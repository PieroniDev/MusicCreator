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
