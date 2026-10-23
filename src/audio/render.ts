import type { PlayMode, Project } from '../model/types';
import { AudioGraph } from './graph';
import { patternEvents, songAudioEvents, songEvents, swingDelay } from '../model/events';
import { automationAt, hasAutomation, instrumentAutomationAt } from '../model/automation';
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
/** How often automation is re-evaluated (matches the live engine's ~25 ms). */
const AUTOMATION_STEP = 0.02;

/** Renders the song (or one pattern) offline, faster than real time. */
export async function renderProject(project: Project, options: RenderOptions): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100;
  const tail = options.tail ?? 2.5;
  const spt = secondsPerTick(project.bpm);
  const song = options.mode === 'song';
  const pattern = findPattern(project, options.patternId) ?? project.patterns[0];
  const lengthTicks = song ? songLength(project) : pattern ? patternLength(pattern) : 0;
  const notes = song ? songEvents(project, 0, lengthTicks) : pattern ? patternEvents(project, pattern.id, 0, lengthTicks) : [];
  const clips = song ? songAudioEvents(project, 0, lengthTicks) : [];
  const automated = song && hasAutomation(project);
  const duration = lengthTicks * spt + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const graph = new AudioGraph(ctx);
  await graph.loadSamples(project);
  graph.sync(project);

  let nextNote = 0;
  let nextClip = 0;
  const scheduleUntil = (seconds: number) => {
    while (nextNote < notes.length && notes[nextNote].start * spt < seconds) {
      const ev = notes[nextNote++];
      if (!graph.isChannelAudible(ev.channelId)) continue;
      const params = automated ? instrumentAutomationAt(project, ev.channelId, ev.start) : undefined;
      graph.playNote(ev.channelId, ev.key, ev.velocity, (ev.start + swingDelay(ev.start, project.swing)) * spt, ev.length * spt, params);
    }
    while (nextClip < clips.length && clips[nextClip].start * spt < seconds) {
      const ev = clips[nextClip++];
      if (graph.isChannelAudible(ev.channelId)) graph.playClip(ev.channelId, ev.start * spt, ev.sampleOffset, ev.length * spt);
    }
  };
  if (automated) graph.setAutomation(automationAt(project, 0));
  scheduleUntil(CHUNK_SECONDS);

  // suspend() needs times on render-block boundaries, each used only once.
  const block = 128 / sampleRate;
  const step = automated ? AUTOMATION_STEP : CHUNK_SECONDS / 2;
  let lastBlock = 0;
  for (let t = step; t < duration; t += step) {
    const at = Math.floor(t / block) * block;
    if (at <= lastBlock) continue;
    lastBlock = at;
    void ctx.suspend(at).then(() => {
      scheduleUntil(at + CHUNK_SECONDS);
      if (automated) graph.setAutomation(automationAt(project, at / spt));
      options.onProgress?.(Math.min(1, at / duration));
      void ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  options.onProgress?.(1);
  graph.dispose();
  return buffer;
}
