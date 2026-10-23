import type { InstrumentPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { createNoise, decayEnvelope, noiseOffset } from '../dsp';
import { NodeVoice } from '../voice';

export const DRUM_VOICES = ['Kick', 'Snare', 'Clap', 'Hat fechado', 'Hat aberto', 'Tom', 'Rim', 'Cowbell', 'Prato'] as const;

const params: ParamSpec[] = [
  { id: 'voice', name: 'Som', min: 0, max: DRUM_VOICES.length - 1, default: 0, options: [...DRUM_VOICES], group: 'Som' },
  { id: 'tune', name: 'Afinação', min: -24, max: 24, default: 0, step: 0.1, unit: 'st', group: 'Som' },
  { id: 'decay', name: 'Decaim.', min: 0.1, max: 4, default: 1, scale: 'log', unit: '×', group: 'Som' },
  { id: 'tone', name: 'Tom', min: 0, max: 1, default: 0.5, unit: '%', group: 'Som' },
  { id: 'snap', name: 'Ataque', min: 0, max: 1, default: 0.5, unit: '%', group: 'Som' },
  { id: 'level', name: 'Volume', min: 0, max: 1, default: 0.8, unit: '%', group: 'Saída' },
];

/** Classic 808-style metallic partials (Hz) used for hats, cymbals and cowbell. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

interface Hit {
  ctx: BaseAudioContext;
  voice: NodeVoice;
  out: AudioNode;
  t: number;
  /** Pitch multiplier from tune + played key. */
  pitch: number;
  decay: number;
  tone: number;
  snap: number;
}

function osc(h: Hit, type: OscillatorType, freq: number): OscillatorNode {
  const o = h.voice.source(h.ctx.createOscillator());
  o.type = type;
  o.frequency.value = freq;
  return o;
}

function gain(h: Hit, dest: AudioNode): GainNode {
  const g = h.voice.node(h.ctx.createGain());
  g.gain.value = 0;
  g.connect(dest);
  return g;
}

function filter(h: Hit, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = h.voice.node(h.ctx.createBiquadFilter());
  f.type = type;
  f.frequency.value = Math.min(freq, h.ctx.sampleRate / 2 - 100);
  f.Q.value = q;
  return f;
}

function noiseBurst(h: Hit, dest: AudioNode, peak: number, decay: number): number {
  const n = h.voice.source(createNoise(h.ctx));
  const g = gain(h, dest);
  n.connect(g);
  const end = decayEnvelope(g.gain, h.t, peak, decay);
  n.start(h.t, noiseOffset());
  n.stop(end);
  return end;
}

function metal(h: Hit, dest: AudioNode, base: number): OscillatorNode[] {
  return METAL.map((f) => {
    const o = osc(h, 'square', f * base);
    o.connect(dest);
    o.start(h.t);
    return o;
  });
}

function kick(h: Hit): number {
  const base = 52 * h.pitch;
  const body = osc(h, 'sine', base);
  body.frequency.setValueAtTime(base * (2.5 + h.tone * 3), h.t);
  body.frequency.setTargetAtTime(base, h.t, 0.018 + (1 - h.tone) * 0.02);
  const g = gain(h, h.out);
  body.connect(g);
  const end = decayEnvelope(g.gain, h.t, 1, 0.5 * h.decay, 0.002);
  body.start(h.t);
  if (h.snap > 0) noiseBurst(h, filter(h, 'highpass', 2500), h.snap * 0.35, 0.012);
  return end;
}

function snare(h: Hit): number {
  const base = 185 * h.pitch;
  const body = osc(h, 'triangle', base);
  body.frequency.setValueAtTime(base * 1.5, h.t);
  body.frequency.setTargetAtTime(base, h.t, 0.015);
  const g = gain(h, h.out);
  body.connect(g);
  const bodyEnd = decayEnvelope(g.gain, h.t, 0.75 - h.snap * 0.3, 0.13 * h.decay);
  body.start(h.t);
  const hp = filter(h, 'highpass', 1000 + h.tone * 3500);
  hp.connect(h.out);
  const noiseEnd = noiseBurst(h, hp, 0.35 + h.snap * 0.55, 0.24 * h.decay);
  return Math.max(bodyEnd, noiseEnd);
}

function clap(h: Hit): number {
  const n = h.voice.source(createNoise(h.ctx));
  const bp = filter(h, 'bandpass', (900 + h.tone * 1800) * h.pitch, 1.3);
  const g = gain(h, h.out);
  n.connect(bp);
  bp.connect(g);
  const p = g.gain;
  p.setValueAtTime(0, h.t);
  for (let i = 0; i < 3; i++) {
    const ti = h.t + i * 0.011;
    p.setValueAtTime(0.9, ti);
    p.setTargetAtTime(0.12, ti + 0.0005, 0.003);
  }
  const tailStart = h.t + 0.033;
  const tail = 0.2 * h.decay;
  p.setValueAtTime(0.75 + h.snap * 0.25, tailStart);
  p.setTargetAtTime(0, tailStart, tail / 5);
  const end = tailStart + tail * 1.4;
  n.start(h.t, noiseOffset());
  n.stop(end);
  return end;
}

