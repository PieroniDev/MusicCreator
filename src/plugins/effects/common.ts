/**
 * Equal-power dry/wet mixer used by effects that blend a processed signal
 * with the original.
 */
export class DryWet {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly dry: GainNode;
  readonly wet: GainNode;

  constructor(ctx: BaseAudioContext, mix: number) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.wet.connect(this.output);
    this.setMix(mix);
  }

  setMix(mix: number): void {
    const m = Math.min(1, Math.max(0, mix));
    this.dry.gain.value = Math.cos((m * Math.PI) / 2);
    this.wet.gain.value = Math.sin((m * Math.PI) / 2);
  }
}

/** Ramps an AudioParam to a new value to avoid zipper noise on knob moves. */
export function smooth(param: AudioParam, value: number, ctx: BaseAudioContext, time = 0.02): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + time);
}

/** Note-value labels and their length in beats, for tempo-synced effects. */
export const SYNC_DIVISIONS: Array<{ label: string; beats: number }> = [
  { label: '1/32', beats: 0.125 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16 pont.', beats: 0.375 },
  { label: '1/8 tercina', beats: 1 / 3 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8 pont.', beats: 0.75 },
  { label: '1/4', beats: 1 },
  { label: '1/4 pont.', beats: 1.5 },
  { label: '1/2', beats: 2 },
  { label: '1 compasso', beats: 4 },
];

/**
 * A gain that follows a repeating shape (one cycle = `period` seconds), used
 * by tempo-synced effects. The shape is rendered into a looping buffer that
 * drives the gain, so it is sample-accurate. With a beat anchor (a context
 * time where a beat starts) cycles line up with the song's beats.
 */
export class PeriodicGain {
  readonly node: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private anchor: number;

  constructor(
    private readonly ctx: BaseAudioContext,
    private shape: (phase: number) => number,
    private period: number,
  ) {
    this.node = ctx.createGain();
    // The looping source adds the shape on top of an intrinsic gain of 0.
    this.node.gain.value = 0;
    this.anchor = ctx.currentTime;
    this.restart();
  }

  setShape(shape: (phase: number) => number, period: number): void {
    this.shape = shape;
    this.period = period;
    this.restart();
  }

  /** Aligns cycles so one starts at `beatTime` (and every period before/after it). */
  sync(beatTime: number): void {
    this.anchor = beatTime;
    this.restart();
  }

  dispose(): void {
    try {
      this.source?.stop();
    } catch {
      /* never started */
    }
    this.source?.disconnect();
    this.node.disconnect();
  }

  private restart(): void {
    const ctx = this.ctx;
    const length = Math.max(2, Math.round(this.period * ctx.sampleRate));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = this.shape(i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // The buffer is a whole number of samples; stretch it to the exact period so cycles never drift.
    source.playbackRate.value = length / (this.period * ctx.sampleRate);
    source.connect(this.node.gain);
    // Start now, at the point of the cycle the anchor implies, so changes apply at once without losing phase.
    const now = ctx.currentTime;
    const elapsed = now - this.anchor;
    const phase = (((elapsed % this.period) + this.period) % this.period) / this.period;
    source.start(now, (phase * length) / ctx.sampleRate);
    const old = this.source;
    this.source = source;
    if (old) {
      try {
        old.stop(now);
      } catch {
        /* never started */
      }
      old.onended = () => old.disconnect();
    }
  }
}

/** Beats per tempo-synced rate option. */
export const RATE_DIVISIONS: Array<{ label: string; beats: number }> = [
  { label: '1 compasso', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8 tercina', beats: 1 / 3 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16 tercina', beats: 1 / 6 },
  { label: '1/32', beats: 0.125 },
];
