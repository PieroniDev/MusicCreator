import { describe, expect, it } from 'vitest';
import type { ParamSpec } from '../src/plugins/params';
import { clampParam, formatParam, normalizeParams, normToValue, valueToNorm } from '../src/plugins/params';
import { EFFECTS, INSTRUMENTS } from '../src/plugins/registry';

const cutoff: ParamSpec = { id: 'cutoff', name: 'Cutoff', min: 20, max: 20000, default: 1000, scale: 'log', unit: 'Hz' };
const wave: ParamSpec = { id: 'wave', name: 'Wave', min: 0, max: 3, default: 0, options: ['a', 'b', 'c', 'd'] };

describe('param mapping', () => {
  it('maps log params geometrically and back', () => {
    expect(normToValue(cutoff, 0)).toBeCloseTo(20);
    expect(normToValue(cutoff, 1)).toBeCloseTo(20000);
    expect(normToValue(cutoff, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000));
    expect(valueToNorm(cutoff, normToValue(cutoff, 0.3))).toBeCloseTo(0.3);
  });

  it('rounds enum params and clamps out-of-range values', () => {
    expect(clampParam(wave, 2.4)).toBe(2);
    expect(clampParam(wave, 9)).toBe(3);
    expect(formatParam(wave, 1)).toBe('b');
    expect(formatParam(cutoff, 2500)).toBe('2.50 kHz');
  });

  it('fills defaults and drops unknown keys', () => {
    expect(normalizeParams([cutoff, wave], { cutoff: 5, extra: 1 })).toEqual({ cutoff: 20, wave: 0 });
  });
});

describe('native plugins', () => {
  for (const plugin of [...INSTRUMENTS, ...EFFECTS]) {
    it(`${plugin.name}: defaults and presets stay inside the param ranges`, () => {
      const ids = new Set(plugin.params.map((p) => p.id));
      expect(ids.size).toBe(plugin.params.length);
      for (const spec of plugin.params) {
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
        if (spec.options) expect(spec.options).toHaveLength(spec.max - spec.min + 1);
      }
      expect(plugin.presets.length).toBeGreaterThan(0);
      for (const preset of plugin.presets) {
        for (const [id, value] of Object.entries(preset.params)) {
          const spec = plugin.params.find((p) => p.id === id);
          expect(spec, `${preset.name}: unknown param ${id}`).toBeDefined();
          expect(value, `${preset.name}.${id}`).toBeGreaterThanOrEqual(spec!.min);
          expect(value, `${preset.name}.${id}`).toBeLessThanOrEqual(spec!.max);
        }
      }
    });
  }
});
