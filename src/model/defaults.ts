import type { Channel, EffectSlot, MixerTrack, Note, Pattern, PlaylistClip, PlaylistTrack, Project } from './types';
import { TICKS_PER_BAR, TICKS_PER_STEP } from './time';
import { getEffect, getInstrument } from '../plugins/registry';
import { normalizeParams } from '../plugins/params';

export const MIXER_INSERTS = 16;
export const PLAYLIST_TRACKS = 12;
export const MAX_EFFECT_SLOTS = 8;

export const COLORS = ['#ff8a3d', '#f5c542', '#7ed957', '#3ddc97', '#3dc6ff', '#5b8cff', '#a87cff', '#ff6fb5', '#ff5a5a', '#c9d1d9'];

let counter = 0;
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function colorAt(i: number): string {
  return COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];
}

/** Params for a plugin, starting from one of its presets (by name) or its defaults. */
export function instrumentParams(instrumentId: string, presetName?: string) {
  const plugin = getInstrument(instrumentId);
  if (!plugin) return {};
  const preset = presetName ? plugin.presets.find((p) => p.name === presetName) : undefined;
  return normalizeParams(plugin.params, preset?.params);
}

export function createChannel(
  instrumentId: string,
  name: string,
  options: Partial<Omit<Channel, 'id' | 'instrument'>> & { preset?: string } = {},
): Channel {
  const { preset, ...rest } = options;
  return {
    id: uid('ch'),
    name,
    color: COLORS[0],
    instrument: instrumentId,
    params: instrumentParams(instrumentId, preset),
    volume: 0.78,
    pan: 0,
    mute: false,
    solo: false,
    mixerTrack: 0,
    rootKey: 60,
    ...rest,
  };
}

export function createEffectSlot(pluginId: string, presetName?: string): EffectSlot {
  const plugin = getEffect(pluginId);
  const preset = presetName ? plugin?.presets.find((p) => p.name === presetName) : undefined;
  return {
    id: uid('fx'),
    plugin: pluginId,
    params: plugin ? normalizeParams(plugin.params, preset?.params) : {},
    enabled: true,
  };
}

export function createMixerTrack(index: number): MixerTrack {
  return {
    id: uid('mx'),
    name: index === 0 ? 'Master' : `Insert ${index}`,
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    effects: [],
  };
}

export function createPattern(name: string, color: string, lengthBars = 1): Pattern {
  return { id: uid('pt'), name, color, lengthBars, notes: {} };
}

export function createPlaylistTracks(count = PLAYLIST_TRACKS): PlaylistTrack[] {
  return Array.from({ length: count }, (_, i) => ({ id: uid('tr'), name: `Faixa ${i + 1}`, mute: false }));
}

export function createNote(key: number, start: number, length: number, velocity = 0.8): Note {
  return { id: uid('n'), key, start, length, velocity };
}

function drumChannels(): Channel[] {
  return [
    createChannel('drums', 'Kick', { preset: 'Kick', color: '#ff8a3d', mixerTrack: 1 }),
    createChannel('drums', 'Clap', { preset: 'Clap', color: '#f5c542', mixerTrack: 2 }),
    createChannel('drums', 'Hat', { preset: 'Hat fechado', color: '#7ed957', mixerTrack: 3 }),
    createChannel('drums', 'Snare', { preset: 'Snare', color: '#3ddc97', mixerTrack: 4 }),
  ];
}

function baseMixer(): MixerTrack[] {
  const mixer = Array.from({ length: MIXER_INSERTS + 1 }, (_, i) => createMixerTrack(i));
  mixer[0].effects.push(createEffectSlot('limiter', 'Segurança'));
  return mixer;
}

/** A blank project: drum channels, one synth, one empty pattern. */
export function createEmptyProject(): Project {
  const channels = [...drumChannels(), createChannel('trio', 'Trio Synth', { color: '#5b8cff', mixerTrack: 5 })];
  const mixer = baseMixer();
  channels.forEach((c) => (mixer[c.mixerTrack].name = c.name));
  return {
    version: 1,
    name: 'Sem título',
    bpm: 130,
    channels,
    patterns: [createPattern('Pattern 1', COLORS[0])],
    playlist: { tracks: createPlaylistTracks(), clips: [] },
    mixer,
    samples: {},
  };
}

function steps(stepsOn: number[], key: number, velocity = 0.8): Note[] {
  return stepsOn.map((s) => createNote(key, s * TICKS_PER_STEP, TICKS_PER_STEP, velocity));
}

