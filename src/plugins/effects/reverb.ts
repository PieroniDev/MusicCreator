import type { EffectPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { disconnectAll } from '../dsp';
import { DryWet, smooth } from './common';

const params: ParamSpec[] = [
  { id: 'decay', name: 'Duração', min: 0.2, max: 12, default: 2.2, scale: 'log', unit: 's', group: 'Sala' },
  { id: 'preDelay', name: 'Pré-delay', min: 0, max: 0.25, default: 0.02, unit: 's', group: 'Sala' },
  { id: 'damping', name: 'Brilho', min: 1000, max: 20000, default: 7000, scale: 'log', unit: 'Hz', group: 'Cor' },
  { id: 'lowCut', name: 'Corte grave', min: 20, max: 1000, default: 150, scale: 'log', unit: 'Hz', group: 'Cor' },
  { id: 'width', name: 'Largura', min: 0, max: 1, default: 1, unit: '%', group: 'Cor' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.25, unit: '%', group: 'Saída' },
];

/**
 * Builds a stereo impulse response: decaying noise whose high frequencies
 * fade faster than the lows, like a real room.
 */
export function buildImpulse(
  ctx: BaseAudioContext,
  decay: number,
  brightness: number,
  width: number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * decay * 1.2));
  const buf = ctx.createBuffer(2, length, rate);
  const left = buf.getChannelData(0);
  const right = buf.getChannelData(1);
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 0xffffffff) * 2 - 1;
  };
  // -60 dB after `decay` seconds.
  const k = Math.log(1000) / (decay * rate);
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;
    // Cutoff glides from `brightness` down to a quarter of it across the tail.
    const cutoff = brightness * (1 - 0.75 * t);
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
    const env = Math.exp(-k * i);
    const nL = rnd();
    const nR = width * rnd() + (1 - width) * nL;
    lpL += a * (nL - lpL);
    lpR += a * (nR - lpR);
    left[i] = lpL * env;
    right[i] = lpR * env;
  }
  return buf;
}

export const reverb: EffectPlugin = {
  kind: 'effect',
  id: 'reverb',
  name: 'Reverb',
  description: 'Reverb por convolução com resposta de sala gerada: duração, brilho, largura e pré-delay.',
  params,
  presets: [
    { name: 'Sala', params: {} },
    { name: 'Quarto pequeno', params: { decay: 0.6, preDelay: 0.005, damping: 6000, mix: 0.2 } },
    { name: 'Hall', params: { decay: 4, preDelay: 0.035, damping: 8000, mix: 0.3 } },
    { name: 'Catedral', params: { decay: 9, preDelay: 0.06, damping: 5000, lowCut: 250, mix: 0.35 } },
    { name: 'Plate brilhante', params: { decay: 1.8, preDelay: 0.01, damping: 15000, lowCut: 300, mix: 0.25 } },
  ],

  create(ctx, values) {
    const p = paramReader(params, values);
    const current = { ...values };
    const read = (id: string) => (typeof current[id] === 'number' ? current[id] : p(id));

    const mix = new DryWet(ctx, read('mix'));
    const pre = ctx.createDelay(1);
    const conv = ctx.createConvolver();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    mix.input.connect(pre);
    pre.connect(conv);
    conv.connect(hp);
    hp.connect(mix.wet);

    const rebuild = () => {
      conv.buffer = buildImpulse(ctx, read('decay'), Math.min(read('damping'), ctx.sampleRate / 2 - 100), read('width'));
    };
    pre.delayTime.value = read('preDelay');
    hp.frequency.value = read('lowCut');
    rebuild();

    let pending: ReturnType<typeof setTimeout> | undefined;
    return {
      input: mix.input,
      output: mix.output,
      setParam(id, v) {
        current[id] = v;
        if (id === 'mix') mix.setMix(v);
        else if (id === 'preDelay') smooth(pre.delayTime, v, ctx, 0.05);
        else if (id === 'lowCut') smooth(hp.frequency, v, ctx);
        else {
          // Regenerating the impulse is relatively costly; wait for the knob to settle.
          clearTimeout(pending);
          pending = setTimeout(rebuild, 120);
        }
      },
      dispose() {
        clearTimeout(pending);
        disconnectAll(mix.input, mix.output, mix.dry, mix.wet, pre, conv, hp);
      },
    };
  },
};
