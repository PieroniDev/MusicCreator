/**
 * Standard MIDI File (SMF) reading and writing, for exchanging notes with
 * other DAWs. Ticks are converted between the file's resolution and the
 * project's PPQ.
 */
import { PPQ } from './time';

export interface MidiNote {
  key: number;
  /** In project ticks. */
  start: number;
  length: number;
  /** 0..1 */
  velocity: number;
}

export interface MidiTrack {
  name: string;
  notes: MidiNote[];
  /** MIDI channel 0..15 the notes were on (9 is drums in General MIDI). */
  channel: number;
}

export interface MidiSong {
  bpm: number | null;
  tracks: MidiTrack[];
}

// ---------- writing ----------

function varLen(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

function text(s: string): number[] {
  return [...new TextEncoder().encode(s)];
}

function chunk(type: string, data: number[]): number[] {
  const n = data.length;
  return [...text(type), (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...data];
}

/** Writes a format 1 file: a tempo track, then one track per entry. */
export function writeMidi(song: { bpm: number; tracks: MidiTrack[] }): Uint8Array<ArrayBuffer> {
  const usPerQuarter = Math.round(60_000_000 / song.bpm);
  const tempoTrack = [
    0x00, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff,
    0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // 4/4
    0x00, 0xff, 0x2f, 0x00,
  ];
  const tracks = song.tracks.map((track) => {
    const ch = track.channel & 0x0f;
    const events: Array<{ tick: number; order: number; bytes: number[] }> = [];
    for (const n of track.notes) {
      const key = Math.min(127, Math.max(0, Math.round(n.key)));
      const vel = Math.min(127, Math.max(1, Math.round(n.velocity * 127)));
      const start = Math.round(n.start);
      events.push({ tick: start, order: 1, bytes: [0x90 | ch, key, vel] });
      // Note-offs sort before note-ons on the same tick so repeated notes don't cut each other.
      events.push({ tick: start + Math.max(1, Math.round(n.length)), order: 0, bytes: [0x80 | ch, key, 0] });
    }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const name = text(track.name);
    const data: number[] = [0x00, 0xff, 0x03, ...varLen(name.length), ...name];
    let last = 0;
    for (const e of events) {
      data.push(...varLen(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    data.push(0x00, 0xff, 0x2f, 0x00);
    return chunk('MTrk', data);
  });
  const header = chunk('MThd', [0x00, 0x01, ((tracks.length + 1) >> 8) & 0xff, (tracks.length + 1) & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff]);
  return new Uint8Array([...header, ...chunk('MTrk', tempoTrack), ...tracks.flat()]);
}

// ---------- reading ----------

class Reader {
  pos = 0;
  constructor(private readonly b: Uint8Array) {}
  get done() {
    return this.pos >= this.b.length;
  }
  u8() {
    if (this.pos >= this.b.length) throw new Error('Arquivo MIDI truncado.');
    return this.b[this.pos++];
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  u32() {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  str(n: number) {
    const s = new TextDecoder().decode(this.b.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
  varLen() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.u8();
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new Error('Número inválido no arquivo MIDI.');
  }
  skip(n: number) {
    this.pos += n;
  }
}

/** Reads notes, track names and the first tempo from a format 0 or 1 MIDI file. */
export function readMidi(bytes: Uint8Array): MidiSong {
  const r = new Reader(bytes);
  if (r.str(4) !== 'MThd') throw new Error('Não é um arquivo MIDI.');
  const headerLength = r.u32();
  r.u16(); // format
  const trackCount = r.u16();
  const division = r.u16();
  r.skip(headerLength - 6);
  if (division & 0x8000) throw new Error('Arquivos MIDI com tempo SMPTE não são suportados.');
  const scale = PPQ / division;

  let bpm: number | null = null;
  const tracks: MidiTrack[] = [];
  for (let t = 0; t < trackCount && !r.done; t++) {
    const type = r.str(4);
    const length = r.u32();
    const end = r.pos + length;
    if (type !== 'MTrk') {
      r.pos = end;
      continue;
    }
    let tick = 0;
    let status = 0;
    let name = '';
    // Held notes per channel+key; a stack so overlapping repeats pair up in order.
    const held = new Map<number, Array<{ start: number; velocity: number }>>();
    const byChannel = new Map<number, MidiNote[]>();
    const noteOff = (ch: number, key: number) => {
      const stack = held.get(ch * 128 + key);
      const on = stack?.shift();
      if (!on) return;
      const list = byChannel.get(ch) ?? [];
      list.push({ key, start: on.start * scale, length: Math.max(1, (tick - on.start) * scale), velocity: on.velocity });
      byChannel.set(ch, list);
    };
    while (r.pos < end) {
      tick += r.varLen();
      let b = r.u8();
      if (b === 0xff) {
        const meta = r.u8();
        const len = r.varLen();
        if (meta === 0x03 && !name) name = r.str(len);
        else if (meta === 0x51 && len === 3 && bpm === null) bpm = Math.round((60_000_000 / ((r.u8() << 16) | (r.u8() << 8) | r.u8())) * 100) / 100;
        else r.skip(len);
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        r.skip(r.varLen());
        continue;
      }
      // Running status: a data byte reuses the previous status.
      let data1: number;
      if (b < 0x80) {
        data1 = b;
        b = status;
      } else {
        status = b;
        data1 = -1;
      }
      const kind = b & 0xf0;
      const ch = b & 0x0f;
      const needsTwo = kind !== 0xc0 && kind !== 0xd0;
      const d1 = data1 >= 0 ? data1 : r.u8();
      const d2 = needsTwo ? r.u8() : 0;
      if (kind === 0x90 && d2 > 0) {
        const k = ch * 128 + d1;
        const stack = held.get(k) ?? [];
        stack.push({ start: tick, velocity: d2 / 127 });
        held.set(k, stack);
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        noteOff(ch, d1);
      }
    }
    r.pos = end;
    // Notes never released end with the track.
    for (const [k, stack] of held) while (stack.length) noteOff(Math.floor(k / 128), k % 128);
    const channels = [...byChannel.keys()].sort((a, b) => a - b);
    for (const ch of channels) {
      const notes = byChannel.get(ch)!.sort((a, b) => a.start - b.start);
      const label = name || `Faixa ${t + 1}`;
      tracks.push({ name: channels.length > 1 ? `${label} (canal ${ch + 1})` : label, channel: ch, notes });
    }
  }
  return { bpm, tracks };
}
