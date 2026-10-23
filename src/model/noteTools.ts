import type { Note } from './types';
import { uid } from './defaults';
import { snapRound, wrap } from './time';

/** Pure note transforms behind the piano roll's Tools menu. They return new notes and keep ids. */

export const CHORDS: Array<{ name: string; intervals: number[] }> = [
  { name: 'Maior', intervals: [0, 4, 7] },
  { name: 'Menor', intervals: [0, 3, 7] },
  { name: 'Sétima (7)', intervals: [0, 4, 7, 10] },
  { name: 'Maior com sétima (maj7)', intervals: [0, 4, 7, 11] },
  { name: 'Menor com sétima (m7)', intervals: [0, 3, 7, 10] },
  { name: 'Nona (9)', intervals: [0, 4, 7, 10, 14] },
  { name: 'Menor com nona (m9)', intervals: [0, 3, 7, 10, 14] },
  { name: 'Sus2', intervals: [0, 2, 7] },
  { name: 'Sus4', intervals: [0, 5, 7] },
  { name: 'Diminuto', intervals: [0, 3, 6] },
  { name: 'Aumentado', intervals: [0, 4, 8] },
  { name: 'Quinta (power chord)', intervals: [0, 7, 12] },
  { name: 'Oitavas', intervals: [0, 12] },
];

export const SCALES: Array<{ name: string; steps: number[] }> = [
  { name: 'Maior', steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Menor natural', steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Menor harmônica', steps: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'Menor melódica', steps: [0, 2, 3, 5, 7, 9, 11] },
  { name: 'Pentatônica maior', steps: [0, 2, 4, 7, 9] },
  { name: 'Pentatônica menor', steps: [0, 3, 5, 7, 10] },
  { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { name: 'Dórico', steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Frígio', steps: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'Lídio', steps: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'Mixolídio', steps: [0, 2, 4, 5, 7, 9, 10] },
];

export function inScale(key: number, root: number, steps: number[]): boolean {
  return steps.includes(wrap(key - root, 12));
}

/** Moves notes to the start grid; with `lengths`, also snaps their ends. `strength` 0..1 moves part way. */
export function quantize(notes: Note[], grid: number, strength = 1, lengths = false): Note[] {
  return notes.map((n) => {
    const start = n.start + (snapRound(n.start, grid) - n.start) * strength;
    let length = n.length;
    if (lengths) length = Math.max(grid, snapRound(n.start + n.length, grid) - snapRound(n.start, grid));
    return { ...n, start: Math.max(0, Math.round(start)), length };
  });
}

/** Adds the other chord tones above each note (the note itself is the root). */
export function chordsFrom(notes: Note[], intervals: number[]): Note[] {
  const added: Note[] = [];
  for (const n of notes) {
    for (const i of intervals) {
      const key = n.key + i;
      if (i === 0 || key > 127) continue;
      added.push({ ...n, id: uid('n'), key });
    }
  }
  return [...notes, ...added];
}

/** Notes grouped by start tick (chords), in time order. */
function byStart(notes: Note[]): Note[][] {
  const groups = new Map<number, Note[]>();
  for (const n of notes) {
    const g = groups.get(n.start);
    if (g) g.push(n);
    else groups.set(n.start, [n]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

/** Stretches every note up to the next note's start (the last notes keep their length). */
export function legato(notes: Note[]): Note[] {
  const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  return notes.map((n) => {
    const next = starts.find((s) => s > n.start);
    return next === undefined ? n : { ...n, length: next - n.start };
  });
}

export type ArpDirection = 'up' | 'down' | 'updown';

/**
 * Turns each chord into an arpeggio: its notes play one after another every
 * `step` ticks for as long as the chord lasted.
 */
export function arpeggiate(notes: Note[], step: number, direction: ArpDirection = 'up', gate = 0.9): Note[] {
  const out: Note[] = [];
  for (const chord of byStart(notes)) {
    const keys = chord.map((n) => n.key).sort((a, b) => a - b);
    let order = direction === 'down' ? [...keys].reverse() : keys;
    if (direction === 'updown' && keys.length > 2) order = [...keys, ...keys.slice(1, -1).reverse()];
    const start = chord[0].start;
    const end = start + Math.max(...chord.map((n) => n.length));
    const velocity = Math.max(...chord.map((n) => n.velocity));
    for (let t = start, i = 0; t < end; t += step, i++) {
      out.push({ id: uid('n'), key: order[i % order.length], start: t, length: Math.max(1, Math.min(step * gate, end - t)), velocity });
    }
  }
  return out;
}

/** Spreads each chord's notes in time, like a strum, `spread` ticks apart. */
export function strum(notes: Note[], spread: number, direction: 'up' | 'down' = 'up'): Note[] {
  const out: Note[] = [];
  for (const chord of byStart(notes)) {
    const sorted = [...chord].sort((a, b) => (direction === 'up' ? a.key - b.key : b.key - a.key));
    sorted.forEach((n, i) => {
      const delay = Math.min(i * spread, n.length - 1);
      out.push({ ...n, start: n.start + delay, length: n.length - delay });
    });
  }
  return out;
}

/** Random timing and velocity variation, for a less mechanical feel. */
export function humanize(notes: Note[], timing: number, velocity: number, random: () => number = Math.random): Note[] {
  return notes.map((n) => ({
    ...n,
    start: Math.max(0, Math.round(n.start + (random() * 2 - 1) * timing)),
    velocity: Math.min(1, Math.max(0.05, n.velocity + (random() * 2 - 1) * velocity)),
  }));
}

/** Mirrors the notes upside down within their own key range. */
export function flip(notes: Note[]): Note[] {
  if (notes.length === 0) return notes;
  const keys = notes.map((n) => n.key);
  const sum = Math.min(...keys) + Math.max(...keys);
  return notes.map((n) => ({ ...n, key: sum - n.key }));
}

/** Moves notes outside the scale to the nearest key in it (down on ties). */
export function fitToScale(notes: Note[], root: number, steps: number[]): Note[] {
  return notes.map((n) => {
    if (inScale(n.key, root, steps)) return n;
    for (let d = 1; d < 12; d++) {
      if (n.key - d >= 0 && inScale(n.key - d, root, steps)) return { ...n, key: n.key - d };
      if (n.key + d <= 127 && inScale(n.key + d, root, steps)) return { ...n, key: n.key + d };
    }
    return n;
  });
}

/** Cuts each note into pieces `size` ticks long (like a stutter / chop). */
export function chop(notes: Note[], size: number): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    for (let t = n.start; t < n.start + n.length; t += size) {
      out.push({ ...n, id: uid('n'), start: t, length: Math.min(size, n.start + n.length - t) });
    }
  }
  return out;
}
