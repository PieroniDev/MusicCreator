import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/state/store';
import { MAX_EFFECT_SLOTS } from '../src/model/defaults';
import { TICKS_PER_STEP } from '../src/model/time';

const s = () => useStore.getState();

beforeEach(() => {
  s().newProject();
});

describe('store', () => {
  it('toggles steps on and off at the channel root key', () => {
    const pattern = s().project.patterns[0];
    const channel = s().project.channels[0];
    s().toggleStep(pattern.id, channel.id, 3);
    const notes = s().project.patterns[0].notes[channel.id];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ key: channel.rootKey, start: 3 * TICKS_PER_STEP, length: TICKS_PER_STEP });
    s().toggleStep(pattern.id, channel.id, 3);
    expect(s().project.patterns[0].notes[channel.id]).toHaveLength(0);
  });

  it('undoes and redoes discrete edits', () => {
    const pattern = s().project.patterns[0];
    const channel = s().project.channels[0];
    s().toggleStep(pattern.id, channel.id, 0);
    s().toggleStep(pattern.id, channel.id, 4);
    expect(s().project.patterns[0].notes[channel.id]).toHaveLength(2);
    s().undo();
    expect(s().project.patterns[0].notes[channel.id]).toHaveLength(1);
    s().redo();
    expect(s().project.patterns[0].notes[channel.id]).toHaveLength(2);
  });

  it('records a whole gesture as a single undo step', () => {
    const before = s().project;
    s().beginGesture();
    for (let i = 0; i < 10; i++) s().setBpm(100 + i, true);
    s().endGesture();
    expect(s().project.bpm).toBe(109);
    s().undo();
    expect(s().project).toBe(before);
  });

  it('does not record a gesture that changed nothing', () => {
    const depth = s().past.length;
    s().beginGesture();
    s().endGesture();
    expect(s().past.length).toBe(depth);
  });

  it('removes a channel together with its notes and fixes the selection', () => {
    const pattern = s().project.patterns[0];
    const channel = s().project.channels[0];
    s().selectChannel(channel.id);
    s().toggleStep(pattern.id, channel.id, 0);
    s().removeChannel(channel.id);
    expect(s().project.channels.find((c) => c.id === channel.id)).toBeUndefined();
    expect(s().project.patterns[0].notes[channel.id]).toBeUndefined();
    expect(s().ui.selectedChannelId).not.toBe(channel.id);
  });

  it('routes a new channel to a free mixer insert', () => {
    const used = new Set(s().project.channels.map((c) => c.mixerTrack));
    const id = s().addChannel('fm');
    const channel = s().project.channels.find((c) => c.id === id)!;
    expect(channel.mixerTrack).toBeGreaterThan(0);
    expect(used.has(channel.mixerTrack)).toBe(false);
    expect(s().ui.selectedChannelId).toBe(id);
  });

  it('deletes a pattern with its playlist clips but always keeps one pattern', () => {
    s().addPattern();
    const [first, second] = s().project.patterns;
    s().addClip(second.id, 0, 0);
    s().removePattern(second.id);
    expect(s().project.patterns).toHaveLength(1);
    expect(s().project.playlist.clips).toHaveLength(0);
    s().removePattern(first.id);
    expect(s().project.patterns).toHaveLength(1);
  });

  it('limits effect slots per mixer track', () => {
    const track = 3;
    for (let i = 0; i < MAX_EFFECT_SLOTS; i++) expect(s().addEffect(track, 'delay')).not.toBeNull();
    expect(s().addEffect(track, 'delay')).toBeNull();
    expect(s().project.mixer[track].effects).toHaveLength(MAX_EFFECT_SLOTS);
  });

  it('clamps effect params to their range', () => {
    const id = s().addEffect(1, 'reverb')!;
    s().setEffectParam(1, id, 'mix', 5);
    expect(s().project.mixer[1].effects[0].params.mix).toBe(1);
  });

  it('applies instrument presets', () => {
    const id = s().addChannel('trio');
    s().applyChannelPreset(id, 2);
    const channel = s().project.channels.find((c) => c.id === id)!;
    expect(channel.params.cutoff).toBe(900);
  });

  it('solo toggles between one channel and none', () => {
    const [a, b] = s().project.channels;
    s().soloChannel(a.id);
    expect(s().project.channels.map((c) => c.solo)).toEqual(s().project.channels.map((c) => c.id === a.id));
    s().soloChannel(b.id);
    expect(s().project.channels.find((c) => c.solo)?.id).toBe(b.id);
    s().soloChannel(b.id);
    expect(s().project.channels.some((c) => c.solo)).toBe(false);
  });
});

