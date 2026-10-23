import { describe, expect, it } from 'vitest';
import { fillEvery, invertSteps, randomSteps, shiftNotes } from '../src/model/stepTools';
import { TICKS_PER_BAR, TICKS_PER_STEP } from '../src/model/time';

const steps = (notes: { start: number }[]) => notes.map((n) => n.start / TICKS_PER_STEP);

describe('step tools', () => {
  it('fills every N steps', () => {
    expect(steps(fillEvery(16, 4, 60))).toEqual([0, 4, 8, 12]);
    expect(steps(fillEvery(16, 8, 60, 2))).toEqual([2, 10]);
    expect(fillEvery(16, 4, 50).every((n) => n.key === 50 && n.length === TICKS_PER_STEP)).toBe(true);
  });

  it('rotates steps around the pattern', () => {
    expect(steps(shiftNotes(fillEvery(16, 4, 60), 1, TICKS_PER_BAR))).toEqual([1, 5, 9, 13]);
    expect(steps(shiftNotes(fillEvery(16, 4, 60), -1, TICKS_PER_BAR))).toEqual([3, 7, 11, 15]);
  });

  it('randomizes with the given density', () => {
    const seq = [0.1, 0.5, 0.9, 0.2, 0.3];
    let i = 0;
    const rnd = () => seq[i++ % seq.length];
    expect(steps(randomSteps(3, 0.4, 60, rnd))).toEqual([0, 2]);
  });

  it('inverts steps', () => {
    expect(steps(invertSteps(fillEvery(8, 2, 60), 8, 60))).toEqual([1, 3, 5, 7]);
  });
});
