import type { EffectPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { disconnectAll, stopAll } from '../dsp';
import { DryWet, smooth } from './common';

const FILTER_TYPES: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

const filterParams: ParamSpec[] = [
  { id: 'type', name: 'Tipo', min: 0, max: 3, default: 0, options: ['Passa-baixa', 'Passa-alta', 'Passa-banda', 'Notch'], group: 'Filtro' },
  { id: 'cutoff', name: 'Corte', min: 20, max: 20000, default: 2000, scale: 'log', unit: 'Hz', group: 'Filtro' },
  { id: 'resonance', name: 'Resson.', min: 0.1, max: 25, default: 2, scale: 'log', group: 'Filtro' },
  { id: 'lfoRate', name: 'Velocidade', min: 0.02, max: 20, default: 0.5, scale: 'log', unit: 'Hz', group: 'LFO' },
  { id: 'lfoDepth', name: 'Profund.', min: 0, max: 4, default: 0, step: 0.01, unit: 'oct', group: 'LFO' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%', group: 'Saída' },
];

export const autoFilter: EffectPlugin = {
  kind: 'effect',
  id: 'filter',
  name: 'Filter',
  description: 'Filtro ressonante com LFO para varreduras automáticas.',
  params: filterParams,
  presets: [
    { name: 'Passa-baixa', params: {} },
    { name: 'Varredura lenta', params: { cutoff: 900, resonance: 6, lfoRate: 0.15, lfoDepth: 2.5 } },
    { name: 'Wobble', params: { cutoff: 400, resonance: 8, lfoRate: 4, lfoDepth: 3 } },
    { name: 'Passa-alta (build-up)', params: { type: 1, cutoff: 600, resonance: 3 } },
  ],

  create(ctx, values) {
    const p = paramReader(filterParams, values);
    const mix = new DryWet(ctx, p('mix'));
    const filter = ctx.createBiquadFilter();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.connect(depth);
    depth.connect(filter.detune);
    mix.input.connect(filter);
    filter.connect(mix.wet);

    filter.type = FILTER_TYPES[Math.round(p('type'))] ?? 'lowpass';
    filter.frequency.value = Math.min(p('cutoff'), ctx.sampleRate / 2 - 100);
    filter.Q.value = p('resonance');
    lfo.frequency.value = p('lfoRate');
    depth.gain.value = p('lfoDepth') * 1200;
    lfo.start();

    return {
      input: mix.input,
      output: mix.output,
      setParam(id, v) {
        if (id === 'type') filter.type = FILTER_TYPES[Math.round(v)] ?? 'lowpass';
        else if (id === 'cutoff') smooth(filter.frequency, Math.min(v, ctx.sampleRate / 2 - 100), ctx);
        else if (id === 'resonance') smooth(filter.Q, v, ctx);
        else if (id === 'lfoRate') smooth(lfo.frequency, v, ctx);
        else if (id === 'lfoDepth') smooth(depth.gain, v * 1200, ctx);
        else if (id === 'mix') mix.setMix(v);
      },
      dispose() {
        stopAll([lfo], 0);
        disconnectAll(mix.input, mix.output, mix.dry, mix.wet, filter, lfo, depth);
      },
    };
  },
};

const chorusParams: ParamSpec[] = [
  { id: 'rate', name: 'Velocidade', min: 0.05, max: 8, default: 0.8, scale: 'log', unit: 'Hz', group: 'Chorus' },
  { id: 'depth', name: 'Profund.', min: 0, max: 1, default: 0.5, unit: '%', group: 'Chorus' },
  { id: 'delay', name: 'Atraso', min: 0.002, max: 0.04, default: 0.014, unit: 's', group: 'Chorus' },
  { id: 'feedback', name: 'Realim.', min: 0, max: 0.9, default: 0.15, unit: '%', group: 'Chorus' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.5, unit: '%', group: 'Saída' },
];

export const chorus: EffectPlugin = {
  kind: 'effect',
  id: 'chorus',
  name: 'Chorus',
  description: 'Chorus estéreo com duas linhas moduladas em fase oposta; com realimentação vira flanger.',
  params: chorusParams,
  presets: [
    { name: 'Chorus', params: {} },
    { name: 'Ensemble largo', params: { rate: 0.4, depth: 0.8, delay: 0.022, mix: 0.6 } },
    { name: 'Flanger', params: { rate: 0.25, depth: 0.7, delay: 0.003, feedback: 0.7, mix: 0.5 } },
    { name: 'Vibrato', params: { rate: 5.5, depth: 0.35, delay: 0.004, feedback: 0, mix: 1 } },
  ],

  create(ctx, values) {
    const p = paramReader(chorusParams, values);
    const current = { ...values };
    const read = (id: string) => (typeof current[id] === 'number' ? current[id] : p(id));
    const mix = new DryWet(ctx, read('mix'));
    mix.input.channelCount = 2;
    mix.input.channelCountMode = 'explicit';
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    mix.input.connect(split);
    const lfo = ctx.createOscillator();
    const invert = ctx.createGain();
    invert.gain.value = -1;
    lfo.connect(invert);

    const lines = [0, 1].map((ch) => {
      const d = ctx.createDelay(0.1);
      const mod = ctx.createGain();
      const fb = ctx.createGain();
      split.connect(d, ch);
      d.connect(fb).connect(d);
      d.connect(merge, 0, ch);
      (ch === 0 ? lfo : invert).connect(mod);
      mod.connect(d.delayTime);
      return { d, mod, fb };
    });
    merge.connect(mix.wet);

    const update = () => {
      const base = read('delay');
      // Swing the delay by up to 90% of its base so it never goes negative.
      const swing = base * 0.9 * read('depth');
      for (const l of lines) {
        smooth(l.d.delayTime, base, ctx, 0.05);
        smooth(l.mod.gain, swing, ctx, 0.05);
        smooth(l.fb.gain, read('feedback'), ctx);
      }
      smooth(lfo.frequency, read('rate'), ctx);
    };
    for (const l of lines) l.d.delayTime.value = read('delay');
    lfo.frequency.value = read('rate');
    update();
    lfo.start();

    return {
      input: mix.input,
      output: mix.output,
      setParam(id, v) {
        current[id] = v;
        if (id === 'mix') mix.setMix(v);
        else update();
      },
      dispose() {
        stopAll([lfo], 0);
        disconnectAll(mix.input, mix.output, mix.dry, mix.wet, split, merge, lfo, invert);
        for (const l of lines) disconnectAll(l.d, l.mod, l.fb);
      },
    };
  },
};
