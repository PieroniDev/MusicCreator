import type { Note, Pattern, Project } from './types';
import { barTicks, TICKS_PER_BAR, TICKS_PER_STEP } from './time';

/** End tick of the last note across all channels of a pattern. */
export function patternContentEnd(pattern: Pattern): number {
  let end = 0;
  for (const notes of Object.values(pattern.notes)) {
    for (const n of notes) end = Math.max(end, n.start + n.length);
  }
  return end;
}

/**
 * Pattern length in ticks: its minimum bar count, grown to whole bars that
 * fit every note. `bar` is the project's bar length (see barTicks).
 */
export function patternLength(pattern: Pattern, bar = TICKS_PER_BAR): number {
  const minBars = Math.max(1, Math.floor(pattern.lengthBars));
  const contentBars = Math.ceil(patternContentEnd(pattern) / bar);
  return Math.max(minBars, contentBars) * bar;
}

export function patternSteps(pattern: Pattern, bar = TICKS_PER_BAR): number {
  return patternLength(pattern, bar) / TICKS_PER_STEP;
}

/**
 * A channel's notes can be shown as plain steps when every note is one step
 * long, sits on a step boundary and no two share a step (each step may have
 * its own pitch, set in the graph editor). Otherwise the channel rack shows a
 * read-only preview and edits go to the piano roll.
 */
export function isStepSequence(notes: Note[] | undefined, _rootKey?: number): boolean {
  if (!notes) return true;
  const starts = new Set<number>();
  for (const n of notes) {
    if (n.length !== TICKS_PER_STEP || n.start % TICKS_PER_STEP !== 0 || starts.has(n.start)) return false;
    starts.add(n.start);
  }
  return true;
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
  const bar = barTicks(project.timeSig);
  let end = 0;
  for (const c of project.playlist.clips) end = Math.max(end, c.start + c.length);
  return Math.max(1, Math.ceil(end / bar)) * bar;
}
