import { memo, useEffect, useRef } from 'react';
import type { MixerTrack } from '../model/types';
import { actions, useStore } from '../state/store';
import { engine } from '../audio/engine';
import { EFFECTS, getEffect } from '../plugins/registry';
import { MAX_EFFECT_SLOTS } from '../model/defaults';
import { Fader, formatDb, Knob } from './controls';

const PAN_SPEC = { min: -1, max: 1, default: 0, name: 'Pan' };
const formatPan = (v: number) => (Math.abs(v) < 0.005 ? 'C' : `${Math.round(Math.abs(v) * 100)}${v < 0 ? 'E' : 'D'}`);

/** Peak meters for every strip, driven by one animation loop. */
function useMeters(count: number) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    const held = new Float32Array(count * 2);
    let raf = 0;
    const loop = () => {
      for (let i = 0; i < count; i++) {
        const peaks = engine.readPeak(i);
        for (let side = 0; side < 2; side++) {
          const k = i * 2 + side;
          // Fast attack, slow fall.
          held[k] = Math.max(peaks[side], held[k] * 0.9);
          const el = refs.current[k];
          if (el) {
            const db = held[k] > 0 ? 20 * Math.log10(held[k]) : -60;
            const h = Math.min(1, Math.max(0, (db + 60) / 66));
            // The mask hides the unlit top of the gradient column.
            el.style.transform = `scaleY(${1 - h})`;
            el.parentElement?.classList.toggle('clip', held[k] >= 1);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [count]);
  return refs;
}

interface StripProps {
  track: MixerTrack;
  index: number;
  selected: boolean;
  routed: string[];
  meterRef(side: number): (el: HTMLDivElement | null) => void;
}

const Strip = memo(function Strip({ track, index, selected, routed, meterRef }: StripProps) {
  const a = actions();
  return (
    <div
      className={`strip${selected ? ' selected' : ''}${index === 0 ? ' master' : ''}${track.mute ? ' muted' : ''}`}
      onPointerDown={() => a.selectMixerTrack(index)}
    >
      <div className="strip-num">{index === 0 ? 'M' : index}</div>
      <div
        className="strip-name"
        title={`${track.name}${routed.length ? `\nCanais: ${routed.join(', ')}` : ''}\nDuplo clique para renomear`}
        onDoubleClick={() => {
          const name = prompt('Nome da faixa do mixer', track.name);
          if (name) a.updateMixerTrack(index, { name });
        }}
      >
        {track.name}
      </div>
      <div className="strip-fx-dots" title={`${track.effects.length} efeito(s)`}>
        {Array.from({ length: MAX_EFFECT_SLOTS }, (_, i) => (
          <span key={i} className={track.effects[i] ? (track.effects[i].enabled ? 'on' : 'off') : ''} />
        ))}
      </div>
      <Knob value={track.pan} spec={PAN_SPEC} size={26} showValue={false} format={formatPan} onChange={(v) => a.updateMixerTrack(index, { pan: v }, false)} />
      <div className="strip-fader-row">
        <Fader value={track.volume} onChange={(v) => a.updateMixerTrack(index, { volume: v }, false)} height={132} />
        <div className="meter">
          <div className="meter-col">
            <div className="meter-mask" ref={meterRef(0)} />
          </div>
          <div className="meter-col">
            <div className="meter-mask" ref={meterRef(1)} />
          </div>
        </div>
      </div>
      <div className="strip-db">{formatDb(track.volume)}</div>
      <div className="strip-buttons">
        <button type="button" className={`mute-btn${track.mute ? ' on' : ''}`} onClick={() => a.updateMixerTrack(index, { mute: !track.mute })} title="Mudo">
          M
        </button>
        {index > 0 && (
          <button type="button" className={`solo-btn${track.solo ? ' on' : ''}`} onClick={() => a.updateMixerTrack(index, { solo: !track.solo })} title="Solo">
            S
          </button>
        )}
      </div>
    </div>
  );
});

function EffectRack({ index, track }: { index: number; track: MixerTrack }) {
  const a = actions();
  const empty = MAX_EFFECT_SLOTS - track.effects.length;
  return (
    <div className="fx-rack">
      <div className="fx-rack-title">
        {index === 0 ? 'Master' : `Insert ${index}`} — {track.name}
      </div>
      {track.effects.map((slot, i) => {
        const plugin = getEffect(slot.plugin);
        return (
          <div key={slot.id} className={`fx-slot${slot.enabled ? '' : ' bypassed'}`}>
            <button
              type="button"
              className={`led${slot.enabled ? ' on' : ''}`}
              onClick={() => a.toggleEffect(index, slot.id)}
              title={slot.enabled ? 'Ligado (clique para bypass)' : 'Em bypass'}
            />
            <button type="button" className="fx-name" onClick={() => a.openPluginWindow({ kind: 'effect', track: index, slotId: slot.id })} title="Abrir editor">
              {i + 1}. {plugin?.name ?? slot.plugin}
            </button>
            <button type="button" className="fx-small" onClick={() => a.moveEffect(index, slot.id, -1)} disabled={i === 0} title="Subir">
              ▲
            </button>
            <button type="button" className="fx-small" onClick={() => a.moveEffect(index, slot.id, 1)} disabled={i === track.effects.length - 1} title="Descer">
              ▼
            </button>
            <button type="button" className="fx-small danger" onClick={() => a.removeEffect(index, slot.id)} title="Remover">
              ×
            </button>
          </div>
        );
      })}
      {empty > 0 && (
        <select
          className="fx-add"
          value=""
          onChange={(e) => {
            const id = a.addEffect(index, e.target.value);
            if (id) a.openPluginWindow({ kind: 'effect', track: index, slotId: id });
          }}
        >
          <option value="">+ Adicionar efeito…</option>
          {EFFECTS.map((fx) => (
            <option key={fx.id} value={fx.id}>{fx.name}</option>
          ))}
        </select>
      )}
      {Array.from({ length: Math.max(0, empty - 1) }, (_, i) => (
        <div key={i} className="fx-slot empty" />
      ))}
    </div>
  );
}

export function Mixer() {
  const mixer = useStore((s) => s.project.mixer);
  const channels = useStore((s) => s.project.channels);
  const selected = useStore((s) => s.ui.selectedMixerTrack);
  const meterRefs = useMeters(mixer.length);
  const track = mixer[selected] ?? mixer[0];

  return (
    <div className="mixer">
      <div className="strips">
        {mixer.map((t, i) => (
          <Strip
            key={t.id}
            track={t}
            index={i}
            selected={i === selected}
            routed={channels.filter((c) => c.mixerTrack === i).map((c) => c.name)}
            meterRef={(side) => (el) => {
              meterRefs.current[i * 2 + side] = el;
            }}
          />
        ))}
      </div>
      <EffectRack index={mixer[selected] ? selected : 0} track={track} />
    </div>
  );
}
