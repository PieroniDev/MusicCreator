import type { EffectPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { dbToGain, disconnectAll } from '../dsp';
import { smooth } from './common';

const BANDS = [
  { id: 'low', name: 'Graves' },
  { id: 'mid', name: 'Médios' },
  { id: 'high', name: 'Agudos' },
];

const params: ParamSpec[] = [
  { id: 'lowFreq', name: 'Corte G/M', min: 40, max: 1000, default: 180, scale: 'log', unit: 'Hz', group: 'Divisão' },
  { id: 'highFreq', name: 'Corte M/A', min: 1000, max: 12000, default: 3500, scale: 'log', unit: 'Hz', group: 'Divisão' },
  ...BANDS.flatMap((b): ParamSpec[] => [
    { id: `${b.id}Threshold`, name: 'Limiar', min: -60, max: 0, default: -20, step: 0.1, unit: 'dB', group: b.name },
    { id: `${b.id}Ratio`, name: 'Razão', min: 1, max: 20, default: 3, step: 0.1, unit: ':1', group: b.name },
    { id: `${b.id}Gain`, name: 'Ganho', min: -12, max: 12, default: 0, step: 0.1, unit: 'dB', group: b.name },
  ]),
  { id: 'attack', name: 'Ataque', min: 0.001, max: 0.3, default: 0.01, scale: 'log', unit: 's', group: 'Tempo' },
  { id: 'release', name: 'Relaxam.', min: 0.02, max: 1, default: 0.2, scale: 'log', unit: 's', group: 'Tempo' },
  { id: 'output', name: 'Saída', min: -12, max: 12, default: 0, step: 0.1, unit: 'dB', group: 'Saída' },
];

/**
 * Three-band compressor: Linkwitz–Riley style crossovers (two cascaded
 * Butterworth sections) split the signal, each band has its own compressor
 * and gain, and the bands are summed again.
 */
export const multibandCompressor: EffectPlugin = {
  kind: 'effect',
  id: 'multiband',
  name: 'Multiband Compressor',
  description: 'Compressor de 3 bandas (graves, médios, agudos) para controlar e encorpar a mixagem ou o master.',
  params,
  presets: [
    { name: 'Master suave', params: {} },
    { name: 'Graves firmes', params: { lowThreshold: -26, lowRatio: 5, lowGain: 2 } },
    { name: 'Brilho controlado', params: { highThreshold: -28, highRatio: 4, highGain: 1.5 } },
    { name: 'Esmagar tudo', params: { lowThreshold: -35, midThreshold: -35, highThreshold: -35, lowRatio: 8, midRatio: 8, highRatio: 8, lowGain: 6, midGain: 6, highGain: 6 } },
  ],

  create(ctx, values) {
    const p = paramReader(params, values);
    const input = ctx.createGain();
    const out = ctx.createGain();
    const filter = (type: BiquadFilterType) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.Q.value = Math.SQRT1_2;
      return f;
    };
    // Each crossover side is two 2nd-order sections (24 dB/oct).
    const lowLP = [filter('lowpass'), filter('lowpass')];
    const midHP = [filter('highpass'), filter('highpass')];
    const midLP = [filter('lowpass'), filter('lowpass')];
    const highHP = [filter('highpass'), filter('highpass')];
    const chain = (from: AudioNode, nodes: AudioNode[]) => nodes.reduce((prev, n) => prev.connect(n), from);
    const bands = BANDS.map(() => ({ comp: ctx.createDynamicsCompressor(), gain: ctx.createGain() }));
    chain(chain(input, lowLP), [bands[0].comp, bands[0].gain, out]);
    chain(chain(chain(input, midHP), midLP), [bands[1].comp, bands[1].gain, out]);
    chain(chain(input, highHP), [bands[2].comp, bands[2].gain, out]);

    const apply = (id: string, v: number, ramp: boolean) => {
      const set = (param: AudioParam, value: number) => (ramp ? smooth(param, value, ctx) : (param.value = value));
      const nyquist = ctx.sampleRate / 2 - 100;
      if (id === 'lowFreq') for (const f of [...lowLP, ...midHP]) set(f.frequency, Math.min(v, nyquist));
      else if (id === 'highFreq') for (const f of [...midLP, ...highHP]) set(f.frequency, Math.min(v, nyquist));
      else if (id === 'attack') for (const b of bands) set(b.comp.attack, v);
      else if (id === 'release') for (const b of bands) set(b.comp.release, v);
      else if (id === 'output') set(out.gain, dbToGain(v));
      else {
        const i = BANDS.findIndex((b) => id.startsWith(b.id));
        const band = bands[i];
        if (!band) return;
        if (id.endsWith('Threshold')) set(band.comp.threshold, v);
        else if (id.endsWith('Ratio')) set(band.comp.ratio, v);
        else if (id.endsWith('Gain')) set(band.gain.gain, dbToGain(v));
      }
    };
    for (const b of bands) b.comp.knee.value = 6;
    for (const spec of params) apply(spec.id, p(spec.id), false);

    return {
      input,
      output: out,
      setParam: (id, v) => apply(id, v, true),
      dispose: () => disconnectAll(input, out, ...lowLP, ...midHP, ...midLP, ...highHP, ...bands.flatMap((b) => [b.comp, b.gain])),
    };
  },
};
