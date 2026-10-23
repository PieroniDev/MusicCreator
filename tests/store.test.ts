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
