import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { AutomationPoint, AutomationTarget, Channel, EffectSlot, MixerTrack, Note, PlayMode, PlaylistClip, Project, StretchSettings } from '../model/types';
import { sourceSpeed, STRETCH_PITCH_RANGE } from '../model/stretch';
import { describeTarget } from '../model/automation';
import { canRoute } from '../model/routing';
import {
  colorAt,
  createChannel,
  createDemoProject,
  createEffectSlot,
  createEmptyProject,
  createNote,
  createPattern,
  MAX_EFFECT_SLOTS,
  uid,
} from '../model/defaults';
import { findPattern, patternLength, songLength } from '../model/pattern';
import { barTicks, BEAT_UNITS, MAX_BEATS, SNAP_BAR, TICKS_PER_STEP } from '../model/time';
import { getEffect, getInstrument } from '../plugins/registry';
import { clampParam, normalizeParams } from '../plugins/params';

export type WindowId = 'channelRack' | 'playlist' | 'pianoRoll' | 'mixer';

/** Editable fields of a playlist clip (others are fixed at creation). */
export interface ClipPatch {
  track?: number;
  start?: number;
  length?: number;
  /** Audio clips: seconds into the sample. */
  offset?: number;
}

/** Removes sample assets no channel uses any more. */
function pruneSamples(d: Draft<Project>): void {
  const used = new Set<string>();
  for (const c of d.channels) {
    if (c.sampleId) used.add(c.sampleId);
    for (const id of c.pads ?? []) if (id) used.add(id);
  }
  for (const id of Object.keys(d.samples)) if (!used.has(id)) delete d.samples[id];
}

/**
 * Drops clips that point at something deleted: audio clips of removed
 * channels and automation of removed channels, effects or parameters.
 */
function pruneClips(d: Draft<Project>): void {
  const channelIds = new Set(d.channels.map((c) => c.id));
  d.playlist.clips = d.playlist.clips.filter((c) => {
    if (c.kind === 'audio') return channelIds.has(c.channelId);
    if (c.kind === 'automation') return describeTarget(d as Project, c.target) !== null;
    return true;
  });
}

export interface WindowState {
  open: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export type PluginWindowRef =
  | { kind: 'channel'; channelId: string }
  | { kind: 'effect'; track: number; slotId: string }
  /** Audio editor of a channel's sample. */
  | { kind: 'audio'; channelId: string };

export function pluginWindowKey(ref: PluginWindowRef): string {
  if (ref.kind === 'effect') return `fx:${ref.track}:${ref.slotId}`;
  return `${ref.kind === 'channel' ? 'ch' : 'au'}:${ref.channelId}`;
}

export interface UIState {
  selectedPatternId: string;
  selectedChannelId: string | null;
  selectedMixerTrack: number;
  mode: PlayMode;
  songStart: number;
  metronome: boolean;
  /** Record armed: notes played live are written into the pattern while it plays. */
  recording: boolean;
  /** What record captures: notes played live, or audio from an input into the playlist. */
  recordMode: 'notes' | 'audio';
  /** Song mode loops this playlist region (ticks) instead of the whole song. */
  songLoop: { start: number; end: number } | null;
  windows: Record<WindowId, WindowState>;
  pluginWindows: Array<PluginWindowRef & { x: number; y: number; z: number }>;
  topZ: number;
  pianoRoll: {
    snap: number;
    zoom: number;
    /** Scale highlighting: root pitch class 0..11 and index into SCALES (-1: off). */
    scaleRoot: number;
    scale: number;
    /** Chord stamp: index into CHORDS (-1: single notes). */
    stamp: number;
  };
  playlist: { snap: number; zoom: number };
}

export const DEFAULT_WINDOWS: Record<WindowId, WindowState> = {
  channelRack: { open: true, x: 8, y: 8, w: 640, h: 330, z: 2 },
  playlist: { open: true, x: 656, y: 8, w: 640, h: 430, z: 1 },
  mixer: { open: true, x: 8, y: 446, w: 1288, h: 360, z: 3 },
  pianoRoll: { open: false, x: 90, y: 60, w: 1020, h: 520, z: 4 },
};

/** Window layout that fills a workspace of the given size: rack and playlist on top, mixer below. */
export function layoutFor(width: number, height: number): Record<WindowId, WindowState> {
  const gap = 8;
  const topH = Math.round(Math.min(360, Math.max(240, height * 0.4)));
  const rackW = Math.round(Math.min(680, Math.max(420, width * 0.48)));
  const playlistX = gap * 2 + rackW;
  const mixerY = topH + gap * 2 + 40;
  return {
    channelRack: { open: true, x: gap, y: gap, w: rackW, h: topH, z: 2 },
    playlist: { open: true, x: playlistX, y: gap, w: Math.max(300, width - playlistX - gap), h: topH + 40, z: 1 },
    mixer: { open: true, x: gap, y: mixerY, w: Math.max(400, width - gap * 2), h: Math.max(250, height - mixerY - gap), z: 3 },
    pianoRoll: {
      open: false,
      x: 60,
      y: 40,
      w: Math.max(500, Math.min(1300, width - 120)),
      h: Math.max(320, Math.min(620, height - 80)),
      z: 4,
    },
  };
}

const HISTORY_LIMIT = 200;

export interface AppState {
  project: Project;
  past: Project[];
  future: Project[];
  ui: UIState;
  /** Project snapshot at the start of a drag/knob gesture (undone as one step). */
  gestureBase: Project | null;
  /**
   * The file the project belongs to and the project as last saved/opened;
   * the project has unsaved changes when it is not that same object.
   */
  doc: { path: string | null; saved: Project | null };

