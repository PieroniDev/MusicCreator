import { describe, expect, it } from 'vitest';
import { wsola } from '../src/audio/stretch';
import { guessBpm, sourceSpeed, stretchFactor, tempoRatio } from '../src/model/stretch';

const SR = 44100;

function sine(freq: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

/** Frequency from the rate of rising zero crossings, away from the edges. */
function frequencyOf(data: Float32Array): number {
  const from = Math.floor(data.length * 0.1);
  const to = Math.floor(data.length * 0.9);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (data[i - 1] < 0 && data[i] >= 0) crossings++;
  return crossings / ((to - from) / SR);
}

describe('wsola', () => {
  it('changes the length and keeps the pitch', () => {
    for (const factor of [0.5, 0.8, 1.25, 2]) {
      const [out] = wsola([sine(440, 2)], factor, SR);
      expect(out.length).toBe(Math.round(2 * SR * factor));
      expect(frequencyOf(out)).toBeGreaterThan(430);
      expect(frequencyOf(out)).toBeLessThan(450);
    }
  });

  it('keeps the level steady (no amplitude holes between frames)', () => {
    const [out] = wsola([sine(220, 2)], 1.5, SR);
    let min = Infinity;
    let max = 0;
    const block = 2048;
    for (let b = 2; b < out.length / block - 2; b++) {
      let peak = 0;
      for (let i = b * block; i < (b + 1) * block; i++) peak = Math.max(peak, Math.abs(out[i]));
      min = Math.min(min, peak);
      max = Math.max(max, peak);
    }
    expect(min).toBeGreaterThan(0.4);
    expect(max).toBeLessThan(0.6);
  });

  it('moves attacks to their stretched positions', () => {
    const input = new Float32Array(SR * 2);
    // A short burst every half second.
    for (let t = 0; t < 4; t++) for (let i = 0; i < 200; i++) input[t * SR * 0.5 + i] = Math.sin(i * 0.3) * (1 - i / 200);
    const [out] = wsola([input], 2, SR);
    for (let t = 1; t < 4; t++) {
      const expected = t * SR; // every second after stretching by 2
      let peakAt = 0;
      let peak = 0;
      for (let i = expected - 4000; i < expected + 4000; i++) {
        if (Math.abs(out[i]) > peak) {
          peak = Math.abs(out[i]);
          peakAt = i;
        }
      }
      expect(peak).toBeGreaterThan(0.3);
      expect(Math.abs(peakAt - expected) / SR).toBeLessThan(0.03);
    }
  });

  it('handles every channel and very short input', () => {
    const out = wsola([sine(440, 1), sine(660, 1)], 1.2, SR);
    expect(out).toHaveLength(2);
    expect(Math.abs(frequencyOf(out[1]) - 660)).toBeLessThan(12);
    const [tiny] = wsola([new Float32Array(100).fill(0.25)], 2, SR);
    expect(tiny.length).toBe(200);
    expect(tiny[150]).toBeCloseTo(0.25);
  });
});

describe('stretch settings', () => {
  it('follows the project tempo only when the sample tempo is known', () => {
    expect(tempoRatio(undefined, 140)).toBe(1);
    expect(tempoRatio({ mode: 'stretch', pitch: 0, bpm: 0 }, 140)).toBe(1);
    expect(tempoRatio({ mode: 'stretch', pitch: 0, bpm: 70 }, 140)).toBe(2);
  });

  it('resample couples speed and pitch; stretch keeps them apart', () => {
    const resample = { mode: 'resample' as const, pitch: 12, bpm: 100 };
    expect(sourceSpeed(resample, 100)).toBeCloseTo(2);
    expect(stretchFactor(resample, 100)).toBe(1);
    const stretch = { mode: 'stretch' as const, pitch: 12, bpm: 100 };
    expect(sourceSpeed(stretch, 100)).toBe(1);
    // Twice as long, then played an octave up: same length, octave higher.
    expect(stretchFactor(stretch, 100)).toBeCloseTo(2);
    expect(stretchFactor({ mode: 'stretch', pitch: 0, bpm: 120 }, 120)).toBe(1);
    expect(stretchFactor({ mode: 'stretch', pitch: 0, bpm: 120 }, 60)).toBeCloseTo(2);
  });

  it('guesses a loop tempo from its length', () => {
    // 2 bars of 4/4 at 128 BPM.
    expect(guessBpm((8 * 60) / 128, 120)).toBeCloseTo(128, 1);
    // 1 bar at 90 BPM could also be 2 bars at 180: the tempo nearer the project wins.
    expect(guessBpm((4 * 60) / 90, 100)).toBeCloseTo(90, 1);
    expect(guessBpm((4 * 60) / 90, 170)).toBeCloseTo(180, 1);
    expect(guessBpm(0, 130)).toBe(130);
  });
});
