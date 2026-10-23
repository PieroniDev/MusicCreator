import type { InstrumentPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { Envelope } from '../dsp';
import { NodeVoice } from '../voice';
import type { ParamValues } from '../../model/types';

export const SLICE_COUNTS = [2, 4, 8, 16, 32, 64];
const MODES = ['Partes iguais', 'Transientes (ataques)'];

const params: ParamSpec[] = [
  { id: 'slices', name: 'Fatias', min: 0, max: SLICE_COUNTS.length - 1, default: 3, options: SLICE_COUNTS.map(String), group: 'Fatias' },
  { id: 'mode', name: 'Cortar por', min: 0, max: 1, default: 1, options: MODES, group: 'Fatias' },
  { id: 'sensitivity', name: 'Sensib.', min: 0, max: 1, default: 0.5, unit: '%', group: 'Fatias' },
  { id: 'pitch', name: 'Afinação', min: -24, max: 24, default: 0, step: 0.1, unit: 'st', group: 'Som' },
  { id: 'attack', name: 'Ataque', min: 0.001, max: 0.2, default: 0.002, scale: 'log', unit: 's', group: 'Som' },
  { id: 'release', name: 'Relaxam.', min: 0.003, max: 0.5, default: 0.01, scale: 'log', unit: 's', group: 'Som' },
  { id: 'gate', name: 'Cortar na nota', min: 0, max: 1, default: 0, options: ['Não', 'Sim'], group: 'Som' },
  { id: 'gain', name: 'Volume', min: 0, max: 1.5, default: 0.9, unit: '%', group: 'Saída' },
];

const cache = new WeakMap<AudioBuffer, Map<string, number[]>>();

/**
 * Start times (seconds) of the slices of a loop: equal parts, or the
 * strongest attacks found by an energy-rise detector (always including 0).
 */
export function slicePoints(buffer: AudioBuffer, values: ParamValues): number[] {
  const p = paramReader(params, values);
  const count = SLICE_COUNTS[Math.round(p('slices'))] ?? 16;
  const transient = Math.round(p('mode')) === 1;
  const sensitivity = p('sensitivity');
  const key = `${count}|${transient}|${sensitivity}`;
  let byKey = cache.get(buffer);
  if (!byKey) cache.set(buffer, (byKey = new Map()));
  const known = byKey.get(key);
  if (known) return known;

  let points: number[];
  if (!transient) {
    points = Array.from({ length: count }, (_, i) => (i * buffer.duration) / count);
  } else {
    points = detectOnsets(buffer, count, sensitivity);
  }
  byKey.set(key, points);
  return points;
}

/** Energy-rise onset detection on ~11 ms frames; keeps the `max` strongest, well spaced. */
function detectOnsets(buffer: AudioBuffer, max: number, sensitivity: number): number[] {
  const frame = 512;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const frames = Math.floor(buffer.length / frame);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (const data of channels) for (let i = f * frame; i < (f + 1) * frame; i++) e += data[i] * data[i];
    energy[f] = Math.sqrt(e / (frame * channels.length));
  }
  const peak = energy.reduce((m, v) => Math.max(m, v), 0) || 1;
  const floor = peak * (0.25 - sensitivity * 0.22);
  const ratio = 2.5 - sensitivity * 1.7;
  const candidates: Array<{ frame: number; strength: number }> = [];
  for (let f = 1; f < frames; f++) {
    const before = Math.max(energy[f - 1], 1e-6);
    if (energy[f] > floor && energy[f] / before > ratio) candidates.push({ frame: f, strength: energy[f] - before });
  }
  // Strongest first, at least ~60 ms apart.
  const minGap = Math.ceil((0.06 * buffer.sampleRate) / frame);
  const chosen: number[] = [0];
  for (const c of candidates.sort((a, b) => b.strength - a.strength)) {
    if (chosen.length >= max) break;
    if (chosen.every((f) => Math.abs(f - c.frame) >= minGap)) chosen.push(c.frame);
  }
  return chosen.sort((a, b) => a - b).map((f) => (f * frame) / buffer.sampleRate);
}

export const slicer: InstrumentPlugin = {
  kind: 'instrument',
  id: 'slicer',
  name: 'Slicer',
  description: 'Fatia um loop (por partes iguais ou pelos ataques) e toca cada fatia numa tecla a partir da nota base.',
  usesSample: true,
  params,
  presets: [
    { name: 'Por ataques', params: {} },
    { name: '16 partes iguais', params: { mode: 0, slices: 3 } },
    { name: '8 partes iguais', params: { mode: 0, slices: 2 } },
    { name: 'Chop curto', params: { gate: 1, release: 0.02 } },
  ],

  noteOn(ctx, destination, { key, velocity, time, rootKey, params: values, sample, detune = 0 }) {
    const p = paramReader(params, values);
    const voice = new NodeVoice(ctx, destination);
    const points = sample ? slicePoints(sample, values) : [];
    const index = key - rootKey;
    if (!sample || index < 0 || index >= points.length) {
      voice.ensureSource(time);
      voice.endAt(time + 0.05);
      return voice;
    }
    const start = points[index];
    const end = points[index + 1] ?? sample.duration;
    const rate = Math.pow(2, (p('pitch') + detune / 100) / 12);
    const src = voice.source(ctx.createBufferSource());
    src.buffer = sample;
    src.playbackRate.value = rate;
    const amp = voice.node(ctx.createGain());
    src.connect(amp).connect(voice.out);
    src.start(time, start, end - start);
    const env = new Envelope(amp.gain, time, { attack: p('attack'), decay: 1, sustain: 1, release: p('release') }, velocity * p('gain'));
    const length = (end - start) / rate;
    // Fade the slice out right at its end so slices never click.
    const fadeAt = Math.max(time + p('attack'), time + length - p('release'));
    if (p('gate') >= 0.5) voice.envelope(env);
    else {
      env.release(fadeAt);
      voice.endAt(time + length + 0.01);
    }
    return voice;
  },
};
