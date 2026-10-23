import { useRef } from 'react';
import { actions, selectedPattern, useStore, type WindowId } from '../state/store';
import { engine } from '../audio/engine';
import { BEAT_UNITS, formatPosition, formatTimeSig, MAX_BEATS } from '../model/time';
import { DragNumber, IconButton } from './controls';
import { usePlayheadFrame, usePlaying } from './hooks';
import { confirmDiscard, exportMidi, importMidi, newProject, openProject, saveProject } from './fileOps';
import { openContextMenu } from './ContextMenu';
import { runExport, useExportProgress } from './exporter';
import { enableMidi, useMidi } from '../audio/midi';
import { refreshInputs, setInput, setMonitor, useRecorder } from '../audio/recorder';

const WINDOW_BUTTONS: Array<{ id: WindowId; label: string; key: string; name?: string }> = [
  { id: 'playlist', label: 'Playlist', key: 'F5' },
  { id: 'channelRack', label: 'Rack', key: 'F6', name: 'Channel Rack' },
  { id: 'pianoRoll', label: 'Piano Roll', key: 'F7' },
  { id: 'mixer', label: 'Mixer', key: 'F9' },
];

function TimeDisplay() {
  const ref = useRef<HTMLDivElement>(null);
  const songStart = useStore((s) => s.ui.songStart);
  const mode = useStore((s) => s.ui.mode);
  const sig = useStore((s) => s.project.timeSig);
  usePlayheadFrame((pos) => {
    if (ref.current) ref.current.textContent = formatPosition(pos ?? (mode === 'song' ? songStart : 0), sig);
  });
  return (
    <div className="time-display" ref={ref} title="Posição (compasso:tempo:passo)">
      {formatPosition(mode === 'song' ? songStart : 0, sig)}
    </div>
  );
}