function clip(patternId: string, track: number, startBar: number, bars: number): PlaylistClip {
  return { id: uid('cl'), patternId, track, start: startBar * TICKS_PER_BAR, length: bars * TICKS_PER_BAR };
}

/** The demo song loaded on first start, showing every part of the app. */
export function createDemoProject(): Project {
  const [kick, clap, hat, snare] = drumChannels();
  const bass = createChannel('trio', 'Baixo', { preset: 'Sub Bass', color: '#3dc6ff', mixerTrack: 5 });
  const chords = createChannel('trio', 'Acordes', { preset: 'Pad', color: '#a87cff', mixerTrack: 6, volume: 0.6 });
  const lead = createChannel('fm', 'Melodia', { preset: 'Marimba', color: '#ff6fb5', mixerTrack: 7, volume: 0.65 });
  const channels = [kick, clap, hat, snare, bass, chords, lead];

  const beat = createPattern('Batida', '#ff8a3d', 1);
  beat.notes[kick.id] = steps([0, 4, 8, 12], 60, 0.9);
  beat.notes[clap.id] = steps([4, 12], 60, 0.8);
  beat.notes[hat.id] = [...steps([2, 6, 10, 14], 60, 0.75), ...steps([3, 7, 11, 15], 60, 0.35)].sort((a, b) => a.start - b.start);
  beat.notes[snare.id] = steps([15], 60, 0.35);

  // Am – F – C – G, one chord per bar.
  const roots = [45, 41, 48, 43];
  const triads = [
    [57, 60, 64],
    [53, 57, 60],
    [55, 60, 64],
    [55, 59, 62],
  ];
  const bassline = createPattern('Baixo', '#3dc6ff', 4);
  bassline.notes[bass.id] = roots.flatMap((root, bar) =>
    [2, 6, 10, 14].map((s) => createNote(root, bar * TICKS_PER_BAR + s * TICKS_PER_STEP, TICKS_PER_STEP * 1.5, 0.85)),
  );

  const pads = createPattern('Acordes', '#a87cff', 4);
  pads.notes[chords.id] = triads.flatMap((triad, bar) =>
    triad.map((key) => createNote(key, bar * TICKS_PER_BAR, TICKS_PER_BAR - TICKS_PER_STEP, 0.7)),
  );

  // A minor pentatonic phrase over the four chords: [key, step, length in steps].
  const phrase: Array<[number, number, number]> = [
    [69, 0, 2], [72, 3, 1], [76, 6, 2], [74, 10, 2], [72, 13, 3],
    [69, 16, 2], [72, 19, 1], [74, 22, 2], [72, 26, 4],
    [67, 32, 2], [72, 35, 1], [76, 38, 2], [79, 42, 2], [76, 45, 3],
    [74, 48, 2], [72, 51, 1], [71, 54, 2], [67, 58, 4],
  ];
  const melody = createPattern('Melodia', '#ff6fb5', 4);
  melody.notes[lead.id] = phrase.map(([key, s, len]) => createNote(key, s * TICKS_PER_STEP, len * TICKS_PER_STEP, 0.8));

  const tracks = createPlaylistTracks();
  ['Bateria', 'Baixo', 'Acordes', 'Melodia'].forEach((name, i) => (tracks[i].name = name));

  const mixer = baseMixer();
  channels.forEach((c) => (mixer[c.mixerTrack].name = c.name));
  mixer[0].effects = [createEffectSlot('limiter', 'Mais alto')];
  mixer[1].effects.push(createEffectSlot('eq', 'Kick com peso'));
  mixer[2].effects.push(createEffectSlot('reverb', 'Quarto pequeno'));
  mixer[5].effects.push(createEffectSlot('compressor', 'Suave'));
  mixer[6].effects.push(createEffectSlot('chorus', 'Ensemble largo'), createEffectSlot('reverb', 'Hall'));
  mixer[7].effects.push(createEffectSlot('delay', 'Ping-pong 1/8 pont.'), createEffectSlot('reverb', 'Sala'));
  mixer[5].volume = 0.75;

  return {
    version: 1,
    name: 'Demo',
    bpm: 124,
    channels,
    patterns: [beat, bassline, pads, melody],
    playlist: {
      tracks,
      clips: [
        clip(pads.id, 2, 0, 16),
        clip(beat.id, 0, 4, 12),
        clip(bassline.id, 1, 4, 12),
        clip(melody.id, 3, 8, 8),
      ],
    },
    mixer,
    samples: {},
  };
}
