import type { EffectPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { dbToGain, disconnectAll } from '../dsp';
import { DryWet, smooth } from './common';

const TYPES = ['Saturação', 'Clipe duro', 'Dobra (fold)', 'Retificador'];

const params: ParamSpec[] = [
  { id: 'type', name: 'Tipo', min: 0, max: TYPES.length - 1, default: 0, options: TYPES, group: 'Distorção' },
  { id: 'drive', name: 'Drive', min: 0, max: 1, default: 0.35, unit: '%', group: 'Distorção' },
  { id: 'tone', name: 'Tom', min: 500, max: 20000, default: 9000, scale: 'log', unit: 'Hz', group: 'Cor' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%', group: 'Saída' },
  { id: 'output', name: 'Saída', min: -24, max: 12, default: -3, step: 0.1, unit: 'dB', group: 'Saída' },
];

export function distortionCurve(type: number, drive: number, size = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  const k = 1 + drive * 49;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    let y: number;
    switch (type) {
      case 1:
        y = Math.max(-1, Math.min(1, x * k));
        break;
      case 2:
        y = Math.sin((x * k * Math.PI) / 2);
        break;
      case 3:
        y = Math.tanh(Math.abs(x) * k) / Math.tanh(k) * 2 - 1;
        break;
      default:
        y = Math.tanh(x * k) / Math.tanh(k);
    }
    curve[i] = y;
  }
  return curve;
}

export const distortion: EffectPlugin = {
  kind: 'effect',
  id: 'distortion',
  name: 'Distortion',
  description: 'Saturação, clipe duro, wavefolder e retificador com controle de tom.',
  params,
  presets: [
    { name: 'Saturação leve', params: {} },
    { name: 'Fuzz', params: { type: 1, drive: 0.8, tone: 5000, output: -9 } },
    { name: 'Wavefolder', params: { type: 2, drive: 0.25, tone: 12000, output: -6 } },
    { name: 'Calor em paralelo', params: { drive: 0.6, mix: 0.35, tone: 6000, output: -2 } },
  ],

  create(ctx, values) {
    const p = paramReader(params, values);
    const current = { ...values };
    const read = (id: string) => (typeof current[id] === 'number' ? current[id] : p(id));
    const mix = new DryWet(ctx, read('mix'));
    const shaper = ctx.createWaveShaper();
    shaper.oversample = '4x';
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    const out = ctx.createGain();
    mix.input.connect(shaper);
    shaper.connect(tone);
    tone.connect(out);
    out.connect(mix.wet);

    const updateCurve = () => {
      shaper.curve = distortionCurve(Math.round(read('type')), read('drive'));
    };
    updateCurve();
    tone.frequency.value = Math.min(read('tone'), ctx.sampleRate / 2 - 100);
    out.gain.value = dbToGain(read('output'));

    return {
      input: mix.input,
      output: mix.output,
      setParam(id, v) {
        current[id] = v;
        if (id === 'type' || id === 'drive') updateCurve();
        else if (id === 'tone') smooth(tone.frequency, Math.min(v, ctx.sampleRate / 2 - 100), ctx);
        else if (id === 'output') smooth(out.gain, dbToGain(v), ctx);
        else if (id === 'mix') mix.setMix(v);
      },
      dispose: () => disconnectAll(mix.input, mix.output, mix.dry, mix.wet, shaper, tone, out),
    };
  },
};