describe('store: clips, routing, swing and saved state', () => {
  it('creates an automation clip on a free lane holding the current value', () => {
    const channel = s().project.channels[0];
    const id = s().addAutomationClip({ kind: 'channel', channelId: channel.id, param: 'volume' })!;
    const clip = s().project.playlist.clips.find((c) => c.id === id)!;
    expect(clip.kind).toBe('automation');
    if (clip.kind !== 'automation') return;
    expect(clip.points[0].v).toBeCloseTo(channel.volume / 1.25);
    expect(s().project.playlist.tracks[clip.track].name).toContain(channel.name);
    expect(s().addAutomationClip({ kind: 'channel', channelId: 'gone', param: 'volume' })).toBeNull();
  });

  it('removes audio clips and automation with the channel they belong to', () => {
    const id = s().addChannel('sampler');
    s().addAudioClip(id, 0, 0, 384);
    s().addAutomationClip({ kind: 'instrument', channelId: id, param: 'cutoff' });
    expect(s().project.playlist.clips).toHaveLength(2);
    s().removeChannel(id);
    expect(s().project.playlist.clips).toHaveLength(0);
  });

  it('removes automation of a deleted effect', () => {
    const slot = s().addEffect(2, 'reverb')!;
    s().addAutomationClip({ kind: 'effect', track: 2, slotId: slot, param: 'mix' });
    s().removeEffect(2, slot);
    expect(s().project.playlist.clips.some((c) => c.kind === 'automation')).toBe(false);
  });

  it('keeps points sorted and inside the clip', () => {
    const id = s().addAutomationClip({ kind: 'mixer', track: 1, param: 'pan' })!;
    s().setAutomationPoints(id, [{ t: 500, v: 2 }, { t: -5, v: 0.5 }, { t: 1e9, v: -1 }]);
    const clip = s().project.playlist.clips.find((c) => c.id === id)!;
    if (clip.kind !== 'automation') throw new Error('expected automation');
    expect(clip.points).toEqual([{ t: 0, v: 0.5 }, { t: 500, v: 1 }, { t: clip.length, v: 0 }]);
    s().updateClip(id, { length: 384 });
    const shorter = s().project.playlist.clips.find((c) => c.id === id)!;
    if (shorter.kind !== 'automation') throw new Error('expected automation');
    expect(Math.max(...shorter.points.map((p) => p.t))).toBe(384);
  });

  it('adds, changes and removes sends but refuses loops', () => {
    s().setSend(1, 2, 1);
    s().setSend(1, 2, 0.5);
    expect(s().project.mixer[1].sends).toEqual([{ to: 2, level: 0.5 }]);
    s().setSend(2, 1, 1);
    expect(s().project.mixer[2].sends).toEqual([]);
    s().setSend(1, 2, null);
    expect(s().project.mixer[1].sends).toEqual([]);
    s().setToMaster(1, false);
    expect(s().project.mixer[1].toMaster).toBe(false);
  });

  it('clamps swing', () => {
    s().setSwing(3);
    expect(s().project.swing).toBe(1);
  });

  it('tracks unsaved changes against the last save', async () => {
    const { isDirty } = await import('../src/state/store');
    expect(isDirty(s())).toBe(false);
    s().setBpm(99);
    expect(isDirty(s())).toBe(true);
    s().markSaved('/tmp/song.mcproj');
    expect(isDirty(s())).toBe(false);
    expect(s().doc.path).toBe('/tmp/song.mcproj');
    s().undo();
    expect(isDirty(s())).toBe(true);
    s().redo();
    expect(isDirty(s())).toBe(false);
    s().loadProject(s().project, null, false);
    expect(isDirty(s())).toBe(true);
  });
});

describe('store: playlist clip tools and drum pads', () => {
  it('duplicates a clip right after itself', () => {
    const pattern = s().project.patterns[0];
    const id = s().addClip(pattern.id, 2, 384);
    const copy = s().duplicateClip(id)!;
    const c = s().project.playlist.clips.find((x) => x.id === copy)!;
    expect(c).toMatchObject({ track: 2, start: 768 });
  });

  it('makes a pattern clip unique with its own copy of the pattern', () => {
    const pattern = s().project.patterns[0];
    const channel = s().project.channels[0];
    s().toggleStep(pattern.id, channel.id, 0);
    const a = s().addClip(pattern.id, 0, 0);
    const b = s().addClip(pattern.id, 0, 384);
    s().makeClipUnique(b);
    const clips = s().project.playlist.clips;
    const clipA = clips.find((x) => x.id === a)!;
    const clipB = clips.find((x) => x.id === b)!;
    if (clipA.kind !== 'pattern' || clipB.kind !== 'pattern') throw new Error('expected pattern clips');
    expect(clipB.patternId).not.toBe(clipA.patternId);
    expect(s().project.patterns).toHaveLength(2);
    expect(s().ui.selectedPatternId).toBe(clipB.patternId);
    const copy = s().project.patterns.find((p) => p.id === clipB.patternId)!;
    expect(copy.notes[channel.id]).toHaveLength(1);
  });

  it('stores pad samples and frees them when replaced or cleared', () => {
    const id = s().addChannel('pads');
    expect(s().project.channels.find((c) => c.id === id)!.rootKey).toBe(36);
    s().setPadSample(id, 3, 'kick.wav', 'AAAA');
    const sampleId = s().project.channels.find((c) => c.id === id)!.pads![3]!;
    expect(s().project.samples[sampleId].name).toBe('kick.wav');
    s().setPadSample(id, 3, '', null);
    expect(s().project.channels.find((c) => c.id === id)!.pads![3]).toBeNull();
    expect(s().project.samples[sampleId]).toBeUndefined();
  });
});

