import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../src/model/defaults';
import { describeTarget, hasTempoAutomation, tempoAt, TEMPO_SPEC } from '../src/model/automation';
import { buildTempoMap } from '../src/model/tempo';
import { valueToNorm } from '../src/plugins/params';
import type { Project } from '../src/model/types';

/** A project at 120 BPM whose tempo automation ramps from `from` to `to` BPM over 4 bars. */
function ramp(from: number, to: number): Project {
  const p = createEmptyProject();
  p.bpm = 120;
  p.playlist.clips.push({
    id: 'a',
    kind: 'automation',
    target: { kind: 'tempo' },
    track: 0,
    start: 0,
    length: 1536,
    points: [
      { t: 0, v: valueToNorm(TEMPO_SPEC, from) },
      { t: 1536, v: valueToNorm(TEMPO_SPEC, to) },
    ],
  });
  return p;
}

describe('tempo automation', () => {
  it('describes the tempo target and reads the tempo along the clip', () => {
    const p = ramp(100, 200);
    expect(describeTarget(p, { kind: 'tempo' })?.label).toBe('Andamento (BPM)');
    expect(hasTempoAutomation(p)).toBe(true);
    expect(tempoAt(p, 0)).toBeCloseTo(100);
    expect(tempoAt(p, 768)).toBeCloseTo(150);
    // Outside the clip the project tempo applies.
    expect(tempoAt(p, 5000)).toBe(120);
    p.playlist.tracks[0].mute = true;
    expect(hasTempoAutomation(p)).toBe(false);
    expect(tempoAt(p, 0)).toBe(120);
  });

  it('is a plain conversion without tempo automation', () => {
    const map = buildTempoMap(createEmptyProject(), 384);
    const spt = 60 / 130 / 96;
    expect(map.seconds(384)).toBeCloseTo(384 * spt);
    expect(map.tick(1)).toBeCloseTo(1 / spt);
    expect(map.bpmAt(100)).toBe(130);
  });

  it('integrates a changing tempo and inverts it', () => {
    const constant = buildTempoMap(ramp(150, 150), 1536);
    // 4 bars at 150 BPM: 16 beats of 0.4 s.
    expect(constant.seconds(1536)).toBeCloseTo(6.4, 2);
    const up = buildTempoMap(ramp(100, 200), 1536);
    // Faster towards the end: shorter than at 100 BPM (9.6 s), longer than at 200 (4.8 s).
    const total = up.seconds(1536);
    expect(total).toBeGreaterThan(4.8);
    expect(total).toBeLessThan(9.6);
    // Exact integral of 60/(PPQ·bpm(t)) for a linear ramp: 60·16/(100) · ln(2) = 6.654 s.
    expect(total).toBeCloseTo((60 * 16 * Math.LN2) / 100, 1);
    for (const t of [0, 100, 777, 1500, 2000]) expect(up.tick(up.seconds(t))).toBeCloseTo(t, 6);
    // Past the end the last tempo continues.
    expect(up.seconds(1536 + 96) - up.seconds(1536)).toBeCloseTo(60 / 200, 2);
    expect(up.bpmAt(1530)).toBeGreaterThan(195);
  });

  it('can be ignored (pattern mode)', () => {
    const map = buildTempoMap(ramp(100, 200), 1536, false);
    expect(map.seconds(96)).toBeCloseTo(0.5);
  });
});
