import { useEffect, useMemo, useRef, useState } from 'react';
import type { AutomationTarget, ParamValues } from '../model/types';
import type { ParamSpec, Preset } from '../plugins/params';
import { actions, pluginWindowKey, useStore, type PluginWindowRef } from '../state/store';
import { getEffect, getInstrument } from '../plugins/registry';
import { engine } from '../audio/engine';
import { keyName, isBlackKey } from '../model/time';
import type { Voice } from '../plugins/types';
import { Knob } from './controls';
import { Window } from './Window';
import { isAudioFile, loadSampleFile } from './fileOps';
import { useDecodedSample } from './hooks';

function groupParams(params: ParamSpec[]): Array<[string, ParamSpec[]]> {
  const groups = new Map<string, ParamSpec[]>();
  for (const p of params) {
    const g = p.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return [...groups];
}

interface ParamPanelProps {
  specs: ParamSpec[];
  values: ParamValues;
  color: string;
  onChange(id: string, v: number): void;
  /** Automation target for a param (offered in each knob's right-click menu). */
  target(param: string): AutomationTarget;
}

function ParamPanel({ specs, values, color, onChange, target }: ParamPanelProps) {
  const groups = useMemo(() => groupParams(specs), [specs]);
  return (
    <div className="param-groups">
      {groups.map(([name, params]) => (
        <fieldset key={name} className="param-group">
          {name && <legend>{name}</legend>}
          <div className="param-row">
            {params.map((spec) =>
              spec.options ? (
                <label key={spec.id} className="param-select">
                  <span>{spec.name}</span>
                  <select
                    value={Math.round(values[spec.id] ?? spec.default)}
                    onChange={(e) => {
                      actions().beginGesture();
                      onChange(spec.id, Number(e.target.value));
                      actions().endGesture();
                    }}
                  >
                    {spec.options.map((label, i) => (
                      <option key={label} value={i}>{label}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <Knob
                  key={spec.id}
                  value={values[spec.id] ?? spec.default}
                  spec={spec}
                  label={spec.name}
                  color={color}
                  automation={target(spec.id)}
                  onChange={(v) => onChange(spec.id, v)}
                />
              ),
            )}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function PresetSelect({ presets, onSelect }: { presets: Preset[]; onSelect(index: number): void }) {
  return (
    <select className="preset-select" value="" onChange={(e) => e.target.value !== '' && onSelect(Number(e.target.value))} title="Presets de fábrica">
      <option value="">Presets…</option>
      {presets.map((p, i) => (
        <option key={p.name} value={i}>{p.name}</option>
      ))}
    </select>
  );
}

function Waveform({ sampleId, color }: { sampleId?: string; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const buffer = useDecodedSample(sampleId);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const w = (el.width = el.clientWidth * devicePixelRatio);
    const h = (el.height = el.clientHeight * devicePixelRatio);
    ctx.clearRect(0, 0, w, h);
    if (!buffer) return;
    const data = buffer.getChannelData(0);
    const per = Math.max(1, Math.floor(data.length / w));
    ctx.fillStyle = color;
    for (let x = 0; x < w; x++) {
      let min = 1;
      let max = -1;
      for (let i = x * per; i < Math.min(data.length, (x + 1) * per); i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
      }
      ctx.fillRect(x, ((1 - max) / 2) * h, 1, Math.max(1, ((max - min) / 2) * h));
    }
  }, [buffer, color]);
  return <canvas ref={canvas} className="waveform" />;
}

function MiniKeyboard({ channelId, rootKey }: { channelId: string; rootKey: number }) {
  const voice = useRef<Voice | null>(null);
  const base = Math.floor(rootKey / 12) * 12 - 12;
  const stop = () => {
    voice.current?.release(engine.context?.currentTime ?? 0);
    voice.current = null;
  };
  const keys = Array.from({ length: 36 }, (_, i) => base + i);
  return (
    <div className="mini-keys" onPointerUp={stop} onPointerLeave={stop}>
      {keys.map((k) => (
        <div
          key={k}
          className={`mini-key${isBlackKey(k) ? ' black' : ''}${k === rootKey ? ' root' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            stop();
            voice.current = engine.previewNote(channelId, k, 0.85);
          }}
          title={keyName(k)}
        />
      ))}
    </div>
  );
}

function ChannelEditor({ channelId }: { channelId: string }) {
  const channel = useStore((s) => s.project.channels.find((c) => c.id === channelId));
  const mixer = useStore((s) => s.project.mixer);
  const sampleName = useStore((s) => (channel?.sampleId ? s.project.samples[channel.sampleId]?.name : undefined));
  const [dropping, setDropping] = useState(false);
  if (!channel) return null;
  const plugin = getInstrument(channel.instrument);
  if (!plugin) return <div className="empty-hint">Instrumento desconhecido.</div>;
  const a = actions();

  return (
    <div className="plugin-editor">
      <div className="plugin-head">
        <div className="plugin-desc">{plugin.description}</div>
        <div className="plugin-head-controls">
          <PresetSelect presets={plugin.presets} onSelect={(i) => a.applyChannelPreset(channel.id, i)} />
          <label className="inline-field">
            Mixer
            <select value={channel.mixerTrack} onChange={(e) => a.updateChannel(channel.id, { mixerTrack: Number(e.target.value) })}>
              {mixer.map((t, i) => (
                <option key={t.id} value={i}>
                  {i === 0 ? 'Master' : `${i}. ${t.name}`}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field" title="Nota que os passos do step sequencer tocam e que toca o som na afinação original">
            Nota base
            <select value={channel.rootKey} onChange={(e) => a.updateChannel(channel.id, { rootKey: Number(e.target.value) })}>
              {Array.from({ length: 128 }, (_, k) => (
                <option key={k} value={k}>{keyName(k)}</option>
              ))}
            </select>
          </label>
          <Knob
            value={channel.volume}
            spec={{ min: 0, max: 1.25, default: 0.78, unit: '%' }}
            label="Volume"
            size={28}
            automation={{ kind: 'channel', channelId: channel.id, param: 'volume' }}
            onChange={(v) => a.updateChannel(channel.id, { volume: v }, false)}
          />
          <Knob
            value={channel.pan}
            spec={{ min: -1, max: 1, default: 0 }}
            label="Pan"
            size={28}
            format={(v) => (Math.abs(v) < 0.005 ? 'Centro' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'E' : 'D'}`)}
            automation={{ kind: 'channel', channelId: channel.id, param: 'pan' }}
            onChange={(v) => a.updateChannel(channel.id, { pan: v }, false)}
          />
        </div>
      </div>
      {plugin.usesSample && (
        <div
          className={`sample-zone${dropping ? ' dropping' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const file = e.dataTransfer.files[0];
            if (file && isAudioFile(file)) void loadSampleFile(channel.id, file);
          }}
        >
          <Waveform sampleId={channel.sampleId} color={channel.color} />
          <div className="sample-info">
            <span>{sampleName ?? 'Nenhum sample — arraste um arquivo de áudio aqui'}</span>
            <button type="button" className="text-btn" onClick={() => void loadSampleFile(channel.id)}>
              Carregar…
            </button>
          </div>
        </div>
      )}
      <ParamPanel
        specs={plugin.params}
        values={channel.params}
        color={channel.color}
        onChange={(id, v) => a.setChannelParam(channel.id, id, v)}
        target={(param) => ({ kind: 'instrument', channelId: channel.id, param })}
      />
      <MiniKeyboard channelId={channel.id} rootKey={channel.rootKey} />
    </div>
  );
}

function EffectEditor({ track, slotId }: { track: number; slotId: string }) {
  const slot = useStore((s) => s.project.mixer[track]?.effects.find((e) => e.id === slotId));
  if (!slot) return null;
  const plugin = getEffect(slot.plugin);
  if (!plugin) return <div className="empty-hint">Efeito desconhecido.</div>;
  const a = actions();
  return (
    <div className="plugin-editor">
      <div className="plugin-head">
        <div className="plugin-desc">{plugin.description}</div>
        <div className="plugin-head-controls">
          <PresetSelect presets={plugin.presets} onSelect={(i) => a.applyEffectPreset(track, slotId, i)} />
          <button type="button" className={`text-btn${slot.enabled ? '' : ' warn'}`} onClick={() => a.toggleEffect(track, slotId)}>
            {slot.enabled ? 'Ligado' : 'Bypass'}
          </button>
        </div>
      </div>
      <ParamPanel
        specs={plugin.params}
        values={slot.params}
        color="#ff8a3d"
        onChange={(id, v) => a.setEffectParam(track, slotId, id, v)}
        target={(param) => ({ kind: 'effect', track, slotId, param })}
      />
    </div>
  );
}

export function PluginWindow({ win }: { win: PluginWindowRef & { x: number; y: number; z: number } }) {
  const key = pluginWindowKey(win);
  const title = useStore((s) => {
    if (win.kind === 'channel') {
      const c = s.project.channels.find((x) => x.id === win.channelId);
      return c ? `${c.name} · ${getInstrument(c.instrument)?.name ?? ''}` : '';
    }
    const t = s.project.mixer[win.track];
    const slot = t?.effects.find((e) => e.id === win.slotId);
    return slot ? `${getEffect(slot.plugin)?.name ?? ''} · ${win.track === 0 ? 'Master' : `Insert ${win.track}`}` : '';
  });
  const accent = useStore((s) => (win.kind === 'channel' ? s.project.channels.find((c) => c.id === win.channelId)?.color : undefined));
  const a = actions();
  return (
    <Window
      title={title}
      x={win.x}
      y={win.y}
      z={win.z}
      accent={accent}
      className="plugin-window"
      onMove={(x, y) => a.movePluginWindow(key, x, y)}
      onFocus={() => a.focusPluginWindow(key)}
      onClose={() => a.closePluginWindow(key)}
    >
      {win.kind === 'channel' ? <ChannelEditor channelId={win.channelId} /> : <EffectEditor track={win.track} slotId={win.slotId} />}
    </Window>
  );
}