describe('time-stretch settings', () => {
  it('keeps audio clips covering the same audio when the speed changes', () => {
    const a = useStore.getState();
    a.newProject();
    a.setBpm(120);
    const id = a.addChannel('sampler');
    const clip = a.addAudioClip(id, 0, 0, 384);
    // The sample was recorded at 60 BPM: following 120 BPM it plays twice as fast, so the clip halves.
    a.setChannelStretch(id, { mode: 'stretch', pitch: 0, bpm: 60 });
    const find = () => useStore.getState().project.playlist.clips.find((c) => c.id === clip)!;
    expect(find().length).toBe(192);
    expect(useStore.getState().project.channels.find((c) => c.id === id)?.stretch).toEqual({ mode: 'stretch', pitch: 0, bpm: 60 });
    // Pitch alone does not change the length in stretch mode...
    a.setChannelStretch(id, { mode: 'stretch', pitch: 5, bpm: 60 });
    expect(find().length).toBe(192);
    // ...but does in resample mode.
    a.setChannelStretch(id, { mode: 'resample', pitch: 12, bpm: 60 });
    expect(find().length).toBe(96);
    a.setChannelStretch(id, null);
    expect(find().length).toBe(384);
    expect(useStore.getState().project.channels.find((c) => c.id === id)?.stretch).toBeUndefined();
    a.undo();
    expect(find().length).toBe(96);
  });
});

describe('playlist markers and loop region', () => {
  it('adds, sorts, renames, moves and removes markers with undo', () => {
    const a = useStore.getState();
    a.newProject();
    const m1 = a.addMarker(768, 'Refrão');
    const m2 = a.addMarker(0);
    const markers = () => useStore.getState().project.playlist.markers ?? [];
    expect(markers().map((m) => m.name)).toEqual(['Marcador 2', 'Refrão']);
    a.updateMarker(m2, { tick: 1536, name: '  Final ' });
    expect(markers().map((m) => [m.name, m.tick])).toEqual([['Refrão', 768], ['Final', 1536]]);
    a.removeMarker(m1);
    a.removeMarker(m2);
    expect(useStore.getState().project.playlist.markers).toBeUndefined();
    a.undo();
    expect(markers().map((m) => m.name)).toEqual(['Final']);
  });

  it('keeps the loop region ordered and drops empty ones', () => {
    const a = useStore.getState();
    a.setSongLoop({ start: 768, end: 384 });
    expect(useStore.getState().ui.songLoop).toEqual({ start: 384, end: 768 });
    a.setSongLoop({ start: 384, end: 384 });
    expect(useStore.getState().ui.songLoop).toBeNull();
  });
});

describe('note pan and fine pitch', () => {
  it('stores them only when not centred, clamped', () => {
    const a = useStore.getState();
    a.newProject();
    const { project, ui } = useStore.getState();
    const channelId = project.channels[0].id;
    a.toggleStep(ui.selectedPatternId, channelId, 0);
    const note = () => useStore.getState().project.patterns.find((x) => x.id === ui.selectedPatternId)!.notes[channelId][0];
    a.updateNotes(ui.selectedPatternId, channelId, { [note().id]: { pan: -3, fine: 250 } });
    expect([note().pan, note().fine]).toEqual([-1, 100]);
    a.updateNotes(ui.selectedPatternId, channelId, { [note().id]: { pan: 0, fine: 0 } });
    expect('pan' in note() || 'fine' in note()).toBe(false);
  });
});

describe('time signature', () => {
  it('is stored only when not 4/4 and rejects odd beat units', () => {
    const a = useStore.getState();
    a.newProject();
    a.setTimeSignature(7, 8);
    expect(useStore.getState().project.timeSig).toEqual({ beats: 7, beatUnit: 8 });
    a.setTimeSignature(3, 5);
    expect(useStore.getState().project.timeSig).toEqual({ beats: 7, beatUnit: 8 });
    a.setTimeSignature(4, 4);
    expect(useStore.getState().project.timeSig).toBeUndefined();
    a.undo();
    expect(useStore.getState().project.timeSig).toEqual({ beats: 7, beatUnit: 8 });
  });
});
