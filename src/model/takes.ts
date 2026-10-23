import { wrap } from './time';

/** Where the transport stood when a recording's first frame was captured. */
export interface TakeStart {
  /** Ticks since playback started (negative during the start-up delay). */
  u: number;
  /** Position inside the loop where playback started. */
  p0: number;
  loopStart: number;
  loopLength: number;
  /** Whether a loop region was playing (each pass becomes its own take). */
  region: boolean;
}

export interface TakeSegment {
  /** Frames of the recording [from, to). */
  from: number;
  to: number;
  /** Song position (ticks) where this part goes. */
  at: number;
}

/**
 * Splits a recording into takes: audio from before playback started is
 * dropped, and while a loop region plays every pass around it becomes a
 * separate take placed at the loop start. Scraps shorter than `minFrames`
 * (like the moment after the last wrap) are dropped, keeping at least one.
 */
export function splitTake(frames: number, start: TakeStart, framesPerTick: number, minFrames = 0): TakeSegment[] {
  const skip = start.u < 0 ? Math.min(frames, Math.round(-start.u * framesPerTick)) : 0;
  const position = wrap(start.p0 + Math.max(0, start.u), start.loopLength);
  if (!start.region) return skip < frames ? [{ from: skip, to: frames, at: start.loopStart + position }] : [];
  const segments: TakeSegment[] = [];
  let from = skip;
  let ticks = start.loopLength - position;
  let at = start.loopStart + position;
  while (from < frames) {
    const to = Math.min(frames, skip + Math.round(ticks * framesPerTick));
    if (to > from) segments.push({ from, to, at });
    from = Math.max(from, to);
    at = start.loopStart;
    ticks += start.loopLength;
  }
  const kept = segments.filter((s) => s.to - s.from >= minFrames);
  return kept.length ? kept : segments.slice(0, 1);
}
