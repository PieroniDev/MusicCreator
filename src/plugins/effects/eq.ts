import type { EffectPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { dbToGain, disconnectAll } from '../dsp';
import { smooth } from './common';

const params: ParamSpec[] = [
  { id: 'lowCut', name: 'Corte grave', min: 10, max: 1000, default: 10, scale: 'log', unit: 'Hz', group: 'Cortes' },
  { id: 'highCut', name: 'Corte agudo', min: 1000, max: 22000, default: 22000, scale: 'log', unit: 'Hz', group: 'Cortes' },
  { id: 'lowFreq', name: 'Freq.', min: 20, max: 1000, default: 100, scale: 'log', unit: 'Hz', group: 'Graves (shelf)' },
  { id: 'lowGain', name: 'Ganho', min: -18, max: 18, default: 0, step: 0.1, unit: 'dB', group: 'Graves (shelf)' },
  { id: 'mid1Freq', name: 'Freq.', min: 40, max: 8000, default: 400, scale: 'log', unit: 'Hz', group: 'Médio 1' },
  { id: 'mid1Gain', name: 'Ganho', min: -18, max: 18, default: 0, step: 0.1, unit: 'dB', group: 'Médio 1' },
  { id: 'mid1Q', name: 'Q', min: 0.1, max: 12, default: 1, scale: 'log', group: 'Médio 1' },
  { id: 'mid2Freq', name: 'Freq.', min: 200, max: 16000, default: 2500, scale: 'log', unit: 'Hz', group: 'Médio 2' },
  { id: 'mid2Gain', name: 'Ganho', min: -18, max: 18, default: 0, step: 0.1, unit: 'dB', group: 'Médio 2' },
  { id: 'mid2Q', name: 'Q', min: 0.1, max: 12, default: 1, scale: 'log', group: 'Médio 2' },
  { id: 'highFreq', name: 'Freq.', min: 1000, max: 20000, default: 8000, scale: 'log', unit: 'Hz', group: 'Agudos (shelf)' },
  { id: 'highGain', name: 'Ganho', min: -18, max: 18, default: 0, step: 0.1, unit: 'dB', group: 'Agudos (shelf)' },
  { id: 'output', name: 'Saída', min: -24, max: 24, default: 0, step: 0.1, unit: 'dB', group: 'Saída' },
];

export const parametricEq: EffectPlugin = {
  kind: 'effect',
  id: 'eq',
  name: 'Parametric EQ',
  description: 'Equalizador de 4 bandas com filtros de corte de graves e agudos.',
  params,
  presets: [
    { name: 'Neutro', params: {} },
    { name: 'Limpar graves', params: { lowCut: 120 } },
    { name: 'Brilho', params: { highGain: 4, highFreq: 9000, mid2Gain: 1.5, mid2Freq: 4000 } },
    { name: 'Telefone', params: { lowCut: 400, highCut: 3200, mid1Freq: 1200, mid1Gain: 6, mid1Q: 1.5 } },
    { name: 'Kick com peso', params: { lowFreq: 70, lowGain: 4, mid1Freq: 350, mid1Gain: -4, mid1Q: 1.4, mid2Freq: 4000, mid2Gain: 2 } },
  ],

  create(ctx, values) {
    const p = paramReader(params, values);
    const nyquist = ctx.sampleRate / 2 - 100;
    const mk = (type: BiquadFilterType) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      return f;
    };
    const lowCut = mk('highpass');
    const low = mk('lowshelf');
    const mid1 = mk('peaking');
    const mid2 = mk('peaking');
    const high = mk('highshelf');
    const highCut = mk('lowpass');
    const out = ctx.createGain();
    const chain = [lowCut, low, mid1, mid2, high, highCut];
    for (let i = 1; i < chain.length; i++) chain[i - 1].connect(chain[i]);
    highCut.connect(out);

    const apply = (id: string, v: number, ramp: boolean) => {
      const set = (param: AudioParam, value: number) => (ramp ? smooth(param, value, ctx) : (param.value = value));
      switch (id) {
        case 'lowCut': return set(lowCut.frequency, v);
        case 'highCut': return set(highCut.frequency, Math.min(v, nyquist));
        case 'lowFreq': return set(low.frequency, v);
        case 'lowGain': return set(low.gain, v);
        case 'mid1Freq': return set(mid1.frequency, v);
        case 'mid1Gain': return set(mid1.gain, v);
        case 'mid1Q': return set(mid1.Q, v);
        case 'mid2Freq': return set(mid2.frequency, Math.min(v, nyquist));
        case 'mid2Gain': return set(mid2.gain, v);
        case 'mid2Q': return set(mid2.Q, v);
        case 'highFreq': return set(high.frequency, Math.min(v, nyquist));
        case 'highGain': return set(high.gain, v);
        case 'output': return set(out.gain, dbToGain(v));
      }
    };
    lowCut.Q.value = 0.707;
    highCut.Q.value = 0.707;
    for (const spec of params) apply(spec.id, p(spec.id), false);

    return {
      input: lowCut,
      output: out,
      setParam: (id, v) => apply(id, v, true),
      dispose: () => disconnectAll(...chain, out),
    };
  },
};
