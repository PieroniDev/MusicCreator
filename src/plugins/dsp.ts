/** Small DSP helpers shared by the native plugins. */

export interface ADSR {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

const MIN_TIME = 0.001;

/**
 * ADSR envelope driven by AudioParam automation. The shape is kept
 * analytically so a release can start at any time (also for live notes)
 * without `cancelAndHoldAtTime`, which not every browser implements.
 */
export class Envelope {
  private readonly attack: number;
  private readonly tau: number;

  constructor(
    private readonly param: AudioParam,
    private readonly t0: number,
    private readonly adsr: ADSR,
    private readonly peak: number,
    private readonly base = 0,
  ) {
    this.attack = Math.max(MIN_TIME, adsr.attack);
    this.tau = Math.max(MIN_TIME, adsr.decay / 4);
    param.cancelScheduledValues(t0);
    param.setValueAtTime(base, t0);
    param.linearRampToValueAtTime(base + peak, t0 + this.attack);
    param.setTargetAtTime(base + peak * adsr.sustain, t0 + this.attack, this.tau);
  }

  valueAt(t: number): number {
    if (t <= this.t0) return this.base;
    const attackEnd = this.t0 + this.attack;
    if (t <= attackEnd) return this.base + (this.peak * (t - this.t0)) / this.attack;
    const sustain = this.peak * this.adsr.sustain;
    return this.base + sustain + (this.peak - sustain) * Math.exp(-(t - attackEnd) / this.tau);
  }

  /** Starts the release at `t`; returns the time at which the envelope is effectively silent. */
  release(t: number, release = this.adsr.release): number {
    const v = this.valueAt(t);
    const p = this.param;
    p.cancelScheduledValues(t);
    if (t <= this.t0 + this.attack) p.linearRampToValueAtTime(v, t);
    else p.setValueAtTime(v, t);
    const tau = Math.max(MIN_TIME, release / 4);
    p.setTargetAtTime(this.base, t, tau);
    return t + tau * 6;
  }
}

/** One-shot exponential-ish decay from `peak` to silence starting at `t`. */
export function decayEnvelope(param: AudioParam, t: number, peak: number, decay: number, attack = 0.001): number {
  const tau = Math.max(MIN_TIME, decay / 5);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, tau);
  return t + attack + tau * 7;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    const length = Math.floor(ctx.sampleRate * 2);
    buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic noise keeps offline renders reproducible.
    let seed = 0x12345678;
    for (let i = 0; i < length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    }
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

export function createNoise(ctx: BaseAudioContext): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  return src;
}

/** Offset into the noise buffer so consecutive hits don't sound identical. */
export function noiseOffset(): number {
  return Math.random() * 1.5;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

export const WAVEFORMS: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];
export const WAVEFORM_LABELS = ['Seno', 'Triângulo', 'Serra', 'Quadrada', 'Ruído'];

/** Disconnects nodes, ignoring the errors thrown for already-disconnected ones. */
export function disconnectAll(...nodes: Array<AudioNode | undefined>): void {
  for (const n of nodes) {
    try {
      n?.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

/** Stops scheduled sources, ignoring sources that never started. */
export function stopAll(sources: AudioScheduledSourceNode[], time: number): void {
  for (const s of sources) {
    try {
      s.stop(time);
    } catch {
      /* not started or already stopped */
    }
  }
}
