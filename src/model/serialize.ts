import type {
  AutomationPoint,
  AutomationTarget,
  Channel,
  EffectSlot,
  MixerSend,
  MixerTrack,
  Note,
  Pattern,
  PlaylistClip,
  PlaylistTrack,
  Marker,
  Project,
  SampleAsset,
  StretchSettings,
  TimeSignature,
} from './types';
import { BEAT_UNITS, MAX_BEATS } from './time';
import { STRETCH_PITCH_RANGE } from './stretch';
import { canRoute } from './routing';
import { targetExists } from './automation';
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
  const pan = num(v.pan, 0, -1, 1);
  const fine = num(v.fine, 0, -100, 100);
  return {
    id: str(v.id, uid('n')),
    key: Math.round(num(v.key, 60, 0, 127)),
    start: num(v.start, 0, 0, 1e7),
    length,
    velocity: num(v.velocity, 0.8, 0, 1),
    ...(pan ? { pan } : {}),
    ...(fine ? { fine } : {}),
  };
}

function parseTimeSig(v: unknown): { timeSig?: TimeSignature } {
  if (!isObj(v)) return {};
  const beats = Math.round(num(v.beats, 4, 1, MAX_BEATS));
  const beatUnit = BEAT_UNITS.includes(v.beatUnit as number) ? (v.beatUnit as number) : 4;
  return beats === 4 && beatUnit === 4 ? {} : { timeSig: { beats, beatUnit } };
}

function parseStretch(v: unknown): StretchSettings | undefined {
  if (!isObj(v)) return undefined;
  return {
    mode: v.mode === 'resample' ? 'resample' : 'stretch',
    pitch: num(v.pitch, 0, -STRETCH_PITCH_RANGE, STRETCH_PITCH_RANGE),
    bpm: v.bpm === 0 ? 0 : num(v.bpm, 0, 10, 999),
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
    pads: Array.isArray(v.pads) ? v.pads.slice(0, 16).map((x) => (typeof x === 'string' ? x : null)) : undefined,
    stretch: parseStretch(v.stretch),
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
    toMaster: v.toMaster !== false,
    // Raw sends; validated once the whole mixer is known (see parseSends).
    sends: arr(v.sends)
      .filter(isObj)
      .map((x) => ({ to: Math.round(num(x.to, -1)), level: num(x.level, 1, 0, 2) })),
  };
}

/** Keeps only sends that point at another insert without creating a loop. */
function parseSends(mixer: MixerTrack[]): void {
  const raw = mixer.map((t) => t.sends);
  for (const t of mixer) t.sends = [];
  raw.forEach((sends, from) => {
    for (const send of sends) {
      if (mixer[from].sends.some((x) => x.to === send.to)) continue;
      if (canRoute(mixer, from, send.to)) mixer[from].sends.push(send as MixerSend);
    }
  });
}

function parseTarget(v: unknown, mixerSize: number): AutomationTarget | null {
  if (!isObj(v)) return null;
  const track = Math.round(num(v.track, -1));
  const validTrack = track >= 0 && track < mixerSize;
  switch (v.kind) {
    case 'channel':
      return typeof v.channelId === 'string' && (v.param === 'volume' || v.param === 'pan')
        ? { kind: 'channel', channelId: v.channelId, param: v.param }
        : null;
    case 'instrument':
      return typeof v.channelId === 'string' && typeof v.param === 'string'
        ? { kind: 'instrument', channelId: v.channelId, param: v.param }
        : null;
    case 'mixer':
      return validTrack && (v.param === 'volume' || v.param === 'pan') ? { kind: 'mixer', track, param: v.param } : null;
    case 'effect':
      return validTrack && typeof v.slotId === 'string' && typeof v.param === 'string'
        ? { kind: 'effect', track, slotId: v.slotId, param: v.param }
        : null;
    case 'tempo':
      return { kind: 'tempo' };
    default:
      return null;
  }
}

function parsePoints(v: unknown, length: number): AutomationPoint[] {
  const points = arr(v)
    .filter(isObj)
    .map((p) => ({ t: num(p.t, 0, 0, length), v: num(p.v, 0.5, 0, 1) }))
    .sort((a, b) => a.t - b.t);
  return points.length ? points.slice(0, 2000) : [{ t: 0, v: 0.5 }];
}

interface ClipContext {
  patternIds: Set<string>;
  channelIds: Set<string>;
  trackCount: number;
  mixerSize: number;
}

function parseClip(c: Record<string, unknown>, ctx: ClipContext): PlaylistClip | null {
  const base = {
    id: str(c.id, uid('cl')),
    track: Math.round(num(c.track, 0, 0, ctx.trackCount - 1)),
    start: num(c.start, 0, 0, 1e8),
    length: num(c.length, 384, 1, 1e8),
  };
  // Clips from before audio/automation clips existed have no kind.
  const kind = c.kind ?? 'pattern';
  if (kind === 'pattern') {
    return typeof c.patternId === 'string' && ctx.patternIds.has(c.patternId) ? { ...base, kind, patternId: c.patternId } : null;
  }
  if (kind === 'audio') {
    return typeof c.channelId === 'string' && ctx.channelIds.has(c.channelId)
      ? { ...base, kind, channelId: c.channelId, offset: num(c.offset, 0, 0, 1e6) }
      : null;
  }
  if (kind === 'automation') {
    const target = parseTarget(c.target, ctx.mixerSize);
    return target ? { ...base, kind, target, points: parsePoints(c.points, base.length) } : null;
  }
  return null;
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
  parseSends(mixer);
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
  const clipContext: ClipContext = { patternIds, channelIds, trackCount: tracks.length, mixerSize: mixer.length };
  const clips: PlaylistClip[] = arr(playlist.clips)
    .filter(isObj)
    .map((c) => parseClip(c, clipContext))
    .filter((c): c is PlaylistClip => c !== null);

  const markers: Marker[] = arr(playlist.markers)
    .filter(isObj)
    .map((m) => ({ id: str(m.id, uid('mk')), tick: Math.round(num(m.tick, 0, 0, 1e7)), name: str(m.name, 'Marcador').slice(0, 60) }))
    .sort((a, b) => a.tick - b.tick)
    .slice(0, 500);

  const samples: Record<string, SampleAsset> = {};
  if (isObj(input.samples)) {
    for (const [id, s] of Object.entries(input.samples)) {
      if (isObj(s) && typeof s.data === 'string') samples[id] = { id, name: str(s.name, 'sample'), data: s.data };
    }
  }
  for (const c of channels) {
    if (c.sampleId && !samples[c.sampleId]) c.sampleId = undefined;
    if (c.pads) c.pads = c.pads.map((id) => (id && samples[id] ? id : null));
    else delete c.pads;
    if (!c.stretch) delete c.stretch;
  }

  const project: Project = {
    version: 1,
    name: str(input.name, 'Sem título'),
    bpm: num(input.bpm, 130, 20, 400),
    ...parseTimeSig(input.timeSig),
    swing: num(input.swing, 0, 0, 1),
    channels,
    patterns,
    playlist: { tracks, clips, ...(markers.length ? { markers } : {}) },
    mixer,
    samples,
  };
  // Automation of things that no longer exist (deleted channel, effect...) is dropped.
  project.playlist.clips = clips.filter((c) => c.kind !== 'automation' || targetExists(project, c.target));
  return project;
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}
