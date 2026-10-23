import { describe, expect, it } from 'vitest';
import { canRoute } from '../src/model/routing';

const mixer = (sends: Record<number, number[]>, size = 6) =>
  Array.from({ length: size }, (_, i) => ({ sends: (sends[i] ?? []).map((to) => ({ to, level: 1 })) }));

describe('canRoute', () => {
  it('allows routes between different inserts', () => {
    expect(canRoute(mixer({}), 1, 2)).toBe(true);
  });

  it('never routes to or from the master, to itself or out of range', () => {
    const m = mixer({});
    expect(canRoute(m, 0, 2)).toBe(false);
    expect(canRoute(m, 2, 0)).toBe(false);
    expect(canRoute(m, 3, 3)).toBe(false);
    expect(canRoute(m, 1, 9)).toBe(false);
  });

  it('refuses routes that would close a loop, directly or through other inserts', () => {
    expect(canRoute(mixer({ 2: [1] }), 1, 2)).toBe(false);
    expect(canRoute(mixer({ 2: [3], 3: [1] }), 1, 2)).toBe(false);
    expect(canRoute(mixer({ 2: [3] }), 1, 2)).toBe(true);
  });
});