  undo(): void;
  redo(): void;
  beginGesture(): void;
  endGesture(): void;

  loadProject(project: Project, path?: string | null, saved?: boolean): void;
  markSaved(path: string | null): void;
  newProject(): void;
  loadDemo(): void;
  setProjectName(name: string): void;
  setBpm(bpm: number, gesture?: boolean): void;
  /** Beats per bar and beat unit (4/4 clears it). Positions in ticks stay where they are. */
  setTimeSignature(beats: number, beatUnit: number): void;

  addChannel(instrumentId: string, preset?: string): string;
  removeChannel(id: string): void;
  cloneChannel(id: string): void;
  moveChannel(id: string, direction: -1 | 1): void;
  updateChannel(id: string, patch: Partial<Pick<Channel, 'name' | 'color' | 'volume' | 'pan' | 'mute' | 'mixerTrack' | 'rootKey'>>, history?: boolean): void;
  soloChannel(id: string): void;
  setChannelParam(id: string, param: string, value: number): void;
  applyChannelPreset(id: string, presetIndex: number): void;
  /** Puts a new sample asset on the channel; returns the asset id. */
  setChannelSample(id: string, name: string, data: string): string;
  /** Drum Pads: puts a sample on a pad (or clears it with null data). */
  setPadSample(id: string, pad: number, name: string, data: string | null, history?: boolean): void;
  /**
   * Sampler time-stretch (null turns it off). The channel's audio clips are
   * resized so they keep covering the same part of the sample.
   */
  setChannelStretch(id: string, stretch: StretchSettings | null, history?: boolean): void;

  addPattern(): void;
  clonePattern(id: string): void;
  removePattern(id: string): void;
  updatePattern(id: string, patch: { name?: string; color?: string; lengthBars?: number }): void;

  toggleStep(patternId: string, channelId: string, step: number): void;
  setStepVelocity(patternId: string, channelId: string, step: number, velocity: number): void;
  addNotes(patternId: string, channelId: string, notes: Note[], history?: boolean): void;
  updateNotes(patternId: string, channelId: string, patches: Record<string, Partial<Omit<Note, 'id'>>>, history?: boolean): void;
  removeNotes(patternId: string, channelId: string, ids: string[], history?: boolean): void;
  /** Replaces some notes by others in one undo step (piano roll tools). */
  replaceNotes(patternId: string, channelId: string, removeIds: string[], add: Note[]): void;
  clearNotes(patternId: string, channelId: string): void;

  addClip(patternId: string, track: number, start: number, length?: number): string;
  addAudioClip(channelId: string, track: number, start: number, length: number): string;
  addAutomationClip(target: AutomationTarget): string | null;
  updateClip(id: string, patch: ClipPatch, history?: boolean): void;
  setAutomationPoints(id: string, points: AutomationPoint[]): void;
  /** Copies a clip right after itself on the same track; returns the copy's id. */
  duplicateClip(id: string): string | null;
  /** Gives a pattern clip its own copy of the pattern, so editing it changes only this clip. */
  makeClipUnique(id: string): void;
  removeClip(id: string, history?: boolean): void;
  updateTrack(index: number, patch: { name?: string; mute?: boolean }): void;
  /** Adds a playlist track at the bottom; returns its index. */
  addPlaylistTrack(name?: string): number;
  addMarker(tick: number, name?: string): string;
  updateMarker(id: string, patch: { tick?: number; name?: string }, history?: boolean): void;
  removeMarker(id: string): void;

  updateMixerTrack(index: number, patch: Partial<Pick<MixerTrack, 'name' | 'volume' | 'pan' | 'mute' | 'solo'>>, history?: boolean): void;
  addEffect(track: number, pluginId: string): string | null;
  replaceEffect(track: number, slotId: string, pluginId: string): void;
  removeEffect(track: number, slotId: string): void;
  moveEffect(track: number, slotId: string, direction: -1 | 1): void;
  toggleEffect(track: number, slotId: string): void;
  setEffectParam(track: number, slotId: string, param: string, value: number): void;
  applyEffectPreset(track: number, slotId: string, presetIndex: number): void;
  setSend(from: number, to: number, level: number | null, history?: boolean): void;
  setToMaster(index: number, on: boolean): void;
  setSwing(value: number, gesture?: boolean): void;

