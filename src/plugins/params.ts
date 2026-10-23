import type { ParamValues } from '../model/types';

export type ParamScale = 'linear' | 'log';

export interface ParamSpec {
  id: string;
  name: string;
  min: number;
  max: number;
  default: number;
  /** Quantization step; 1 for integer params. */
  step?: number;
  scale?: ParamScale;
  unit?: string;
  /** Labels for enum params (value = option index). */
  options?: string[];
  /** Used to lay out the plugin editor. */
  group?: string;
}

export interface Preset {
  name: string;
  params: ParamValues;
}

export function clampParam(spec: ParamSpec, value: number): number {
  let v = Math.min(spec.max, Math.max(spec.min, value));
  if (spec.options) v = Math.round(v);
  else if (spec.step) {
    // Trim float noise (0.1 * 3 = 0.30000000000000004) to the step's precision.
    const decimals = Math.max(0, 1 - Math.floor(Math.log10(spec.step)));
    v = Number((Math.round(v / spec.step) * spec.step).toFixed(decimals));
  }
  return v;
}

/** Knob position 0..1 → value. */
export function normToValue(spec: ParamSpec, norm: number): number {
  const n = Math.min(1, Math.max(0, norm));
  if (spec.scale === 'log' && spec.min > 0) {
    return clampParam(spec, spec.min * Math.pow(spec.max / spec.min, n));
  }
  return clampParam(spec, spec.min + n * (spec.max - spec.min));
}

/** Value → knob position 0..1. */
export function valueToNorm(spec: ParamSpec, value: number): number {
  const v = Math.min(spec.max, Math.max(spec.min, value));
  if (spec.scale === 'log' && spec.min > 0) {
    return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
  }
  if (spec.max === spec.min) return 0;
  return (v - spec.min) / (spec.max - spec.min);
}

export function formatParam(spec: ParamSpec, value: number): string {
  if (spec.options) return spec.options[Math.round(value)] ?? String(value);
  const unit = spec.unit ?? '';
  if (unit === 'Hz' && value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz`;
  if (unit === 's' && value < 1) return `${Math.round(value * 1000)} ms`;
  if (unit === '%') return `${Math.round(value * 100)}%`;
  const abs = Math.abs(value);
  const digits = spec.step === 1 ? 0 : abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const text = value.toFixed(digits);
  return unit ? `${text} ${unit}` : text;
}

export function defaultParams(specs: ParamSpec[]): ParamValues {
  const out: ParamValues = {};
  for (const s of specs) out[s.id] = s.default;
  return out;
}

/** Fills missing params with defaults and clamps known ones; drops unknown keys. */
export function normalizeParams(specs: ParamSpec[], values: ParamValues | undefined): ParamValues {
  const out: ParamValues = {};
  for (const s of specs) {
    const v = values?.[s.id];
    out[s.id] = typeof v === 'number' && Number.isFinite(v) ? clampParam(s, v) : s.default;
  }
  return out;
}

/** Reads a param with a fallback to its spec default, so DSP code never sees undefined. */
export function paramReader(specs: ParamSpec[], values: ParamValues) {
  const defaults = defaultParams(specs);
  return (id: string): number => {
    const v = values[id];
    return typeof v === 'number' ? v : (defaults[id] ?? 0);
  };
}