function hat(h: Hit, open: boolean): number {
  const bp = filter(h, 'bandpass', 10000, 0.8);
  const hp = filter(h, 'highpass', 6500 + h.tone * 2500);
  const g = gain(h, h.out);
  bp.connect(hp);
  hp.connect(g);
  const mix = h.voice.node(h.ctx.createGain());
  mix.gain.value = 0.35;
  mix.connect(bp);
  metal(h, mix, h.pitch * (1 + h.tone * 0.4));
  const decay = (open ? 0.42 : 0.055) * h.decay;
  const end = decayEnvelope(g.gain, h.t, 0.55, decay);
  if (h.snap > 0) noiseBurst(h, hp, h.snap * 0.4, decay * 0.9);
  return end;
}

function tom(h: Hit): number {
  const base = 115 * h.pitch;
  const body = osc(h, 'sine', base);
  body.frequency.setValueAtTime(base * 1.6, h.t);
  body.frequency.setTargetAtTime(base, h.t, 0.04);
  const g = gain(h, h.out);
  body.connect(g);
  const end = decayEnvelope(g.gain, h.t, 0.9, 0.38 * h.decay);
  body.start(h.t);
  if (h.snap > 0) noiseBurst(h, filter(h, 'bandpass', 3000 + h.tone * 3000, 0.8), h.snap * 0.2, 0.03);
  return end;
}

function rim(h: Hit): number {
  const body = osc(h, 'triangle', 1700 * h.pitch);
  const bp = filter(h, 'bandpass', (1600 + h.tone * 1600) * h.pitch, 3);
  const g = gain(h, h.out);
  body.connect(bp);
  bp.connect(g);
  const end = decayEnvelope(g.gain, h.t, 1.2, 0.035 * h.decay);
  body.start(h.t);
  if (h.snap > 0) noiseBurst(h, bp, h.snap * 0.6, 0.01);
  return end;
}

function cowbell(h: Hit): number {
  const bp = filter(h, 'bandpass', 800 * h.pitch * (0.8 + h.tone * 0.4), 2);
  const g = gain(h, h.out);
  bp.connect(g);
  for (const f of [540, 800]) {
    const o = osc(h, 'square', f * h.pitch);
    o.connect(bp);
    o.start(h.t);
  }
  const p = g.gain;
  p.setValueAtTime(0, h.t);
  p.linearRampToValueAtTime(0.7, h.t + 0.001);
  p.setTargetAtTime(0.25, h.t + 0.001, 0.012);
  p.setTargetAtTime(0, h.t + 0.03, 0.08 * h.decay);
  return h.t + 0.03 + 0.08 * h.decay * 7;
}

function crash(h: Hit): number {
  const hp = filter(h, 'highpass', 4000 + h.tone * 3000);
  const g = gain(h, h.out);
  hp.connect(g);
  const mix = h.voice.node(h.ctx.createGain());
  mix.gain.value = 0.25;
  mix.connect(hp);
  metal(h, mix, h.pitch * 1.7);
  const decay = 1.6 * h.decay;
  const end = decayEnvelope(g.gain, h.t, 0.5, decay, 0.003);
  noiseBurst(h, hp, 0.25 + h.snap * 0.4, decay);
  return end;
}

const VOICES: Array<(h: Hit) => number> = [
  kick,
  snare,
  clap,
  (h) => hat(h, false),
  (h) => hat(h, true),
  tom,
  rim,
  cowbell,
  crash,
];

function preset(name: string, voice: number, extra: Record<string, number> = {}) {
  return { name, params: { voice, ...extra } };
}

export const drumSynth: InstrumentPlugin = {
  kind: 'instrument',
  id: 'drums',
  name: 'Drum Synth',
  description: 'Bateria sintetizada: kick, snare, clap, hats, tom, rim, cowbell e prato. A nota tocada altera a afinação.',
  params,
  presets: [
    preset('Kick', 0, { tone: 0.45, snap: 0.4 }),
    preset('Kick 808 longo', 0, { tone: 0.3, snap: 0.15, decay: 3, tune: -2 }),
    preset('Snare', 1, { tone: 0.5, snap: 0.6 }),
    preset('Clap', 2, { tone: 0.45, snap: 0.5 }),
    preset('Hat fechado', 3, { tone: 0.6, snap: 0.3, level: 0.5 }),
    preset('Hat aberto', 4, { tone: 0.6, snap: 0.3, level: 0.45 }),
    preset('Tom', 5, { tone: 0.4 }),
    preset('Rim', 6),
    preset('Cowbell', 7, { level: 0.5 }),
    preset('Prato', 8, { level: 0.5 }),
  ],

  noteOn(ctx, destination, { key, velocity, time, rootKey, params: values, detune = 0 }) {
    const p = paramReader(params, values);
    const voice = new NodeVoice(ctx, destination);
    const level = voice.node(ctx.createGain());
    level.gain.value = p('level') * velocity;
    level.connect(voice.out);
    const hit: Hit = {
      ctx,
      voice,
      out: level,
      t: time,
      pitch: Math.pow(2, (p('tune') + key - rootKey + detune / 100) / 12),
      decay: p('decay'),
      tone: p('tone'),
      snap: p('snap'),
    };
    const play = VOICES[Math.round(p('voice'))] ?? kick;
    voice.endAt(play(hit));
    return voice;
  },
};
