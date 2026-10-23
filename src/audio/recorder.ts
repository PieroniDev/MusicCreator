import { create } from 'zustand';
import { engine } from './engine';
import { encodeWav } from './wav';
import { bytesToBase64 } from './samples';
import { actions, useStore } from '../state/store';
import { PPQ, secondsPerTick, TICKS_PER_STEP } from '../model/time';
import { splitTake, type TakeStart } from '../model/takes';

/**
 * Audio recording into the playlist. While record is armed in audio mode the
 * chosen input stays open (and can be monitored through the master); playing
 * the song captures it (raw PCM through an AudioWorklet, no lossy encoding)
 * and stopping turns the take into a Sampler channel plus an audio clip where
 * the recording started. While a playlist loop region plays, every pass
 * around the loop becomes its own take on its own track (older ones muted).
 */

export interface AudioInput {
  id: string;
  label: string;
}

export interface RecorderStatus {
  state: 'idle' | 'armed' | 'recording' | 'error';
  error?: string;
  /** Input level 0..1 for the meter while armed or recording. */
  level: number;
  /** Audio inputs the system offers (labels appear once microphone access was granted). */
  inputs: AudioInput[];
  /** Chosen input device (null: the system default). */
  inputId: string | null;
  /** Play the input through the master while armed (use headphones). */
  monitor: boolean;
}

const SETTINGS_KEY = 'musiccreator.recorder';

function loadSettings(): Pick<RecorderStatus, 'inputId' | 'monitor'> {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { inputId: typeof raw.inputId === 'string' ? raw.inputId : null, monitor: raw.monitor === true };
  } catch {
    return { inputId: null, monitor: false };
  }
}

function saveSettings(): void {
  const { inputId, monitor } = useRecorder.getState();
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ inputId, monitor }));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

export const useRecorder = create<RecorderStatus>(() => ({ state: 'idle', level: 0, inputs: [], ...loadSettings() }));

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
let monitorGain: GainNode | null = null;
let chunks: Float32Array[][] = [];
/** The transport when the current take's first block was captured. */
let takeStart: TakeStart | null = null;
let takes = 0;
const loadedContexts = new WeakSet<BaseAudioContext>();

/** Lists the audio inputs (call again after access is granted to get their names). */
export async function refreshInputs(): Promise<void> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Entrada ${i + 1}` }));
    useRecorder.setState({ inputs });
  } catch {
    useRecorder.setState({ inputs: [] });
  }
}

export function setInput(id: string | null): void {
  useRecorder.setState({ inputId: id });
  saveSettings();
  // Reopen with the new device if the input is open.
  if (useRecorder.getState().state === 'armed') {
    closeInput();
    useRecorder.setState({ state: 'idle', level: 0 });
    void syncArmed();
  }
}

export function setMonitor(on: boolean): void {
  useRecorder.setState({ monitor: on });
  saveSettings();
  if (monitorGain) monitorGain.gain.setTargetAtTime(on ? 1 : 0, monitorGain.context.currentTime, 0.01);
}

async function openInput(): Promise<void> {
  const ctx = engine.ensureRunning();
  if (!loadedContexts.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    loadedContexts.add(ctx);
  }
  const { inputId, monitor } = useRecorder.getState();
  // Raw input: no echo cancellation, noise suppression or automatic gain.
  const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: inputId ? { ...raw, deviceId: { exact: inputId } } : raw });
  } catch (err) {
    // The saved device is gone (unplugged): fall back to the default input.
    if (!inputId) throw err;
    useRecorder.setState({ inputId: null });
    saveSettings();
    stream = await navigator.mediaDevices.getUserMedia({ audio: raw });
  }
  void refreshInputs();
  source = ctx.createMediaStreamSource(stream);
  capture = new AudioWorkletNode(ctx, 'mc-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
  // The capture node must reach the output to be processed; a muted gain keeps it silent.
  sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(capture).connect(sink).connect(ctx.destination);
  monitorGain = ctx.createGain();
  monitorGain.gain.value = monitor ? 1 : 0;
  source.connect(monitorGain);
  monitorGain.connect(engine.masterInput ?? ctx.destination);
  capture.port.onmessage = (e: MessageEvent<{ time?: number; peak: number; data?: Float32Array[] }>) => {
    const { time, peak, data } = e.data;
    useRecorder.setState((s) => ({ level: Math.max(peak, s.level * 0.92) }));
    if (!data) return;
    if (time !== undefined) {
      // The take was played along with what was heard: shift it back by the output and input latency.
      const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      takeStart = engine.timelineAt(time - latency);
    }
    chunks.push(data);
  };
}

function closeInput(): void {
  stream?.getTracks().forEach((t) => t.stop());
  for (const n of [source, capture, sink, monitorGain]) n?.disconnect();
  stream = null;
  source = capture = sink = monitorGain = null;
}

/** Opens or closes the input to match whether audio recording is armed. */
export async function syncArmed(): Promise<void> {
  const { recording, recordMode } = useStore.getState().ui;
  const want = recording && recordMode === 'audio';
  const state = useRecorder.getState().state;
  if (want && (state === 'idle' || state === 'error')) {
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

/** A playlist track with no clips on it, other than `taken` (adds one if every track is in use). */
function freeTrack(taken: Set<number>): number {
  const { tracks, clips } = useStore.getState().project.playlist;
  const used = new Set(clips.map((c) => c.track));
  const free = tracks.findIndex((_, i) => !used.has(i) && !taken.has(i));
  return free >= 0 ? free : actions().addPlaylistTrack();
}

function finishTake(start: TakeStart | null): void {
  capture?.port.postMessage('stop');
  useRecorder.setState({ state: 'armed' });
  const taken = chunks;
  chunks = [];
  if (!taken.length || !start) return;
  const channels = Math.max(...taken.map((c) => c.length));
  const length = taken.reduce((n, c) => n + c[0].length, 0);
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  let offset = 0;
  for (const block of taken) {
    for (let c = 0; c < channels; c++) data[c].set(block[c] ?? block[0], offset);
    offset += block[0].length;
  }
  const sampleRate = engine.context!.sampleRate;
  const spt = secondsPerTick(useStore.getState().project.bpm);
  const segments = splitTake(length, start, spt * sampleRate, PPQ * spt * sampleRate);
  if (!segments.length) return;

  takes++;
  const a = actions();
  a.beginGesture();
  const usedTracks = new Set<number>();
  segments.forEach((seg, i) => {
    const frames = seg.to - seg.from;
    const wav = encodeWav({ numberOfChannels: channels, sampleRate, length: frames, getChannelData: (c) => data[c].subarray(seg.from, seg.to) });
    const name = segments.length > 1 ? `Gravação ${takes} (take ${i + 1})` : `Gravação ${takes}`;
    const channelId = a.addChannel('sampler');
    a.setChannelSample(channelId, `${name}.wav`, bytesToBase64(new Uint8Array(wav)));
    const track = freeTrack(usedTracks);
    usedTracks.add(track);
    const lengthTicks = Math.max(TICKS_PER_STEP, Math.round(frames / sampleRate / spt));
    a.addAudioClip(channelId, track, Math.max(0, Math.round(seg.at)), lengthTicks);
    if (segments.length > 1) {
      // Takes are stacked like in other DAWs: only the newest one plays.
      a.updateTrack(track, { name, mute: i < segments.length - 1 });
    }
  });
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
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void refreshInputs());
  void refreshInputs();
}
