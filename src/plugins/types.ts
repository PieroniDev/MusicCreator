import type { ParamValues } from '../model/types';
import type { ParamSpec, Preset } from './params';

export interface NoteOptions {
  key: number;
  /** 0..1 */
  velocity: number;
  /** Context time at which the note starts. */
  time: number;
  /** Channel root key: plays the sound at its natural pitch. */
  rootKey: number;
  params: ParamValues;
  /** Decoded sample for sample-based instruments. */
  sample?: AudioBuffer;
}

export interface Voice {
  /** Starts the release phase at context time `time`. */
  release(time: number): void;
  /** Stops immediately and frees the nodes. */
  kill(): void;
  /** Fires once the voice has finished sounding. */
  onEnded?: () => void;
}

export interface InstrumentPlugin {
  kind: 'instrument';
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  presets: Preset[];
  /** Whether the instrument plays a user sample (shows the sample loader). */
  usesSample?: boolean;
  noteOn(ctx: BaseAudioContext, destination: AudioNode, options: NoteOptions): Voice;
}

export interface EffectContext {
  bpm: number;
}

export interface EffectInstance {
  input: AudioNode;
  output: AudioNode;
  setParam(id: string, value: number, params: ParamValues): void;
  setTempo?(bpm: number, params: ParamValues): void;
  dispose(): void;
}

export interface EffectPlugin {
  kind: 'effect';
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  presets: Preset[];
  create(ctx: BaseAudioContext, params: ParamValues, env: EffectContext): EffectInstance;
}

export type Plugin = InstrumentPlugin | EffectPlugin;
