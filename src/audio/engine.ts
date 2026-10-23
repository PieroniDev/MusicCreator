import type { PlayMode, Project } from '../model/types';
import type { Voice } from '../plugins/types';
import { AudioGraph } from './graph';
import { audioClipsAt, loopedEvents, patternEvents, songAudioEvents, songEvents, swingDelay } from '../model/events';
import { automationAt, hasAutomation, hasTempoAutomation, instrumentAutomationAt, tempoAt } from '../model/automation';
import { findPattern, patternLength, songLength } from '../model/pattern';
import { barTicks, beatTicks, PPQ, secondsPerTick, TICKS_PER_BAR, wrap } from '../model/time';

export interface TransportState {
  mode: PlayMode;
  patternId: string | null;
  /** Song position playback starts from (song mode). */
  songStart: number;
  metronome: boolean;
  /** Song mode: a region of the playlist to loop instead of the whole song. */
  loop: { start: number; end: number } | null;
  /** Audio recording is armed: without a loop region the song keeps going past its end. */
  recordingAudio: boolean;
}

/** Room to keep recording past the end of the song (in bars). */
const RECORD_ROOM_BARS = 512;

/** Where the timeline stands at some context time (see AudioEngine.timelineAt). */
export interface TimelinePoint {
  /** Ticks since playback started (negative before the first beat played). */
  u: number;
  /** Position inside the loop where playback started. */
  p0: number;
  loopStart: number;
  loopLength: number;
  region: boolean;
}

interface LoopRange {
  start: number;
  length: number;
  /** Whether it is a loop region (positions outside it jump to its start). */
  region: boolean;
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
 * started; the position is loopStart + ((p0 + u) mod loopLength).
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
  private loopStart = 0;
  private loopLength = TICKS_PER_BAR;
  private region = false;
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

  /** The tempo playing now (it follows tempo automation in song mode). */
  get tempo(): number {
    return 60 / (this.spt * PPQ);
  }

  /** Whether tempo automation drives the tempo (song mode with a tempo clip). */
  private tempoAutomated(project: Project): boolean {
    return this.lastMode === 'song' && hasTempoAutomation(project);
  }

  /**
   * Changes the tempo from timeline position `atU` on: positions before it
   * keep the times they were scheduled at.
   */
  private retempo(bpm: number, atU: number): void {
    const spt = secondsPerTick(bpm);
    if (spt === this.spt) return;
    this.anchorTime += (atU - this.anchorU) * this.spt;
    this.anchorU = atU;
    this.spt = spt;
    this.graph?.setTempo(bpm);
    this.updateBeatAnchor();
  }

  /** Called on every project change. */
  sync(project: Project): void {
    if (!this.graph) return;
    if (this.playing && this.tempoAutomated(project)) {
      // The tempo comes from the automation clip (see schedule).
      this.graph.sync(project);
      return;
    }
    const newSpt = secondsPerTick(project.bpm);
    if (this.playing && newSpt !== this.spt && this.ctx) {
      // Re-anchor so the tempo change takes effect from now on without a jump.
      const now = this.ctx.currentTime;
      if (now > this.anchorTime) {
        this.anchorU += (now - this.anchorTime) / this.spt;
        this.anchorTime = now;
      }
    }
    const tempoChanged = newSpt !== this.spt;
    this.spt = newSpt;
    this.graph.sync(project);
    if (this.playing && tempoChanged) this.updateBeatAnchor();
  }

  play(): void {
    if (!this.host) return;
    const ctx = this.ensureRunning();
    const project = this.host.getProject();
    const transport = this.host.getTransport();
    this.graph!.sync(project);
    this.killAll();
    this.spt = secondsPerTick(project.bpm);
    this.setLoop(this.computeLoop(project, transport));
    this.lastMode = transport.mode;
    this.p0 = transport.mode === 'song' ? this.relative(transport.songStart) : 0;
    if (this.tempoAutomated(project)) {
      const bpm = tempoAt(project, this.loopStart + this.p0);
      this.spt = secondsPerTick(bpm);
      this.graph!.setTempo(bpm);
    } else this.graph!.setTempo(null);
    this.anchorTime = ctx.currentTime + START_DELAY;
    this.anchorU = 0;
    this.nextU = 0;
    this.playing = true;
    this.updateBeatAnchor();
    if (transport.mode === 'song') this.resumeAudioClips(project, this.loopStart + this.p0, this.anchorTime);
    this.timer.start();
    this.schedule();
    this.emit();
  }

