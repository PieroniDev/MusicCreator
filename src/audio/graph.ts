import type { Channel, EffectSlot, MixerTrack, Project } from '../model/types';
import type { EffectInstance, Voice } from '../plugins/types';
import { getEffect, getInstrument } from '../plugins/registry';
import { disconnectAll } from '../plugins/dsp';
import { decodeSample, getDecodedSample } from './samples';

interface ChannelStrip {
  channel: Channel;
  input: GainNode;
  panner: StereoPannerNode;
  routedTo: number;
  muted: boolean;
}

interface FxEntry {
  slot: EffectSlot;
  instance: EffectInstance;
}

interface MixerStrip {
  track?: MixerTrack;
  input: GainNode;
  fader: GainNode;
  panner: StereoPannerNode;
  mute: GainNode;
  effects: Map<string, FxEntry>;
  chainKey: string;
  meters?: [AnalyserNode, AnalyserNode];
  meterBuffer?: Float32Array<ArrayBuffer>;
}

/** Glides a param to its new value (no zipper noise); jumps when the node is new. */
function setSmooth(param: AudioParam, value: number, ctx: BaseAudioContext, immediate: boolean): void {
  if (immediate) param.value = value;
  else param.setTargetAtTime(value, ctx.currentTime, 0.01);
}

export interface GraphOptions {
  /** Create analysers for the mixer meters (live engine only). */
  meters?: boolean;
}

/**
 * The audio graph of a project on one context: channel strips feeding mixer
 * tracks, each with its effect chain, fader and pan, all summed into the
 * master. Used both by the live engine and by offline (WAV) renders.
 * `sync` reconciles it with a new project state, touching only what changed.
 */
export class AudioGraph {
  private readonly channels = new Map<string, ChannelStrip>();
  private readonly mixer: MixerStrip[] = [];
  private readonly voices = new Set<Voice>();
  private bpm = 120;
  private project?: Project;

  constructor(
    readonly ctx: BaseAudioContext,
    private readonly options: GraphOptions = {},
  ) {}

  sync(project: Project): void {
    const prev = this.project;
    this.project = project;
    const tempoChanged = project.bpm !== this.bpm;
    this.bpm = project.bpm;

    if (!prev || prev.mixer !== project.mixer || tempoChanged) this.syncMixer(project, tempoChanged);
    if (!prev || prev.channels !== project.channels || prev.mixer.length !== project.mixer.length) this.syncChannels(project);
    if (!prev || prev.samples !== project.samples) this.loadSamples(project);
  }

  /** Decodes every sample the project uses; resolves when all are ready. */
  async loadSamples(project: Project): Promise<void> {
    const jobs = Object.values(project.samples).map((s) => decodeSample(this.ctx, s));
    await Promise.all(jobs);
  }

  playNote(channelId: string, key: number, velocity: number, time: number, duration?: number): Voice | null {
    const strip = this.channels.get(channelId);
    if (!strip) return null;
    const channel = strip.channel;
    const plugin = getInstrument(channel.instrument);
    if (!plugin) return null;
    const voice = plugin.noteOn(this.ctx, strip.input, {
      key,
      velocity,
      time,
      rootKey: channel.rootKey,
      params: channel.params,
      sample: getDecodedSample(channel.sampleId),
    });
    this.voices.add(voice);
    voice.onEnded = () => this.voices.delete(voice);
    if (duration !== undefined) voice.release(time + duration);
    return voice;
  }

  isChannelAudible(channelId: string): boolean {
    const strip = this.channels.get(channelId);
    return !!strip && !strip.muted;
  }

  killAll(): void {
    for (const v of this.voices) v.kill();
    this.voices.clear();
  }

  /** Peak level (0..) of a mixer track's left and right channels since the last call. */
  readPeak(trackIndex: number): [number, number] {
    const strip = this.mixer[trackIndex];
    if (!strip?.meters || !strip.meterBuffer) return [0, 0];
    const out: [number, number] = [0, 0];
    strip.meters.forEach((analyser, side) => {
      analyser.getFloatTimeDomainData(strip.meterBuffer!);
      let peak = 0;
      for (const v of strip.meterBuffer!) peak = Math.max(peak, Math.abs(v));
      out[side] = peak;
    });
    return out;
  }

  dispose(): void {
    this.killAll();
    for (const s of this.channels.values()) disconnectAll(s.input, s.panner);
    for (const m of this.mixer) {
      for (const fx of m.effects.values()) fx.instance.dispose();
      disconnectAll(m.input, m.fader, m.panner, m.mute, ...(m.meters ?? []));
    }
    this.channels.clear();
    this.mixer.length = 0;
  }

