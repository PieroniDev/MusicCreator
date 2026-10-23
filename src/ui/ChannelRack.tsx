import { memo, useRef, useState } from 'react';
import type { Channel, Note, Pattern } from '../model/types';
import { actions, selectedPattern, useStore } from '../state/store';
import { isStepSequence, patternLength, patternSteps, stepIsOn } from '../model/pattern';
import { TICKS_PER_STEP } from '../model/time';
import { INSTRUMENTS, getInstrument } from '../plugins/registry';
import { Knob, Led } from './controls';
import { usePlayheadFrame } from './hooks';
import { isAudioFile, loadSampleFile } from './fileOps';

const VOLUME_SPEC = { min: 0, max: 1.25, default: 0.78, unit: '%', name: 'Volume' };
const PAN_SPEC = { min: -1, max: 1, default: 0, name: 'Pan' };
const formatPan = (v: number) => (Math.abs(v) < 0.005 ? 'Centro' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'E' : 'D'}`);

/** Read-only miniature of a channel's piano roll notes. */
function NotePreview({ notes, length, color }: { notes: Note[]; length: number; color: string }) {
  const keys = notes.map((n) => n.key);
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  const range = Math.max(1, hi - lo + 1);
  return (
    <svg className="note-preview" viewBox={`0 0 ${length} ${range}`} preserveAspectRatio="none">
      {notes.map((n) => (
        <rect key={n.id} x={n.start} y={hi - n.key} width={Math.max(n.length, length / 200)} height={1} fill={color} opacity={0.4 + n.velocity * 0.6} />
      ))}
    </svg>
  );
}

interface RowProps {
  channel: Channel;
  pattern: Pattern;
  steps: number;
  selected: boolean;
  mixerSize: number;
}

const ChannelRow = memo(function ChannelRow({ channel, pattern, steps, selected, mixerSize }: RowProps) {
  const notes = pattern.notes[channel.id];
  const stepMode = isStepSequence(notes, channel.rootKey);
  const [menu, setMenu] = useState(false);
  const [dropping, setDropping] = useState(false);
  const plugin = getInstrument(channel.instrument);
  const a = actions();

  const openEditor = () => a.openPluginWindow({ kind: 'channel', channelId: channel.id });
  const openPianoRoll = () => {
    a.selectChannel(channel.id);
    a.toggleWindow('pianoRoll', true);
  };

  return (
    <div
      className={`rack-row${selected ? ' selected' : ''}${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        if (plugin?.usesSample && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const file = e.dataTransfer.files[0];
        if (plugin?.usesSample && file && isAudioFile(file)) {
          e.preventDefault();
          void loadSampleFile(channel.id, file);
        }
      }}
    >
      <Led
        on={!channel.mute}
        color={channel.solo ? '#ffd43b' : undefined}
        onClick={() => a.updateChannel(channel.id, { mute: !channel.mute })}
        onContextMenu={() => a.soloChannel(channel.id)}
        title={`Ligado/mudo (clique) · solo (botão direito)${channel.solo ? ' — em solo' : ''}`}
      />
      <Knob value={channel.pan} spec={PAN_SPEC} size={22} showValue={false} format={formatPan} label={undefined} onChange={(v) => a.updateChannel(channel.id, { pan: v }, false)} />
      <Knob value={channel.volume} spec={VOLUME_SPEC} size={22} showValue={false} onChange={(v) => a.updateChannel(channel.id, { volume: v }, false)} />
      <input
        className="rack-track"
        type="number"
        min={0}
        max={mixerSize - 1}
        value={channel.mixerTrack}
        onChange={(e) => a.updateChannel(channel.id, { mixerTrack: Number(e.target.value) })}
        title="Faixa do mixer (0 = Master)"
      />
      <div className="rack-name-wrap">
        <button
          type="button"
          className="rack-name"
          style={{ borderLeftColor: channel.color }}
          onClick={() => {
            a.selectChannel(channel.id);
            openEditor();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            a.selectChannel(channel.id);
            setMenu(true);
          }}
          title={`${channel.name} — ${plugin?.name ?? '?'} (clique: abrir · botão direito: opções)`}
        >
          {channel.name}
        </button>
        {menu && (
          <div className="context-menu" onMouseLeave={() => setMenu(false)}>
            <button type="button" onClick={() => (setMenu(false), openPianoRoll())}>Piano roll</button>
            <button type="button" onClick={() => (setMenu(false), openEditor())}>Abrir instrumento</button>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                const name = prompt('Nome do canal', channel.name);
                if (name) a.updateChannel(channel.id, { name });
              }}
            >
              Renomear…
            </button>
            {plugin?.usesSample && <button type="button" onClick={() => (setMenu(false), void loadSampleFile(channel.id))}>Carregar sample…</button>}
            <button type="button" onClick={() => (setMenu(false), a.cloneChannel(channel.id))}>Clonar</button>
            <button type="button" onClick={() => (setMenu(false), a.moveChannel(channel.id, -1))}>Mover para cima</button>
            <button type="button" onClick={() => (setMenu(false), a.moveChannel(channel.id, 1))}>Mover para baixo</button>
            <button type="button" onClick={() => (setMenu(false), a.clearNotes(pattern.id, channel.id))}>Limpar notas deste pattern</button>
            <button type="button" className="danger" onClick={() => (setMenu(false), a.removeChannel(channel.id))}>Excluir canal</button>
          </div>
        )}
      </div>
      <button
        type="button"
        className={`rack-select${selected ? ' on' : ''}`}
        onClick={() => a.selectChannel(channel.id)}
        title="Selecionar (para o piano roll e o teclado)"
      />
      {stepMode ? (
        <div className="steps" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
          {Array.from({ length: steps }, (_, i) => {
            const on = stepIsOn(notes, i);
            const velocity = on ? (notes?.find((n) => n.start === i * TICKS_PER_STEP)?.velocity ?? 0.78) : 0;
            return (
              <button
                type="button"
                key={i}
                data-step={i}
                className={`step${on ? ' on' : ''}${Math.floor(i / 4) % 2 ? ' alt' : ''}`}
                style={on ? { background: channel.color, opacity: 0.45 + velocity * 0.55 } : undefined}
                onPointerDown={(e) => {
                  if (e.button === 2) return;
                  e.preventDefault();
                  a.toggleStep(pattern.id, channel.id, i);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (on) a.toggleStep(pattern.id, channel.id, i);
                }}
                title={on ? `Passo ${i + 1} — velocidade ${Math.round(velocity * 100)}% (role a roda para ajustar)` : `Passo ${i + 1}`}
                onWheel={(e) => {
                  if (!on) return;
                  a.beginGesture();
                  a.setStepVelocity(pattern.id, channel.id, i, velocity + (e.deltaY < 0 ? 0.05 : -0.05));
                  a.endGesture();
                }}
              />
            );
          })}
        </div>
      ) : (
        <button type="button" className="steps preview" onClick={openPianoRoll} title="Este canal tem notas no piano roll — clique para editar">
          <NotePreview notes={notes ?? []} length={patternLength(pattern)} color={channel.color} />
        </button>
      )}
    </div>
  );
});

