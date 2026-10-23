import { describe, expect, it } from 'vitest';
import type { Note } from '../src/model/types';
import { arpeggiate, chop, chordsFrom, fitToScale, flip, humanize, inScale, legato, quantize, SCALES, strum } from '../src/model/noteTools';

const n = (key: number, start: number, length: number, velocity = 0.8): Note => ({ id: `${key}-${start}`, key, start, length, velocity });
const major = SCALES.find((s) => s.name === 'Maior')!.steps;

describe('note tools', () => {
  it('quantizes starts, optionally lengths, and partially with strength', () => {
    expect(quantize([n(60, 13, 30)], 24).map((x) => x.start)).toEqual([24]);
    expect(quantize([n(60, 13, 30)], 24, 0.5)[0].start).toBe(19);
    expect(quantize([n(60, 13, 30)], 24, 1, true)[0]).toMatchObject({ start: 24, length: 24 });
    expect(quantize([n(60, 0, 3)], 24, 1, true)[0].length).toBe(24);
  });

  it('builds chords on each note', () => {
    const out = chordsFrom([n(60, 0, 96)], [0, 4, 7]);
    expect(out.map((x) => x.key)).toEqual([60, 64, 67]);
    expect(out.every((x) => x.start === 0 && x.length === 96)).toBe(true);
    expect(new Set(out.map((x) => x.id)).size).toBe(3);
  });

  it('makes notes legato up to the next start', () => {
    const out = legato([n(60, 0, 10), n(64, 0, 10), n(62, 48, 10)]);
    expect(out.map((x) => x.length)).toEqual([48, 48, 10]);
  });

  it('arpeggiates chords for their full length', () => {
    const out = arpeggiate([n(60, 0, 96), n(64, 0, 96), n(67, 0, 96)], 24, 'up', 1);
    expect(out.map((x) => [x.key, x.start])).toEqual([
      [60, 0],
      [64, 24],
      [67, 48],
      [60, 72],
    ]);
    const down = arpeggiate([n(60, 0, 48), n(64, 0, 48)], 24, 'down');
    expect(down.map((x) => x.key)).toEqual([64, 60]);
    const updown = arpeggiate([n(60, 0, 96), n(64, 0, 96), n(67, 0, 96)], 24, 'updown');
    expect(updown.map((x) => x.key)).toEqual([60, 64, 67, 64]);
  });

  it('strums chords from the lowest note up', () => {
    const out = strum([n(67, 0, 96), n(60, 0, 96), n(64, 0, 96)], 6);
    const byKey = Object.fromEntries(out.map((x) => [x.key, x]));
    expect([byKey[60].start, byKey[64].start, byKey[67].start]).toEqual([0, 6, 12]);
    expect(byKey[67].length).toBe(84);
  });

  it('humanizes within the given ranges', () => {
    let i = 0;
    const seq = [1, 0, 0.5, 0.5];
    const out = humanize([n(60, 48, 24, 0.5), n(62, 0, 24, 0.5)], 4, 0.2, () => seq[i++]);
    expect(out[0]).toMatchObject({ start: 52, velocity: 0.3 });
    expect(out[1]).toMatchObject({ start: 0, velocity: 0.5 });
  });

  it('flips within the key range', () => {
    expect(flip([n(60, 0, 1), n(64, 0, 1), n(72, 0, 1)]).map((x) => x.key)).toEqual([72, 68, 60]);
  });

  it('fits notes to a scale', () => {
    expect(inScale(61, 60, major)).toBe(false);
    expect(fitToScale([n(61, 0, 1), n(66, 0, 1), n(64, 0, 1)], 60, major).map((x) => x.key)).toEqual([60, 65, 64]);
  });

  it('chops notes into pieces', () => {
    const out = chop([n(60, 0, 60)], 24);
    expect(out.map((x) => [x.start, x.length])).toEqual([
      [0, 24],
      [24, 24],
      [48, 12],
    ]);
  });
});