  private createMixerStrip(index: number): MixerStrip {
    const ctx = this.ctx;
    const strip: MixerStrip = {
      input: ctx.createGain(),
      fader: ctx.createGain(),
      panner: ctx.createStereoPanner(),
      mute: ctx.createGain(),
      effects: new Map(),
      chainKey: '',
    };
    strip.input.connect(strip.fader);
    strip.fader.connect(strip.panner);
    strip.panner.connect(strip.mute);
    strip.mute.connect(index === 0 ? ctx.destination : this.mixer[0].input);
    if (this.options.meters) {
      const split = ctx.createChannelSplitter(2);
      const meters: [AnalyserNode, AnalyserNode] = [ctx.createAnalyser(), ctx.createAnalyser()];
      strip.mute.connect(split);
      meters.forEach((a, i) => {
        a.fftSize = 512;
        split.connect(a, i);
      });
      strip.meters = meters;
      strip.meterBuffer = new Float32Array(512);
    }
    return strip;
  }

  private syncMixer(project: Project, tempoChanged: boolean): void {
    const anySolo = project.mixer.some((t, i) => i > 0 && t.solo);
    project.mixer.forEach((track, i) => {
      if (!this.mixer[i]) this.mixer[i] = this.createMixerStrip(i);
      const strip = this.mixer[i];
      const muted = track.mute || (i > 0 && anySolo && !track.solo);
      strip.mute.gain.value = muted ? 0 : 1;
      if (strip.track === track && !tempoChanged) return;
      setSmooth(strip.fader.gain, track.volume, this.ctx, !strip.track);
      setSmooth(strip.panner.pan, track.pan, this.ctx, !strip.track);
      if (strip.track?.effects !== track.effects || tempoChanged) this.syncEffects(strip, track.effects, tempoChanged);
      strip.track = track;
    });
  }

  private syncEffects(strip: MixerStrip, slots: EffectSlot[], tempoChanged: boolean): void {
    const seen = new Set<string>();
    for (const slot of slots) {
      seen.add(slot.id);
      const plugin = getEffect(slot.plugin);
      let entry = strip.effects.get(slot.id);
      if (entry && entry.slot.plugin !== slot.plugin) {
        entry.instance.dispose();
        strip.effects.delete(slot.id);
        entry = undefined;
      }
      if (!plugin) continue;
      if (!entry) {
        entry = { slot, instance: plugin.create(this.ctx, slot.params, { bpm: this.bpm }) };
        strip.effects.set(slot.id, entry);
        // A new instance invalidates the chain wiring.
        strip.chainKey = '';
        continue;
      }
      if (entry.slot.params !== slot.params) {
        for (const [id, value] of Object.entries(slot.params)) {
          if (entry.slot.params[id] !== value) entry.instance.setParam(id, value, slot.params);
        }
      }
      if (tempoChanged) entry.instance.setTempo?.(this.bpm, slot.params);
      entry.slot = slot;
    }
    for (const [id, entry] of strip.effects) {
      if (!seen.has(id)) {
        entry.instance.dispose();
        strip.effects.delete(id);
      }
    }

    const active = slots.filter((s) => s.enabled && strip.effects.has(s.id));
    const key = active.map((s) => s.id).join('|');
    if (key === strip.chainKey) return;
    strip.chainKey = key;
    disconnectAll(strip.input);
    for (const entry of strip.effects.values()) disconnectAll(entry.instance.output);
    let node: AudioNode = strip.input;
    for (const slot of active) {
      const fx = strip.effects.get(slot.id)!;
      node.connect(fx.instance.input);
      node = fx.instance.output;
    }
    node.connect(strip.fader);
  }

  private syncChannels(project: Project): void {
    const anySolo = project.channels.some((c) => c.solo);
    const seen = new Set<string>();
    for (const channel of project.channels) {
      seen.add(channel.id);
      let strip = this.channels.get(channel.id);
      const isNew = !strip;
      if (!strip) {
        const input = this.ctx.createGain();
        const panner = this.ctx.createStereoPanner();
        input.connect(panner);
        strip = { channel, input, panner, routedTo: -1, muted: false };
        this.channels.set(channel.id, strip);
      }
      strip.channel = channel;
      strip.muted = channel.mute || (anySolo && !channel.solo);
      setSmooth(strip.input.gain, strip.muted ? 0 : channel.volume, this.ctx, isNew);
      setSmooth(strip.panner.pan, channel.pan, this.ctx, isNew);
      const target = Math.min(channel.mixerTrack, this.mixer.length - 1);
      if (strip.routedTo !== target) {
        disconnectAll(strip.panner);
        strip.panner.connect(this.mixer[target].input);
        strip.routedTo = target;
      }
    }
    for (const [id, strip] of this.channels) {
      if (!seen.has(id)) {
        disconnectAll(strip.input, strip.panner);
        this.channels.delete(id);
      }
    }
  }
}