  private setLoop(loop: LoopRange): void {
    this.loopStart = loop.start;
    this.loopLength = loop.length;
    this.region = loop.region;
  }

  /** Position inside the loop (ticks from its start) for a song position. */
  private relative(position: number): number {
    const x = position - this.loopStart;
    if (x >= 0 && x < this.loopLength) return x;
    return this.region ? 0 : wrap(x, this.loopLength);
  }

  /** Tells tempo-synced effects when the song's tick 0 (a bar start) plays. */
  private updateBeatAnchor(): void {
    if (!this.graph) return;
    const timeAtNext = this.anchorTime + (this.nextU - this.anchorU) * this.spt;
    this.graph.setBeatAnchor(timeAtNext - (this.loopStart + wrap(this.p0 + this.nextU, this.loopLength)) * this.spt);
  }

  /** Starting in the middle of audio clips: play them from the right point of the sample. */
  private resumeAudioClips(project: Project, position: number, time: number): void {
    for (const clip of audioClipsAt(project, position)) {
      if (!this.graph?.isChannelAudible(clip.channelId)) continue;
      const elapsed = clip.elapsed * this.spt * clip.speed;
      this.graph.playClip(clip.channelId, time, clip.sampleOffset + elapsed, (clip.length - clip.elapsed) * this.spt);
    }
  }

  /** Length of the timeline being played (pattern or song), in ticks. */
  get loopTicks(): number {
    return this.loopLength;
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.timer.stop();
    this.killAll();
    // Parameters and the tempo go back to their project values.
    this.graph?.setAutomation(new Map());
    this.graph?.setTempo(null);
    if (this.host) this.spt = secondsPerTick(this.host.getProject().bpm);
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
    return this.loopStart + wrap(this.p0 + u, this.loopLength);
  }

  /**
   * The position the listener hears right now: the output plays a little
   * behind the context clock, so a note played "on the beat" by ear gets
   * recorded on the beat.
   */
  getHeardPosition(): number | null {
    const pos = this.getPosition();
    if (pos === null || !this.ctx) return null;
    const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return this.loopStart + wrap(pos - this.loopStart - latency / this.spt, this.loopLength);
  }

  /**
   * Timeline position playing at context time `time`, not wrapped at the loop
   * end: loopStart + p0 + u (subtract loopStart and wrap at loopTicks to get
   * the position inside the loop).
   */
  positionAt(time: number): number | null {
    if (!this.playing) return null;
    return this.loopStart + this.p0 + this.anchorU + (time - this.anchorTime) / this.spt;
  }

  /** Song position where the loop starts (0 unless a playlist loop region plays). */
  get loopStartTick(): number {
    return this.loopStart;
  }

  /** The timeline at context time `time` (recordings use it to place and split takes). */
  timelineAt(time: number): TimelinePoint | null {
    if (!this.playing) return null;
    return {
      u: this.anchorU + (time - this.anchorTime) / this.spt,
      p0: this.p0,
      loopStart: this.loopStart,
      loopLength: this.loopLength,
      region: this.region,
    };
  }

