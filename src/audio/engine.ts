import type { PlayMode, Project } from '../model/types';
import type { Voice } from '../plugins/types';
import { AudioGraph } from './graph';
import { loopedEvents, patternEvents, songEvents } from '../model/events';
import { findPattern, patternLength, songLength } from '../model/pattern';
import { PPQ, secondsPerTick, TICKS_PER_BAR, wrap } from '../model/time';

export interface TransportState {
  mode: PlayMode;
  patternId: string | null;
  /** Song position playback starts from (song mode). */
  songStart: number;
  metronome: boolean;
}

export interface EngineHost {
  getProject(): Project;
  getTransport(): TransportState;
}

/** How far ahead notes are scheduled, in seconds. */
const LOOKAHEAD = 0.12;
const TIMER_INTERVAL_MS = 25;
const START_DELAY = 0.05;

/**
 * A timer that keeps firing in background tabs (where setInterval is
 * throttled to once a second, too slow for the lookahead scheduler).
 */
function createTimer(callback: () => void): { start(): void; stop(): void } {
  try {
    const src = `let id=null;onmessage=e=>{if(e.data==='start'){clearInterval(id);id=setInterval(()=>postMessage(0),${TIMER_INTERVAL_MS});}else{clearInterval(id);id=null;}}`;
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = callback;
    return { start: () => worker.postMessage('start'), stop: () => worker.postMessage('stop') };
  } catch {
    let id: ReturnType<typeof setInterval> | undefined;
    return {
      start: () => {
        clearInterval(id);
        id = setInterval(callback, TIMER_INTERVAL_MS);
      },
      stop: () => clearInterval(id),
    };
  }
}