  selectPattern(id: string): void;
  selectChannel(id: string | null): void;
  selectMixerTrack(index: number): void;
  setMode(mode: PlayMode): void;
  setSongStart(tick: number): void;
  setSongLoop(range: { start: number; end: number } | null): void;
  toggleMetronome(): void;
  toggleRecording(): void;
  setRecordMode(mode: 'notes' | 'audio'): void;
  toggleWindow(id: WindowId, open?: boolean): void;
  focusWindow(id: WindowId): void;
  setWindowRect(id: WindowId, rect: Partial<Pick<WindowState, 'x' | 'y' | 'w' | 'h'>>): void;
  resetLayout(width: number, height: number): void;
  openPluginWindow(ref: PluginWindowRef): void;
  closePluginWindow(key: string): void;
  focusPluginWindow(key: string): void;
  movePluginWindow(key: string, x: number, y: number): void;
  setPianoRollView(patch: Partial<UIState['pianoRoll']>): void;
  setPlaylistView(patch: Partial<UIState['playlist']>): void;
}

function initialUI(project: Project): UIState {
  return {
    selectedPatternId: project.patterns[0].id,
    selectedChannelId: project.channels[0]?.id ?? null,
    selectedMixerTrack: 0,
    mode: 'pattern',
    songStart: 0,
    metronome: false,
    recording: false,
    recordMode: 'notes',
    songLoop: null,
    windows: structuredClone(DEFAULT_WINDOWS),
    pluginWindows: [],
    topZ: 10,
    pianoRoll: { snap: TICKS_PER_STEP, zoom: 1, scaleRoot: 0, scale: -1, stamp: -1 },
    playlist: { snap: SNAP_BAR, zoom: 1 },
  };
}

/** Keeps UI references valid after the project changes under it (undo, load, deletes). */
function reconcileUI(ui: UIState, project: Project): UIState {
  const patternOk = project.patterns.some((p) => p.id === ui.selectedPatternId);
  const channelOk = ui.selectedChannelId === null || project.channels.some((c) => c.id === ui.selectedChannelId);
  const pluginWindows = ui.pluginWindows.filter((w) =>
    w.kind === 'effect'
      ? project.mixer[w.track]?.effects.some((e) => e.id === w.slotId)
      : project.channels.some((c) => c.id === w.channelId),
  );
  if (patternOk && channelOk && pluginWindows.length === ui.pluginWindows.length) return ui;
  return {
    ...ui,
    selectedPatternId: patternOk ? ui.selectedPatternId : project.patterns[0].id,
    selectedChannelId: channelOk ? ui.selectedChannelId : (project.channels[0]?.id ?? null),
    pluginWindows,
  };
}

export const useStore = create<AppState>()((set, get) => {
  /** Applies a project change, optionally recording it as one undo step. */
  const mutate = (recipe: (draft: Draft<Project>) => void, history = true) => {
    const state = get();
    const next = produce(state.project, recipe);
    if (next === state.project) return;
    const recordHistory = history && !state.gestureBase;
    set({
      project: next,
      ui: reconcileUI(state.ui, next),
      ...(recordHistory ? { past: [...state.past, state.project].slice(-HISTORY_LIMIT), future: [] } : {}),
    });
  };
  const ui = (recipe: (draft: Draft<UIState>) => void) => set((s) => ({ ui: produce(s.ui, recipe) }));
  const channelOf = (draft: Draft<Project>, id: string) => draft.channels.find((c) => c.id === id);
  const slotOf = (draft: Draft<Project>, track: number, slotId: string) =>
    draft.mixer[track]?.effects.find((e) => e.id === slotId) as Draft<EffectSlot> | undefined;
  const notesOf = (draft: Draft<Project>, patternId: string, channelId: string) => {
    const pattern = draft.patterns.find((p) => p.id === patternId);
    if (!pattern) return undefined;
    return (pattern.notes[channelId] ??= []);
  };

  const demo = createDemoProject();
  return {
    project: demo,
    past: [],
    future: [],
    ui: initialUI(demo),
    gestureBase: null,
    doc: { path: null, saved: demo },

    undo() {
      const { past, project, future, ui: current } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future], ui: reconcileUI(current, prev), gestureBase: null });
    },
    redo() {
      const { past, project, future, ui: current } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({ project: next, past: [...past, project], future: future.slice(1), ui: reconcileUI(current, next), gestureBase: null });
    },
    beginGesture() {
      if (!get().gestureBase) set({ gestureBase: get().project });
    },
    endGesture() {
      const { gestureBase, project, past } = get();
      if (!gestureBase) return;
      if (gestureBase === project) set({ gestureBase: null });
      else set({ gestureBase: null, past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [] });
    },

