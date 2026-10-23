import type { EffectPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { disconnectAll } from '../dsp';
import { DryWet, PeriodicGain, RATE_DIVISIONS } from './common';
import type { ParamValues } from '../../model/types';

/** Shared plumbing of the tempo-synced volume shapers. */
function shaper(
  name: string,
  id: string,
  description: string,
  params: ParamSpec[],
  presets: EffectPlugin['presets'],
  shapeOf: (read: (id: string) => number) => (phase: number) => number,
): EffectPlugin {
  return {
    kind: 'effect',
    id,
    name,
    description,
    params,
    presets,
    create(ctx, values, env) {
      const defaults = paramReader(params, values);
      const current: ParamValues = { ...values };
      const read = (p: string) => (typeof current[p] === 'number' ? current[p] : defaults(p));
      let bpm = env.bpm;
      const period = () => (RATE_DIVISIONS[Math.round(read('rate'))] ?? RATE_DIVISIONS[2]).beats * (60 / bpm);
      const mix = new DryWet(ctx, read('mix'));
      const gate = new PeriodicGain(ctx, shapeOf(read), period());
      mix.input.connect(gate.node);
      gate.node.connect(mix.wet);
      const update = () => gate.setShape(shapeOf(read), period());
      return {
        input: mix.input,
        output: mix.output,
        setParam(p, v) {
          current[p] = v;
          if (p === 'mix') mix.setMix(v);
          else update();
        },
        setTempo(newBpm) {
          bpm = newBpm;
          update();
        },
        syncBeat(beatTime) {
          gate.sync(beatTime);
        },
        dispose() {
          gate.dispose();
          disconnectAll(mix.input, mix.output, mix.dry, mix.wet);
        },
      };
    },
  };
}

const RATE = (def: number): ParamSpec => ({
  id: 'rate',
  name: 'Ritmo',
  min: 0,
  max: RATE_DIVISIONS.length - 1,
  default: def,
  options: RATE_DIVISIONS.map((d) => d.label),
  group: 'Ritmo',
});

export const tranceGate = shaper(
  'Trance Gate',
  'gate',
  'Corta o som no ritmo da música (sincronizado ao BPM): gates, stutters e chops.',
  [
    RATE(5),
    { id: 'duty', name: 'Abertura', min: 0.05, max: 1, default: 0.5, unit: '%', group: 'Ritmo' },
    { id: 'depth', name: 'Profund.', min: 0, max: 1, default: 1, unit: '%', group: 'Forma' },
    { id: 'smooth', name: 'Suavizar', min: 0, max: 0.5, default: 0.08, unit: '%', group: 'Forma' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%', group: 'Saída' },
  ],
  [
    { name: 'Gate 1/16', params: {} },
    { name: 'Gate 1/8 suave', params: { rate: 3, duty: 0.6, smooth: 0.25 } },
    { name: 'Stutter 1/32', params: { rate: 7, duty: 0.45, smooth: 0.05 } },
    { name: 'Tercinas', params: { rate: 4, duty: 0.5 } },
  ],
  (read) => {
    const duty = read('duty');
    const floor = 1 - read('depth');
    // Edge ramps take `smooth` of the open part, so the gate doesn't click.
    const ramp = Math.max(0.002, read('smooth') * duty);
    return (phase) => {
      if (phase < ramp) return floor + ((1 - floor) * phase) / ramp;
      if (phase < duty - ramp) return 1;
      if (phase < duty) return floor + ((1 - floor) * (duty - phase)) / ramp;
      return floor;
    };
  },
);

export const pump = shaper(
  'Sidechain Pump',
  'pump',
  'O "bombeado" de sidechain sincronizado ao BPM: abaixa o volume em cada batida e solta em curva.',
  [
    RATE(2),
    { id: 'depth', name: 'Profund.', min: 0, max: 1, default: 0.8, unit: '%', group: 'Forma' },
    { id: 'hold', name: 'Segurar', min: 0, max: 0.5, default: 0.04, unit: '%', group: 'Forma' },
    { id: 'release', name: 'Soltar', min: 0.05, max: 1, default: 0.55, unit: '%', group: 'Forma' },
    { id: 'curve', name: 'Curva', min: 0.3, max: 4, default: 1.8, step: 0.01, group: 'Forma' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%', group: 'Saída' },
  ],
  [
    { name: 'House 1/4', params: {} },
    { name: 'Pump forte', params: { depth: 1, release: 0.75, curve: 2.5 } },
    { name: 'Respiração suave', params: { depth: 0.45, release: 0.45, curve: 1.2 } },
    { name: 'Colcheias', params: { rate: 3, depth: 0.7, release: 0.6 } },
  ],
  (read) => {
    const depth = read('depth');
    const hold = read('hold');
    const release = Math.max(0.01, read('release'));
    const curve = read('curve');
    const attack = 0.004;
    return (phase) => {
      let duck: number;
      if (phase < attack) duck = phase / attack;
      else if (phase < attack + hold) duck = 1;
      else {
        const x = Math.min(1, (phase - attack - hold) / release);
        duck = 1 - Math.pow(x, 1 / curve);
      }
      return 1 - depth * duck;
    };
  },
);
