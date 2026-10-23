import type { PlayMode, Project } from '../model/types';
import { AudioGraph } from './graph';
import { patternEvents, songEvents } from '../model/events';
import { findPattern, patternLength, songLength } from '../model/pattern';
import { secondsPerTick } from '../model/time';

export interface RenderOptions {
  mode: PlayMode;
  patternId: string | null;
  sampleRate?: number;
  /** Extra seconds after the end so reverb and delay tails ring out. */
  tail?: number;
  onProgress?: (fraction: number) => void;
}

/** Notes are scheduled in chunks so long songs don't build every voice up front. */
const CHUNK_SECONDS = 4;

/** Renders the song (or one pattern) offline, faster than real time. */
export async function renderProject(project: Project, options: RenderOptions): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100;
  const tail = options.tail ?? 2.5;
  const spt = secondsPerTick(project.bpm);
  const pattern = findPattern(project, options.patternId) ?? project.patterns[0];
  const lengthTicks = options.mode === 'song' ? songLength(project) : pattern ? patternLength(pattern) : 0;
  const events =
    options.mode === 'song'
      ? songEvents(project, 0, lengthTicks)
      : pattern
        ? patternEvents(project, pattern.id, 0, lengthTicks)
        : [];
  const duration = lengthTicks * spt + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const graph = new AudioGraph(ctx);
  await graph.loadSamples(project);
  graph.sync(project);

  let next = 0;
  const scheduleUntil = (seconds: number) => {
    while (next < events.length && events[next].start * spt < seconds) {
      const ev = events[next++];
      if (graph.isChannelAudible(ev.channelId)) {
        graph.playNote(ev.channelId, ev.key, ev.velocity, ev.start * spt, ev.length * spt);
      }
    }
  };
  scheduleUntil(CHUNK_SECONDS);
  for (let t = CHUNK_SECONDS / 2; t < duration; t += CHUNK_SECONDS) {
    const at = t;
    // suspend() needs a time quantized to the render block; round down to one.
    const when = Math.floor((at * sampleRate) / 128) * 128 / sampleRate;
    void ctx.suspend(when).then(() => {
      scheduleUntil(at + CHUNK_SECONDS);
      options.onProgress?.(Math.min(1, at / duration));
      void ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  options.onProgress?.(1);
  graph.dispose();
  return buffer;
}
