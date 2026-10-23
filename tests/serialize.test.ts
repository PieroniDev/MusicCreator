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
