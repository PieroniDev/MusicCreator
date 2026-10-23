import { drumSynth } from '../plugins/instruments/drumSynth';
import { normalizeParams } from '../plugins/params';
import { encodeWav } from '../audio/wav';
import { bytesToBase64 } from '../audio/samples';
import { actions } from '../state/store';

/** Pads of the built-in kit: a Drum Synth preset and tweaks, rendered to samples. */
const KIT: Array<[string, string, Record<string, number>]> = [
  ['Kick', 'Kick', {}],
  ['Kick 808', 'Kick 808 longo', {}],
  ['Snare', 'Snare', {}],
  ['Clap', 'Clap', {}],
  ['Hat fechado', 'Hat fechado', {}],
  ['Hat aberto', 'Hat aberto', {}],
  ['Tom grave', 'Tom', { tune: -5 }],
  ['Tom médio', 'Tom', {}],
  ['Tom agudo', 'Tom', { tune: 5 }],
  ['Rim', 'Rim', {}],
  ['Cowbell', 'Cowbell', {}],
  ['Prato', 'Prato', {}],
  ['Snare seca', 'Snare', { tune: 3, decay: 0.5, snap: 0.9 }],
  ['Clap aberto', 'Clap', { decay: 2, tone: 0.7 }],
  ['Shaker', 'Hat fechado', { tone: 1, decay: 0.6, snap: 0.9, level: 0.35 }],
  ['Kick curto', 'Kick', { tune: 4, decay: 0.45 }],
];

async function renderHit(presetName: string, extra: Record<string, number>): Promise<string> {
  const preset = drumSynth.presets.find((p) => p.name === presetName);
  const params = normalizeParams(drumSynth.params, { ...preset?.params, ...extra });
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, rate * 2.5, rate);
  drumSynth.noteOn(ctx, ctx.destination, { key: 60, rootKey: 60, velocity: 1, time: 0, params });
  const rendered = await ctx.startRendering();
  // Trim the silent tail so the samples stay small.
  const data = rendered.getChannelData(0);
  let end = data.length;
  while (end > rate * 0.05 && Math.abs(data[end - 1]) < 1e-4) end--;
  const trimmed = {
    numberOfChannels: 2,
    sampleRate: rate,
    length: end,
    getChannelData: (c: number) => rendered.getChannelData(c).subarray(0, end),
  };
  return bytesToBase64(new Uint8Array(encodeWav(trimmed)));
}

/** Fills a Drum Pads channel with the synthesized kit (one undo step). */
export async function fillWithSynthKit(channelId: string): Promise<void> {
  const samples = await Promise.all(KIT.map(([, preset, extra]) => renderHit(preset, extra)));
  const a = actions();
  a.beginGesture();
  samples.forEach((data, pad) => a.setPadSample(channelId, pad, `${KIT[pad][0]}.wav`, data));
  a.endGesture();
}

/** Adds an instrument channel; Drum Pads start with the synthesized kit loaded. */
export function addInstrumentChannel(instrumentId: string, preset?: string): string {
  const id = actions().addChannel(instrumentId, preset);
  if (instrumentId === 'pads') void fillWithSynthKit(id);
  return id;
}
