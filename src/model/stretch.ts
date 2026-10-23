import type { StretchSettings } from './types';

export const STRETCH_PITCH_RANGE = 24;

/** How much faster than recorded the project tempo asks the sample to run. */
export function tempoRatio(stretch: StretchSettings | undefined, projectBpm: number): number {
  return stretch && stretch.bpm > 0 ? projectBpm / stretch.bpm : 1;
}

/** Seconds of the original sample that play per second of output. */
export function sourceSpeed(stretch: StretchSettings | undefined, projectBpm: number): number {
  if (!stretch) return 1;
  const ratio = tempoRatio(stretch, projectBpm);
  return stretch.mode === 'resample' ? ratio * Math.pow(2, stretch.pitch / 12) : ratio;
}

/**
 * Length factor of the time-stretched buffer in 'stretch' mode (it is then
 * played faster or slower by the pitch ratio, which restores the length).
 * 1 means no processing is needed.
 */
export function stretchFactor(stretch: StretchSettings | undefined, projectBpm: number): number {
  if (!stretch || stretch.mode !== 'stretch') return 1;
  const factor = Math.pow(2, stretch.pitch / 12) / tempoRatio(stretch, projectBpm);
  return Math.abs(factor - 1) < 1e-3 ? 1 : factor;
}

/**
 * Guesses the tempo of a loop from its length: the number of beats (a power
 * of two) whose tempo falls in a usual range, closest to the project tempo.
 */
export function guessBpm(duration: number, projectBpm: number): number {
  if (duration <= 0) return projectBpm;
  let best = projectBpm;
  let bestDistance = Infinity;
  for (let beats = 1; beats <= 256; beats *= 2) {
    const bpm = (beats * 60) / duration;
    if (bpm < 60 || bpm > 200) continue;
    const distance = Math.abs(Math.log2(bpm / projectBpm));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = bpm;
    }
  }
  return Math.round(best * 100) / 100;
}
