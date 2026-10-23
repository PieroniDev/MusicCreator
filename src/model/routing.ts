import type { MixerTrack } from './types';

/** Inserts reachable from `from` by following sends (not counting the master). */
function reachable(mixer: Pick<MixerTrack, 'sends'>[], from: number): Set<number> {
  const seen = new Set<number>();
  const stack = [from];
  while (stack.length) {
    const i = stack.pop()!;
    for (const s of mixer[i]?.sends ?? []) {
      if (!seen.has(s.to)) {
        seen.add(s.to);
        stack.push(s.to);
      }
    }
  }
  return seen;
}

/**
 * Whether insert `from` may send to insert `to`: both must be inserts (the
 * master is reached through `toMaster`), different, and the new route must not
 * close a loop, which would feed the signal back into itself.
 */
export function canRoute(mixer: Pick<MixerTrack, 'sends'>[], from: number, to: number): boolean {
  if (from <= 0 || to <= 0 || from === to || from >= mixer.length || to >= mixer.length) return false;
  return !reachable(mixer, to).has(from);
}