function StepPlayhead({ steps }: { steps: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mode = useStore((s) => s.ui.mode);
  usePlayheadFrame((pos) => {
    const el = ref.current;
    if (!el) return;
    if (pos === null || mode !== 'pattern') {
      el.style.display = 'none';
      return;
    }
    const step = Math.floor(pos / TICKS_PER_STEP);
    el.style.display = 'block';
    el.style.left = `${(step / steps) * 100}%`;
    el.style.width = `${100 / steps}%`;
  });
  return <div ref={ref} className="step-playhead" style={{ display: 'none' }} />;
}

export function ChannelRack() {
  const channels = useStore((s) => s.project.channels);
  const mixerSize = useStore((s) => s.project.mixer.length);
  const pattern = useStore(selectedPattern);
  const selectedChannelId = useStore((s) => s.ui.selectedChannelId);
  const onlyPattern = useStore((s) => s.project.patterns.length <= 1);
  const [adding, setAdding] = useState(false);
  const steps = patternSteps(pattern);
  const a = actions();

  return (
    <div className="channel-rack">
      <div className="rack-header">
        <span className="pattern-chip" style={{ background: pattern.color }}>
          {pattern.name}
        </span>
        <label className="inline-field" title="Tamanho mínimo do pattern; ele cresce sozinho para caber as notas">
          Compassos
          <select value={pattern.lengthBars} onChange={(e) => a.updatePattern(pattern.id, { lengthBars: Number(e.target.value) })}>
            {[1, 2, 3, 4, 6, 8, 12, 16].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            const name = prompt('Nome do pattern', pattern.name);
            if (name) a.updatePattern(pattern.id, { name });
          }}
        >
          Renomear
        </button>
        <button type="button" className="text-btn" onClick={() => a.clonePattern(pattern.id)}>Clonar</button>
        <button
          type="button"
          className="text-btn danger"
          disabled={onlyPattern}
          onClick={() => confirm(`Excluir o pattern "${pattern.name}" e seus clips na playlist?`) && a.removePattern(pattern.id)}
        >
          Excluir
        </button>
      </div>
      <div className="rack-rows">
        <div className="rack-rows-inner" style={{ ['--steps-min' as string]: `${steps * 15}px` }}>
          {channels.map((c) => (
            <ChannelRow key={c.id} channel={c} pattern={pattern} steps={steps} selected={c.id === selectedChannelId} mixerSize={mixerSize} />
          ))}
          <div className="rack-playhead-lane">
            <StepPlayhead steps={steps} />
          </div>
        </div>
      </div>
      <div className="rack-footer">
        <button type="button" className="add-channel" onClick={() => setAdding((v) => !v)}>
          + Adicionar canal
        </button>
        {adding && (
          <div className="add-menu">
            {INSTRUMENTS.map((inst) => (
              <div key={inst.id} className="add-menu-group">
                <button
                  type="button"
                  className="add-menu-main"
                  onClick={() => {
                    a.addChannel(inst.id);
                    setAdding(false);
                  }}
                  title={inst.description}
                >
                  {inst.name}
                </button>
                {inst.id === 'drums' &&
                  inst.presets.map((p) => (
                    <button
                      type="button"
                      key={p.name}
                      className="add-menu-preset"
                      onClick={() => {
                        a.addChannel(inst.id, p.name);
                        setAdding(false);
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
