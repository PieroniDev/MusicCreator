import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/liveInput', () => ({
  liveNoteOn: vi.fn(),
  liveNoteOff: vi.fn(),
  setSustain: vi.fn(),
  releaseAllLive: vi.fn(),
}));

const live = await import('../src/ui/liveInput');
const { handleMidiMessage } = await import('../src/audio/midi');

describe('MIDI input', () => {
  it('turns note on/off messages on any channel into live notes', () => {
    handleMidiMessage(new Uint8Array([0x93, 60, 127]), 'dev');
    expect(live.liveNoteOn).toHaveBeenCalledWith('dev', 60, 1);
    handleMidiMessage(new Uint8Array([0x83, 60, 40]), 'dev');
    expect(live.liveNoteOff).toHaveBeenCalledWith('dev', 60);
  });

  it('treats note on with velocity 0 as note off', () => {
    vi.mocked(live.liveNoteOff).mockClear();
    handleMidiMessage(new Uint8Array([0x90, 64, 0]), 'dev');
    expect(live.liveNoteOff).toHaveBeenCalledWith('dev', 64);
  });

  it('follows the sustain pedal and all-notes-off', () => {
    handleMidiMessage(new Uint8Array([0xb0, 64, 127]), 'dev');
    expect(live.setSustain).toHaveBeenLastCalledWith(true);
    handleMidiMessage(new Uint8Array([0xb0, 64, 0]), 'dev');
    expect(live.setSustain).toHaveBeenLastCalledWith(false);
    handleMidiMessage(new Uint8Array([0xb0, 123, 0]), 'dev');
    expect(live.releaseAllLive).toHaveBeenCalled();
  });

  it('ignores short or unrelated messages', () => {
    vi.mocked(live.liveNoteOn).mockClear();
    handleMidiMessage(new Uint8Array([0xf8]), 'dev');
    handleMidiMessage(new Uint8Array([0xe0, 0, 64]), 'dev');
    handleMidiMessage(null, 'dev');
    expect(live.liveNoteOn).not.toHaveBeenCalled();
  });
});
