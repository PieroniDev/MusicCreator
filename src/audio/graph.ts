import type { AutomationTarget, Channel, EffectSlot, MixerTrack, ParamValues, Project } from '../model/types';
import type { EffectInstance, Voice } from '../plugins/types';
import { getEffect, getInstrument } from '../plugins/registry';
import { disconnectAll } from '../plugins/dsp';
import { targetKey, type AutomatedValue } from '../model/automation';
import { decodeSample, getDecodedSample } from './samples';
import { getStretched } from './stretch';
import { sourceSpeed, stretchFactor } from '../model/stretch';

/** The buffer a sample-based channel plays, how fast, and how original seconds map into it. */
interface ResolvedSample {
  buffer?: AudioBuffer;
  /** playbackRate multiplier. */
  rate: number;
  /** Buffer seconds per second of the original sample. */
  scale: number;
}

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
  /** Post-fader output that feeds the master and the sends. */
  out: GainNode;
  sends: Map<number, GainNode>;
  routeKey: string;
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
 * tracks, each with its effect chain, fader and pan, routed to the master and
 * to other inserts. Used both by the live engine and by offline (WAV) renders.
 * `sync` reconciles it with a new project state, touching only what changed.
 * Automation overrides project values while the song plays (see setAutomation).
 */
export class AudioGraph {
  private readonly channels = new Map<string, ChannelStrip>();
  private readonly mixer: MixerStrip[] = [];
  private readonly voices = new Set<Voice>();
  private automation = new Map<string, AutomatedValue>();
  /** Context time of a beat on the song grid, for tempo-synced effects (null when stopped). */
  private beatAnchor: number | null = null;
  private bpm = 120;
  /** Tempo set by tempo automation while the song plays (null: the project tempo). */
  private tempoOverride: number | null = null;
  private project?: Project;

  constructor(
    readonly ctx: BaseAudioContext,
    private readonly options: GraphOptions = {},
  ) {}

  sync(project: Project): void {
    const prev = this.project;
    this.project = project;
    const bpm = this.tempoOverride ?? project.bpm;
    const tempoChanged = bpm !== this.bpm;
    this.bpm = bpm;

    if (!prev || prev.mixer !== project.mixer || tempoChanged) this.syncMixer(project, tempoChanged);
    if (!prev || prev.channels !== project.channels || prev.mixer.length !== project.mixer.length) this.syncChannels(project);
    if (!prev || prev.samples !== project.samples) this.loadSamples(project);
    if (!prev || prev.channels !== project.channels || tempoChanged) {
      for (const c of project.channels) if (c.stretch) this.resolveSample(c);
    }
  }

  /** Decodes every sample the project uses; resolves when all are ready. */
  async loadSamples(project: Project): Promise<void> {
    const jobs = Object.values(project.samples).map((s) => decodeSample(this.ctx, s));
    await Promise.all(jobs);
  }

  /**
   * Plays a note on a channel. `params` overrides some instrument params for
   * this note only (automation at the note's start); `note` carries the
   * note's own pan and fine pitch.
   */
  playNote(
    channelId: string,
    key: number,
    velocity: number,
    time: number,
    duration?: number,
    params?: ParamValues,
    note?: { pan?: number; fine?: number },
  ): Voice | null {
    const strip = this.channels.get(channelId);
    if (!strip) return null;
    const channel = strip.channel;
    const plugin = getInstrument(channel.instrument);
    if (!plugin) return null;
    const resolved = this.resolveSample(channel);
    // A panned note gets its own panner in front of the channel.
    let destination: AudioNode = strip.input;
    let panner: StereoPannerNode | null = null;
    if (note?.pan) {
      panner = this.ctx.createStereoPanner();
      panner.pan.value = note.pan;
      panner.connect(strip.input);
      destination = panner;
    }
    const voice = plugin.noteOn(this.ctx, destination, {
      key,
      velocity,
      time,
      rootKey: channel.rootKey,
      params: params ? { ...channel.params, ...params } : channel.params,
      sample: resolved.buffer,
      rate: resolved.rate,
      detune: note?.fine,
      pads: channel.pads?.map((id) => getDecodedSample(id ?? undefined)),
    });
    this.track(voice, panner ? () => panner.disconnect() : undefined);
    if (duration !== undefined) voice.release(time + duration);
    return voice;
  }

