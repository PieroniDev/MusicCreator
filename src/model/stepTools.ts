import type { Note } from './types';
import { createNote } from './defaults';
import { TICKS_PER_STEP, wrap } from './time';

/** Step-sequencer helpers behind the channel menu. Steps play the channel's root key. */

/** A step on every `every`-th step, starting at `offset`, over `steps` steps. */
export function fillEvery(steps: number, every: number, rootKey: number, offset = 0): Note[] {
  const out: Note[] = [];
  for (let s = offset; s < steps; s += every) out.push(createNote(rootKey, s * TICKS_PER_STEP, TICKS_PER_STEP, 0.78));
  return out;
}

/** Rotates notes by `steps` steps inside a loop of `length` ticks (what leaves one end comes in at the other). */
export function shiftNotes(notes: Note[], steps: number, length: number): Note[] {
  return notes.map((n) => ({ ...n, start: wrap(n.start + steps * TICKS_PER_STEP, length) })).sort((a, b) => a.start - b.start);
}

/** Random steps, each on with probability `density`. */
export function randomSteps(steps: number, density: number, rootKey: number, random: () => number = Math.random): Note[] {
  const out: Note[] = [];
  for (let s = 0; s < steps; s++) {
    if (random() < density) out.push(createNote(rootKey, s * TICKS_PER_STEP, TICKS_PER_STEP, 0.6 + random() * 0.35));
  }
  return out;
}

/** Turns empty steps on and filled steps off. */
export function invertSteps(notes: Note[], steps: number, rootKey: number): Note[] {
  const on = new Set(notes.map((n) => Math.round(n.start / TICKS_PER_STEP)));
  const out: Note[] = [];
  for (let s = 0; s < steps; s++) if (!on.has(s)) out.push(createNote(rootKey, s * TICKS_PER_STEP, TICKS_PER_STEP, 0.78));
  return out;
}