    loadProject(project, path = null, saved = true) {
      set((s) => ({
        project,
        past: [],
        future: [],
        gestureBase: null,
        doc: { path, saved: saved ? project : null },
        ui: { ...initialUI(project), windows: s.ui.windows, pianoRoll: s.ui.pianoRoll, playlist: s.ui.playlist },
      }));
    },
    markSaved(path) {
      set((s) => ({ doc: { path, saved: s.project } }));
    },
    newProject() {
      get().loadProject(createEmptyProject());
    },
    loadDemo() {
      get().loadProject(createDemoProject());
    },
    setProjectName(name) {
      mutate((d) => void (d.name = name.trim() || 'Sem título'));
    },
    setBpm(bpm, gesture = false) {
      const value = Math.round(Math.min(400, Math.max(20, bpm)) * 100) / 100;
      mutate((d) => void (d.bpm = value), !gesture);
    },

    setTimeSignature(beats, beatUnit) {
      const b = Math.round(Math.min(MAX_BEATS, Math.max(1, beats)));
      if (!BEAT_UNITS.includes(beatUnit)) return;
      mutate((d) => {
        if (b === 4 && beatUnit === 4) delete d.timeSig;
        else d.timeSig = { beats: b, beatUnit };
      });
    },

    addChannel(instrumentId, preset) {
      const plugin = getInstrument(instrumentId);
      const count = get().project.channels.length;
      const channel = createChannel(instrumentId, preset ?? plugin?.name ?? 'Canal', {
        preset,
        color: colorAt(count),
        ...(plugin?.defaultRootKey !== undefined ? { rootKey: plugin.defaultRootKey } : {}),
      });
      mutate((d) => {
        // Route new channels to the first insert no other channel uses.
        const used = new Set(d.channels.map((c) => c.mixerTrack));
        const free = d.mixer.findIndex((_, i) => i > 0 && !used.has(i));
        channel.mixerTrack = free > 0 ? free : 0;
        if (free > 0 && /^Insert \d+$/.test(d.mixer[free].name)) d.mixer[free].name = channel.name;
        d.channels.push(channel);
      });
      ui((u) => void (u.selectedChannelId = channel.id));
      return channel.id;
    },
    removeChannel(id) {
      mutate((d) => {
        d.channels = d.channels.filter((c) => c.id !== id);
        for (const p of d.patterns) delete p.notes[id];
        pruneClips(d);
        pruneSamples(d);
      });
    },
    cloneChannel(id) {
      const source = get().project.channels.find((c) => c.id === id);
      if (!source) return;
      const copy: Channel = { ...structuredClone(source), id: uid('ch'), name: `${source.name} (2)`, solo: false };
      mutate((d) => {
        const index = d.channels.findIndex((c) => c.id === id);
        d.channels.splice(index + 1, 0, copy);
      });
      ui((u) => void (u.selectedChannelId = copy.id));
    },
    moveChannel(id, direction) {
      mutate((d) => {
        const i = d.channels.findIndex((c) => c.id === id);
        const j = i + direction;
        if (i < 0 || j < 0 || j >= d.channels.length) return;
        [d.channels[i], d.channels[j]] = [d.channels[j], d.channels[i]];
      });
    },
    updateChannel(id, patch, history = true) {
      mutate((d) => {
        const c = channelOf(d, id);
        if (!c) return;
        if (patch.name !== undefined) c.name = patch.name.trim() || c.name;
        if (patch.color !== undefined) c.color = patch.color;
        if (patch.volume !== undefined) c.volume = Math.min(1.25, Math.max(0, patch.volume));
        if (patch.pan !== undefined) c.pan = Math.min(1, Math.max(-1, patch.pan));
        if (patch.mute !== undefined) c.mute = patch.mute;
        if (patch.mixerTrack !== undefined) c.mixerTrack = Math.min(d.mixer.length - 1, Math.max(0, Math.round(patch.mixerTrack)));
        if (patch.rootKey !== undefined) c.rootKey = Math.min(127, Math.max(0, Math.round(patch.rootKey)));
      }, history);
    },
    soloChannel(id) {
      mutate((d) => {
        const target = channelOf(d, id);
        if (!target) return;
        // Solo toggles: soloing an already-solo channel clears every solo.
        const enable = !target.solo;
        for (const c of d.channels) c.solo = enable && c.id === id;
      });
    },
    setChannelParam(id, param, value) {
      mutate((d) => {
        const c = channelOf(d, id);
        const spec = c && getInstrument(c.instrument)?.params.find((p) => p.id === param);
        if (c && spec) c.params[param] = clampParam(spec, value);
      }, false);
    },
    applyChannelPreset(id, presetIndex) {
      mutate((d) => {
        const c = channelOf(d, id);
        const plugin = c && getInstrument(c.instrument);
        const preset = plugin?.presets[presetIndex];
        if (c && plugin && preset) c.params = normalizeParams(plugin.params, preset.params);
      });
    },
    setChannelSample(id, name, data) {
      const sampleId = uid('smp');
      mutate((d) => {
        const c = channelOf(d, id);
        if (!c) return;
        d.samples[sampleId] = { id: sampleId, name, data };
        c.sampleId = sampleId;
        pruneSamples(d);
        if (/^(Sampler|Slicer)( \(\d+\))?$/.test(c.name)) {
          const label = name.replace(/\.[^.]+$/, '').slice(0, 40) || c.name;
          // The insert was named after the channel when it was added; keep them in step.
          const insert = d.mixer[c.mixerTrack];
          if (c.mixerTrack > 0 && insert?.name === c.name) insert.name = label;
          c.name = label;
        }
      });
      return sampleId;
    },