/** While tempo automation plays, the tempo heard right now (next to the project tempo). */
function LiveTempo({ bpm }: { bpm: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  usePlayheadFrame((pos) => {
    const el = ref.current;
    if (!el) return;
    const live = pos === null ? bpm : engine.tempo;
    el.textContent = Math.abs(live - bpm) > 0.005 ? `→ ${live.toFixed(1)}` : '';
  });
  return <span ref={ref} className="bpm-live" title="Andamento atual (automação)" />;
}

const COMMON_SIGNATURES: Array<[number, number]> = [
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [6, 4],
  [7, 4],
  [6, 8],
  [7, 8],
  [9, 8],
  [12, 8],
];

/** Time signature of the project (bars in the playlist, piano roll, rack and metronome follow it). */
function TimeSignatureButton() {
  const sig = useStore((s) => s.project.timeSig);
  const current = formatTimeSig(sig);
  return (
    <button
      type="button"
      className="time-sig"
      title="Fórmula de compasso"
      onClick={(e) =>
        openContextMenu(
          e,
          [
            ...COMMON_SIGNATURES.map(([b, u]) => ({
              label: `${current === `${b}/${u}` ? '✓ ' : ''}${b}/${u}`,
              action: () => actions().setTimeSignature(b, u),
            })),
            {
              label: 'Outra…',
              action: () => {
                const text = prompt(`Fórmula de compasso (tempos/figura, ex.: 11/8). Tempos: 1 a ${MAX_BEATS}; figura: ${BEAT_UNITS.join(', ')}`, current);
                const m = text?.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
                if (!m) return;
                const beats = Number(m[1]);
                const unit = Number(m[2]);
                if (beats >= 1 && beats <= MAX_BEATS && BEAT_UNITS.includes(unit)) actions().setTimeSignature(beats, unit);
                else alert('Fórmula inválida.');
              },
            },
          ],
          'Fórmula de compasso',
        )
      }
    >
      {current}
    </button>
  );
}

export function Toolbar({ onResetLayout }: { onResetLayout(): void }) {
  const playing = usePlaying();
  const mode = useStore((s) => s.ui.mode);
  const metronome = useStore((s) => s.ui.metronome);
  const recording = useStore((s) => s.ui.recording);
  const recordMode = useStore((s) => s.ui.recordMode);
  const recorder = useRecorder();
  const midi = useMidi();
  const bpm = useStore((s) => s.project.bpm);
  const name = useStore((s) => s.project.name);
  const patterns = useStore((s) => s.project.patterns);
  const pattern = useStore(selectedPattern);
  const windows = useStore((s) => s.ui.windows);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const exporting = useExportProgress((s) => s.progress);

  return (
    <div className="toolbar">
      <div className="brand" title="MusicCreator">
        <span className="brand-mark">M</span>
        <input
          className="project-name"
          key={name}
          defaultValue={name}
          onBlur={(e) => actions().setProjectName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          title="Nome do projeto"
        />
      </div>

      <div className="tool-group">
        <IconButton
          onClick={(e) =>
            openContextMenu(
              { clientX: e.currentTarget.getBoundingClientRect().left, clientY: e.currentTarget.getBoundingClientRect().bottom + 2, preventDefault: () => {} },
              [
                { label: 'Novo projeto', action: newProject },
                { label: 'Abrir projeto…', action: () => void openProject() },
                { label: 'Salvar', action: () => void saveProject() },
                { label: 'Salvar como…', action: () => void saveProject(true) },
                { label: `Exportar WAV (${mode === 'song' ? 'música' : 'pattern'})…`, action: () => void runExport(), disabled: exporting !== null },
                { label: `Exportar MIDI (${mode === 'song' ? 'música' : 'pattern'})…`, action: () => void exportMidi() },
                { label: 'Importar MIDI…', action: () => void importMidi() },
                { label: 'Carregar música demo', action: () => confirmDiscard() && actions().loadDemo() },
              ],
            )
          }
          title="Arquivo: novo, abrir, salvar, exportar WAV/MIDI, importar MIDI"
        >
          Arquivo ▾
        </IconButton>
        <IconButton onClick={() => void saveProject()} title="Salvar projeto (Ctrl+S)">
          Salvar
        </IconButton>
        <IconButton onClick={() => void runExport()} title={`Exportar ${mode === 'song' ? 'a música' : 'o pattern'} como WAV`} disabled={exporting !== null}>
          {exporting === null ? 'Exportar' : `Renderizando ${Math.round(exporting * 100)}%`}
        </IconButton>
      </div>

      <div className="tool-group">
        <IconButton onClick={() => actions().undo()} disabled={!canUndo} title="Desfazer (Ctrl+Z)">
          ↶
        </IconButton>
        <IconButton onClick={() => actions().redo()} disabled={!canRedo} title="Refazer (Ctrl+Y)">
          ↷
        </IconButton>
      </div>

      <div className="tool-group transport">
        <div className="mode-switch" role="radiogroup" aria-label="Modo de reprodução">
          <button type="button" className={mode === 'pattern' ? 'on' : ''} onClick={() => actions().setMode('pattern')} title="Tocar o pattern selecionado (L alterna)">
            PAT
          </button>
          <button type="button" className={mode === 'song' ? 'on' : ''} onClick={() => actions().setMode('song')} title="Tocar a música da Playlist (L alterna)">
            SONG
          </button>
        </div>
        <button type="button" className={`play-btn${playing ? ' playing' : ''}`} onClick={() => engine.toggle()} title="Tocar / parar (Espaço)">
          {playing ? '■' : '▶'}
        </button>
        <button
          type="button"
          className={`rec-btn${recording ? ' armed' : ''}${recorder.state === 'recording' ? ' live' : ''}`}
          onClick={() => actions().toggleRecording()}
          onContextMenu={(e) => {
            void refreshInputs();
            const check = (on: boolean) => (on ? '✓ ' : '');
            openContextMenu(
              e,
              [
                { label: `${check(recordMode === 'notes')}Gravar notas (teclado / MIDI, modo PAT)`, action: () => actions().setRecordMode('notes') },
                {
                  label: `${check(recordMode === 'audio')}Gravar áudio (microfone / interface, modo SONG)`,
                  action: () => {
                    actions().setRecordMode('audio');
                    actions().setMode('song');
                  },
                },
                {
                  label: `${check(recorder.monitor)}Ouvir a entrada pelo master (use fones)`,
                  action: () => setMonitor(!recorder.monitor),
                },
                { label: `${check(recorder.inputId === null)}Entrada: padrão do sistema`, action: () => setInput(null) },
                ...recorder.inputs.map((input) => ({
                  label: `${check(recorder.inputId === input.id)}Entrada: ${input.label}`,
                  action: () => setInput(input.id),
                })),
              ],
              'Gravação',
            );
          }}
          title={
            recordMode === 'audio'
              ? recording
                ? 'Gravação de áudio armada: toque a música (SONG) e a entrada vira um clip de áudio na Playlist'
                : 'Armar gravação de áudio (botão direito: escolher notas ou áudio)'
              : recording
                ? 'Gravação armada: as notas tocadas (teclado ou MIDI) entram no pattern enquanto ele toca (modo PAT)'
                : 'Armar gravação de notas (botão direito: escolher notas ou áudio)'
          }
        >
          ●<span className="rec-mode">{recordMode === 'audio' ? 'A' : 'N'}</span>
        </button>
        {recordMode === 'audio' && recording && (
          <div className="input-meter" title="Nível da entrada de áudio">
            <div style={{ transform: `scaleX(${Math.min(1, recorder.level)})` }} />
          </div>
        )}
        <IconButton active={metronome} onClick={() => actions().toggleMetronome()} title="Metrônomo">
          ♩
        </IconButton>
        <IconButton
          active={midi.state === 'on' && midi.inputs.length > 0}
          disabled={midi.state === 'unsupported'}
          onClick={() => void enableMidi()}
          title={
            midi.state === 'unsupported'
              ? 'Este navegador não tem suporte a MIDI'
              : midi.state === 'denied'
                ? 'Acesso ao MIDI negado'
                : midi.state === 'on'
                  ? midi.inputs.length
                    ? `Teclados MIDI: ${midi.inputs.join(', ')}`
                    : 'MIDI ligado — nenhum teclado conectado'
                  : 'Ligar teclados MIDI'
          }
        >
          MIDI{midi.state === 'on' ? ` ${midi.inputs.length}` : ''}
        </IconButton>
        <TimeDisplay />
        <div
          className="bpm"
          title="Andamento: arraste para cima/baixo ou dê duplo clique para digitar · botão direito: automação"
          onContextMenu={(e) =>
            openContextMenu(
              e,
              [
                {
                  label: 'Criar clip de automação do andamento',
                  action: () => {
                    if (actions().addAutomationClip({ kind: 'tempo' })) actions().toggleWindow('playlist', true);
                  },
                },
              ],
              'Andamento',
            )
          }
        >
          <DragNumber
            value={bpm}
            min={20}
            max={400}
            step={1}
            onChange={(v, gesture) => actions().setBpm(v, gesture)}
            format={(v) => v.toFixed(v % 1 ? 2 : 0)}
          />
          <span>BPM</span>
          <LiveTempo bpm={bpm} />
        </div>
        <TimeSignatureButton />
      </div>

      <div className="tool-group">
        <select
          className="pattern-select"
          value={pattern.id}
          onChange={(e) => actions().selectPattern(e.target.value)}
          title="Pattern selecionado"
          style={{ borderLeftColor: pattern.color }}
        >
          {patterns.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <IconButton onClick={() => actions().addPattern()} title="Novo pattern">
          +
        </IconButton>
      </div>

      <div className="tool-group windows">
        {WINDOW_BUTTONS.map((b) => (
          <IconButton key={b.id} active={windows[b.id].open} onClick={() => actions().toggleWindow(b.id)} title={`${b.name ?? b.label} (${b.key})`}>
            {b.label}
          </IconButton>
        ))}
        <IconButton onClick={onResetLayout} title="Reorganizar as janelas para caber na tela">
          ⊞
        </IconButton>
      </div>
    </div>
  );
}
