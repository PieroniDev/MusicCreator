import { describe, expect, it } from 'vitest';
import { formatPosition, keyName, keyToFrequency, secondsPerTick, snapFloor, snapRound, TICKS_PER_BAR, wrap } from '../src/model/time';

describe('time', () => {
  it('formats positions as bar:beat:step', () => {
    expect(formatPosition(0)).toBe('1:1:1');
    expect(formatPosition(24)).toBe('1:1:2');
    expect(formatPosition(96)).toBe('1:2:1');
    expect(formatPosition(TICKS_PER_BAR * 2 + 96 * 3 + 24 * 3)).toBe('3:4:4');
  });

  it('wraps negative and positive values into the loop', () => {
    expect(wrap(5, 4)).toBe(1);
    expect(wrap(-1, 4)).toBe(3);
    expect(wrap(3, 0)).toBe(0);
  });

  it('snaps to the grid', () => {
    expect(snapFloor(47, 24)).toBe(24);
    expect(snapRound(37, 24)).toBe(48);
    expect(snapRound(11.4, 1)).toBe(11);
  });

  it('names keys with 60 = C5 and tunes A to 440 Hz', () => {
    expect(keyName(60)).toBe('C5');
    expect(keyName(61)).toBe('C#5');
    expect(keyToFrequency(69)).toBeCloseTo(440);
    expect(keyToFrequency(81)).toBeCloseTo(880);
  });

  it('converts tempo to seconds per tick', () => {
    // 120 BPM: a quarter note lasts 0.5 s, so a bar of 384 ticks lasts 2 s.
    expect(secondsPerTick(120) * TICKS_PER_BAR).toBeCloseTo(2);
  });
});

describe('time signatures', () => {
  it('sizes beats and bars', async () => {
    const { barTicks, beatTicks, formatTimeSig, resolveSnap, SNAP_BAR, SNAP_BEAT } = await import('../src/model/time');
    expect(barTicks()).toBe(384);
    expect(barTicks({ beats: 3, beatUnit: 4 })).toBe(288);
    expect(beatTicks({ beats: 6, beatUnit: 8 })).toBe(48);
    expect(barTicks({ beats: 7, beatUnit: 8 })).toBe(336);
    expect(barTicks({ beats: 5, beatUnit: 16 })).toBe(120);
    expect(formatTimeSig({ beats: 6, beatUnit: 8 })).toBe('6/8');
    expect(resolveSnap(SNAP_BAR, { beats: 3, beatUnit: 4 })).toBe(288);
    expect(resolveSnap(SNAP_BEAT, { beats: 6, beatUnit: 8 })).toBe(48);
    expect(resolveSnap(24)).toBe(24);
  });

  it('formats positions in the signature', async () => {
    const { formatPosition } = await import('../src/model/time');
    expect(formatPosition(288, { beats: 3, beatUnit: 4 })).toBe('2:1:1');
    expect(formatPosition(288 + 96 + 24, { beats: 3, beatUnit: 4 })).toBe('2:2:2');
    // 6/8: beats are eighths (two steps).
    expect(formatPosition(48 * 5 + 24, { beats: 6, beatUnit: 8 })).toBe('1:6:2');
  });
});
