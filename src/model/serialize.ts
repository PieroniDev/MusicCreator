import type { Channel, EffectSlot, MixerTrack, Note, Pattern, PlaylistClip, PlaylistTrack, Project, SampleAsset } from './types';
import { colorAt, createMixerTrack, createPlaylistTracks, MAX_EFFECT_SLOTS, MIXER_INSERTS, PLAYLIST_TRACKS, uid } from './defaults';
import { getEffect, getInstrument, DEFAULT_INSTRUMENT } from '../plugins/registry';
import { normalizeParams } from '../plugins/params';

export const FILE_EXTENSION = '.mcproj';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.length > 0 ? v.slice(0, 200) : fallback);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown) => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const color = (v: unknown, i: number) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : colorAt(i));

function parseNote(v: unknown): Note | null {
  if (!isObj(v)) return null;
  const length = num(v.length, 0, 0, 1e7);
  if (length <= 0) return null;
  return {
    id: str(v.id, uid('n')),
    key: Math.round(num(v.key, 60, 0, 127)),
    start: num(v.start, 0, 0, 1e7),
    length,
    velocity: num(v.velocity, 0.8, 0, 1),
  };
}

function parseChannel(v: unknown, i: number, mixerSize: number): Channel | null {
  if (!isObj(v)) return null;
  const plugin = getInstrument(str(v.instrument, '')) ?? getInstrument(DEFAULT_INSTRUMENT)!;
  return {
    id: str(v.id, uid('ch')),
    name: str(v.name, `Canal ${i + 1}`),
    color: color(v.color, i),
    instrument: plugin.id,
    params: normalizeParams(plugin.params, isObj(v.params) ? (v.params as Record<string, number>) : undefined),
    volume: num(v.volume, 0.78, 0, 1.25),
    pan: num(v.pan, 0, -1, 1),
    mute: bool(v.mute),
    solo: bool(v.solo),
    mixerTrack: Math.round(num(v.mixerTrack, 0, 0, mixerSize - 1)),
    rootKey: Math.round(num(v.rootKey, 60, 0, 127)),
    sampleId: typeof v.sampleId === 'string' ? v.sampleId : undefined,
  };
}

function parsePattern(v: unknown, i: number, channelIds: Set<string>): Pattern | null {
  if (!isObj(v)) return null;
  const notes: Record<string, Note[]> = {};
  if (isObj(v.notes)) {
    for (const [channelId, list] of Object.entries(v.notes)) {
      if (!channelIds.has(channelId)) continue;
      notes[channelId] = arr(list).map(parseNote).filter((n): n is Note => n !== null);
    }
  }
  return {
    id: str(v.id, uid('pt')),
    name: str(v.name, `Pattern ${i + 1}`),
    color: color(v.color, i),
    lengthBars: Math.round(num(v.lengthBars, 1, 1, 64)),
    notes,
  };
}

function parseEffect(v: unknown): EffectSlot | null {
  if (!isObj(v)) return null;
  const plugin = getEffect(str(v.plugin, ''));
  if (!plugin) return null;
  return {
    id: str(v.id, uid('fx')),
    plugin: plugin.id,
    params: normalizeParams(plugin.params, isObj(v.params) ? (v.params as Record<string, number>) : undefined),
    enabled: v.enabled !== false,
  };
}

function parseMixerTrack(v: unknown, i: number): MixerTrack {
  const base = createMixerTrack(i);
  if (!isObj(v)) return base;
  return {
    id: str(v.id, base.id),
    name: str(v.name, base.name),
    volume: num(v.volume, base.volume, 0, 2),
    pan: num(v.pan, 0, -1, 1),
    mute: bool(v.mute),
    solo: i === 0 ? false : bool(v.solo),
    effects: arr(v.effects)
      .map(parseEffect)
      .filter((e): e is EffectSlot => e !== null)
      .slice(0, MAX_EFFECT_SLOTS),
  };
}

/**
 * Validates and normalizes untrusted project JSON (a file the user opened or
 * autosaved data). Unknown fields are dropped and missing ones defaulted;
 * throws only when the input is not a project at all.
 */
export function parseProject(input: unknown): Project {
  if (!isObj(input) || !Array.isArray(input.channels) || !Array.isArray(input.patterns)) {
    throw new Error('O arquivo não é um projeto do MusicCreator.');
  }
  const rawMixer = arr(input.mixer);
  const mixer = Array.from({ length: Math.max(MIXER_INSERTS + 1, Math.min(rawMixer.length, 128)) }, (_, i) =>
    parseMixerTrack(rawMixer[i], i),
  );
  const channels = input.channels
    .map((c, i) => parseChannel(c, i, mixer.length))
    .filter((c): c is Channel => c !== null);
  const channelIds = new Set(channels.map((c) => c.id));
  const patterns = input.patterns
    .map((p, i) => parsePattern(p, i, channelIds))
    .filter((p): p is Pattern => p !== null);
  if (patterns.length === 0) {
    patterns.push({ id: uid('pt'), name: 'Pattern 1', color: colorAt(0), lengthBars: 1, notes: {} });
  }
  const patternIds = new Set(patterns.map((p) => p.id));

  const playlist = isObj(input.playlist) ? input.playlist : {};
  const defaultTracks = createPlaylistTracks(PLAYLIST_TRACKS);
  const rawTracks = arr(playlist.tracks);
  const tracks: PlaylistTrack[] = Array.from({ length: Math.max(PLAYLIST_TRACKS, Math.min(rawTracks.length, 200)) }, (_, i) => {
    const t = rawTracks[i];
    const fallback = defaultTracks[i] ?? { id: uid('tr'), name: `Faixa ${i + 1}`, mute: false };
    return isObj(t) ? { id: str(t.id, fallback.id), name: str(t.name, fallback.name), mute: bool(t.mute) } : fallback;
  });
  const clips: PlaylistClip[] = arr(playlist.clips)
    .filter(isObj)
    .filter((c) => typeof c.patternId === 'string' && patternIds.has(c.patternId))
    .map((c) => ({
      id: str(c.id, uid('cl')),
      patternId: c.patternId as string,
      track: Math.round(num(c.track, 0, 0, tracks.length - 1)),
      start: num(c.start, 0, 0, 1e8),
      length: num(c.length, 384, 1, 1e8),
    }));

  const samples: Record<string, SampleAsset> = {};
  if (isObj(input.samples)) {
    for (const [id, s] of Object.entries(input.samples)) {
      if (isObj(s) && typeof s.data === 'string') samples[id] = { id, name: str(s.name, 'sample'), data: s.data };
    }
  }
  for (const c of channels) if (c.sampleId && !samples[c.sampleId]) c.sampleId = undefined;

  return {
    version: 1,
    name: str(input.name, 'Sem título'),
    bpm: num(input.bpm, 130, 20, 400),
    channels,
    patterns,
    playlist: { tracks, clips },
    mixer,
    samples,
  };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}
