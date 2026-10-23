import { describe, expect, it } from 'vitest';
import { encodeWav, peakLevel } from '../src/audio/wav';

function fakeBuffer(channels: number[][], sampleRate = 44100) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    getChannelData: (c: number) => Float32Array.from(channels[c]),
  };
}

describe('encodeWav', () => {
  it('writes a valid 16-bit PCM header and interleaved samples', () => {
    const wav = new DataView(encodeWav(fakeBuffer([[0, 1, -1], [0.5, 2, -2]])));
    const text = (o: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => wav.getUint8(o + i)));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(wav.getUint16(20, true)).toBe(1);
    expect(wav.getUint16(22, true)).toBe(2);
    expect(wav.getUint32(24, true)).toBe(44100);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(3 * 2 * 2);
    expect(wav.byteLength).toBe(44 + 12);
    const samples = Array.from({ length: 6 }, (_, i) => wav.getInt16(44 + i * 2, true));
    // L0 R0 L1 R1 L2 R2, out-of-range values clipped.
    expect(samples).toEqual([0, 16383, 32767, 32767, -32768, -32768]);
  });

  it('measures the peak level', () => {
    expect(peakLevel(fakeBuffer([[0.1, -0.7], [0.3, 0.2]]))).toBeCloseTo(0.7);
  });
});
