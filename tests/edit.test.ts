import { describe, expect, it } from 'vitest';
import * as edit from '../src/audio/edit';

const pcm = () => [Float32Array.from([0, 0.1, 0.2, 0.3, 0.4, 0.5]), Float32Array.from([1, 1, 1, 1, 1, 1])];
const list = (a: Float32Array) => [...a].map((v) => Math.round(v * 1000) / 1000);

describe('audio edits', () => {
  it('treats an empty or reversed range as the given span, and no range as everything', () => {
    expect(edit.normalizeRange(pcm(), null)).toEqual({ start: 0, end: 6 });
    expect(edit.normalizeRange(pcm(), { start: 4, end: 2 })).toEqual({ start: 2, end: 4 });
    expect(edit.normalizeRange(pcm(), { start: 3, end: 3 })).toEqual({ start: 0, end: 6 });
    expect(edit.normalizeRange(pcm(), { start: -5, end: 99 })).toEqual({ start: 0, end: 6 });
  });

  it('crops, removes and inserts silence on every channel', () => {
    const r = { start: 2, end: 4 };
    expect(edit.crop(pcm(), r).map(list)).toEqual([[0.2, 0.3], [1, 1]]);
    expect(edit.remove(pcm(), r).map(list)).toEqual([[0, 0.1, 0.4, 0.5], [1, 1, 1, 1]]);
    expect(list(edit.insertSilence(pcm(), 1, 2)[0])).toEqual([0, 0, 0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('changes only the range and never the input', () => {
    const input = pcm();
    const out = edit.silence(input, { start: 1, end: 3 });
    expect(list(out[0])).toEqual([0, 0, 0, 0.3, 0.4, 0.5]);
    expect(list(input[0])).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(list(edit.reverse(input, { start: 0, end: 3 })[0])).toEqual([0.2, 0.1, 0, 0.3, 0.4, 0.5]);
    expect(list(edit.gain(input, { start: 5, end: 6 }, 2)[0])).toEqual([0, 0.1, 0.2, 0.3, 0.4, 1]);
  });

  it('normalizes the peak of the range', () => {
    const out = edit.normalize([Float32Array.from([0.1, -0.25, 0.2])], { start: 0, end: 3 }, 1);
    expect(list(out[0])).toEqual([0.4, -1, 0.8]);
    // Silence stays silent.
    expect(list(edit.normalize([new Float32Array(3)], { start: 0, end: 3 })[0])).toEqual([0, 0, 0]);
  });

  it('fades from silence and into silence', () => {
    const ones = [new Float32Array(5).fill(1)];
    const fin = edit.fade(ones, { start: 0, end: 5 }, 'in')[0];
    const fout = edit.fade(ones, { start: 0, end: 5 }, 'out')[0];
    expect(fin[0]).toBe(0);
    expect(fin[4]).toBeCloseTo(1);
    expect(fout[0]).toBeCloseTo(1);
    expect(fout[4]).toBeCloseTo(0);
    for (let i = 1; i < 5; i++) expect(fin[i]).toBeGreaterThan(fin[i - 1]);
  });

  it('removes a DC offset', () => {
    const out = edit.removeDc([Float32Array.from([0.5, 0.7, 0.3, 0.5])], { start: 0, end: 4 });
    expect(list(out[0])).toEqual([0, 0.2, -0.2, 0]);
    expect(edit.peakOf(out, { start: 0, end: 4 })).toBeCloseTo(0.2);
  });
});
