import type { Voice } from './types';
import { disconnectAll, Envelope, stopAll } from './dsp';

/**
 * Bookkeeping shared by the native instruments: tracks the sources, nodes and
 * envelopes of one note, ends it on release and frees everything once all
 * sources have stopped. Plugins connect their signal chain into `out`.
 */
export class NodeVoice implements Voice {
  readonly out: GainNode;
  onEnded?: () => void;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private readonly envelopes: Envelope[] = [];
  private endedSources = 0;
  private released = false;
  private killed = false;
  private finished = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.connect(destination);
  }

  source<T extends AudioScheduledSourceNode>(src: T): T {
    this.sources.push(src);
    src.onended = () => {
      this.endedSources++;
      if (this.endedSources >= this.sources.length) this.finish();
    };
    return src;
  }

  node<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  /** Envelopes that shape the note's release (amp, filter, ...). */
  envelope(env: Envelope): Envelope {
    this.envelopes.push(env);
    return env;
  }

  /**
   * A voice with no audible source (every oscillator turned off, no sample)
   * still needs one so it ends and gets cleaned up like any other.
   */
  ensureSource(time: number): void {
    if (this.sources.length > 0) return;
    const silent = this.source(this.ctx.createConstantSource());
    silent.offset.value = 0;
    silent.connect(this.out);
    silent.start(time);
  }

  /** One-shot sounds: the note ends by itself at `time`. */
  endAt(time: number): void {
    stopAll(this.sources, time);
  }

  release(time: number): void {
    if (this.released || this.killed || this.envelopes.length === 0) return;
    this.released = true;
    let end = time;
    for (const env of this.envelopes) end = Math.max(end, env.release(time));
    stopAll(this.sources, end);
  }

  kill(): void {
    if (this.killed || this.finished) return;
    this.killed = true;
    const now = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(1, now);
    g.linearRampToValueAtTime(0, now + 0.012);
    stopAll(this.sources, now + 0.03);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    disconnectAll(...this.sources, ...this.nodes, this.out);
    this.onEnded?.();
  }
}
