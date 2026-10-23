import { engine } from '../audio/engine';
import { actions, selectedPattern, useStore } from '../state/store';
import { createNote } from '../model/defaults';
import { snapRound, wrap } from '../model/time';
import type { Voice } from '../plugins/types';

interface HeldNote {
  voice: Voice | null;
  channelId: string;
  key: number;
  velocity: number;
  /** Where the note started in the pattern, when it is being recorded. */
  recordFrom: number | null;
  patternId: string;
}

const held = new Map<string, HeldNote>();
const sustained = new Set<Voice>();
let sustain = false;

const now = () => engine.context?.currentTime ?? 0;

/** Whether notes played now get written into the pattern. */
function recordingNow(): boolean {
  const { ui } = useStore.getState();
  return ui.recording && ui.recordMode === 'notes' && ui.mode === 'pattern' && engine.isPlaying;
}

/**
 * A note played live (computer keyboard or MIDI) on the selected channel.
 * `source` keeps the same key held on two devices apart.
 */
export function liveNoteOn(source: string, key: number, velocity: number): void {
  const id = `${source}:${key}`;
  liveNoteOff(source, key);
  const state = useStore.getState();
  const channelId = state.ui.selectedChannelId;
  if (!channelId) return;
  const position = recordingNow() ? engine.getHeardPosition() : null;
  held.set(id, {
    voice: engine.previewNote(channelId, key, velocity),
    channelId,
    key,
    velocity,
    recordFrom: position,
    patternId: selectedPattern(state).id,
  });
}

export function liveNoteOff(source: string, key: number): void {
  const id = `${source}:${key}`;
  const note = held.get(id);
  if (!note) return;
  held.delete(id);
  if (note.voice) {
    if (sustain) sustained.add(note.voice);
    else note.voice.release(now());
  }
  if (note.recordFrom === null) return;
  const end = engine.getHeardPosition();
  const loop = engine.loopTicks;
  if (end === null || loop <= 0) return;
  const { snap } = useStore.getState().ui.pianoRoll;
  // Starts snap to the piano roll grid; the length is kept as played.
  const start = wrap(snapRound(note.recordFrom, snap), loop);
  const length = Math.max(6, wrap(end - note.recordFrom, loop));
  actions().addNotes(note.patternId, note.channelId, [createNote(note.key, start, length, note.velocity)]);
}

/** Sustain pedal: while down, released notes keep sounding. */
export function setSustain(down: boolean): void {
  sustain = down;
  if (down) return;
  for (const v of sustained) v.release(now());
  sustained.clear();
}

/** Lets go of everything (window lost focus, device unplugged). */
export function releaseAllLive(): void {
  for (const [id, note] of held) liveNoteOff(id.slice(0, id.lastIndexOf(':')), note.key);
  setSustain(false);
}