  /**
   * Plays an audio clip: the channel's sample from `offset` seconds of the
   * original audio, for `duration` seconds of output.
   */
  playClip(channelId: string, time: number, offset: number, duration: number, params?: ParamValues): Voice | null {
    const strip = this.channels.get(channelId);
    const channel = strip?.channel;
    const plugin = channel && getInstrument(channel.instrument);
    if (!strip || !channel || !plugin?.usesSample) return null;
    const { buffer, rate, scale } = this.resolveSample(channel);
    if (!buffer) return null;
    const voice = plugin.noteOn(this.ctx, strip.input, {
      key: channel.rootKey,
      velocity: 1,
      time,
      rootKey: channel.rootKey,
      params: params ? { ...channel.params, ...params } : channel.params,
      sample: buffer,
      rate,
      offset: offset * scale,
      gated: true,
    });
    this.track(voice);
    voice.release(time + duration);
    return voice;
  }

  /**
   * Applies the channel's time-stretch settings. While a stretched buffer is
   * still being computed the original plays at the right speed (timing stays
   * correct, only the pitch is off until it is ready).
   */
  private resolveSample(channel: Channel): ResolvedSample {
    const original = getDecodedSample(channel.sampleId);
    const st = channel.instrument === 'sampler' ? channel.stretch : undefined;
    if (!original || !st || !channel.sampleId) return { buffer: original, rate: 1, scale: 1 };
    const speed = sourceSpeed(st, this.bpm);
    const factor = stretchFactor(st, this.bpm);
    if (st.mode === 'resample') return { buffer: original, rate: speed, scale: 1 };
    if (factor === 1) return { buffer: original, rate: Math.pow(2, st.pitch / 12), scale: 1 };
    const stretched = getStretched(channel.sampleId, original, factor);
    return stretched ? { buffer: stretched, rate: Math.pow(2, st.pitch / 12), scale: factor } : { buffer: original, rate: speed, scale: 1 };
  }

  isChannelAudible(channelId: string): boolean {
    const strip = this.channels.get(channelId);
    return !!strip && !strip.muted;
  }

  killAll(): void {
    for (const v of this.voices) v.kill();
    this.voices.clear();
  }

  /**
   * Sets the automated values in effect now (from automationAt). Targets that
   * were automated before and are missing now go back to their project value.
   * Instrument targets are applied per note instead (see playNote).
   */
  setAutomation(values: Map<string, AutomatedValue>): void {
    const previous = this.automation;
    this.automation = values;
    for (const [key, entry] of values) {
      if (previous.get(key)?.value !== entry.value) this.applyTarget(entry.target);
    }
    for (const [key, entry] of previous) {
      if (!values.has(key)) this.applyTarget(entry.target);
    }
  }

  /**
   * Tempo automation: tempo-synced effects (delays, gates) and time-stretched
   * samples follow `bpm`; null goes back to the project tempo.
   */
  setTempo(bpm: number | null): void {
    this.tempoOverride = bpm;
    const next = bpm ?? this.project?.bpm ?? this.bpm;
    if (next === this.bpm) return;
    this.bpm = next;
    for (const strip of this.mixer) for (const fx of strip.effects.values()) fx.instance.setTempo?.(next, fx.slot.params);
  }

  /** Lines tempo-synced effects (gates, pumps) up with the song's beats. */
  setBeatAnchor(beatTime: number): void {
    this.beatAnchor = beatTime;
    for (const strip of this.mixer) for (const fx of strip.effects.values()) fx.instance.syncBeat?.(beatTime);
  }

