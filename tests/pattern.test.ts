import { describe, expect, it } from 'vitest';
import { createNote, createPattern, createEmptyProject } from '../src/model/defaults';
import { isStepSequence, patternLength, songLength, stepIsOn } from '../src/model/pattern';
import { TICKS_PER_BAR, TICKS_PER_STEP } from '../src/model/time';

describe('pattern helpers', () => {
  it('is at least its minimum bar count and grows to fit notes', () => {
    const p = createPattern('p', '#ffffff', 2);
    expect(patternLength(p)).toBe(2 * TICKS_PER_BAR);
    p.notes.a = [createNote(60, TICKS_PER_BAR * 2 + 10, 50)];
    expect(patternLength(p)).toBe(3 * TICKS_PER_BAR);
  });

  it('recognizes plain step sequences', () => {
    const steps = [createNote(60, 0, TICKS_PER_STEP), createNote(60, 4 * TICKS_PER_STEP, TICKS_PER_STEP)];
    expect(isStepSequence(steps, 60)).toBe(true);
    // Steps may carry their own pitch, but two notes on one step need the piano roll.
    expect(isStepSequence([...steps, createNote(64, 8 * TICKS_PER_STEP, TICKS_PER_STEP)], 60)).toBe(true);
    expect(isStepSequence([...steps, createNote(64, 0, TICKS_PER_STEP)], 60)).toBe(false);
    expect(isStepSequence([createNote(60, 0, 48)], 60)).toBe(false);
    expect(isStepSequence(undefined, 60)).toBe(true);
    expect(stepIsOn(steps, 4)).toBe(true);
    expect(stepIsOn(steps, 3)).toBe(false);
  });

  it('measures the song in whole bars', () => {
    const project = createEmptyProject();
    expect(songLength(project)).toBe(TICKS_PER_BAR);
    project.playlist.clips.push({ id: 'c', kind: 'pattern' as const, patternId: project.patterns[0].id, track: 0, start: 100, length: TICKS_PER_BAR });
    expect(songLength(project)).toBe(2 * TICKS_PER_BAR);
  });
});

describe('patterns and songs in other time signatures', () => {
  it('measures in bars of the project signature', () => {
    const p = createPattern('p', '#ffffff', 2);
    expect(patternLength(p, 288)).toBe(576);
    p.notes.a = [createNote(60, 600, 10)];
    expect(patternLength(p, 288)).toBe(864);
    const project = createEmptyProject();
    project.timeSig = { beats: 3, beatUnit: 4 };
    project.playlist.clips.push({ id: 'c', kind: 'pattern' as const, patternId: project.patterns[0].id, track: 0, start: 0, length: 300 });
    expect(songLength(project)).toBe(576);
  });
});
