import { memo, useEffect, useRef, useState } from 'react';
import type { Pattern, PlaylistClip } from '../model/types';
import { actions, selectedPattern, useStore } from '../state/store';
import { patternLength, songLength } from '../model/pattern';
import { snapFloor, snapRound, TICKS_PER_BAR, PPQ, TICKS_PER_STEP } from '../model/time';
import { engine } from '../audio/engine';
import { startDrag } from './controls';
import { usePlayheadFrame } from './hooks';
import { getActiveScope, isTyping, setActiveScope } from './focus';

const LANE_H = 42;
const HEADER_W = 132;
const RULER_H = 22;
const BASE_PPT = 64 / TICKS_PER_BAR;
const EDGE_PX = 7;
const MIN_BARS = 32;

const SNAP_OPTIONS = [
  { label: 'Compasso', ticks: TICKS_PER_BAR },
  { label: 'Tempo', ticks: PPQ },
  { label: 'Passo', ticks: TICKS_PER_STEP },
  { label: 'Livre', ticks: 1 },
];

/** Miniature of a pattern's notes, repeated across the clip like playback does. */
const ClipPreview = memo(function ClipPreview({ pattern, clipLength }: { pattern: Pattern; clipLength: number }) {
  const length = patternLength(pattern);
  const all = Object.values(pattern.notes).flat();
  if (!all.length) return null;
  const keys = all.map((n) => n.key);
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  const range = Math.max(12, hi - lo + 1);
  const reps = Math.ceil(clipLength / length);
  return (
    <svg className="clip-preview" viewBox={`0 0 ${clipLength} ${range}`} preserveAspectRatio="none">
      {Array.from({ length: reps }, (_, r) =>
        all
          .filter((n) => r * length + n.start < clipLength)
          .map((n) => (
            <rect
              key={`${r}-${n.id}`}
              x={r * length + n.start}
              y={hi - n.key + (range - (hi - lo + 1)) / 2}
              width={Math.max(n.length, clipLength / 300)}
              height={1}
            />
          )),
      )}
      {Array.from({ length: reps - 1 }, (_, r) => (
        <line key={`l${r}`} x1={(r + 1) * length} x2={(r + 1) * length} y1={0} y2={range} className="clip-repeat" />
      ))}
    </svg>
  );
});