  /** Input of the master track (live input monitoring plays through the master effects). */
  get masterInput(): AudioNode | null {
    return this.graph?.masterInput ?? null;
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

  private computeLoop(project: Project, transport: TransportState): LoopRange {
    if (transport.mode === 'song') {
      const r = transport.loop;
      if (r && r.end > r.start) return { start: r.start, length: r.end - r.start, region: true };
      const extra = transport.recordingAudio ? RECORD_ROOM_BARS * barTicks(project.timeSig) : 0;
      return { start: 0, length: songLength(project) + extra, region: false };
    }
    const pattern = findPattern(project, transport.patternId) ?? project.patterns[0];
    const bar = barTicks(project.timeSig);
    return { start: 0, length: pattern ? patternLength(pattern, bar) : bar, region: false };
  }

  private schedule(): void {
    if (!this.playing || !this.ctx || !this.graph || !this.host) return;
    const ctx = this.ctx;
    const project = this.host.getProject();
    const transport = this.host.getTransport();

    // Keep the playing position when the loop changes or the mode changes.
    const loop = this.computeLoop(project, transport);
    if (transport.mode !== this.lastMode) {
      this.lastMode = transport.mode;
      this.setLoop(loop);
      this.p0 = (transport.mode === 'song' ? this.relative(transport.songStart) : 0) - this.nextU;
      this.updateBeatAnchor();
    } else if (loop.start !== this.loopStart || loop.length !== this.loopLength || loop.region !== this.region) {
      const position = this.loopStart + wrap(this.p0 + this.nextU, this.loopLength);
      this.setLoop(loop);
      this.p0 = this.relative(position) - this.nextU;
      this.updateBeatAnchor();
    }

    // Tempo automation: the tempo at the next position to schedule applies from there on.
    if (this.tempoAutomated(project)) {
      this.retempo(tempoAt(project, this.loopStart + wrap(this.p0 + this.nextU, this.loopLength)), this.nextU);
    } else if (secondsPerTick(project.bpm) !== this.spt) {
      this.retempo(project.bpm, this.nextU);
      this.graph.setTempo(null);
    }

    const horizonU = this.anchorU + (ctx.currentTime + LOOKAHEAD - this.anchorTime) / this.spt;
    if (horizonU <= this.nextU) return;
    const span = horizonU - this.nextU;
    const position = this.p0 + this.nextU;
    const timeOf = (offset: number) => this.anchorTime + (this.nextU + offset - this.anchorU) * this.spt;

    const song = transport.mode === 'song';
    const patternId = transport.patternId ?? project.patterns[0]?.id;
    // Sources work in loop coordinates; `at` keeps the song position (for swing and automation).
    const ls = this.loopStart;
    const inLoop =
      <T extends { start: number }>(src: (from: number, to: number) => T[]) =>
      (from: number, to: number) =>
        src(from + ls, to + ls).map((e) => ({ ...e, start: e.start - ls, at: e.start }));
    const source = song
      ? inLoop((from, to) => songEvents(project, from, to))
      : inLoop((from, to) => (patternId ? patternEvents(project, patternId, from, to) : []));
    const automated = song && hasAutomation(project);

    for (const ev of loopedEvents(source, this.loopLength, position, span)) {
      if (!this.graph.isChannelAudible(ev.channelId)) continue;
      const time = Math.max(ctx.currentTime, timeOf(ev.offset + swingDelay(ev.at, project.swing)));
      const params = automated ? instrumentAutomationAt(project, ev.channelId, ev.at) : undefined;
      this.graph.playNote(ev.channelId, ev.key, ev.velocity, time, ev.length * this.spt, params, ev);
    }

    if (song) {
      const clips = inLoop((from, to) => songAudioEvents(project, from, to));
      for (const ev of loopedEvents(clips, this.loopLength, position, span)) {
        if (!this.graph.isChannelAudible(ev.channelId)) continue;
        const time = Math.max(ctx.currentTime, timeOf(ev.offset));
        this.graph.playClip(ev.channelId, time, ev.sampleOffset, ev.length * this.spt);
      }
      // Each time the loop wraps, audio clips that began before the loop start pick up from there.
      if (ls > 0) {
        const wraps = (from: number, to: number) => (from === 0 && to > 0 ? [{ start: 0 }] : []);
        for (const w of loopedEvents(wraps, this.loopLength, position, span)) {
          if (w.offset > 0 || this.nextU > 0) this.resumeAudioClips(project, ls, Math.max(ctx.currentTime, timeOf(w.offset)));
        }
      }
    }

    // Automation follows what is being heard now, not the lookahead window.
    const heard = this.getPosition();
    this.graph.setAutomation(automated && heard !== null ? automationAt(project, heard) : new Map());

    if (transport.metronome) {
      const beat = beatTicks(project.timeSig);
      const bar = barTicks(project.timeSig);
      const beats = inLoop((from: number, to: number) => {
        const out = [];
        for (let t = Math.ceil(from / beat) * beat; t < to; t += beat) {
          out.push({ channelId: '', key: t % bar === 0 ? 1 : 0, velocity: 1, start: t, length: 0 });
        }
        return out;
      });
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
