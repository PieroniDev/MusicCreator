import type { Note, Pattern, Project } from './types';
import { TICKS_PER_BAR, TICKS_PER_STEP } from './time';

/** End tick of the last note across all channels of a pattern. */
export function patternContentEnd(pattern: Pattern): number {
  let end = 0;
  for (const notes of Object.values(pattern.notes)) {
    for (const n of notes) end = Math.max(end, n.start + n.length);
  }
  return end;
}

/** Pattern length in ticks: its minimum bar count, grown to whole bars that fit every note. */
export function patternLength(pattern: Pattern): number {
  const minBars = Math.max(1, Math.floor(pattern.lengthBars));
  const contentBars = Math.ceil(patternContentEnd(pattern) / TICKS_PER_BAR);
  return Math.max(minBars, contentBars) * TICKS_PER_BAR;
}

export function patternSteps(pattern: Pattern): number {
  return patternLength(pattern) / TICKS_PER_STEP;
}

/**
 * A channel's notes can be shown as plain steps when every note is one step
 * long, sits on a step boundary and uses the channel's root key. Otherwise
 * the channel rack shows a read-only preview and edits go to the piano roll.
 */
export function isStepSequence(notes: Note[] | undefined, rootKey: number): boolean {
  if (!notes) return true;
  return notes.every(
    (n) => n.key === rootKey && n.length === TICKS_PER_STEP && n.start % TICKS_PER_STEP === 0,
  );
}

export function stepIsOn(notes: Note[] | undefined, step: number): boolean {
  if (!notes) return false;
  const start = step * TICKS_PER_STEP;
  return notes.some((n) => n.start === start);
}

export function findPattern(project: Project, id: string | null | undefined): Pattern | undefined {
  if (!id) return undefined;
  return project.patterns.find((p) => p.id === id);
}

/** End of the arrangement in ticks, rounded up to a whole bar (at least one bar). */
export function songLength(project: Project): number {
  let end = 0;
  for (const c of project.playlist.clips) end = Math.max(end, c.start + c.length);
  return Math.max(1, Math.ceil(end / TICKS_PER_BAR)) * TICKS_PER_BAR;
}
