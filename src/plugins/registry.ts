import type { EffectPlugin, InstrumentPlugin } from './types';
import { trioSynth } from './instruments/trioSynth';
import { fmSynth } from './instruments/fmSynth';
import { drumSynth } from './instruments/drumSynth';
import { sampler } from './instruments/sampler';
import { parametricEq } from './effects/eq';
import { compressor, limiter } from './effects/dynamics';
import { delay } from './effects/delay';
import { reverb } from './effects/reverb';
import { distortion } from './effects/distortion';
import { autoFilter, chorus } from './effects/modulation';

export const INSTRUMENTS: InstrumentPlugin[] = [trioSynth, fmSynth, drumSynth, sampler];
export const EFFECTS: EffectPlugin[] = [parametricEq, compressor, limiter, delay, reverb, distortion, autoFilter, chorus];

const instrumentMap = new Map(INSTRUMENTS.map((p) => [p.id, p]));
const effectMap = new Map(EFFECTS.map((p) => [p.id, p]));

export function getInstrument(id: string): InstrumentPlugin | undefined {
  return instrumentMap.get(id);
}

export function getEffect(id: string): EffectPlugin | undefined {
  return effectMap.get(id);
}

export const DEFAULT_INSTRUMENT = trioSynth.id;
