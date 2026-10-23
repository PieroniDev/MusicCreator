import type { InstrumentPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { createNoise, Envelope, noiseOffset, WAVEFORM_LABELS, WAVEFORMS } from '../dsp';
import { NodeVoice } from '../voice';
import { keyToFrequency } from '../../model/time';

const FILTER_TYPES: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass'];

function oscParams(n: number, wave: number, level: number, coarse: number, fine: number): ParamSpec[] {
  const group = `Oscilador ${n}`;
  return [
    { id: `osc${n}Wave`, name: 'Onda', min: 0, max: 4, default: wave, options: WAVEFORM_LABELS, group },
    { id: `osc${n}Level`, name: 'Nível', min: 0, max: 1, default: level, unit: '%', group },
    { id: `osc${n}Coarse`, name: 'Semitons', min: -24, max: 24, default: coarse, step: 1, unit: 'st', group },
    { id: `osc${n}Fine`, name: 'Fino', min: -100, max: 100, default: fine, step: 1, unit: 'ct', group },
  ];
}

const params: ParamSpec[] = [
  ...oscParams(1, 2, 0.8, 0, 0),
  ...oscParams(2, 2, 0.5, 0, 7),
  ...oscParams(3, 0, 0, -12, 0),
  { id: 'unison', name: 'Vozes', min: 1, max: 7, default: 1, step: 1, group: 'Unísono' },
  { id: 'spread', name: 'Abertura', min: 0, max: 100, default: 18, step: 1, unit: 'ct', group: 'Unísono' },
  { id: 'filterType', name: 'Tipo', min: 0, max: 2, default: 0, options: ['Passa-baixa', 'Passa-alta', 'Passa-banda'], group: 'Filtro' },
  { id: 'cutoff', name: 'Corte', min: 20, max: 20000, default: 9000, scale: 'log', unit: 'Hz', group: 'Filtro' },
  { id: 'resonance', name: 'Resson.', min: 0.1, max: 20, default: 0.8, scale: 'log', group: 'Filtro' },
  { id: 'filterEnv', name: 'Env.', min: -4, max: 8, default: 0, step: 0.01, unit: 'oct', group: 'Filtro' },
  { id: 'filterAttack', name: 'Ataque', min: 0.001, max: 4, default: 0.001, scale: 'log', unit: 's', group: 'Envelope do filtro' },
  { id: 'filterDecay', name: 'Decaim.', min: 0.001, max: 4, default: 0.3, scale: 'log', unit: 's', group: 'Envelope do filtro' },
  { id: 'filterSustain', name: 'Sustent.', min: 0, max: 1, default: 0, unit: '%', group: 'Envelope do filtro' },
  { id: 'filterRelease', name: 'Relaxam.', min: 0.001, max: 6, default: 0.3, scale: 'log', unit: 's', group: 'Envelope do filtro' },
  { id: 'attack', name: 'Ataque', min: 0.001, max: 4, default: 0.004, scale: 'log', unit: 's', group: 'Envelope de volume' },
  { id: 'decay', name: 'Decaim.', min: 0.001, max: 4, default: 0.4, scale: 'log', unit: 's', group: 'Envelope de volume' },
  { id: 'sustain', name: 'Sustent.', min: 0, max: 1, default: 0.75, unit: '%', group: 'Envelope de volume' },
  { id: 'release', name: 'Relaxam.', min: 0.001, max: 6, default: 0.15, scale: 'log', unit: 's', group: 'Envelope de volume' },
  { id: 'gain', name: 'Volume', min: 0, max: 1, default: 0.6, unit: '%', group: 'Saída' },
];

export const trioSynth: InstrumentPlugin = {
  kind: 'instrument',
  id: 'trio',
  name: 'Trio Synth',
  description: 'Sintetizador subtrativo de 3 osciladores com unísono, filtro ressonante e envelopes.',
  params,
  presets: [
    { name: 'Inicial', params: {} },
    {
      name: 'Supersaw Lead',
      params: { osc1Wave: 2, osc2Wave: 2, osc2Fine: 12, osc2Level: 0.6, unison: 7, spread: 28, cutoff: 7000, resonance: 1.2, attack: 0.005, decay: 0.5, sustain: 0.8, release: 0.3, gain: 0.45 },
    },
    {
      name: 'Sub Bass',
      params: { osc1Wave: 0, osc1Level: 1, osc2Wave: 1, osc2Level: 0.3, osc2Coarse: 12, osc2Fine: 0, osc3Level: 0, cutoff: 900, resonance: 0.7, attack: 0.003, decay: 0.3, sustain: 0.9, release: 0.08, gain: 0.75 },
    },
    {
      name: 'Acid Bass',
      params: { osc1Wave: 2, osc1Level: 1, osc2Level: 0, osc3Level: 0, cutoff: 300, resonance: 12, filterEnv: 4.5, filterDecay: 0.18, filterSustain: 0, attack: 0.002, decay: 0.25, sustain: 0.6, release: 0.06, gain: 0.55 },
    },
    {
      name: 'Pluck',
      params: { osc1Wave: 2, osc2Wave: 3, osc2Level: 0.4, osc2Fine: 5, cutoff: 600, resonance: 2, filterEnv: 5, filterDecay: 0.25, attack: 0.001, decay: 0.35, sustain: 0, release: 0.25, gain: 0.6 },
    },
    {
      name: 'Pad',
      params: { osc1Wave: 2, osc2Wave: 1, osc2Coarse: 12, osc2Level: 0.4, osc3Wave: 0, osc3Level: 0.4, osc3Coarse: -12, unison: 5, spread: 22, cutoff: 2500, resonance: 0.9, filterEnv: 1.5, filterAttack: 1.2, filterDecay: 2, filterSustain: 0.5, filterRelease: 1.5, attack: 0.9, decay: 1.5, sustain: 0.8, release: 1.8, gain: 0.4 },
    },
  ],

  noteOn(ctx, destination, { key, velocity, time, params: values }) {
    const p = paramReader(params, values);
    const voice = new NodeVoice(ctx, destination);

    const filter = voice.node(ctx.createBiquadFilter());
    filter.type = FILTER_TYPES[Math.round(p('filterType'))] ?? 'lowpass';
    filter.frequency.value = p('cutoff');
    filter.Q.value = p('resonance');

    const amp = voice.node(ctx.createGain());
    filter.connect(amp);
    amp.connect(voice.out);

    const baseFreq = keyToFrequency(key);
    const unison = Math.max(1, Math.round(p('unison')));
    const spread = p('spread');
    for (let n = 1; n <= 3; n++) {
      const level = p(`osc${n}Level`);
      if (level <= 0) continue;
      const waveIndex = Math.round(p(`osc${n}Wave`));
      const oscGain = voice.node(ctx.createGain());
      oscGain.gain.value = (level * 0.35) / Math.sqrt(unison);
      oscGain.connect(filter);
      if (waveIndex === 4) {
        const noise = voice.source(createNoise(ctx));
        noise.connect(oscGain);
        noise.start(time, noiseOffset());
        continue;
      }
      const freq = baseFreq * Math.pow(2, p(`osc${n}Coarse`) / 12);
      for (let u = 0; u < unison; u++) {
        const osc = voice.source(ctx.createOscillator());
        osc.type = WAVEFORMS[waveIndex] ?? 'sawtooth';
        osc.frequency.value = freq;
        const offset = unison > 1 ? (u / (unison - 1)) * 2 - 1 : 0;
        osc.detune.value = p(`osc${n}Fine`) + offset * spread;
        osc.connect(oscGain);
        // Free-running phase per unison voice avoids a phasey, static attack.
        osc.start(time + (unison > 1 ? Math.random() * 0.002 : 0));
      }
    }

    voice.envelope(
      new Envelope(amp.gain, time, { attack: p('attack'), decay: p('decay'), sustain: p('sustain'), release: p('release') }, velocity * p('gain')),
    );
    const envOct = p('filterEnv');
    if (envOct !== 0) {
      voice.envelope(
        new Envelope(
          filter.detune,
          time,
          { attack: p('filterAttack'), decay: p('filterDecay'), sustain: p('filterSustain'), release: p('filterRelease') },
          envOct * 1200,
        ),
      );
    }
    voice.ensureSource(time);
    return voice;
  },
};