    setPadSample(id, pad, name, data, history = true) {
      const sampleId = uid('smp');
      mutate((d) => {
        const c = channelOf(d, id);
        if (!c || pad < 0 || pad > 15) return;
        const pads = c.pads ?? Array.from({ length: 16 }, () => null);
        if (data) d.samples[sampleId] = { id: sampleId, name, data };
        pads[pad] = data ? sampleId : null;
        c.pads = pads;
        pruneSamples(d);
      }, history);
    },

    setChannelStretch(id, stretch, history = true) {
      mutate((d) => {
        const c = channelOf(d, id);
        if (!c) return;
        const before = sourceSpeed(c.stretch, d.bpm);
        if (stretch) {
          c.stretch = {
            mode: stretch.mode,
            pitch: Math.min(STRETCH_PITCH_RANGE, Math.max(-STRETCH_PITCH_RANGE, stretch.pitch)),
            bpm: stretch.bpm > 0 ? Math.min(999, Math.max(10, stretch.bpm)) : 0,
          };
        } else delete c.stretch;
        const after = sourceSpeed(c.stretch, d.bpm);
        if (before === after) return;
        for (const clip of d.playlist.clips) {
          if (clip.kind === 'audio' && clip.channelId === id) clip.length = Math.max(1, Math.round((clip.length * before) / after));
        }
      }, history);
    },

    addPattern() {
      const count = get().project.patterns.length;
      const pattern = createPattern(`Pattern ${count + 1}`, colorAt(count));
      mutate((d) => void d.patterns.push(pattern));
      ui((u) => void (u.selectedPatternId = pattern.id));
    },
    clonePattern(id) {
      const source = findPattern(get().project, id);
      if (!source) return;
      const copy = { ...structuredClone(source), id: uid('pt'), name: `${source.name} (2)` };
      for (const notes of Object.values(copy.notes)) for (const n of notes) n.id = uid('n');
      mutate((d) => {
        const i = d.patterns.findIndex((p) => p.id === id);
        d.patterns.splice(i + 1, 0, copy);
      });
      ui((u) => void (u.selectedPatternId = copy.id));
    },
    removePattern(id) {
      if (get().project.patterns.length <= 1) return;
      mutate((d) => {
        d.patterns = d.patterns.filter((p) => p.id !== id);
        d.playlist.clips = d.playlist.clips.filter((c) => c.kind !== 'pattern' || c.patternId !== id);
      });
    },
    updatePattern(id, patch) {
      mutate((d) => {
        const p = d.patterns.find((x) => x.id === id);
        if (!p) return;
        if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
        if (patch.color !== undefined) p.color = patch.color;
        if (patch.lengthBars !== undefined) p.lengthBars = Math.min(64, Math.max(1, Math.round(patch.lengthBars)));
      });
    },

    toggleStep(patternId, channelId, step) {
      const channel = get().project.channels.find((c) => c.id === channelId);
      if (!channel) return;
      mutate((d) => {
        const notes = notesOf(d, patternId, channelId);
        if (!notes) return;
        const start = step * TICKS_PER_STEP;
        const i = notes.findIndex((n) => n.start === start);
        if (i >= 0) notes.splice(i, 1);
        else {
          notes.push(createNote(channel.rootKey, start, TICKS_PER_STEP, 0.78));
          notes.sort((a, b) => a.start - b.start);
        }
      });
    },
    setStepVelocity(patternId, channelId, step, velocity) {
      mutate((d) => {
        const n = notesOf(d, patternId, channelId)?.find((x) => x.start === step * TICKS_PER_STEP);
        if (n) n.velocity = Math.min(1, Math.max(0, velocity));
      }, false);
    },
    addNotes(patternId, channelId, notes, history = true) {
      mutate((d) => {
        const list = notesOf(d, patternId, channelId);
        if (!list) return;
        list.push(...notes);
        list.sort((a, b) => a.start - b.start);
      }, history);
    },
    updateNotes(patternId, channelId, patches, history = false) {
      mutate((d) => {
        const list = notesOf(d, patternId, channelId);
        if (!list) return;
        for (const n of list) {
          const patch = patches[n.id];
          if (!patch) continue;
          if (patch.key !== undefined) n.key = Math.min(127, Math.max(0, Math.round(patch.key)));
          if (patch.start !== undefined) n.start = Math.max(0, patch.start);
          if (patch.length !== undefined) n.length = Math.max(1, patch.length);
          if (patch.velocity !== undefined) n.velocity = Math.min(1, Math.max(0, patch.velocity));
          if (patch.pan !== undefined) {
            const pan = Math.round(Math.min(1, Math.max(-1, patch.pan)) * 100) / 100;
            if (pan) n.pan = pan;
            else delete n.pan;
          }
          if (patch.fine !== undefined) {
            const fine = Math.round(Math.min(100, Math.max(-100, patch.fine)));
            if (fine) n.fine = fine;
            else delete n.fine;
          }
        }
        list.sort((a, b) => a.start - b.start);
      }, history);
    },
    removeNotes(patternId, channelId, ids, history = true) {
      const remove = new Set(ids);
      mutate((d) => {
        const pattern = d.patterns.find((p) => p.id === patternId);
        const list = pattern?.notes[channelId];
        if (pattern && list) pattern.notes[channelId] = list.filter((n) => !remove.has(n.id));
      }, history);
    },
    replaceNotes(patternId, channelId, removeIds, add) {
      const remove = new Set(removeIds);
      mutate((d) => {
        const pattern = d.patterns.find((p) => p.id === patternId);
        if (!pattern) return;
        const kept = (pattern.notes[channelId] ?? []).filter((n) => !remove.has(n.id));
        pattern.notes[channelId] = [...kept, ...add.filter((n) => n.key >= 0 && n.key <= 127 && n.length > 0)].sort((a, b) => a.start - b.start);
      });
    },
    clearNotes(patternId, channelId) {
      mutate((d) => {
        const pattern = d.patterns.find((p) => p.id === patternId);
        if (pattern) delete pattern.notes[channelId];
      });
    },

