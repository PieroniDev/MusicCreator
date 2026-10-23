import type { InstrumentPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { Envelope, WAVEFORM_LABELS, WAVEFORMS } from '../dsp';
import { NodeVoice } from '../voice';
import { keyToFrequency } from '../../model/time';

const WAVES = WAVEFORM_LABELS.slice(0, 4);

const params: ParamSpec[] = [
  { id: 'carrierWave', name: 'Onda', min: 0, max: 3, default: 0, options: WAVES, group: 'Portadora' },
  { id: 'carrierRatio', name: 'Razão', min: 0.25, max: 8, default: 1, step: 0.25, group: 'Portadora' },
  { id: 'modWave', name: 'Onda', min: 0, max: 3, default: 0, options: WAVES, group: 'Modulador' },
  { id: 'modRatio', name: 'Razão', min: 0.25, max: 16, default: 1, step: 0.25, group: 'Modulador' },
  { id: 'modIndex', name: 'Índice', min: 0, max: 20, default: 3, step: 0.01, group: 'Modulador' },
  { id: 'velToIndex', name: 'Vel.→Índ.', min: 0, max: 1, default: 0.5, unit: '%', group: 'Modulador' },
  { id: 'modAttack', name: 'Ataque', min: 0.001, max: 4, default: 0.001, scale: 'log', unit: 's', group: 'Envelope do modulador' },
  { id: 'modDecay', name: 'Decaim.', min: 0.001, max: 6, default: 1.2, scale: 'log', unit: 's', group: 'Envelope do modulador' },
  { id: 'modSustain', name: 'Sustent.', min: 0, max: 1, default: 0.2, unit: '%', group: 'Envelope do modulador' },
  { id: 'modRelease', name: 'Relaxam.', min: 0.001, max: 6, default: 0.4, scale: 'log', unit: 's', group: 'Envelope do modulador' },
  { id: 'attack', name: 'Ataque', min: 0.001, max: 4, default: 0.002, scale: 'log', unit: 's', group: 'Envelope de volume' },
  { id: 'decay', name: 'Decaim.', min: 0.001, max: 6, default: 1.5, scale: 'log', unit: 's', group: 'Envelope de volume' },
  { id: 'sustain', name: 'Sustent.', min: 0, max: 1, default: 0.3, unit: '%', group: 'Envelope de volume' },
  { id: 'release', name: 'Relaxam.', min: 0.001, max: 6, default: 0.5, scale: 'log', unit: 's', group: 'Envelope de volume' },
  { id: 'gain', name: 'Volume', min: 0, max: 1, default: 0.5, unit: '%', group: 'Saída' },
];

export const fmSynth: InstrumentPlugin = {
  kind: 'instrument',
  id: 'fm',
  name: 'FM Synth',
  description: 'Síntese FM de 2 operadores: pianos elétricos, sinos, baixos metálicos.',
  params,
  presets: [
    { name: 'Piano elétrico', params: {} },
    { name: 'Sino', params: { modRatio: 3.5, modIndex: 6, modDecay: 3, modSustain: 0, decay: 4, sustain: 0, release: 2.5, gain: 0.4 } },
    { name: 'FM Bass', params: { modRatio: 1, modIndex: 5, modDecay: 0.15, modSustain: 0.1, decay: 0.6, sustain: 0.6, release: 0.08, gain: 0.6 } },
    { name: 'Metais', params: { modRatio: 1, modIndex: 4, modAttack: 0.08, modDecay: 0.5, modSustain: 0.7, attack: 0.06, decay: 0.4, sustain: 0.8, release: 0.2, gain: 0.45 } },
    { name: 'Marimba', params: { carrierRatio: 1, modRatio: 4, modIndex: 2.5, modDecay: 0.12, modSustain: 0, decay: 0.5, sustain: 0, release: 0.3, gain: 0.6 } },
  ],

  noteOn(ctx, destination, { key, velocity, time, params: values }) {
    const p = paramReader(params, values);
    const voice = new NodeVoice(ctx, destination);
    const f = keyToFrequency(key);

    const carrier = voice.source(ctx.createOscillator());
    carrier.type = WAVEFORMS[Math.round(p('carrierWave'))] ?? 'sine';
    carrier.frequency.value = f * p('carrierRatio');

    const modFreq = f * p('modRatio');
    const modulator = voice.source(ctx.createOscillator());
    modulator.type = WAVEFORMS[Math.round(p('modWave'))] ?? 'sine';
    modulator.frequency.value = modFreq;
    const modDepth = voice.node(ctx.createGain());
    modulator.connect(modDepth);
    modDepth.connect(carrier.frequency);

    const amp = voice.node(ctx.createGain());
    carrier.connect(amp);
    amp.connect(voice.out);

    const velScale = 1 - p('velToIndex') + p('velToIndex') * velocity;
    voice.envelope(
      new Envelope(
        modDepth.gain,
        time,
        { attack: p('modAttack'), decay: p('modDecay'), sustain: p('modSustain'), release: p('modRelease') },
        p('modIndex') * modFreq * velScale,
      ),
    );
    voice.envelope(
      new Envelope(amp.gain, time, { attack: p('attack'), decay: p('decay'), sustain: p('sustain'), release: p('release') }, velocity * p('gain')),
    );
    carrier.start(time);
    modulator.start(time);
    return voice;
  },
};
