import type { Project } from './types';
import { hasTempoAutomation, tempoAt } from './automation';
import { PPQ, secondsPerTick } from './time';

/** Converts between song ticks and seconds when the tempo may change along the song. */
export interface TempoMap {
  /** Seconds from the song start to `tick`. */
  seconds(tick: number): number;
  /** The tick playing at `seconds` from the song start. */
  tick(seconds: number): number;
  bpmAt(tick: number): number;
}

/** The tempo is held constant over slices of this many ticks (a 64th note). */
const SLICE = 6;

/**
 * Tempo map of a project up to `endTick` (positions past it continue at the
 * last tempo). Without tempo automation (or with `automated` false, e.g. when
 * playing a single pattern) it is a plain linear conversion.
 */
export function buildTempoMap(project: Project, endTick: number, automated = hasTempoAutomation(project)): TempoMap {
  if (!automated) {
    const spt = secondsPerTick(project.bpm);
    return { seconds: (t) => t * spt, tick: (s) => s / spt, bpmAt: () => project.bpm };
  }
  const n = Math.max(1, Math.ceil(endTick / SLICE));
  const spts = new Float64Array(n);
  // starts[i]: seconds at the start of slice i.
  const starts = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    spts[i] = secondsPerTick(tempoAt(project, i * SLICE));
    starts[i + 1] = starts[i] + spts[i] * SLICE;
  }
  const end = n * SLICE;
  return {
    seconds(t) {
      if (t <= 0) return t * spts[0];
      if (t >= end) return starts[n] + (t - end) * spts[n - 1];
      const i = Math.floor(t / SLICE);
      return starts[i] + (t - i * SLICE) * spts[i];
    },
    tick(s) {
      if (s <= 0) return s / spts[0];
      if (s >= starts[n]) return end + (s - starts[n]) / spts[n - 1];
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= s) lo = mid;
        else hi = mid - 1;
      }
      return lo * SLICE + (s - starts[lo]) / spts[lo];
    },
    bpmAt(t) {
      const i = Math.min(n - 1, Math.max(0, Math.floor(t / SLICE)));
      return 60 / (spts[i] * PPQ);
    },
  };
}