    addClip(patternId, track, start, length) {
      const pattern = findPattern(get().project, patternId);
      const id = uid('cl');
      if (!pattern) return id;
      const bar = barTicks(get().project.timeSig);
      const clip: PlaylistClip = { id, kind: 'pattern', patternId, track, start: Math.max(0, start), length: length ?? patternLength(pattern, bar) };
      mutate((d) => void d.playlist.clips.push(clip));
      return id;
    },
    addAudioClip(channelId, track, start, length) {
      const id = uid('cl');
      mutate((d) => {
        if (!d.channels.some((c) => c.id === channelId)) return;
        d.playlist.clips.push({ id, kind: 'audio', channelId, track, start: Math.max(0, start), length: Math.max(TICKS_PER_STEP, length), offset: 0 });
      });
      return id;
    },
    addAutomationClip(target) {
      const project = get().project;
      const info = describeTarget(project, target);
      if (!info) return null;
      const { clips, tracks } = project.playlist;
      // Like other DAWs: a fresh lane below the song, spanning the whole song.
      const used = new Set(clips.map((c) => c.track));
      let track = tracks.findIndex((_, i) => !used.has(i));
      const id = uid('cl');
      const length = Math.max(songLength(project), barTicks(project.timeSig) * 4);
      const value = info.toNorm(info.current);
      mutate((d) => {
        if (track < 0) {
          d.playlist.tracks.push({ id: uid('tr'), name: `Faixa ${d.playlist.tracks.length + 1}`, mute: false });
          track = d.playlist.tracks.length - 1;
        }
        d.playlist.tracks[track].name = info.label;
        d.playlist.clips.push({
          id,
          kind: 'automation',
          target,
          track,
          start: 0,
          length,
          points: [
            { t: 0, v: value },
            { t: length, v: value },
          ],
        });
      });
      return id;
    },
    updateClip(id, patch, history = false) {
      mutate((d) => {
        const c = d.playlist.clips.find((x) => x.id === id);
        if (!c) return;
        if (patch.track !== undefined) c.track = Math.min(d.playlist.tracks.length - 1, Math.max(0, patch.track));
        if (patch.start !== undefined) c.start = Math.max(0, patch.start);
        if (patch.length !== undefined) c.length = Math.max(TICKS_PER_STEP, patch.length);
        if (patch.offset !== undefined && c.kind === 'audio') c.offset = Math.max(0, patch.offset);
        // Points past a shortened automation clip's end are clamped onto it.
        if (c.kind === 'automation') for (const p of c.points) p.t = Math.min(p.t, c.length);
      }, history);
    },
    duplicateClip(id) {
      const clip = get().project.playlist.clips.find((c) => c.id === id);
      if (!clip) return null;
      const copy: PlaylistClip = { ...structuredClone(clip), id: uid('cl'), start: clip.start + clip.length };
      mutate((d) => void d.playlist.clips.push(copy));
      return copy.id;
    },
    makeClipUnique(id) {
      const project = get().project;
      const clip = project.playlist.clips.find((c) => c.id === id);
      const source = clip?.kind === 'pattern' ? findPattern(project, clip.patternId) : undefined;
      if (!clip || !source) return;
      const copy = { ...structuredClone(source), id: uid('pt'), name: `${source.name} (${project.patterns.length + 1})` };
      for (const notes of Object.values(copy.notes)) for (const n of notes) n.id = uid('n');
      mutate((d) => {
        d.patterns.splice(d.patterns.findIndex((p) => p.id === source.id) + 1, 0, copy);
        const c = d.playlist.clips.find((x) => x.id === id);
        if (c?.kind === 'pattern') c.patternId = copy.id;
      });
      ui((u) => void (u.selectedPatternId = copy.id));
    },
    setAutomationPoints(id, points) {
      mutate((d) => {
        const c = d.playlist.clips.find((x) => x.id === id);
        if (!c || c.kind !== 'automation' || points.length === 0) return;
        c.points = points
          .map((p) => ({ t: Math.min(c.length, Math.max(0, p.t)), v: Math.min(1, Math.max(0, p.v)) }))
          .sort((a, b) => a.t - b.t);
      }, false);
    },
    removeClip(id, history = true) {
      mutate((d) => void (d.playlist.clips = d.playlist.clips.filter((c) => c.id !== id)), history);
    },
    addMarker(tick, name) {
      const id = uid('mk');
      mutate((d) => {
        const markers = (d.playlist.markers ??= []);
        markers.push({ id, tick: Math.max(0, Math.round(tick)), name: (name ?? `Marcador ${markers.length + 1}`).slice(0, 60) });
        markers.sort((a, b) => a.tick - b.tick);
      });
      return id;
    },
    updateMarker(id, patch, history = true) {
      mutate((d) => {
        const m = d.playlist.markers?.find((x) => x.id === id);
        if (!m) return;
        if (patch.name !== undefined) m.name = patch.name.trim().slice(0, 60) || m.name;
        if (patch.tick !== undefined) m.tick = Math.max(0, Math.round(patch.tick));
        d.playlist.markers!.sort((a, b) => a.tick - b.tick);
      }, history);
    },
    removeMarker(id) {
      mutate((d) => {
        if (!d.playlist.markers) return;
        d.playlist.markers = d.playlist.markers.filter((m) => m.id !== id);
        if (d.playlist.markers.length === 0) delete d.playlist.markers;
      });
    },
    addPlaylistTrack(name) {
      let index = 0;
      mutate((d) => {
        index = d.playlist.tracks.length;
        d.playlist.tracks.push({ id: uid('tr'), name: (name ?? `Faixa ${index + 1}`).slice(0, 60), mute: false });
      });
      return index;
    },
    updateTrack(index, patch) {
      mutate((d) => {
        const t = d.playlist.tracks[index];
        if (!t) return;
        if (patch.name !== undefined) t.name = patch.name.trim() || t.name;
        if (patch.mute !== undefined) t.mute = patch.mute;
      });
    },

