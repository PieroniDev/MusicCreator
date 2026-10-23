import { describe, expect, it } from 'vitest';
import type { AutomationClip, Project } from '../src/model/types';
import { createDemoProject } from '../src/model/defaults';
import { automationAt, curveAt, describeTarget, faderToGain, gainToFader, instrumentAutomationAt, targetKey } from '../src/model/automation';
import { TICKS_PER_BAR } from '../src/model/time';

function withClip(project: Project, clip: Omit<AutomationClip, 'id' | 'kind'>): AutomationClip {
  const full: AutomationClip = { id: `a${project.playlist.clips.length}`, kind: 'automation', ...clip };
  project.playlist.clips.push(full);
  return full;
}

describe('automation curves', () => {
  const points = [
    { t: 0, v: 0 },
    { t: 100, v: 1 },
    { t: 200, v: 0.5 },
  ];

  it('interpolates linearly between points and holds outside them', () => {
    expect(curveAt(points, -10)).toBe(0);
    expect(curveAt(points, 50)).toBeCloseTo(0.5);
    expect(curveAt(points, 150)).toBeCloseTo(0.75);
    expect(curveAt(points, 500)).toBe(0.5);
    expect(curveAt([{ t: 10, v: 0.3 }], 0)).toBe(0.3);
  });

  it('jumps on two points at the same time', () => {
    const step = [
      { t: 0, v: 0 },
      { t: 50, v: 0 },
      { t: 50, v: 1 },
    ];
    expect(curveAt(step, 49)).toBe(0);
    expect(curveAt(step, 50)).toBe(0);
    expect(curveAt(step, 51)).toBe(1);
  });

  it('uses the fader law for mixer volume', () => {
    expect(faderToGain(gainToFader(0.8))).toBeCloseTo(0.8);
    expect(faderToGain(1)).toBe(2);
    const project = createDemoProject();
    const info = describeTarget(project, { kind: 'mixer', track: 0, param: 'volume' })!;
    expect(info.toValue(gainToFader(1))).toBeCloseTo(1);
    expect(info.current).toBe(project.mixer[0].volume);
  });
});

describe('automationAt', () => {
  it('reports values of clips under the position, mapped through the param range', () => {
    const project = createDemoProject();
    const bass = project.channels.find((c) => c.name === 'Baixo')!;
    withClip(project, {
      track: 8,
      start: TICKS_PER_BAR,
      length: TICKS_PER_BAR,
      target: { kind: 'channel', channelId: bass.id, param: 'pan' },
      points: [
        { t: 0, v: 0 },
        { t: TICKS_PER_BAR, v: 1 },
      ],
    });
    expect(automationAt(project, 0).size).toBe(0);
    const mid = automationAt(project, TICKS_PER_BAR * 1.5);
    const value = mid.get(targetKey({ kind: 'channel', channelId: bass.id, param: 'pan' }));
    expect(value?.value).toBeCloseTo(0); // halfway from -1 to 1
    expect(automationAt(project, TICKS_PER_BAR * 2).size).toBe(0);
  });

  it('ignores clips on muted playlist tracks', () => {
    const project = createDemoProject();
    withClip(project, { track: 8, start: 0, length: TICKS_PER_BAR, target: { kind: 'mixer', track: 1, param: 'pan' }, points: [{ t: 0, v: 1 }] });
    project.playlist.tracks[8].mute = true;
    expect(automationAt(project, 10).size).toBe(0);
  });

  it('gives instrument params per channel for notes starting at a position', () => {
    const project = createDemoProject();
    const bass = project.channels.find((c) => c.name === 'Baixo')!;
    withClip(project, {
      track: 8,
      start: 0,
      length: TICKS_PER_BAR,
      target: { kind: 'instrument', channelId: bass.id, param: 'cutoff' },
      points: [{ t: 0, v: 0 }],
    });
    expect(instrumentAutomationAt(project, bass.id, 10)).toEqual({ cutoff: 20 });
    expect(instrumentAutomationAt(project, project.channels[0].id, 10)).toBeUndefined();
  });

  it('describes nothing for deleted targets', () => {
    const project = createDemoProject();
    expect(describeTarget(project, { kind: 'channel', channelId: 'gone', param: 'volume' })).toBeNull();
    expect(describeTarget(project, { kind: 'effect', track: 1, slotId: 'gone', param: 'mix' })).toBeNull();
    expect(describeTarget(project, { kind: 'instrument', channelId: project.channels[0].id, param: 'nope' })).toBeNull();
  });
});
