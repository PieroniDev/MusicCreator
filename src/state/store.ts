import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Channel, EffectSlot, MixerTrack, Note, PlayMode, PlaylistClip, Project } from '../model/types';
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
import { findPattern, patternLength } from '../model/pattern';
import { TICKS_PER_STEP } from '../model/time';
import { getEffect, getInstrument } from '../plugins/registry';
import { clampParam, normalizeParams } from '../plugins/params';

export type WindowId = 'channelRack' | 'playlist' | 'pianoRoll' | 'mixer';

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
  | { kind: 'effect'; track: number; slotId: string };

export function pluginWindowKey(ref: PluginWindowRef): string {
  return ref.kind === 'channel' ? `ch:${ref.channelId}` : `fx:${ref.track}:${ref.slotId}`;
}

export interface UIState {
  selectedPatternId: string;
  selectedChannelId: string | null;
  selectedMixerTrack: number;
  mode: PlayMode;
  songStart: number;
  metronome: boolean;
  windows: Record<WindowId, WindowState>;
  pluginWindows: Array<PluginWindowRef & { x: number; y: number; z: number }>;
  topZ: number;
  pianoRoll: { snap: number; zoom: number };
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

  addChannel(instrumentId: string, preset?: string): string;
  removeChannel(id: string): void;
  cloneChannel(id: string): void;
  moveChannel(id: string, direction: -1 | 1): void;
  updateChannel(id: string, patch: Partial<Pick<Channel, 'name' | 'color' | 'volume' | 'pan' | 'mute' | 'mixerTrack' | 'rootKey'>>, history?: boolean): void;
  soloChannel(id: string): void;
  setChannelParam(id: string, param: string, value: number): void;
  applyChannelPreset(id: string, presetIndex: number): void;
  setChannelSample(id: string, name: string, data: string): void;

  addPattern(): void;
  clonePattern(id: string): void;
  removePattern(id: string): void;
  updatePattern(id: string, patch: { name?: string; color?: string; lengthBars?: number }): void;

  toggleStep(patternId: string, channelId: string, step: number): void;
  setStepVelocity(patternId: string, channelId: string, step: number, velocity: number): void;
  addNotes(patternId: string, channelId: string, notes: Note[], history?: boolean): void;
  updateNotes(patternId: string, channelId: string, patches: Record<string, Partial<Omit<Note, 'id'>>>, history?: boolean): void;
  removeNotes(patternId: string, channelId: string, ids: string[], history?: boolean): void;
  clearNotes(patternId: string, channelId: string): void;

  addClip(patternId: string, track: number, start: number, length?: number): string;
  updateClip(id: string, patch: Partial<Omit<PlaylistClip, 'id'>>, history?: boolean): void;
  removeClip(id: string, history?: boolean): void;
  updateTrack(index: number, patch: { name?: string; mute?: boolean }): void;

  updateMixerTrack(index: number, patch: Partial<Pick<MixerTrack, 'name' | 'volume' | 'pan' | 'mute' | 'solo'>>, history?: boolean): void;
  addEffect(track: number, pluginId: string): string | null;
  replaceEffect(track: number, slotId: string, pluginId: string): void;
  removeEffect(track: number, slotId: string): void;
  moveEffect(track: number, slotId: string, direction: -1 | 1): void;
  toggleEffect(track: number, slotId: string): void;
  setEffectParam(track: number, slotId: string, param: string, value: number): void;
  applyEffectPreset(track: number, slotId: string, presetIndex: number): void;

  selectPattern(id: string): void;
  selectChannel(id: string | null): void;
  selectMixerTrack(index: number): void;
  setMode(mode: PlayMode): void;
  setSongStart(tick: number): void;
  toggleMetronome(): void;
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
    windows: structuredClone(DEFAULT_WINDOWS),
    pluginWindows: [],
    topZ: 10,
    pianoRoll: { snap: TICKS_PER_STEP, zoom: 1 },
    playlist: { snap: 384, zoom: 1 },
  };
}

/** Keeps UI references valid after the project changes under it (undo, load, deletes). */
function reconcileUI(ui: UIState, project: Project): UIState {
  const patternOk = project.patterns.some((p) => p.id === ui.selectedPatternId);
  const channelOk = ui.selectedChannelId === null || project.channels.some((c) => c.id === ui.selectedChannelId);
  const pluginWindows = ui.pluginWindows.filter((w) =>
    w.kind === 'channel'
      ? project.channels.some((c) => c.id === w.channelId)
      : project.mixer[w.track]?.effects.some((e) => e.id === w.slotId),
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

    addChannel(instrumentId, preset) {
      const plugin = getInstrument(instrumentId);
      const count = get().project.channels.length;
      const channel = createChannel(instrumentId, preset ?? plugin?.name ?? 'Canal', {
        preset,
        color: colorAt(count),
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
        const used = new Set(d.channels.map((c) => c.sampleId).filter(Boolean));
        for (const sampleId of Object.keys(d.samples)) if (!used.has(sampleId)) delete d.samples[sampleId];
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
        const old = c.sampleId;
        d.samples[sampleId] = { id: sampleId, name, data };
        c.sampleId = sampleId;
        if (old && !d.channels.some((other) => other.sampleId === old)) delete d.samples[old];
        if (/^Sampler( \(\d+\))?$/.test(c.name)) {
          const label = name.replace(/\.[^.]+$/, '').slice(0, 40) || c.name;
          // The insert was named after the channel when it was added; keep them in step.
          const insert = d.mixer[c.mixerTrack];
          if (c.mixerTrack > 0 && insert?.name === c.name) insert.name = label;
          c.name = label;
        }
      });
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
        d.playlist.clips = d.playlist.clips.filter((c) => c.patternId !== id);
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
      const clip: PlaylistClip = { id, patternId, track, start: Math.max(0, start), length: length ?? patternLength(pattern) };
      mutate((d) => void d.playlist.clips.push(clip));
      return id;
    },
    updateClip(id, patch, history = false) {
      mutate((d) => {
        const c = d.playlist.clips.find((x) => x.id === id);
        if (!c) return;
        if (patch.track !== undefined) c.track = Math.min(d.playlist.tracks.length - 1, Math.max(0, patch.track));
        if (patch.start !== undefined) c.start = Math.max(0, patch.start);
        if (patch.length !== undefined) c.length = Math.max(TICKS_PER_STEP, patch.length);
        if (patch.patternId !== undefined) c.patternId = patch.patternId;
      }, history);
    },
    removeClip(id, history = true) {
      mutate((d) => void (d.playlist.clips = d.playlist.clips.filter((c) => c.id !== id)), history);
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
      });
    },
    removeEffect(track, slotId) {
      mutate((d) => {
        const t = d.mixer[track];
        if (t) t.effects = t.effects.filter((e) => e.id !== slotId);
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
