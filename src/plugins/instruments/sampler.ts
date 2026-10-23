import type { InstrumentPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { Envelope } from '../dsp';
import { NodeVoice } from '../voice';

const NO_YES = ['Não', 'Sim'];

const params: ParamSpec[] = [
  { id: 'coarse', name: 'Semitons', min: -24, max: 24, default: 0, step: 1, unit: 'st', group: 'Afinação' },
  { id: 'fine', name: 'Fino', min: -100, max: 100, default: 0, step: 1, unit: 'ct', group: 'Afinação' },
  { id: 'keytrack', name: 'Seguir nota', min: 0, max: 1, default: 1, options: NO_YES, group: 'Afinação' },
  { id: 'start', name: 'Início', min: 0, max: 0.99, default: 0, unit: '%', group: 'Reprodução' },
  { id: 'reverse', name: 'Reverso', min: 0, max: 1, default: 0, options: NO_YES, group: 'Reprodução' },
  { id: 'loop', name: 'Loop', min: 0, max: 1, default: 0, options: NO_YES, group: 'Reprodução' },
  { id: 'oneShot', name: 'Tocar inteiro', min: 0, max: 1, default: 1, options: NO_YES, group: 'Reprodução' },
  { id: 'cutoff', name: 'Corte', min: 20, max: 20000, default: 20000, scale: 'log', unit: 'Hz', group: 'Filtro' },
  { id: 'resonance', name: 'Resson.', min: 0.1, max: 20, default: 0.7, scale: 'log', group: 'Filtro' },
  { id: 'attack', name: 'Ataque', min: 0.001, max: 4, default: 0.001, scale: 'log', unit: 's', group: 'Envelope de volume' },
  { id: 'decay', name: 'Decaim.', min: 0.001, max: 6, default: 1, scale: 'log', unit: 's', group: 'Envelope de volume' },
  { id: 'sustain', name: 'Sustent.', min: 0, max: 1, default: 1, unit: '%', group: 'Envelope de volume' },
  { id: 'release', name: 'Relaxam.', min: 0.001, max: 6, default: 0.05, scale: 'log', unit: 's', group: 'Envelope de volume' },
  { id: 'gain', name: 'Volume', min: 0, max: 1.5, default: 0.9, unit: '%', group: 'Saída' },
];

const reversed = new WeakMap<AudioBuffer, AudioBuffer>();

function reverseBuffer(ctx: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  let r = reversed.get(buf);
  if (!r) {
    r = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const dst = r.getChannelData(c);
      for (let i = 0, j = src.length - 1; i < src.length; i++, j--) dst[i] = src[j];
    }
    reversed.set(buf, r);
  }
  return r;
}

export const sampler: InstrumentPlugin = {
  kind: 'instrument',
  id: 'sampler',
  name: 'Sampler',
  description: 'Toca um arquivo de áudio (WAV, MP3, OGG...) afinado pela nota, com filtro, loop, reverso e ADSR.',
  usesSample: true,
  params,
  presets: [
    { name: 'One-shot', params: {} },
    { name: 'One-shot sem afinação', params: { keytrack: 0 } },
    { name: 'Segue a nota', params: { oneShot: 0, release: 0.15 } },
    { name: 'Instrumento em loop', params: { loop: 1, attack: 0.01, sustain: 0.9, release: 0.4 } },
    { name: 'Reverso', params: { reverse: 1, oneShot: 0, release: 0.1 } },
    { name: 'Lo-fi', params: { cutoff: 2200, resonance: 2, coarse: -2 } },
  ],

  noteOn(ctx, destination, { key, velocity, time, rootKey, params: values, sample, offset: clipOffset = 0, gated = false }) {
    const p = paramReader(params, values);
    const voice = new NodeVoice(ctx, destination);
    const filter = voice.node(ctx.createBiquadFilter());
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(p('cutoff'), ctx.sampleRate / 2 - 100);
    filter.Q.value = p('resonance');
    const amp = voice.node(ctx.createGain());
    filter.connect(amp);
    amp.connect(voice.out);

    if (!sample) {
      // Nothing to play yet: end right away so the voice is freed.
      voice.ensureSource(time);
      voice.endAt(time + 0.05);
      return voice;
    }

    const buffer = p('reverse') >= 0.5 ? reverseBuffer(ctx, sample) : sample;
    const src = voice.source(ctx.createBufferSource());
    src.buffer = buffer;
    const semis = (p('keytrack') >= 0.5 ? key - rootKey : 0) + p('coarse') + p('fine') / 100;
    src.playbackRate.value = Math.pow(2, semis / 12);
    const offset = Math.min(buffer.duration, p('start') * buffer.duration + clipOffset);
    const loop = p('loop') >= 0.5;
    if (loop) {
      src.loop = true;
      src.loopStart = offset;
      src.loopEnd = buffer.duration;
    }
    src.connect(filter);
    src.start(time, offset);

    const env = new Envelope(
      amp.gain,
      time,
      { attack: p('attack'), decay: p('decay'), sustain: p('sustain'), release: p('release') },
      velocity * p('gain'),
    );
    // One-shots ignore the note length and play the whole sample.
    if (loop || gated || p('oneShot') < 0.5) voice.envelope(env);
    return voice;
  },
};
