import { describe, expect, it } from 'vitest';
import { readMidi, writeMidi } from '../src/model/midiFile';

describe('MIDI files', () => {
  it('round-trips notes, track names and tempo', () => {
    const song = {
      bpm: 124,
      tracks: [
        { name: 'Baixo', channel: 0, notes: [{ key: 45, start: 0, length: 36, velocity: 0.85 }, { key: 45, start: 36, length: 36, velocity: 0.5 }] },
        { name: 'Acordes', channel: 1, notes: [{ key: 60, start: 0, length: 384, velocity: 1 }, { key: 64, start: 0, length: 384, velocity: 1 }] },
      ],
    };
    const back = readMidi(writeMidi(song));
    expect(back.bpm).toBeCloseTo(124, 1);
    expect(back.tracks.map((t) => t.name)).toEqual(['Baixo', 'Acordes']);
    expect(back.tracks[0].notes.map((n) => [n.key, n.start, n.length])).toEqual([
      [45, 0, 36],
      [45, 36, 36],
    ]);
    expect(back.tracks[0].notes[0].velocity).toBeCloseTo(0.85, 1);
    expect(back.tracks[1].notes).toHaveLength(2);
  });

  it('reads running status, note-on with velocity 0 and other resolutions', () => {
    // Format 0, 480 PPQ: C4 on, (running status) E4 on, C4 off via velocity 0, E4 off.
    const track = [
      0x00, 0x90, 60, 100,
      0x00, 64, 90,
      0x83, 0x60, 60, 0, // delta 480: C4 "on" with velocity 0 = off
      0x83, 0x60, 0x80, 64, 0, // delta 480
      0x00, 0xff, 0x2f, 0x00,
    ];
    const file = new Uint8Array([
      ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0],
      ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length],
      ...track,
    ]);
    const song = readMidi(file);
    expect(song.bpm).toBeNull();
    const notes = song.tracks[0].notes;
    expect(notes.map((n) => [n.key, n.start, n.length])).toEqual([
      [60, 0, 96],
      [64, 0, 192],
    ]);
  });

  it('splits tracks that use several MIDI channels', () => {
    const file = writeMidi({ bpm: 120, tracks: [{ name: 'X', channel: 9, notes: [{ key: 36, start: 0, length: 24, velocity: 1 }] }] });
    const song = readMidi(file);
    expect(song.tracks[0].channel).toBe(9);
  });

  it('rejects files that are not MIDI', () => {
    expect(() => readMidi(new TextEncoder().encode('hello world!'))).toThrow();
  });
});

describe('time signatures in MIDI files', () => {
  it('writes and reads the project signature', () => {
    const bytes = writeMidi({ bpm: 100, timeSig: { beats: 6, beatUnit: 8 }, tracks: [{ name: 'A', channel: 0, notes: [{ key: 60, start: 0, length: 24, velocity: 0.5 }] }] });
    expect(readMidi(bytes).timeSig).toEqual({ beats: 6, beatUnit: 8 });
    expect(readMidi(writeMidi({ bpm: 100, tracks: [] })).timeSig).toEqual({ beats: 4, beatUnit: 4 });
  });
});