/**
 * Real-time engine: owns the AudioContext and the project graph, runs the
 * transport (lookahead scheduler over a looping timeline) and plays preview
 * notes. The timeline is tracked as "unwrapped" ticks `u` since playback
 * started; the loop position is (p0 + u) mod loopLength.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private host: EngineHost | null = null;
  private readonly timer = createTimer(() => this.schedule());
  private readonly listeners = new Set<() => void>();

  private playing = false;
  private anchorTime = 0;
  private anchorU = 0;
  private nextU = 0;
  private p0 = 0;
  private loopLength = TICKS_PER_BAR;
  private spt = secondsPerTick(120);
  private lastMode: PlayMode = 'pattern';

  attach(host: EngineHost): void {
    this.host = host;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Creates/resumes the AudioContext. Must run from a user gesture the first time. */
  ensureRunning(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.graph = new AudioGraph(this.ctx, { meters: true });
      if (this.host) this.graph.sync(this.host.getProject());
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Called on every project change. */
  sync(project: Project): void {
    if (!this.graph) return;
    const newSpt = secondsPerTick(project.bpm);
    if (this.playing && newSpt !== this.spt && this.ctx) {
      // Re-anchor so the tempo change takes effect from now on without a jump.
      const now = this.ctx.currentTime;
      if (now > this.anchorTime) {
        this.anchorU += (now - this.anchorTime) / this.spt;
        this.anchorTime = now;
      }
    }
    this.spt = newSpt;
    this.graph.sync(project);
  }

  play(): void {
    if (!this.host) return;
    const ctx = this.ensureRunning();
    const project = this.host.getProject();
    const transport = this.host.getTransport();
    this.graph!.sync(project);
    this.killAll();
    this.spt = secondsPerTick(project.bpm);
    this.loopLength = this.computeLoopLength(project, transport);
    this.lastMode = transport.mode;
    this.p0 = transport.mode === 'song' ? wrap(transport.songStart, this.loopLength) : 0;
    this.anchorTime = ctx.currentTime + START_DELAY;
    this.anchorU = 0;
    this.nextU = 0;
    this.playing = true;
    this.timer.start();
    this.schedule();
    this.emit();
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.timer.stop();
    this.killAll();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  /** Restarts playback from the transport's start position (e.g. after a ruler click). */
  restart(): void {
    if (this.playing) this.play();
  }

  /** Current position on the playing timeline in ticks, or null when stopped. */
  getPosition(): number | null {
    if (!this.playing || !this.ctx) return null;
    const u = Math.max(0, this.anchorU + (this.ctx.currentTime - this.anchorTime) / this.spt);
    return wrap(this.p0 + u, this.loopLength);
  }

  /** Plays a note now (piano roll clicks, keyboard); release it with `voice.release`. */
  previewNote(channelId: string, key: number, velocity = 0.8): Voice | null {
    const ctx = this.ensureRunning();
    if (this.host && this.graph) this.graph.sync(this.host.getProject());
    return this.graph?.playNote(channelId, key, velocity, ctx.currentTime) ?? null;
  }

  readPeak(trackIndex: number): [number, number] {
    return this.graph?.readPeak(trackIndex) ?? [0, 0];
  }

  private killAll(): void {
    this.graph?.killAll();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private computeLoopLength(project: Project, transport: TransportState): number {
    if (transport.mode === 'song') return songLength(project);
    const pattern = findPattern(project, transport.patternId) ?? project.patterns[0];
    return pattern ? patternLength(pattern) : TICKS_PER_BAR;
  }

  private schedule(): void {
    if (!this.playing || !this.ctx || !this.graph || !this.host) return;
    const ctx = this.ctx;
    const project = this.host.getProject();
    const transport = this.host.getTransport();

    // Keep the playing position when the loop changes size or the mode changes.
    const length = this.computeLoopLength(project, transport);
    if (transport.mode !== this.lastMode) {
      this.lastMode = transport.mode;
      this.loopLength = length;
      this.p0 = wrap((transport.mode === 'song' ? transport.songStart : 0) - this.nextU, length);
    } else if (length !== this.loopLength) {
      const position = wrap(this.p0 + this.nextU, this.loopLength);
      this.loopLength = length;
      this.p0 = wrap(position, length) - this.nextU;
    }

    const horizonU = this.anchorU + (ctx.currentTime + LOOKAHEAD - this.anchorTime) / this.spt;
    if (horizonU <= this.nextU) return;
    const span = horizonU - this.nextU;
    const position = this.p0 + this.nextU;
    const timeOf = (offset: number) => this.anchorTime + (this.nextU + offset - this.anchorU) * this.spt;

    const patternId = transport.patternId ?? project.patterns[0]?.id;
    const source =
      transport.mode === 'song'
        ? (from: number, to: number) => songEvents(project, from, to)
        : (from: number, to: number) => (patternId ? patternEvents(project, patternId, from, to) : []);

    for (const ev of loopedEvents(source, this.loopLength, position, span)) {
      if (!this.graph.isChannelAudible(ev.channelId)) continue;
      const time = Math.max(ctx.currentTime, timeOf(ev.offset));
      this.graph.playNote(ev.channelId, ev.key, ev.velocity, time, ev.length * this.spt);
    }

    if (transport.metronome) {
      const beats = (from: number, to: number) => {
        const out = [];
        for (let t = Math.ceil(from / PPQ) * PPQ; t < to; t += PPQ) {
          out.push({ channelId: '', key: t % TICKS_PER_BAR === 0 ? 1 : 0, velocity: 1, start: t, length: 0 });
        }
        return out;
      };
      for (const ev of loopedEvents(beats, this.loopLength, position, span)) {
        this.click(Math.max(ctx.currentTime, timeOf(ev.offset)), ev.key === 1);
      }
    }
    this.nextU = horizonU;
  }

  private click(time: number, accent: boolean): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, time + 0.001);
    gain.gain.setTargetAtTime(0, time + 0.001, 0.012);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.1);
    osc.onended = () => gain.disconnect();
  }
}

export const engine = new AudioEngine();
