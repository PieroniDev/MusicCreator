/**
 * Destructive sample edits for the audio editor. Each takes the audio as one
 * Float32Array per channel plus a frame range and returns new arrays (the
 * input is never modified).
 */

export type Pcm = Float32Array[];

export interface FrameRange {
  start: number;
  end: number;
}

/** The range clamped to the audio; an empty range means the whole sample. */
export function normalizeRange(pcm: Pcm, range: FrameRange | null): FrameRange {
  const length = pcm[0]?.length ?? 0;
  if (!range) return { start: 0, end: length };
  const start = Math.max(0, Math.min(length, Math.round(Math.min(range.start, range.end))));
  const end = Math.max(0, Math.min(length, Math.round(Math.max(range.start, range.end))));
  return end > start ? { start, end } : { start: 0, end: length };
}

/** Applies `fn(sample, indexInRange, rangeLength)` to every sample of the range. */
function mapRange(pcm: Pcm, r: FrameRange, fn: (v: number, i: number, n: number) => number): Pcm {
  const n = r.end - r.start;
  return pcm.map((ch) => {
    const out = ch.slice();
    for (let i = 0; i < n; i++) out[r.start + i] = fn(ch[r.start + i], i, n);
    return out;
  });
}

/** Keeps only the range. */
export function crop(pcm: Pcm, r: FrameRange): Pcm {
  return pcm.map((ch) => ch.slice(r.start, r.end));
}

/** Deletes the range, joining what comes before and after it. */
export function remove(pcm: Pcm, r: FrameRange): Pcm {
  return pcm.map((ch) => {
    const out = new Float32Array(ch.length - (r.end - r.start));
    out.set(ch.subarray(0, r.start), 0);
    out.set(ch.subarray(r.end), r.start);
    return out;
  });
}

export function silence(pcm: Pcm, r: FrameRange): Pcm {
  return mapRange(pcm, r, () => 0);
}

export function gain(pcm: Pcm, r: FrameRange, factor: number): Pcm {
  return mapRange(pcm, r, (v) => v * factor);
}

/** Scales the range so its loudest sample reaches `peak` (linear). */
export function normalize(pcm: Pcm, r: FrameRange, peak = Math.pow(10, -0.3 / 20)): Pcm {
  let max = 0;
  for (const ch of pcm) for (let i = r.start; i < r.end; i++) max = Math.max(max, Math.abs(ch[i]));
  return max > 0 ? gain(pcm, r, peak / max) : pcm.map((ch) => ch.slice());
}

/** Fades the range in or out along a quarter sine (smooth at both ends). */
export function fade(pcm: Pcm, r: FrameRange, direction: 'in' | 'out'): Pcm {
  return mapRange(pcm, r, (v, i, n) => {
    const x = n > 1 ? i / (n - 1) : 1;
    const g = Math.sin(((direction === 'in' ? x : 1 - x) * Math.PI) / 2);
    return v * g * g;
  });
}

export function reverse(pcm: Pcm, r: FrameRange): Pcm {
  return pcm.map((ch) => {
    const out = ch.slice();
    for (let i = r.start, j = r.end - 1; i < r.end; i++, j--) out[i] = ch[j];
    return out;
  });
}

/** Removes a constant offset (the average) from the range. */
export function removeDc(pcm: Pcm, r: FrameRange): Pcm {
  return pcm.map((ch) => {
    let sum = 0;
    for (let i = r.start; i < r.end; i++) sum += ch[i];
    const mean = sum / Math.max(1, r.end - r.start);
    const out = ch.slice();
    for (let i = r.start; i < r.end; i++) out[i] = ch[i] - mean;
    return out;
  });
}

/** Inserts `frames` of silence at `at`. */
export function insertSilence(pcm: Pcm, at: number, frames: number): Pcm {
  return pcm.map((ch) => {
    const out = new Float32Array(ch.length + frames);
    out.set(ch.subarray(0, at), 0);
    out.set(ch.subarray(at), at + frames);
    return out;
  });
}

/** Peak (linear) of the range, across channels. */
export function peakOf(pcm: Pcm, r: FrameRange): number {
  let max = 0;
  for (const ch of pcm) for (let i = r.start; i < r.end; i++) max = Math.max(max, Math.abs(ch[i]));
  return max;
}
