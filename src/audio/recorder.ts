import { create } from 'zustand';
import { engine } from './engine';
import { encodeWav } from './wav';
import { bytesToBase64 } from './samples';
import { actions, useStore } from '../state/store';
import { secondsPerTick, TICKS_PER_STEP } from '../model/time';

/**
 * Audio recording into the playlist. While record is armed in audio mode the
 * input stays open; playing the song captures it (raw PCM through an
 * AudioWorklet, no lossy encoding) and stopping turns the take into a Sampler
 * channel plus an audio clip where the recording started.
 */

export interface RecorderStatus {
  state: 'idle' | 'armed' | 'recording' | 'error';
  error?: string;
  /** Input level 0..1 for the meter while armed or recording. */
  level: number;
}

export const useRecorder = create<RecorderStatus>(() => ({ state: 'idle', level: 0 }));

const WORKLET = `
class McCapture extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = e.data === 'start'; if (this.on) this.first = true; }; }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      let peak = 0;
      for (const ch of input) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
      if (this.on) {
        this.port.postMessage({ time: this.first ? currentTime : undefined, peak, data: input.map((ch) => ch.slice(0)) });
        this.first = false;
      } else this.port.postMessage({ peak });
    }
    return true;
  }
}
registerProcessor('mc-capture', McCapture);
`;

let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let capture: AudioWorkletNode | null = null;
let sink: GainNode | null = null;
let chunks: Float32Array[][] = [];
/** Song position (ticks) where the current take started, once its first block arrived. */
let takeStart: number | null = null;
let takes = 0;
const loadedContexts = new WeakSet<BaseAudioContext>();

async function openInput(): Promise<void> {
  const ctx = engine.ensureRunning();
  if (!loadedContexts.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    loadedContexts.add(ctx);
  }
  // Raw input: no echo cancellation, noise suppression or automatic gain.
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
  });
  source = ctx.createMediaStreamSource(stream);
  capture = new AudioWorkletNode(ctx, 'mc-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
  // The capture node must reach the output to be processed; a muted gain keeps it silent.
  sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(capture).connect(sink).connect(ctx.destination);
  capture.port.onmessage = (e: MessageEvent<{ time?: number; peak: number; data?: Float32Array[] }>) => {
    const { time, peak, data } = e.data;
    useRecorder.setState((s) => ({ level: Math.max(peak, s.level * 0.92) }));
    if (!data) return;
    if (time !== undefined) {
      // The take was played along with what was heard: shift it back by the output and input latency.
      const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      takeStart = engine.positionAt(time - latency);
    }
    chunks.push(data);
  };
}

function closeInput(): void {
  stream?.getTracks().forEach((t) => t.stop());
  for (const n of [source, capture, sink]) n?.disconnect();
  stream = null;
  source = capture = sink = null;
}

/** Opens or closes the input to match whether audio recording is armed. */
export async function syncArmed(): Promise<void> {
  const { recording, recordMode } = useStore.getState().ui;
  const want = recording && recordMode === 'audio';
  const state = useRecorder.getState().state;
  if (want && state === 'idle') {
    useRecorder.setState({ state: 'armed', error: undefined });
    try {
      await openInput();
    } catch (err) {
      closeInput();
      useRecorder.setState({ state: 'error', error: err instanceof Error ? err.message : String(err) });
      actions().toggleRecording();
      alert('Não foi possível abrir a entrada de áudio (microfone ou interface). Verifique a permissão de microfone.');
    }
  } else if (!want && state !== 'idle' && state !== 'recording') {
    closeInput();
    useRecorder.setState({ state: 'idle', level: 0 });
  }
}

function startTake(): void {
  if (!capture) return;
  chunks = [];
  takeStart = null;
  capture.port.postMessage('start');
  useRecorder.setState({ state: 'recording' });
}

function finishTake(startPosition: number | null): void {
  capture?.port.postMessage('stop');
  useRecorder.setState({ state: 'armed' });
  const taken = chunks;
  chunks = [];
  if (!taken.length || startPosition === null) return;
  const channels = Math.max(...taken.map((c) => c.length));
  const length = taken.reduce((n, c) => n + c[0].length, 0);
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  let offset = 0;
  for (const block of taken) {
    for (let c = 0; c < channels; c++) data[c].set(block[c] ?? block[0], offset);
    offset += block[0].length;
  }
  const ctx = engine.context!;
  const { project } = useStore.getState();
  const spt = secondsPerTick(project.bpm);
  // Audio captured before the song's start (the play pre-roll) is dropped.
  const skip = Math.min(length - 1, Math.max(0, Math.round(-startPosition * spt * ctx.sampleRate)));
  const kept = length - skip;
  const wav = encodeWav({ numberOfChannels: channels, sampleRate: ctx.sampleRate, length: kept, getChannelData: (c) => data[c].subarray(skip) });
  takes++;
  const name = `Gravação ${takes}.wav`;
  const a = actions();
  a.beginGesture();
  const channelId = a.addChannel('sampler');
  a.setChannelSample(channelId, name, bytesToBase64(new Uint8Array(wav)));
  const used = new Set(project.playlist.clips.map((c) => c.track));
  const track = Math.max(0, project.playlist.tracks.findIndex((_, i) => !used.has(i)));
  const lengthTicks = Math.max(TICKS_PER_STEP, Math.round(kept / ctx.sampleRate / spt));
  a.addAudioClip(channelId, track, Math.max(0, Math.round(startPosition)), lengthTicks);
  a.endGesture();
}

/** Starts and stops takes with the transport (takes are recorded in SONG mode). */
export function installRecorder(): void {
  engine.onChange(() => {
    const { state } = useRecorder.getState();
    if (engine.isPlaying && state === 'armed' && useStore.getState().ui.mode === 'song') startTake();
    else if (!engine.isPlaying && state === 'recording') finishTake(takeStart);
  });
  useStore.subscribe((s, prev) => {
    if (s.ui.recording !== prev.ui.recording || s.ui.recordMode !== prev.ui.recordMode) void syncArmed();
  });
}
