/**
 * Project data model. Everything here is plain JSON so a project can be
 * saved, loaded and diffed by reference (the store updates it immutably).
 *
 * Time is measured in ticks: PPQ (ticks per quarter note) = 96,
 * one step (1/16 note) = 24 ticks, one 4/4 bar = 384 ticks.
 */

export type ParamValues = Record<string, number>;

export interface Note {
  id: string;
  /** MIDI key, 0..127 (60 = C5 in this app's naming, middle C). */
  key: number;
  /** Start, in ticks, relative to the start of the pattern. */
  start: number;
  /** Length in ticks (> 0). */
  length: number;
  /** 0..1 */
  velocity: number;
}

export interface Channel {
  id: string;
  name: string;
  color: string;
  /** Instrument plugin id (see plugins/registry). */
  instrument: string;
  params: ParamValues;
  /** Linear gain, 0..1.25 */
  volume: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  mute: boolean;
  solo: boolean;
  /** Mixer track index this channel feeds. 0 = master. */
  mixerTrack: number;
  /** Key that plays the sound at its natural pitch and that step-sequencer steps use. */
  rootKey: number;
  /** Sample asset used by sample-based instruments. */
  sampleId?: string;
}

export interface Pattern {
  id: string;
  name: string;
  color: string;
  /** Minimum length in bars; the pattern grows to fit its notes. */
  lengthBars: number;
  /** Notes per channel id. */
  notes: Record<string, Note[]>;
}

export interface PlaylistTrack {
  id: string;
  name: string;
  mute: boolean;
}

interface ClipBase {
  id: string;
  /** Index into playlist.tracks */
  track: number;
  /** Song position in ticks. */
  start: number;
  /** Length in ticks. */
  length: number;
}

/** Plays a pattern, repeating it when the clip is longer than the pattern. */
export interface PatternClip extends ClipBase {
  kind: 'pattern';
  patternId: string;
}

/**
 * Plays the sample of a Sampler channel (whose settings and mixer routing it
 * uses) from `offset` seconds into the audio. Audio is not time-stretched.
 */
export interface AudioClip extends ClipBase {
  kind: 'audio';
  channelId: string;
  offset: number;
}

/** What an automation clip controls. */
export type AutomationTarget =
  | { kind: 'channel'; channelId: string; param: 'volume' | 'pan' }
  | { kind: 'instrument'; channelId: string; param: string }
  | { kind: 'mixer'; track: number; param: 'volume' | 'pan' }
  | { kind: 'effect'; track: number; slotId: string; param: string };

export interface AutomationPoint {
  /** Ticks from the clip start. */
  t: number;
  /** Normalized value 0..1 (the position of the control, as on a knob). */
  v: number;
}

/** Moves a parameter along a curve of points while the song plays. */
export interface AutomationClip extends ClipBase {
  kind: 'automation';
  target: AutomationTarget;
  /** Sorted by `t`; at least one point. Values hold flat before/after the ends. */
  points: AutomationPoint[];
}

export type PlaylistClip = PatternClip | AudioClip | AutomationClip;

export interface EffectSlot {
  id: string;
  /** Effect plugin id (see plugins/registry). */
  plugin: string;
  params: ParamValues;
  enabled: boolean;
}

export interface MixerSend {
  /** Insert that receives the signal (never the master, never itself). */
  to: number;
  /** Linear gain of the send. */
  level: number;
}

export interface MixerTrack {
  id: string;
  name: string;
  /** Linear gain, 0..2 (fader at 0 dB = 1). */
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  effects: EffectSlot[];
  /** Whether the insert feeds the master (ignored on the master itself). */
  toMaster: boolean;
  /** Post-fader routes to other inserts. */
  sends: MixerSend[];
}

export interface SampleAsset {
  id: string;
  name: string;
  /** Original file bytes, base64 encoded (any format the browser can decode). */
  data: string;
}

export interface Project {
  version: 1;
  name: string;
  bpm: number;
  /** 0..1: delays every second 16th note by up to half a step. */
  swing: number;
  channels: Channel[];
  patterns: Pattern[];
  playlist: {
    tracks: PlaylistTrack[];
    clips: PlaylistClip[];
  };
  /** Index 0 is the master track; the rest are inserts. */
  mixer: MixerTrack[];
  samples: Record<string, SampleAsset>;
}

export type PlayMode = 'pattern' | 'song';
