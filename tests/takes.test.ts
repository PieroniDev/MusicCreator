import { describe, expect, it } from 'vitest';
import { splitTake } from '../src/model/takes';

describe('recording takes', () => {
  const linear = { u: 0, p0: 0, loopStart: 0, loopLength: 1e6, region: false };

  it('drops the audio captured before playback started', () => {
    expect(splitTake(1000, { ...linear, u: -10 }, 2)).toEqual([{ from: 20, to: 1000, at: 0 }]);
    expect(splitTake(10, { ...linear, u: -10 }, 2)).toEqual([]);
  });

  it('places a take where playback started', () => {
    expect(splitTake(1000, { ...linear, p0: 384, u: 5 }, 2)).toEqual([{ from: 0, to: 1000, at: 389 }]);
  });

  it('splits a loop-region recording into one take per pass', () => {
    // Loop over bars 3-4 (768..1536), recording from 1152 (halfway through), 2 frames per tick.
    const start = { u: 0, p0: 384, loopStart: 768, loopLength: 768, region: true };
    const segs = splitTake(2 * (384 + 768 + 200), start, 2);
    expect(segs).toEqual([
      { from: 0, to: 768, at: 1152 },
      { from: 768, to: 2304, at: 768 },
      { from: 2304, to: 2704, at: 768 },
    ]);
  });

  it('drops scraps after the last wrap but always keeps a take', () => {
    const start = { u: 0, p0: 0, loopStart: 0, loopLength: 100, region: true };
    expect(splitTake(205, start, 1, 10)).toEqual([
      { from: 0, to: 100, at: 0 },
      { from: 100, to: 200, at: 0 },
    ]);
    expect(splitTake(5, start, 1, 10)).toEqual([{ from: 0, to: 5, at: 0 }]);
  });

  it('starts counting passes after the pre-roll', () => {
    const start = { u: -4, p0: 0, loopStart: 0, loopLength: 100, region: true };
    expect(splitTake(150, start, 1)).toEqual([
      { from: 4, to: 104, at: 0 },
      { from: 104, to: 150, at: 0 },
    ]);
  });
});
