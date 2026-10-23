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
    expect(isStepSequence(steps, 62)).toBe(false);
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
