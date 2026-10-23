import { useRef, useState } from 'react';
import { actions, selectedPattern, useStore, type WindowId } from '../state/store';
import { engine } from '../audio/engine';
import { formatPosition } from '../model/time';
import { DragNumber, IconButton } from './controls';
import { usePlayheadFrame, usePlaying } from './hooks';
import { exportWav, openProjectFile, saveProjectFile } from './fileOps';

const WINDOW_BUTTONS: Array<{ id: WindowId; label: string; key: string }> = [
  { id: 'playlist', label: 'Playlist', key: 'F5' },
  { id: 'channelRack', label: 'Channel Rack', key: 'F6' },
  { id: 'pianoRoll', label: 'Piano Roll', key: 'F7' },
  { id: 'mixer', label: 'Mixer', key: 'F9' },
];

function TimeDisplay() {
  const ref = useRef<HTMLDivElement>(null);
  const songStart = useStore((s) => s.ui.songStart);
  const mode = useStore((s) => s.ui.mode);
  usePlayheadFrame((pos) => {
    if (ref.current) ref.current.textContent = formatPosition(pos ?? (mode === 'song' ? songStart : 0));
  });
  return (
    <div className="time-display" ref={ref} title="Posição (compasso:tempo:passo)">
      {formatPosition(mode === 'song' ? songStart : 0)}
    </div>
  );
}

export function Toolbar({ onResetLayout }: { onResetLayout(): void }) {
  const playing = usePlaying();
  const mode = useStore((s) => s.ui.mode);
  const metronome = useStore((s) => s.ui.metronome);
  const bpm = useStore((s) => s.project.bpm);
  const name = useStore((s) => s.project.name);
  const patterns = useStore((s) => s.project.patterns);
  const pattern = useStore(selectedPattern);
  const windows = useStore((s) => s.ui.windows);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [exporting, setExporting] = useState<number | null>(null);

  const doExport = async () => {
    if (exporting !== null) return;
    setExporting(0);
    try {
      await exportWav(setExporting);
    } catch (err) {
      console.error(err);
      alert('Falha ao exportar o áudio.');
    } finally {
      setExporting(null);
    }
  };

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
        <IconButton onClick={() => confirm('Começar um projeto novo? O atual será descartado (salve antes se quiser).') && (engine.stop(), actions().newProject())} title="Novo projeto">
          Novo
        </IconButton>
        <IconButton onClick={() => void openProjectFile()} title="Abrir projeto (.mcproj)">
          Abrir
        </IconButton>
        <IconButton onClick={saveProjectFile} title="Salvar projeto (Ctrl+S)">
          Salvar
        </IconButton>
        <IconButton onClick={() => void doExport()} title={`Exportar ${mode === 'song' ? 'a música' : 'o pattern'} como WAV`} disabled={exporting !== null}>
          {exporting === null ? 'Exportar WAV' : `Renderizando ${Math.round(exporting * 100)}%`}
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
        <IconButton active={metronome} onClick={() => actions().toggleMetronome()} title="Metrônomo">
          ♩
        </IconButton>
        <TimeDisplay />
        <div className="bpm" title="Andamento: arraste para cima/baixo ou dê duplo clique para digitar">
          <DragNumber
            value={bpm}
            min={20}
            max={400}
            step={1}
            onChange={(v, gesture) => actions().setBpm(v, gesture)}
            format={(v) => v.toFixed(v % 1 ? 2 : 0)}
          />
          <span>BPM</span>
        </div>
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
          <IconButton key={b.id} active={windows[b.id].open} onClick={() => actions().toggleWindow(b.id)} title={`${b.label} (${b.key})`}>
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
