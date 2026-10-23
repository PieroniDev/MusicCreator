import type { EffectPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { dbToGain, disconnectAll } from '../dsp';
import { smooth } from './common';

const compressorParams: ParamSpec[] = [
  { id: 'threshold', name: 'Limiar', min: -60, max: 0, default: -18, step: 0.1, unit: 'dB', group: 'Compressão' },
  { id: 'ratio', name: 'Razão', min: 1, max: 20, default: 4, step: 0.1, unit: ':1', group: 'Compressão' },
  { id: 'knee', name: 'Joelho', min: 0, max: 40, default: 6, step: 0.1, unit: 'dB', group: 'Compressão' },
  { id: 'attack', name: 'Ataque', min: 0.0005, max: 1, default: 0.01, scale: 'log', unit: 's', group: 'Tempo' },
  { id: 'release', name: 'Relaxam.', min: 0.01, max: 1, default: 0.2, scale: 'log', unit: 's', group: 'Tempo' },
  { id: 'makeup', name: 'Ganho', min: 0, max: 24, default: 3, step: 0.1, unit: 'dB', group: 'Saída' },
];

export const compressor: EffectPlugin = {
  kind: 'effect',
  id: 'compressor',
  name: 'Compressor',
  description: 'Compressor de faixa dinâmica com joelho ajustável e ganho de compensação.',
  params: compressorParams,
  presets: [
    { name: 'Suave', params: {} },
    { name: 'Bateria com punch', params: { threshold: -20, ratio: 6, attack: 0.02, release: 0.12, makeup: 5 } },
    { name: 'Voz', params: { threshold: -22, ratio: 3, knee: 10, attack: 0.005, release: 0.25, makeup: 4 } },
    { name: 'Esmagado', params: { threshold: -40, ratio: 20, knee: 0, attack: 0.001, release: 0.08, makeup: 14 } },
  ],

  create(ctx, values) {
    const p = paramReader(compressorParams, values);
    const comp = ctx.createDynamicsCompressor();
    const makeup = ctx.createGain();
    comp.connect(makeup);
    const apply = (id: string, v: number, ramp: boolean) => {
      const set = (param: AudioParam, value: number) => (ramp ? smooth(param, value, ctx) : (param.value = value));
      switch (id) {
        case 'threshold': return set(comp.threshold, v);
        case 'ratio': return set(comp.ratio, v);
        case 'knee': return set(comp.knee, v);
        case 'attack': return set(comp.attack, v);
        case 'release': return set(comp.release, v);
        case 'makeup': return set(makeup.gain, dbToGain(v));
      }
    };
    for (const spec of compressorParams) apply(spec.id, p(spec.id), false);
    return {
      input: comp,
      output: makeup,
      setParam: (id, v) => apply(id, v, true),
      dispose: () => disconnectAll(comp, makeup),
    };
  },
};

const limiterParams: ParamSpec[] = [
  { id: 'gain', name: 'Entrada', min: 0, max: 24, default: 0, step: 0.1, unit: 'dB', group: 'Limitador' },
  { id: 'ceiling', name: 'Teto', min: -12, max: 0, default: -0.3, step: 0.1, unit: 'dB', group: 'Limitador' },
  { id: 'release', name: 'Relaxam.', min: 0.01, max: 1, default: 0.1, scale: 'log', unit: 's', group: 'Limitador' },
];

export const limiter: EffectPlugin = {
  kind: 'effect',
  id: 'limiter',
  name: 'Limiter',
  description: 'Limitador para o master: aumenta o volume e segura os picos abaixo do teto.',
  params: limiterParams,
  presets: [
    { name: 'Segurança', params: {} },
    { name: 'Mais alto', params: { gain: 6, ceiling: -0.5 } },
    { name: 'Muito alto', params: { gain: 12, ceiling: -0.3, release: 0.05 } },
  ],

  create(ctx, values) {
    const p = paramReader(limiterParams, values);
    const pre = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    const post = ctx.createGain();
    pre.connect(comp);
    comp.connect(post);
    comp.ratio.value = 20;
    comp.knee.value = 0;
    comp.attack.value = 0.001;
    // DynamicsCompressorNode adds automatic makeup gain of (1/curve(1))^0.6,
    // which with ratio 20 and no knee is -0.57 × threshold dB. Undoing it after
    // the compressor leaves the output peaking close to the threshold.
    const apply = (id: string, v: number, ramp: boolean) => {
      const set = (param: AudioParam, value: number) => (ramp ? smooth(param, value, ctx) : (param.value = value));
      switch (id) {
        case 'gain': return set(pre.gain, dbToGain(v));
        case 'ceiling':
          set(comp.threshold, v);
          return set(post.gain, dbToGain(0.57 * v));
        case 'release': return set(comp.release, v);
      }
    };
    for (const spec of limiterParams) apply(spec.id, p(spec.id), false);
    return {
      input: pre,
      output: post,
      setParam: (id, v) => apply(id, v, true),
      dispose: () => disconnectAll(pre, comp, post),
    };
  },
};
