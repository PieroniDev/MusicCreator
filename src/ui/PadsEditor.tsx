import { useRef, useState } from 'react';
import type { Channel } from '../model/types';
import { actions, useStore } from '../state/store';
import { engine } from '../audio/engine';
import { drumPads, FIRST_PAD_KEY, PAD_COUNT } from '../plugins/instruments/drumPads';
import { keyName } from '../model/time';
import type { Voice } from '../plugins/types';
import { Knob } from './controls';
import { openContextMenu } from './ContextMenu';
import { isAudioDrag, readDroppedAudio } from './dnd';
import { loadPadSample } from './fileOps';
import { fillWithSynthKit } from './padKit';

const spec = (id: string) => drumPads.params.find((p) => p.id === id)!;

/** The Drum Pads editor: a 4×4 grid (pad 1 bottom left) and the selected pad's settings. */
export function PadsEditor({ channel }: { channel: Channel }) {
  const samples = useStore((s) => s.project.samples);
  const [selected, setSelected] = useState(0);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const voice = useRef<Voice | null>(null);
  const a = actions();
  const rows = [3, 2, 1, 0].map((r) => [0, 1, 2, 3].map((c) => r * 4 + c));
  const padName = (i: number) => {
    const id = channel.pads?.[i];
    return id ? (samples[id]?.name ?? '').replace(/\.[^.]+$/, '') : '';
  };
  const release = () => {
    voice.current?.release(engine.context?.currentTime ?? 0);
    voice.current = null;
  };
  const param = (p: string) => channel.params[p] ?? spec(p).default;
  const knob = (id: string, label: string) => (
    <Knob
      value={param(id)}
      spec={spec(id)}
      label={label}
      color={channel.color}
      automation={{ kind: 'instrument', channelId: channel.id, param: id }}
      onChange={(v) => a.setChannelParam(channel.id, id, v)}
    />
  );

  return (
    <div className="pads-editor">
      <div className="pads-grid" onPointerUp={release} onPointerLeave={release}>
        {rows.flat().map((i) => (
          <button
            type="button"
            key={i}
            className={`pad${i === selected ? ' selected' : ''}${channel.pads?.[i] ? '' : ' empty'}${dropTarget === i ? ' dropping' : ''}`}
            style={channel.pads?.[i] ? { borderColor: channel.color } : undefined}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              setSelected(i);
              release();
              voice.current = engine.previewNote(channel.id, FIRST_PAD_KEY + i, 0.9);
            }}
            onContextMenu={(e) =>
              openContextMenu(
                e,
                [
                  { label: 'Carregar sample…', action: () => void loadPadSample(channel.id, i) },
                  { label: 'Limpar pad', disabled: !channel.pads?.[i], action: () => a.setPadSample(channel.id, i, '', null) },
                ],
                `Pad ${i + 1} · ${keyName(FIRST_PAD_KEY + i)}`,
              )
            }
            onDragOver={(e) => {
              if (!isAudioDrag(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              setDropTarget(i);
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              setDropTarget(null);
              if (!isAudioDrag(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              void readDroppedAudio(e.dataTransfer).then((audio) => audio && loadPadSample(channel.id, i, audio));
            }}
            title={`Pad ${i + 1} (${keyName(FIRST_PAD_KEY + i)}) — clique: tocar · arraste um áudio: trocar · botão direito: opções`}
          >
            <span className="pad-num">{i + 1}</span>
            <span className="pad-name">{padName(i) || 'vazio'}</span>
            <span className="pad-key">{keyName(FIRST_PAD_KEY + i)}</span>
          </button>
        ))}
      </div>
      <div className="pads-side">
        <fieldset className="param-group">
          <legend>Pad {selected + 1}</legend>
          <div className="param-row">
            {knob(`pad${selected}Vol`, 'Volume')}
            {knob(`pad${selected}Tune`, 'Afinação')}
            {knob(`pad${selected}Pan`, 'Pan')}
          </div>
        </fieldset>
        <fieldset className="param-group">
          <legend>Saída</legend>
          <div className="param-row">{knob('gain', 'Volume geral')}</div>
        </fieldset>
        <button type="button" className="text-btn" onClick={() => confirm('Trocar todos os pads pelo kit sintetizado?') && void fillWithSynthKit(channel.id)}>
          Carregar kit sintetizado
        </button>
        <div className="browser-note">
          Os {PAD_COUNT} pads tocam nas teclas {keyName(FIRST_PAD_KEY)} a {keyName(FIRST_PAD_KEY + PAD_COUNT - 1)}. Use o Piano Roll para programar
          a batida.
        </div>
      </div>
    </div>
  );
}
