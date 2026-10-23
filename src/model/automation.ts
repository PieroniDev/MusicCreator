import type { AutomationClip, AutomationPoint, AutomationTarget, Project } from './types';
import type { ParamSpec } from '../plugins/params';
import { formatParam, normToValue, valueToNorm } from '../plugins/params';
import { getEffect, getInstrument } from '../plugins/registry';

/** Mixer fader law: gain 0..2 with 0 dB at about 70% of the travel. */
export function gainToFader(gain: number): number {
  return Math.sqrt(Math.max(0, gain) / 2);
}

export function faderToGain(pos: number): number {
  const p = Math.min(1, Math.max(0, pos));
  return p * p * 2;
}

export function formatDb(gain: number): string {
  if (gain <= 0.0001) return '-∞ dB';
  const db = 20 * Math.log10(gain);
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

const CHANNEL_VOLUME: ParamSpec = { id: 'volume', name: 'Volume', min: 0, max: 1.25, default: 0.78, unit: '%' };
const PAN: ParamSpec = { id: 'pan', name: 'Pan', min: -1, max: 1, default: 0 };

/** How a target maps the clip's 0..1 curve to real values, plus where its value lives now. */
export interface TargetInfo {
  label: string;
  toValue(norm: number): number;
  toNorm(value: number): number;
  format(value: number): string;
  /** The value currently stored in the project. */
  current: number;
}

function fromSpec(spec: ParamSpec, label: string, current: number): TargetInfo {
  return {
    label,
    toValue: (n) => normToValue(spec, n),
    toNorm: (v) => valueToNorm(spec, v),
    format: (v) => formatParam(spec, v),
    current,
  };
}

/** Describes a target, or returns null when what it points at no longer exists. */
export function describeTarget(project: Project, target: AutomationTarget): TargetInfo | null {
  switch (target.kind) {
    case 'channel': {
      const c = project.channels.find((x) => x.id === target.channelId);
      if (!c) return null;
      const spec = target.param === 'volume' ? CHANNEL_VOLUME : PAN;
      return fromSpec(spec, `${c.name} · ${spec.name}`, c[target.param]);
    }
    case 'instrument': {
      const c = project.channels.find((x) => x.id === target.channelId);
      const spec = c && getInstrument(c.instrument)?.params.find((p) => p.id === target.param);
      if (!c || !spec) return null;
      return fromSpec(spec, `${c.name} · ${spec.group ? `${spec.group} ` : ''}${spec.name}`, c.params[spec.id] ?? spec.default);
    }
    case 'mixer': {
      const t = project.mixer[target.track];
      if (!t) return null;
      const name = target.track === 0 ? 'Master' : `${target.track}. ${t.name}`;
      if (target.param === 'pan') return fromSpec(PAN, `${name} · Pan`, t.pan);
      return {
        label: `${name} · Volume`,
        toValue: faderToGain,
        toNorm: gainToFader,
        format: formatDb,
        current: t.volume,
      };
    }
    case 'effect': {
      const slot = project.mixer[target.track]?.effects.find((e) => e.id === target.slotId);
      const plugin = slot && getEffect(slot.plugin);
      const spec = plugin?.params.find((p) => p.id === target.param);
      if (!slot || !plugin || !spec) return null;
      const where = target.track === 0 ? 'Master' : `Insert ${target.track}`;
      return fromSpec(spec, `${plugin.name} (${where}) · ${spec.name}`, slot.params[spec.id] ?? spec.default);
    }
  }
}

/** Stable key identifying a target (two clips with the same key fight over one parameter). */
export function targetKey(target: AutomationTarget): string {
  switch (target.kind) {
    case 'channel': return `ch:${target.channelId}:${target.param}`;
    case 'instrument': return `in:${target.channelId}:${target.param}`;
    case 'mixer': return `mx:${target.track}:${target.param}`;
    case 'effect': return `fx:${target.track}:${target.slotId}:${target.param}`;
  }
}

/** Curve value (0..1) at `t` ticks into the clip: linear between points, flat outside them. */
export function curveAt(points: AutomationPoint[], t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (t <= b.t) {
      const a = points[i - 1];
      return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points[points.length - 1].v;
}

export interface AutomatedValue {
  target: AutomationTarget;
  value: number;
}

function activeClips(project: Project): AutomationClip[] {
  return project.playlist.clips.filter(
    (c): c is AutomationClip => c.kind === 'automation' && !project.playlist.tracks[c.track]?.mute,
  );
}

/**
 * Values of every automated parameter at a song position, keyed by target.
 * Only clips under the position count; a later clip wins over an earlier one.
 */
export function automationAt(project: Project, position: number): Map<string, AutomatedValue> {
  const out = new Map<string, AutomatedValue>();
  for (const clip of activeClips(project)) {
    if (position < clip.start || position >= clip.start + clip.length) continue;
    const info = describeTarget(project, clip.target);
    if (!info) continue;
    out.set(targetKey(clip.target), { target: clip.target, value: info.toValue(curveAt(clip.points, position - clip.start)) });
  }
  return out;
}

/** Instrument parameter values automated for one channel at a song position (for notes starting then). */
export function instrumentAutomationAt(project: Project, channelId: string, position: number): Record<string, number> | undefined {
  let out: Record<string, number> | undefined;
  for (const clip of activeClips(project)) {
    const t = clip.target;
    if (t.kind !== 'instrument' || t.channelId !== channelId) continue;
    if (position < clip.start || position >= clip.start + clip.length) continue;
    const info = describeTarget(project, t);
    if (!info) continue;
    (out ??= {})[t.param] = info.toValue(curveAt(clip.points, position - clip.start));
  }
  return out;
}

export function hasAutomation(project: Project): boolean {
  return project.playlist.clips.some((c) => c.kind === 'automation');
}

/** Whether a target still points at something that exists. */
export function targetExists(project: Project, target: AutomationTarget): boolean {
  return describeTarget(project, target) !== null;
}
