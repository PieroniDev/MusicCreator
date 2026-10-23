export const PPQ = 96;
export const TICKS_PER_STEP = PPQ / 4;
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = PPQ * BEATS_PER_BAR;
export const STEPS_PER_BAR = TICKS_PER_BAR / TICKS_PER_STEP;

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
export function formatPosition(ticks: number): string {
  const t = Math.max(0, Math.floor(ticks));
  const bar = Math.floor(t / TICKS_PER_BAR) + 1;
  const beat = Math.floor((t % TICKS_PER_BAR) / PPQ) + 1;
  const step = Math.floor((t % PPQ) / TICKS_PER_STEP) + 1;
  return `${bar}:${beat}:${step}`;
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
