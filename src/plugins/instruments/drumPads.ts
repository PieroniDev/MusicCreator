import type { InstrumentPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { NodeVoice } from '../voice';

export const PAD_COUNT = 16;
/** Pad 1 plays on key 36 (the General MIDI kick), pad 16 on key 51. */
export const FIRST_PAD_KEY = 36;

const params: ParamSpec[] = [
  ...Array.from({ length: PAD_COUNT }, (_, i): ParamSpec[] => [
    { id: `pad${i}Vol`, name: 'Volume', min: 0, max: 1.5, default: 1, unit: '%', group: `Pad ${i + 1}` },
    { id: `pad${i}Tune`, name: 'Afinação', min: -24, max: 24, default: 0, step: 0.1, unit: 'st', group: `Pad ${i + 1}` },
    { id: `pad${i}Pan`, name: 'Pan', min: -1, max: 1, default: 0, group: `Pad ${i + 1}` },
  ]).flat(),
  { id: 'gain', name: 'Volume geral', min: 0, max: 1.5, default: 0.9, unit: '%', group: 'Saída' },
];

/** Pad playing a key, or -1 for keys outside the 16 pads. */
export function padForKey(key: number): number {
  const pad = key - FIRST_PAD_KEY;
  return pad >= 0 && pad < PAD_COUNT ? pad : -1;
}

export const drumPads: InstrumentPlugin = {
  kind: 'instrument',
  id: 'pads',
  name: 'Drum Pads',
  description: '16 pads com um sample cada (teclas C3 a D#4): monte kits com seus samples ou com o kit sintetizado.',
  params,
  presets: [{ name: 'Inicial', params: {} }],
  defaultRootKey: FIRST_PAD_KEY,

  noteOn(ctx, destination, { key, velocity, time, params: values, pads, detune = 0 }) {
    const p = paramReader(params, values);
    const voice = new NodeVoice(ctx, destination);
    const pad = padForKey(key);
    const buffer = pad >= 0 ? pads?.[pad] : undefined;
    if (!buffer) {
      voice.ensureSource(time);
      voice.endAt(time + 0.05);
      return voice;
    }
    const src = voice.source(ctx.createBufferSource());
    src.buffer = buffer;
    src.playbackRate.value = Math.pow(2, (p(`pad${pad}Tune`) + detune / 100) / 12);
    const pan = voice.node(ctx.createStereoPanner());
    pan.pan.value = p(`pad${pad}Pan`);
    const gain = voice.node(ctx.createGain());
    gain.gain.value = velocity * p(`pad${pad}Vol`) * p('gain');
    src.connect(pan).connect(gain).connect(voice.out);
    src.start(time);
    // Pads are one-shots: each hit plays the whole sample.
    voice.endAt(time + buffer.duration / src.playbackRate.value + 0.01);
    return voice;
  },
};
