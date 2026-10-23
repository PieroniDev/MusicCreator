import type { Project } from './types';
import { findPattern, patternLength } from './pattern';

/** A note to be played, positioned on the transport timeline (pattern or song). */
export interface NoteEvent {
  channelId: string;
  key: number;
  velocity: number;
  /** Position in ticks on the timeline being played. */
  start: number;
  length: number;
}

/**
 * Notes of one pattern starting in [from, to). Positions are pattern-relative.
 */
export function patternEvents(project: Project, patternId: string, from: number, to: number): NoteEvent[] {
  const pattern = findPattern(project, patternId);
  if (!pattern || to <= from) return [];
  const length = patternLength(pattern);
  const out: NoteEvent[] = [];
  for (const channel of project.channels) {
    const notes = pattern.notes[channel.id];
    if (!notes) continue;
    for (const n of notes) {
      if (n.start >= from && n.start < to && n.start < length) {
        out.push({ channelId: channel.id, key: n.key, velocity: n.velocity, start: n.start, length: n.length });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Notes of the arrangement starting in [from, to). Each playlist clip plays
 * its pattern from the clip start, repeating it when the clip is longer than
 * the pattern; notes are cut at the clip's end.
 */
export function songEvents(project: Project, from: number, to: number): NoteEvent[] {
  if (to <= from) return [];
  const channelIds = new Set(project.channels.map((c) => c.id));
  const out: NoteEvent[] = [];
  for (const clip of project.playlist.clips) {
    const clipEnd = clip.start + clip.length;
    if (clip.start >= to || clipEnd <= from) continue;
    if (project.playlist.tracks[clip.track]?.mute) continue;
    const pattern = findPattern(project, clip.patternId);
    if (!pattern) continue;
    const length = patternLength(pattern);
    const firstRep = Math.max(0, Math.floor((from - clip.start) / length));
    const lastRep = Math.floor((Math.min(to, clipEnd) - clip.start) / length);
    for (const [channelId, notes] of Object.entries(pattern.notes)) {
      if (!channelIds.has(channelId)) continue;
      for (let rep = firstRep; rep <= lastRep; rep++) {
        const repStart = clip.start + rep * length;
        for (const n of notes) {
          if (n.start >= length) continue;
          const start = repStart + n.start;
          if (start < from || start >= to || start >= clipEnd) continue;
          out.push({
            channelId,
            key: n.key,
            velocity: n.velocity,
            start,
            length: Math.min(n.length, clipEnd - start),
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Events for a window of a looping timeline. `position` is where the window
 * starts inside the loop and `span` how many ticks it covers; the window
 * wraps at `loopLength`. Each event carries `offset`: ticks from the window
 * start until the note plays, which is what the scheduler converts to time.
 */
export function loopedEvents(
  source: (from: number, to: number) => NoteEvent[],
  loopLength: number,
  position: number,
  span: number,
): Array<NoteEvent & { offset: number }> {
  const out: Array<NoteEvent & { offset: number }> = [];
  if (loopLength <= 0 || span <= 0) return out;
  let pos = ((position % loopLength) + loopLength) % loopLength;
  let consumed = 0;
  while (consumed < span) {
    const chunk = Math.min(span - consumed, loopLength - pos);
    for (const e of source(pos, pos + chunk)) {
      out.push({ ...e, offset: consumed + (e.start - pos) });
    }
    consumed += chunk;
    pos = 0;
  }
  return out;
}
