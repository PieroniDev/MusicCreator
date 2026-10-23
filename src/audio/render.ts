import type { PlayMode, Project } from '../model/types';
import { AudioGraph } from './graph';
import { patternEvents, songAudioEvents, songEvents, swingDelay } from '../model/events';
import { automationAt, hasAutomation, hasTempoAutomation, instrumentAutomationAt } from '../model/automation';
import { buildTempoMap } from '../model/tempo';
import { findPattern, patternLength, songLength } from '../model/pattern';
import { barTicks, secondsPerTick } from '../model/time';
import { stretchFactor } from '../model/stretch';
import { getDecodedSample } from './samples';
import { whenStretched } from './stretch';

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
/**
 * Silence rendered before the song and cut off afterwards: Chromium's
 * DynamicsCompressorNode (compressor, limiter) mutes its first few
 * milliseconds and needs ~0.2 s to settle, which would swallow the first hit.
 */
const PRE_ROLL = 0.25;

/** Renders the song (or one pattern) offline, faster than real time. */
export async function renderProject(project: Project, options: RenderOptions): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100;
  const tail = options.tail ?? 2.5;
  const song = options.mode === 'song';
  const pattern = findPattern(project, options.patternId) ?? project.patterns[0];
  const lengthTicks = song ? songLength(project) : pattern ? patternLength(pattern, barTicks(project.timeSig)) : 0;
  const notes = song ? songEvents(project, 0, lengthTicks) : pattern ? patternEvents(project, pattern.id, 0, lengthTicks) : [];
  const clips = song ? songAudioEvents(project, 0, lengthTicks) : [];
  const automated = song && hasAutomation(project);
  // Tick ↔ seconds, following tempo automation in song mode.
  const tempoAutomated = song && hasTempoAutomation(project);
  const map = buildTempoMap(project, lengthTicks, tempoAutomated);
  const duration = map.seconds(lengthTicks) + tail;
  const preFrames = Math.round(PRE_ROLL * sampleRate);
  const ctx = new OfflineAudioContext(2, preFrames + Math.ceil(duration * sampleRate), sampleRate);
  const pre = preFrames / sampleRate;
  const graph = new AudioGraph(ctx);
  await graph.loadSamples(project);
  // Time-stretched samples must be ready before the render starts (live playback falls back meanwhile).
  await Promise.all(
    project.channels.map((c) => {
      const source = getDecodedSample(c.sampleId);
      const factor = c.instrument === 'sampler' ? stretchFactor(c.stretch, project.bpm) : 1;
      return source && c.sampleId && factor !== 1 ? whenStretched(c.sampleId, source, factor) : undefined;
    }),
  );
  graph.sync(project);
  // The song starts on a bar, right after the pre-roll.
  graph.setBeatAnchor(pre);

  let nextNote = 0;
  let nextClip = 0;
  const scheduleUntil = (seconds: number) => {
    while (nextNote < notes.length && map.seconds(notes[nextNote].start) < seconds) {
      const ev = notes[nextNote++];
      if (!graph.isChannelAudible(ev.channelId)) continue;
      const params = automated ? instrumentAutomationAt(project, ev.channelId, ev.start) : undefined;
      const start = map.seconds(ev.start + swingDelay(ev.start, project.swing));
      graph.playNote(ev.channelId, ev.key, ev.velocity, pre + start, map.seconds(ev.start + ev.length) - map.seconds(ev.start), params, ev);
    }
    while (nextClip < clips.length && map.seconds(clips[nextClip].start) < seconds) {
      const ev = clips[nextClip++];
      const start = map.seconds(ev.start);
      if (graph.isChannelAudible(ev.channelId)) graph.playClip(ev.channelId, pre + start, ev.sampleOffset, map.seconds(ev.start + ev.length) - start);
    }
  };
  /** Tempo-synced effects follow the tempo at `tick` and stay on the beat grid. */
  const followTempo = (tick: number) => {
    const bpm = map.bpmAt(tick);
    graph.setTempo(bpm);
    graph.setBeatAnchor(pre + map.seconds(tick) - tick * secondsPerTick(bpm));
  };
  if (automated) graph.setAutomation(automationAt(project, 0));
  if (tempoAutomated) followTempo(0);
  scheduleUntil(CHUNK_SECONDS);

  // suspend() needs times on render-block boundaries, each used only once.
  const block = 128 / sampleRate;
  const step = automated ? AUTOMATION_STEP : CHUNK_SECONDS / 2;
  let lastBlock = 0;
  for (let t = step; t < duration; t += step) {
    const when = Math.floor((pre + t) / block) * block;
    if (when <= lastBlock) continue;
    lastBlock = when;
    const at = when - pre;
    void ctx.suspend(when).then(() => {
      scheduleUntil(at + CHUNK_SECONDS);
      const tick = map.tick(at);
      if (automated) graph.setAutomation(automationAt(project, tick));
      if (tempoAutomated) followTempo(tick);
      options.onProgress?.(Math.min(1, at / duration));
      void ctx.resume();
    });
  }
  const rendered = await ctx.startRendering();
  options.onProgress?.(1);
  graph.dispose();
  const buffer = new AudioBuffer({ length: rendered.length - preFrames, numberOfChannels: rendered.numberOfChannels, sampleRate });
  for (let c = 0; c < rendered.numberOfChannels; c++) buffer.copyToChannel(rendered.getChannelData(c).subarray(preFrames), c);
  return buffer;
}
