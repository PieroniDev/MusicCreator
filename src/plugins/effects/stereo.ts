import type { EffectPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { dbToGain, disconnectAll, stopAll } from '../dsp';
import { DryWet, smooth } from './common';

const enhancerParams: ParamSpec[] = [
  { id: 'width', name: 'Largura', min: 0, max: 2, default: 1.4, unit: '%', group: 'Estéreo' },
  { id: 'haas', name: 'Atraso D', min: 0, max: 0.03, default: 0, unit: 's', group: 'Estéreo' },
  { id: 'output', name: 'Saída', min: -12, max: 12, default: 0, step: 0.1, unit: 'dB', group: 'Saída' },
];

/**
 * Mid/side width: side = (L − R) / 2 is scaled, then L = mid + side and
 * R = mid − side. 0% is mono, 100% unchanged, 200% very wide.
 */
export const stereoEnhancer: EffectPlugin = {
  kind: 'effect',
  id: 'stereo',
  name: 'Stereo Enhancer',
  description: 'Abre ou fecha a imagem estéreo (mid/side) e atrasa um lado para alargar sons mono (efeito Haas).',
  params: enhancerParams,
  presets: [
    { name: 'Mais largo', params: {} },
    { name: 'Mono', params: { width: 0 } },
    { name: 'Haas (mono → estéreo)', params: { width: 1, haas: 0.012 } },
    { name: 'Superlargo', params: { width: 2, output: -1.5 } },
  ],

  create(ctx, values) {
    const p = paramReader(enhancerParams, values);
    const input = ctx.createGain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.channelInterpretation = 'speakers';
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const g = (value: number) => {
      const n = ctx.createGain();
      n.gain.value = value;
      return n;
    };
    const mid = g(1);
    const side = g(1);
    const width = g(p('width'));
    const leftSum = g(1);
    const rightSum = g(1);
    const invert = g(-1);
    const delay = ctx.createDelay(0.1);
    const out = g(dbToGain(p('output')));
    const lToMid = g(0.5);
    const rToMid = g(0.5);
    const lToSide = g(0.5);
    const rToSide = g(-0.5);
    input.connect(split);
    split.connect(lToMid, 0).connect(mid);
    split.connect(rToMid, 1).connect(mid);
    split.connect(lToSide, 0).connect(side);
    split.connect(rToSide, 1).connect(side);
    side.connect(width);
    mid.connect(leftSum);
    mid.connect(rightSum);
    width.connect(leftSum);
    width.connect(invert).connect(rightSum);
    leftSum.connect(merge, 0, 0);
    rightSum.connect(delay).connect(merge, 0, 1);
    merge.connect(out);
    delay.delayTime.value = p('haas');

    return {
      input,
      output: out,
      setParam(id, v) {
        if (id === 'width') smooth(width.gain, v, ctx);
        else if (id === 'haas') smooth(delay.delayTime, v, ctx, 0.05);
        else if (id === 'output') smooth(out.gain, dbToGain(v), ctx);
      },
      dispose: () =>
        disconnectAll(input, split, merge, mid, side, width, leftSum, rightSum, invert, delay, out, lToMid, rToMid, lToSide, rToSide),
    };
  },
};

const STAGE_OPTIONS = [4, 6, 8, 12];

const phaserParams: ParamSpec[] = [
  { id: 'stages', name: 'Estágios', min: 0, max: STAGE_OPTIONS.length - 1, default: 1, options: STAGE_OPTIONS.map(String), group: 'Phaser' },
  { id: 'rate', name: 'Velocidade', min: 0.02, max: 10, default: 0.4, scale: 'log', unit: 'Hz', group: 'Phaser' },
  { id: 'depth', name: 'Profund.', min: 0, max: 1, default: 0.7, unit: '%', group: 'Phaser' },
  { id: 'center', name: 'Centro', min: 150, max: 5000, default: 900, scale: 'log', unit: 'Hz', group: 'Phaser' },
  { id: 'feedback', name: 'Realim.', min: 0, max: 0.9, default: 0.5, unit: '%', group: 'Phaser' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.5, unit: '%', group: 'Saída' },
];

/** Classic phaser: a chain of all-pass filters swept by an LFO, mixed with the dry signal. */
export const phaser: EffectPlugin = {
  kind: 'effect',
  id: 'phaser',
  name: 'Phaser',
  description: 'Phaser de 4 a 12 estágios all-pass com LFO e realimentação.',
  params: phaserParams,
  presets: [
    { name: 'Phaser clássico', params: {} },
    { name: 'Lento e profundo', params: { stages: 3, rate: 0.1, depth: 0.9, feedback: 0.7 } },
    { name: 'Rápido', params: { stages: 0, rate: 4, depth: 0.5, feedback: 0.3 } },
  ],

  create(ctx, values) {
    const p = paramReader(phaserParams, values);
    const current = { ...values };
    const read = (id: string) => (typeof current[id] === 'number' ? current[id] : p(id));
    const mix = new DryWet(ctx, read('mix'));
    const stages = Array.from({ length: STAGE_OPTIONS[STAGE_OPTIONS.length - 1] }, () => {
      const f = ctx.createBiquadFilter();
      f.type = 'allpass';
      f.Q.value = 0.5;
      return f;
    });
    const lfo = ctx.createOscillator();
    const sweep = ctx.createGain();
    const feedback = ctx.createGain();
    // A feedback loop in Web Audio needs a delay; the shortest one adds one render block.
    const loopDelay = ctx.createDelay(0.01);
    loopDelay.delayTime.value = 0;
    lfo.connect(sweep);
    for (const s of stages) sweep.connect(s.frequency);

    let active = 0;
    const wire = () => {
      const count = STAGE_OPTIONS[Math.round(read('stages'))] ?? 6;
      if (count === active) return;
      active = count;
      disconnectAll(mix.input, ...stages, loopDelay, feedback);
      mix.input.connect(mix.dry);
      mix.input.connect(stages[0]);
      loopDelay.connect(stages[0]);
      for (let i = 1; i < count; i++) stages[i - 1].connect(stages[i]);
      const last = stages[count - 1];
      last.connect(mix.wet);
      last.connect(feedback).connect(loopDelay);
    };
    const update = () => {
      const center = Math.min(read('center'), ctx.sampleRate / 2 - 500);
      for (const s of stages) smooth(s.frequency, center, ctx);
      smooth(sweep.gain, center * 0.9 * read('depth'), ctx);
      smooth(lfo.frequency, read('rate'), ctx);
      smooth(feedback.gain, read('feedback'), ctx);
    };
    wire();
    for (const s of stages) s.frequency.value = Math.min(read('center'), ctx.sampleRate / 2 - 500);
    lfo.frequency.value = read('rate');
    sweep.gain.value = read('center') * 0.9 * read('depth');
    feedback.gain.value = read('feedback');
    lfo.start();

    return {
      input: mix.input,
      output: mix.output,
      setParam(id, v) {
        current[id] = v;
        if (id === 'mix') mix.setMix(v);
        else if (id === 'stages') wire();
        else update();
      },
      dispose() {
        stopAll([lfo], 0);
        disconnectAll(mix.input, mix.output, mix.dry, mix.wet, ...stages, lfo, sweep, feedback, loopDelay);
      },
    };
  },
};