    updateMixerTrack(index, patch, history = true) {
      mutate((d) => {
        const t = d.mixer[index];
        if (!t) return;
        if (patch.name !== undefined) t.name = patch.name.trim() || t.name;
        if (patch.volume !== undefined) t.volume = Math.min(2, Math.max(0, patch.volume));
        if (patch.pan !== undefined) t.pan = Math.min(1, Math.max(-1, patch.pan));
        if (patch.mute !== undefined) t.mute = patch.mute;
        if (patch.solo !== undefined && index > 0) t.solo = patch.solo;
      }, history);
    },
    addEffect(track, pluginId) {
      const t = get().project.mixer[track];
      if (!t || t.effects.length >= MAX_EFFECT_SLOTS || !getEffect(pluginId)) return null;
      const slot = createEffectSlot(pluginId);
      mutate((d) => void d.mixer[track].effects.push(slot));
      return slot.id;
    },
    replaceEffect(track, slotId, pluginId) {
      const plugin = getEffect(pluginId);
      if (!plugin) return;
      mutate((d) => {
        const effects = d.mixer[track]?.effects;
        const i = effects?.findIndex((e) => e.id === slotId) ?? -1;
        // A new id so the engine builds a fresh instance and open editors close.
        if (effects && i >= 0) effects[i] = createEffectSlot(pluginId);
        pruneClips(d);
      });
    },
    removeEffect(track, slotId) {
      mutate((d) => {
        const t = d.mixer[track];
        if (t) t.effects = t.effects.filter((e) => e.id !== slotId);
        pruneClips(d);
      });
    },
    moveEffect(track, slotId, direction) {
      mutate((d) => {
        const effects = d.mixer[track]?.effects;
        if (!effects) return;
        const i = effects.findIndex((e) => e.id === slotId);
        const j = i + direction;
        if (i < 0 || j < 0 || j >= effects.length) return;
        [effects[i], effects[j]] = [effects[j], effects[i]];
      });
    },
    toggleEffect(track, slotId) {
      mutate((d) => {
        const s = slotOf(d, track, slotId);
        if (s) s.enabled = !s.enabled;
      });
    },
    setEffectParam(track, slotId, param, value) {
      mutate((d) => {
        const s = slotOf(d, track, slotId);
        const spec = s && getEffect(s.plugin)?.params.find((p) => p.id === param);
        if (s && spec) s.params[param] = clampParam(spec, value);
      }, false);
    },
    applyEffectPreset(track, slotId, presetIndex) {
      mutate((d) => {
        const s = slotOf(d, track, slotId);
        const plugin = s && getEffect(s.plugin);
        const preset = plugin?.presets[presetIndex];
        if (s && plugin && preset) s.params = normalizeParams(plugin.params, preset.params);
      });
    },

