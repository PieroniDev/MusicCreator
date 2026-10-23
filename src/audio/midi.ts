import { create } from 'zustand';
import { liveNoteOff, liveNoteOn, releaseAllLive, setSustain } from '../ui/liveInput';

export interface MidiStatus {
  /** 'off' until the user turns MIDI on; 'unsupported' where the browser has no Web MIDI. */
  state: 'off' | 'on' | 'unsupported' | 'denied';
  inputs: string[];
}

export const useMidi = create<MidiStatus>(() => ({
  state: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'off' : 'unsupported',
  inputs: [],
}));

let access: MIDIAccess | null = null;

/** Decodes one MIDI message into live notes and the sustain pedal (any channel). */
export function handleMidiMessage(data: Uint8Array | null | undefined, source: string): void {
  if (!data || data.length < 2) return;
  const type = data[0] & 0xf0;
  const key = data[1];
  const value = data[2] ?? 0;
  if (type === 0x90 && value > 0) liveNoteOn(source, key, value / 127);
  else if (type === 0x80 || (type === 0x90 && value === 0)) liveNoteOff(source, key);
  else if (type === 0xb0 && key === 64) setSustain(value >= 64);
  else if (type === 0xb0 && (key === 120 || key === 123)) releaseAllLive();
}

function connectInputs(): void {
  if (!access) return;
  const names: string[] = [];
  access.inputs.forEach((input) => {
    names.push(input.name ?? 'MIDI');
    input.onmidimessage = (e) => handleMidiMessage(e.data, input.id);
  });
  useMidi.setState({ inputs: names });
}

/** Asks for MIDI access (a permission prompt in browsers) and listens to every keyboard. */
export async function enableMidi(): Promise<void> {
  if (access || useMidi.getState().state === 'unsupported') return;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    useMidi.setState({ state: 'denied' });
    return;
  }
  // Keyboards plugged in later are picked up too.
  access.onstatechange = () => connectInputs();
  connectInputs();
  useMidi.setState({ state: 'on' });
}
