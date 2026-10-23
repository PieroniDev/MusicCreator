import { describe, expect, it } from 'vitest';
import { createDemoProject, MIXER_INSERTS, PLAYLIST_TRACKS } from '../src/model/defaults';
import { parseProject, serializeProject } from '../src/model/serialize';

describe('project files', () => {
  it('round-trips the demo project unchanged', () => {
    const demo = createDemoProject();
    const parsed = parseProject(JSON.parse(serializeProject(demo)));
    expect(parsed).toEqual(demo);
  });

  it('rejects things that are not projects', () => {
    expect(() => parseProject(null)).toThrow();
    expect(() => parseProject({ hello: 'world' })).toThrow();
    expect(() => parseProject([1, 2])).toThrow();
  });

  it('repairs or drops invalid parts instead of failing', () => {
    const project = parseProject({
      name: 42,
      bpm: 9999,
      channels: [{ id: 'c1', instrument: 'does-not-exist', params: { cutoff: 1e9, bogus: 1 }, volume: 7, mixerTrack: 500 }, 'junk'],
      patterns: [
        {
          id: 'p1',
          notes: {
            c1: [{ key: 300, start: -5, length: 10, velocity: 2 }, { key: 60, start: 0, length: 0 }],
            missingChannel: [{ key: 60, start: 0, length: 10 }],
          },
        },
      ],
      playlist: { clips: [{ patternId: 'p1', track: 99, start: 0, length: 384 }, { patternId: 'nope', start: 0 }] },
      mixer: [{ effects: [{ plugin: 'reverb', params: { mix: 5 } }, { plugin: 'unknown' }] }],
    });

    expect(project.name).toBe('Sem título');
    expect(project.bpm).toBe(400);
    expect(project.channels).toHaveLength(1);
    const channel = project.channels[0];
    expect(channel.instrument).toBe('trio');
    expect(channel.params.cutoff).toBe(20000);
    expect(channel.params).not.toHaveProperty('bogus');
    expect(channel.volume).toBe(1.25);
    expect(channel.mixerTrack).toBe(MIXER_INSERTS);

    const notes = project.patterns[0].notes;
    expect(Object.keys(notes)).toEqual(['c1']);
    expect(notes.c1).toEqual([{ id: expect.any(String), key: 127, start: 0, length: 10, velocity: 1 }]);

    expect(project.playlist.tracks).toHaveLength(PLAYLIST_TRACKS);
    expect(project.playlist.clips).toHaveLength(1);
    expect(project.playlist.clips[0].track).toBe(PLAYLIST_TRACKS - 1);

    expect(project.mixer).toHaveLength(MIXER_INSERTS + 1);
    expect(project.mixer[0].effects.map((e) => e.plugin)).toEqual(['reverb']);
    expect(project.mixer[0].effects[0].params.mix).toBe(1);
  });

  it('drops sample references whose data is missing', () => {
    const demo = createDemoProject();
    demo.channels[0].sampleId = 'gone';
    expect(parseProject(JSON.parse(serializeProject(demo))).channels[0].sampleId).toBeUndefined();
  });
});

describe('project files with clips, routing and swing', () => {
  it('round-trips audio and automation clips, sends and swing', () => {
    const demo = createDemoProject();
    const bass = demo.channels[4];
    demo.swing = 0.4;
    demo.mixer[5].sends = [{ to: 6, level: 0.5 }];
    demo.mixer[5].toMaster = false;
    demo.playlist.clips.push(
      { id: 'au', kind: 'audio', channelId: bass.id, track: 5, start: 0, length: 384, offset: 1.25 },
      {
        id: 'au2',
        kind: 'automation',
        track: 6,
        start: 0,
        length: 768,
        target: { kind: 'mixer', track: 5, param: 'volume' },
        points: [
          { t: 0, v: 0.2 },
          { t: 768, v: 0.9 },
        ],
      },
    );
    expect(parseProject(JSON.parse(serializeProject(demo)))).toEqual(demo);
  });

  it('reads clips saved before clip kinds existed as pattern clips', () => {
    const demo = createDemoProject();
    const raw = JSON.parse(serializeProject(demo));
    for (const c of raw.playlist.clips) delete c.kind;
    delete raw.swing;
    const parsed = parseProject(raw);
    expect(parsed.playlist.clips.every((c) => c.kind === 'pattern')).toBe(true);
    expect(parsed.swing).toBe(0);
    expect(parsed.mixer[1].toMaster).toBe(true);
  });

  it('drops looping sends and automation of things that do not exist', () => {
    const demo = createDemoProject();
    const raw = JSON.parse(serializeProject(demo));
    raw.mixer[1].sends = [{ to: 2, level: 1 }, { to: 1, level: 1 }, { to: 0, level: 1 }, { to: 99, level: 1 }];
    raw.mixer[2].sends = [{ to: 1, level: 1 }];
    raw.playlist.clips.push(
      { kind: 'automation', track: 0, start: 0, length: 384, target: { kind: 'channel', channelId: 'gone', param: 'volume' }, points: [] },
      { kind: 'automation', track: 0, start: 0, length: 384, target: { kind: 'mixer', track: 1, param: 'pan' }, points: [{ t: 9999, v: 7 }] },
      { kind: 'audio', channelId: 'gone', track: 0, start: 0, length: 10 },
      { kind: 'mystery', track: 0, start: 0, length: 10 },
    );
    const parsed = parseProject(raw);
    expect(parsed.mixer[1].sends).toEqual([{ to: 2, level: 1 }]);
    expect(parsed.mixer[2].sends).toEqual([]);
    const automation = parsed.playlist.clips.filter((c) => c.kind === 'automation');
    expect(automation).toHaveLength(1);
    expect(automation[0].kind === 'automation' && automation[0].points).toEqual([{ t: 384, v: 1 }]);
    expect(parsed.playlist.clips.some((c) => c.kind === 'audio')).toBe(false);
  });
});

describe('drum pads in project files', () => {
  it('keeps pad samples and empties pads whose sample is missing', () => {
    const demo = createDemoProject();
    demo.samples.s1 = { id: 's1', name: 'kick.wav', data: 'AAAA' };
    demo.channels[0].pads = ['s1', 'gone', ...Array.from({ length: 14 }, () => null)];
    const parsed = parseProject(JSON.parse(serializeProject(demo)));
    expect(parsed.channels[0].pads?.slice(0, 3)).toEqual(['s1', null, null]);
    expect(parsed.channels[1].pads).toBeUndefined();
  });
});