export function Playlist() {
  const project = useStore((s) => s.project);
  const { snap, zoom } = useStore((s) => s.ui.playlist);
  const songStart = useStore((s) => s.ui.songStart);
  const mode = useStore((s) => s.ui.mode);
  const current = useStore(selectedPattern);
  const gridRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const a = actions();

  const ppt = BASE_PPT * zoom;
  const { tracks, clips } = project.playlist;
  const bars = Math.max(MIN_BARS, songLength(project) / TICKS_PER_BAR + 8);
  const width = bars * TICKS_PER_BAR * ppt;
  const height = tracks.length * LANE_H;
  const patterns = new Map(project.patterns.map((p) => [p.id, p]));

  usePlayheadFrame((pos) => {
    const el = playheadRef.current;
    if (!el) return;
    const p = pos !== null && mode === 'song' ? pos : mode === 'song' || pos === null ? songStart : null;
    if (p === null) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.transform = `translateX(${p * ppt}px)`;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (getActiveScope() !== 'playlist' || isTyping(e) || !selectedClip) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        actions().removeClip(selectedClip);
        setSelectedClip(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClip]);

  const toGrid = (clientX: number, clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect();
    return {
      tick: Math.max(0, (clientX - rect.left) / ppt),
      track: Math.min(tracks.length - 1, Math.max(0, Math.floor((clientY - rect.top) / LANE_H))),
    };
  };

  const dragClip = (e: React.PointerEvent, clip: PlaylistClip, resize: boolean) => {
    const origin = { ...clip };
    startDrag(e, {
      onStart: () => a.beginGesture(),
      onMove: (dx, dy, ev) => {
        const step = ev.altKey ? 1 : snap;
        if (resize) {
          const end = snapRound(origin.start + origin.length + dx / ppt, step);
          a.updateClip(clip.id, { length: Math.max(step, end - origin.start) });
        } else {
          const start = Math.max(0, snapRound(origin.start + dx / ppt, step));
          a.updateClip(clip.id, { start, track: origin.track + Math.round(dy / LANE_H) });
        }
      },
      onEnd: () => a.endGesture(),
    });
  };

  const onGridPointerDown = (e: React.PointerEvent) => {
    setActiveScope('playlist');
    const clipEl = (e.target as HTMLElement).closest<HTMLElement>('[data-clip]');
    const clip = clipEl ? clips.find((c) => c.id === clipEl.dataset.clip) : undefined;

    if (e.button === 2) {
      e.preventDefault();
      a.beginGesture();
      if (clip) a.removeClip(clip.id);
      startDrag(e, {
        onMove: (_dx, _dy, ev) => {
          const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-clip]');
          if (el?.dataset.clip) a.removeClip(el.dataset.clip);
        },
        onEnd: () => a.endGesture(),
      });
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();

    if (clip && clipEl) {
      setSelectedClip(clip.id);
      if (clip.patternId !== current.id) a.selectPattern(clip.patternId);
      const rect = clipEl.getBoundingClientRect();
      dragClip(e, clip, e.clientX > rect.right - EDGE_PX);
      return;
    }

    const p = toGrid(e.clientX, e.clientY);
    a.beginGesture();
    const id = a.addClip(current.id, p.track, snapFloor(p.tick, snap));
    setSelectedClip(id);
    const created = useStore.getState().project.playlist.clips.find((c) => c.id === id);
    if (created) dragClip(e, created, false);
  };

  return (
    <div className="playlist" onPointerDownCapture={() => setActiveScope('playlist')}>
      <div className="pl-toolbar">
        <span className="hint-inline">Pintando com:</span>
        <span className="pattern-chip" style={{ background: current.color }}>{current.name}</span>
        <label className="inline-field">
          Grade
          <select value={snap} onChange={(e) => a.setPlaylistView({ snap: Number(e.target.value) })}>
            {SNAP_OPTIONS.map((o) => (
              <option key={o.ticks} value={o.ticks}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Zoom
          <input type="range" min={0.25} max={4} step={0.05} value={zoom} onChange={(e) => a.setPlaylistView({ zoom: Number(e.target.value) })} />
        </label>
        <span className="hint">Clique: colocar pattern · arrastar: mover · borda: esticar (repete) · botão direito: apagar · régua: posição</span>
      </div>
      <div className="pl-body">
        <div className="pl-patterns" title="Patterns do projeto: clique para escolher qual pintar">
          {project.patterns.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`pl-pattern${p.id === current.id ? ' on' : ''}`}
              style={{ borderLeftColor: p.color }}
              onClick={() => a.selectPattern(p.id)}
              onDoubleClick={() => a.toggleWindow('channelRack', true)}
            >
              {p.name}
            </button>
          ))}
          <button type="button" className="pl-pattern add" onClick={() => a.addPattern()}>
            + Pattern
          </button>
        </div>
        <div className="pl-scroll">
          <div className="pl-inner" style={{ gridTemplateColumns: `${HEADER_W}px ${width}px`, gridTemplateRows: `${RULER_H}px ${height}px` }}>
            <div className="pl-corner" />
            <div
              className="pl-ruler"
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const tick = snapFloor((e.clientX - rect.left) / ppt, TICKS_PER_BAR);
                a.setSongStart(tick);
                if (engine.isPlaying && mode === 'song') engine.restart();
              }}
              title="Clique para definir onde a música começa a tocar"
            >
              {Array.from({ length: bars }, (_, bar) => (
                <span key={bar} style={{ left: bar * TICKS_PER_BAR * ppt }}>{bar + 1}</span>
              ))}
              <div className="song-start" style={{ left: songStart * ppt }} />
            </div>
            <div className="pl-headers">
              {tracks.map((t, i) => (
                <div key={t.id} className={`pl-track${t.mute ? ' muted' : ''}`} style={{ height: LANE_H }}>
                  <button
                    type="button"
                    className={`led${t.mute ? '' : ' on'}`}
                    onClick={() => a.updateTrack(i, { mute: !t.mute })}
                    title="Ligar/silenciar faixa"
                  />
                  <span
                    className="pl-track-name"
                    onDoubleClick={() => {
                      const name = prompt('Nome da faixa', t.name);
                      if (name) a.updateTrack(i, { name });
                    }}
                    title="Duplo clique para renomear"
                  >
                    {t.name}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="pl-grid"
              ref={gridRef}
              style={{
                width,
                height,
                backgroundSize: `${TICKS_PER_BAR * 8 * ppt}px 100%, ${TICKS_PER_BAR * ppt}px 100%, 100% ${LANE_H}px`,
              }}
              onPointerDown={onGridPointerDown}
              onContextMenu={(e) => e.preventDefault()}
            >
              {clips.map((clip) => {
                const p = patterns.get(clip.patternId);
                if (!p) return null;
                const muted = tracks[clip.track]?.mute;
                return (
                  <div
                    key={clip.id}
                    data-clip={clip.id}
                    className={`clip${clip.id === selectedClip ? ' selected' : ''}${muted ? ' muted' : ''}`}
                    style={{
                      left: clip.start * ppt,
                      top: clip.track * LANE_H + 1,
                      width: Math.max(6, clip.length * ppt - 1),
                      height: LANE_H - 2,
                      background: `${p.color}33`,
                      borderColor: p.color,
                      color: p.color,
                    }}
                    onDoubleClick={() => {
                      a.selectPattern(p.id);
                      a.toggleWindow('channelRack', true);
                    }}
                    title={`${p.name} — duplo clique abre no Channel Rack`}
                  >
                    <span className="clip-name" style={{ background: p.color }}>{p.name}</span>
                    <ClipPreview pattern={p} clipLength={clip.length} />
                  </div>
                );
              })}
              <div ref={playheadRef} className="playhead" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