  get masterInput(): AudioNode | null {
    return this.mixer[0]?.input ?? null;
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
      disconnectAll(m.input, m.fader, m.panner, m.mute, m.out, ...m.sends.values(), ...(m.meters ?? []));
    }
    this.channels.clear();
    this.mixer.length = 0;
  }

  private track(voice: Voice, cleanup?: () => void): void {
    this.voices.add(voice);
    voice.onEnded = () => {
      this.voices.delete(voice);
      cleanup?.();
    };
  }

  /** The automated value of a target, if it is automated right now. */
  private automated(target: AutomationTarget): number | undefined {
    return this.automation.get(targetKey(target))?.value;
  }

  /** Pushes the effective value (automated or from the project) of one target to the audio nodes. */
  private applyTarget(target: AutomationTarget): void {
    const project = this.project;
    if (!project) return;
    const now = this.ctx.currentTime;
    switch (target.kind) {
      case 'channel': {
        const strip = this.channels.get(target.channelId);
        if (!strip) return;
        const value = this.automated(target) ?? strip.channel[target.param];
        if (target.param === 'volume') strip.input.gain.setTargetAtTime(strip.muted ? 0 : value, now, 0.01);
        else strip.panner.pan.setTargetAtTime(value, now, 0.01);
        return;
      }
      case 'mixer': {
        const strip = this.mixer[target.track];
        const track = project.mixer[target.track];
        if (!strip || !track) return;
        const value = this.automated(target) ?? track[target.param];
        if (target.param === 'volume') strip.fader.gain.setTargetAtTime(value, now, 0.01);
        else strip.panner.pan.setTargetAtTime(value, now, 0.01);
        return;
      }
      case 'effect': {
        const entry = this.mixer[target.track]?.effects.get(target.slotId);
        if (!entry) return;
        const value = this.automated(target) ?? entry.slot.params[target.param];
        if (value !== undefined) entry.instance.setParam(target.param, value, { ...entry.slot.params, [target.param]: value });
        return;
      }
      case 'instrument':
      case 'tempo':
        // Applied per note (instruments) and by the transport (tempo).
        return;
    }
  }

  private createMixerStrip(): MixerStrip {
    const ctx = this.ctx;
    const strip: MixerStrip = {
      input: ctx.createGain(),
      fader: ctx.createGain(),
      panner: ctx.createStereoPanner(),
      mute: ctx.createGain(),
      out: ctx.createGain(),
      sends: new Map(),
      routeKey: '',
      effects: new Map(),
      chainKey: '',
    };
    strip.input.connect(strip.fader);
    strip.fader.connect(strip.panner);
    strip.panner.connect(strip.mute);
    strip.mute.connect(strip.out);
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
    project.mixer.forEach((_, i) => {
      if (!this.mixer[i]) this.mixer[i] = this.createMixerStrip();
    });
    project.mixer.forEach((track, i) => {
      const strip = this.mixer[i];
      const muted = track.mute || (i > 0 && anySolo && !track.solo);
      strip.mute.gain.value = muted ? 0 : 1;
      if (strip.track === track && !tempoChanged) return;
      const fresh = !strip.track;
      setSmooth(strip.fader.gain, this.automated({ kind: 'mixer', track: i, param: 'volume' }) ?? track.volume, this.ctx, fresh);
      setSmooth(strip.panner.pan, this.automated({ kind: 'mixer', track: i, param: 'pan' }) ?? track.pan, this.ctx, fresh);
      if (strip.track?.effects !== track.effects || tempoChanged) this.syncEffects(strip, i, track.effects, tempoChanged);
      this.syncRouting(strip, i, track);
      strip.track = track;
    });
  }

  /** Connects an insert's output to the master and its sends, rewiring only when the routes change. */
  private syncRouting(strip: MixerStrip, index: number, track: MixerTrack): void {
    const toMaster = index > 0 && track.toMaster;
    const key = `${index === 0 ? 'out' : toMaster}|${track.sends.map((s) => s.to).join(',')}`;
    if (key !== strip.routeKey) {
      strip.routeKey = key;
      disconnectAll(strip.out, ...strip.sends.values());
      strip.sends.clear();
      if (index === 0) strip.out.connect(this.ctx.destination);
      else if (toMaster) strip.out.connect(this.mixer[0].input);
      for (const send of track.sends) {
        const target = this.mixer[send.to];
        if (!target || send.to === index || send.to === 0) continue;
        const gain = this.ctx.createGain();
        gain.gain.value = send.level;
        strip.out.connect(gain);
        gain.connect(target.input);
        strip.sends.set(send.to, gain);
      }
      return;
    }
    for (const send of track.sends) {
      const gain = strip.sends.get(send.to);
      if (gain) setSmooth(gain.gain, send.level, this.ctx, false);
    }
  }

  private syncEffects(strip: MixerStrip, trackIndex: number, slots: EffectSlot[], tempoChanged: boolean): void {
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
        if (this.beatAnchor !== null) entry.instance.syncBeat?.(this.beatAnchor);
        strip.effects.set(slot.id, entry);
        // A new instance invalidates the chain wiring.
        strip.chainKey = '';
        continue;
      }
      if (entry.slot.params !== slot.params) {
        for (const [id, value] of Object.entries(slot.params)) {
          if (entry.slot.params[id] === value) continue;
          // An automated parameter follows its clip, not the knob.
          if (this.automated({ kind: 'effect', track: trackIndex, slotId: slot.id, param: id }) !== undefined) continue;
          entry.instance.setParam(id, value, slot.params);
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
      const volume = this.automated({ kind: 'channel', channelId: channel.id, param: 'volume' }) ?? channel.volume;
      const pan = this.automated({ kind: 'channel', channelId: channel.id, param: 'pan' }) ?? channel.pan;
      setSmooth(strip.input.gain, strip.muted ? 0 : volume, this.ctx, isNew);
      setSmooth(strip.panner.pan, pan, this.ctx, isNew);
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
