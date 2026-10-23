import type { TimeSignature } from './types';

export const PPQ = 96;
export const TICKS_PER_STEP = PPQ / 4;
export const BEATS_PER_BAR = 4;
/** A 4/4 bar; use barTicks() for the project's own time signature. */
export const TICKS_PER_BAR = PPQ * BEATS_PER_BAR;
export const STEPS_PER_BAR = TICKS_PER_BAR / TICKS_PER_STEP;

export const BEAT_UNITS = [2, 4, 8, 16];
export const MAX_BEATS = 16;

/** Ticks per beat of a time signature (a quarter note in x/4, an eighth in x/8...). */
export function beatTicks(sig?: TimeSignature): number {
  return (PPQ * 4) / (sig?.beatUnit ?? 4);
}

/** Ticks per bar of a time signature (always a whole number of steps). */
export function barTicks(sig?: TimeSignature): number {
  return beatTicks(sig) * (sig?.beats ?? 4);
}

export function formatTimeSig(sig?: TimeSignature): string {
  return `${sig?.beats ?? 4}/${sig?.beatUnit ?? 4}`;
}

/** Snap values that depend on the time signature (resolved with resolveSnap). */
export const SNAP_BAR = -1;
export const SNAP_BEAT = -2;

export function resolveSnap(snap: number, sig?: TimeSignature): number {
  if (snap === SNAP_BAR) return barTicks(sig);
  if (snap === SNAP_BEAT) return beatTicks(sig);
  return Math.max(1, snap);
}

export function secondsPerTick(bpm: number): number {
  return 60 / bpm / PPQ;
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return ticks * secondsPerTick(bpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return seconds / secondsPerTick(bpm);
}

/** Modulo that is always non-negative (for wrapping loop positions). */
export function wrap(value: number, length: number): number {
  if (length <= 0) return 0;
  const r = value % length;
  return r < 0 ? r + length : r;
}

export function snapFloor(ticks: number, snap: number): number {
  if (snap <= 1) return Math.floor(ticks);
  return Math.floor(ticks / snap) * snap;
}

export function snapRound(ticks: number, snap: number): number {
  if (snap <= 1) return Math.round(ticks);
  return Math.round(ticks / snap) * snap;
}

/** "bar:beat:step" (1-based), the format shown in the transport display. */
export function formatPosition(ticks: number, sig?: TimeSignature): string {
  const t = Math.max(0, Math.floor(ticks));
  const bar = barTicks(sig);
  const beat = beatTicks(sig);
  return `${Math.floor(t / bar) + 1}:${Math.floor((t % bar) / beat) + 1}:${Math.floor((t % beat) / TICKS_PER_STEP) + 1}`;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Note name with key 60 = C5 (the convention used by pattern-based DAWs). */
export function keyName(key: number): string {
  return `${NOTE_NAMES[wrap(key, 12)]}${Math.floor(key / 12)}`;
}

export function isBlackKey(key: number): boolean {
  return [1, 3, 6, 8, 10].includes(wrap(key, 12));
}

export function keyToFrequency(key: number): number {
  return 440 * Math.pow(2, (key - 69) / 12);
}