    setSend(from, to, level, history = true) {
      const { mixer } = get().project;
      const exists = mixer[from]?.sends.some((x) => x.to === to);
      if (level !== null && !exists && !canRoute(mixer, from, to)) return;
      mutate((d) => {
        const t = d.mixer[from];
        if (!t) return;
        if (level === null) t.sends = t.sends.filter((x) => x.to !== to);
        else {
          const send = t.sends.find((x) => x.to === to);
          if (send) send.level = Math.min(2, Math.max(0, level));
          else t.sends.push({ to, level: Math.min(2, Math.max(0, level)) });
        }
      }, history);
    },
    setToMaster(index, on) {
      if (index <= 0) return;
      mutate((d) => {
        const t = d.mixer[index];
        if (t) t.toMaster = on;
      });
    },
    setSwing(value, gesture = false) {
      mutate((d) => void (d.swing = Math.min(1, Math.max(0, value))), !gesture);
    },

    selectPattern(id) {
      ui((u) => void (u.selectedPatternId = id));
    },
    selectChannel(id) {
      ui((u) => void (u.selectedChannelId = id));
    },
    selectMixerTrack(index) {
      ui((u) => void (u.selectedMixerTrack = index));
    },
    setMode(mode) {
      ui((u) => void (u.mode = mode));
    },
    setSongStart(tick) {
      ui((u) => void (u.songStart = Math.max(0, tick)));
    },
    setSongLoop(range) {
      ui((u) => {
        if (!range) u.songLoop = null;
        else {
          const start = Math.max(0, Math.round(Math.min(range.start, range.end)));
          const end = Math.round(Math.max(range.start, range.end));
          u.songLoop = end > start ? { start, end } : null;
        }
      });
    },
    toggleRecording() {
      ui((u) => void (u.recording = !u.recording));
    },
    setRecordMode(mode) {
      ui((u) => void (u.recordMode = mode));
    },
    toggleMetronome() {
      ui((u) => void (u.metronome = !u.metronome));
    },
    toggleWindow(id, open) {
      ui((u) => {
        const w = u.windows[id];
        w.open = open ?? !w.open;
        if (w.open) w.z = ++u.topZ;
      });
    },
    focusWindow(id) {
      if (get().ui.windows[id].z === get().ui.topZ) return;
      ui((u) => void (u.windows[id].z = ++u.topZ));
    },
    setWindowRect(id, rect) {
      ui((u) => void Object.assign(u.windows[id], rect));
    },
    resetLayout(width, height) {
      ui((u) => {
        const layout = layoutFor(width, height);
        for (const id of Object.keys(layout) as WindowId[]) {
          // Keep which windows are open; only reposition them.
          u.windows[id] = { ...layout[id], open: u.windows[id].open, z: u.windows[id].z };
        }
      });
    },
    openPluginWindow(ref) {
      const key = pluginWindowKey(ref);
      ui((u) => {
        const existing = u.pluginWindows.find((w) => pluginWindowKey(w) === key);
        if (existing) {
          existing.z = ++u.topZ;
          return;
        }
        const offset = (u.pluginWindows.length % 6) * 28;
        u.pluginWindows.push({ ...ref, x: 220 + offset, y: 70 + offset, z: ++u.topZ });
      });
    },
    closePluginWindow(key) {
      ui((u) => void (u.pluginWindows = u.pluginWindows.filter((w) => pluginWindowKey(w) !== key)));
    },
    focusPluginWindow(key) {
      ui((u) => {
        const w = u.pluginWindows.find((x) => pluginWindowKey(x) === key);
        if (w && w.z !== u.topZ) w.z = ++u.topZ;
      });
    },
    movePluginWindow(key, x, y) {
      ui((u) => {
        const w = u.pluginWindows.find((p) => pluginWindowKey(p) === key);
        if (w) Object.assign(w, { x, y });
      });
    },
    setPianoRollView(patch) {
      ui((u) => void Object.assign(u.pianoRoll, patch));
    },
    setPlaylistView(patch) {
      ui((u) => void Object.assign(u.playlist, patch));
    },
  };
});

/** Shorthand for actions, which never change identity. */
export const actions = () => useStore.getState();

export function selectedPattern(state: AppState) {
  return findPattern(state.project, state.ui.selectedPatternId) ?? state.project.patterns[0];
}

export function selectedChannel(state: AppState) {
  return state.project.channels.find((c) => c.id === state.ui.selectedChannelId);
}

export function isDirty(state: AppState): boolean {
  return state.project !== state.doc.saved;
}
