import { describe, expect, it } from 'vitest';
import type { Project } from '../src/model/types';
import { createChannel, createEmptyProject, createNote, createPattern } from '../src/model/defaults';
import { loopedEvents, patternEvents, songEvents } from '../src/model/events';
import { TICKS_PER_BAR, TICKS_PER_STEP } from '../src/model/time';

function project(): { p: Project; patternId: string; channelId: string } {
  const p = createEmptyProject();
  p.channels = [createChannel('trio', 'Synth')];
  const pattern = createPattern('A', '#ff0000', 1);
  pattern.notes[p.channels[0].id] = [
    createNote(60, 0, TICKS_PER_STEP),
    createNote(64, 8 * TICKS_PER_STEP, TICKS_PER_STEP * 8),
  ];
  p.patterns = [pattern];
  return { p, patternId: pattern.id, channelId: p.channels[0].id };
}

describe('patternEvents', () => {
  it('returns notes starting inside the half-open window', () => {
    const { p, patternId } = project();
    expect(patternEvents(p, patternId, 0, TICKS_PER_BAR).map((e) => e.key)).toEqual([60, 64]);
    expect(patternEvents(p, patternId, 1, TICKS_PER_BAR).map((e) => e.key)).toEqual([64]);
    expect(patternEvents(p, patternId, 0, 8 * TICKS_PER_STEP)).toHaveLength(1);
  });

  it('ignores notes of channels that no longer exist', () => {
    const { p, patternId } = project();
    p.patterns[0].notes.ghost = [createNote(70, 0, 24)];
    expect(patternEvents(p, patternId, 0, TICKS_PER_BAR)).toHaveLength(2);
  });
});

describe('songEvents', () => {
  it('repeats the pattern across a long clip and cuts notes at the clip end', () => {
    const { p, patternId } = project();
    p.playlist.clips = [{ id: 'c1', patternId, track: 0, start: TICKS_PER_BAR, length: TICKS_PER_BAR * 1.5 }];
    const events = songEvents(p, 0, TICKS_PER_BAR * 4);
    expect(events.map((e) => [e.key, e.start])).toEqual([
      [60, TICKS_PER_BAR],
      [64, TICKS_PER_BAR + 8 * TICKS_PER_STEP],
      [60, TICKS_PER_BAR * 2],
    ]);
    // The clip ends half a bar into the second repetition, before its second note.
    expect(events[1].length).toBe(TICKS_PER_STEP * 8);
  });

  it('cuts a note that would ring past the clip end', () => {
    const { p, patternId } = project();
    p.playlist.clips = [{ id: 'c1', patternId, track: 0, start: 0, length: 10 * TICKS_PER_STEP }];
    const long = songEvents(p, 0, TICKS_PER_BAR).find((e) => e.key === 64)!;
    expect(long.length).toBe(2 * TICKS_PER_STEP);
  });

  it('skips muted playlist tracks', () => {
    const { p, patternId } = project();
    p.playlist.clips = [{ id: 'c1', patternId, track: 2, start: 0, length: TICKS_PER_BAR }];
    p.playlist.tracks[2].mute = true;
    expect(songEvents(p, 0, TICKS_PER_BAR)).toHaveLength(0);
  });

  it('finds repetitions that start inside a window far into the clip', () => {
    const { p, patternId } = project();
    p.playlist.clips = [{ id: 'c1', patternId, track: 0, start: 0, length: TICKS_PER_BAR * 8 }];
    const events = songEvents(p, TICKS_PER_BAR * 5, TICKS_PER_BAR * 5 + 1);
    expect(events.map((e) => e.start)).toEqual([TICKS_PER_BAR * 5]);
  });
});

describe('pattern length in the playlist', () => {
  it('repeats a pattern every two bars once a note rings into the second bar', () => {
    const { p, patternId, channelId } = project();
    p.patterns[0].notes[channelId].push(createNote(67, 12 * TICKS_PER_STEP, TICKS_PER_STEP * 8));
    p.playlist.clips = [{ id: 'c1', patternId, track: 0, start: 0, length: TICKS_PER_BAR * 4 }];
    const starts = songEvents(p, 0, TICKS_PER_BAR * 4).filter((e) => e.key === 60).map((e) => e.start);
    expect(starts).toEqual([0, TICKS_PER_BAR * 2]);
  });
});

describe('loopedEvents', () => {
  it('wraps the window at the loop end and reports offsets from the window start', () => {
    const { p, patternId } = project();
    const source = (from: number, to: number) => patternEvents(p, patternId, from, to);
    // Window starts 2 steps before the loop end and spans 4 steps.
    const events = loopedEvents(source, TICKS_PER_BAR, TICKS_PER_BAR - 2 * TICKS_PER_STEP, 4 * TICKS_PER_STEP);
    expect(events).toHaveLength(1);
    expect(events[0].key).toBe(60);
    expect(events[0].offset).toBe(2 * TICKS_PER_STEP);
  });

  it('covers several loop passes in one window', () => {
    const { p, patternId } = project();
    const source = (from: number, to: number) => patternEvents(p, patternId, from, to);
    const events = loopedEvents(source, TICKS_PER_BAR, 0, TICKS_PER_BAR * 3);
    expect(events.map((e) => e.offset)).toEqual([0, 192, 384, 576, 768, 960]);
  });
});
