import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AudioClip, AutomationClip, Channel, Pattern, PlaylistClip } from '../model/types';
import { actions, selectedPattern, useStore } from '../state/store';
import { patternLength, songLength } from '../model/pattern';
import { secondsPerTick, snapFloor, snapRound, TICKS_PER_BAR, PPQ, TICKS_PER_STEP } from '../model/time';
import { describeTarget } from '../model/automation';
import { engine } from '../audio/engine';
import { startDrag } from './controls';
import { useDecodedSample, usePlayheadFrame } from './hooks';
import { getActiveScope, isTyping, setActiveScope } from './focus';
import { addSamplerChannel } from './fileOps';
import { isAudioDrag, readDroppedAudio } from './dnd';
import { openContextMenu } from './ContextMenu';

const LANE_H = 42;
const HEADER_W = 132;
const RULER_H = 22;
const CLIP_HEADER = 14;
const BASE_PPT = 64 / TICKS_PER_BAR;
const EDGE_PX = 7;
const MIN_BARS = 32;
const AUTOMATION_COLOR = '#7ed957';
const AUDIO_COLOR = '#3dc6ff';

const SNAP_OPTIONS = [
  { label: 'Compasso', ticks: TICKS_PER_BAR },
  { label: 'Tempo', ticks: PPQ },
  { label: 'Passo', ticks: TICKS_PER_STEP },
  { label: 'Livre', ticks: 1 },
];

/** Miniature of a pattern's notes, repeated across the clip like playback does. */
const PatternPreview = memo(function PatternPreview({ pattern, clipLength }: { pattern: Pattern; clipLength: number }) {
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

/** Waveform of the part of the sample an audio clip plays. */
const AudioPreview = memo(function AudioPreview({ clip, channel, ppt, spt }: { clip: AudioClip; channel?: Channel; ppt: number; spt: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const buffer = useDecodedSample(channel?.sampleId);
  const width = Math.min(4096, Math.max(1, Math.round(clip.length * ppt)));
  useLayoutEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    el.width = width;
    el.height = LANE_H - CLIP_HEADER - 4;
    ctx.clearRect(0, 0, el.width, el.height);
    if (!buffer) return;
    const data = buffer.getChannelData(0);
    const from = clip.offset * buffer.sampleRate;
    const perPixel = (clip.length * spt * buffer.sampleRate) / width;
    const mid = el.height / 2;
    ctx.fillStyle = AUDIO_COLOR;
    for (let x = 0; x < width; x++) {
      const a = Math.floor(from + x * perPixel);
      const b = Math.min(data.length, Math.floor(from + (x + 1) * perPixel));
      if (a >= data.length) break;
      let peak = 0;
      // Stride through long spans; plenty for a display.
      const stride = Math.max(1, Math.floor((b - a) / 64));
      for (let i = a; i < b; i += stride) peak = Math.max(peak, Math.abs(data[i]));
      ctx.fillRect(x, mid - peak * mid, 1, Math.max(1, peak * mid * 2));
    }
  }, [buffer, clip.offset, clip.length, width, spt]);
  return <canvas ref={canvas} className="clip-wave" />;
});

/** Automation curve with draggable points. */
function AutomationCurve({ clip, ppt }: { clip: AutomationClip; ppt: number }) {
  const w = clip.length * ppt;
  const h = LANE_H - CLIP_HEADER - 4;
  const pad = 3;
  const y = (v: number) => pad + (1 - v) * (h - pad * 2);
  const pts = clip.points.map((p) => `${p.t * ppt},${y(p.v)}`);
  const first = clip.points[0];
  const last = clip.points[clip.points.length - 1];
  const line = [`0,${y(first.v)}`, ...pts, `${w},${y(last.v)}`].join(' ');
  return (
    <svg className="clip-curve" width={w} height={h}>
      <polygon points={`0,${h} ${line} ${w},${h}`} className="curve-fill" />
      <polyline points={line} className="curve-line" />
      {clip.points.map((p, i) => (
        <circle key={i} data-point={i} cx={p.t * ppt} cy={y(p.v)} r={4} className="curve-point" />
      ))}
    </svg>
  );
}

export function Playlist() {
  const project = useStore((s) => s.project);
  const { snap, zoom } = useStore((s) => s.ui.playlist);
  const songStart = useStore((s) => s.ui.songStart);
  const mode = useStore((s) => s.ui.mode);
  const current = useStore(selectedPattern);
  const gridRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const a = actions();

  const ppt = BASE_PPT * zoom;
  const spt = secondsPerTick(project.bpm);
  const { tracks, clips } = project.playlist;
  const bars = Math.max(MIN_BARS, songLength(project) / TICKS_PER_BAR + 8);
  const width = bars * TICKS_PER_BAR * ppt;
  const height = tracks.length * LANE_H;
  const patterns = new Map(project.patterns.map((p) => [p.id, p]));
  const channels = new Map(project.channels.map((c) => [c.id, c]));

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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        const copy = actions().duplicateClip(selectedClip);
        if (copy) setSelectedClip(copy);
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

  const dragClip = (e: React.PointerEvent, clip: PlaylistClip, edge: 'move' | 'end' | 'start') => {
    const origin = { ...clip };
    startDrag(e, {
      onStart: () => a.beginGesture(),
      onMove: (dx, dy, ev) => {
        const step = ev.altKey ? 1 : snap;
        if (edge === 'end') {
          const end = snapRound(origin.start + origin.length + dx / ppt, step);
          a.updateClip(clip.id, { length: Math.max(step, end - origin.start) });
        } else if (edge === 'start' && origin.kind === 'audio') {
          // Trimming the front of an audio clip skips into the sample.
          const minStart = Math.max(0, origin.start - origin.offset / spt);
          const start = Math.min(origin.start + origin.length - TICKS_PER_STEP, Math.max(minStart, snapRound(origin.start + dx / ppt, step)));
          const moved = start - origin.start;
          a.updateClip(clip.id, { start, length: origin.length - moved, offset: Math.max(0, origin.offset + moved * spt) });
        } else {
          const start = Math.max(0, snapRound(origin.start + dx / ppt, step));
          a.updateClip(clip.id, { start, track: origin.track + Math.round(dy / LANE_H) });
        }
      },
      onEnd: () => a.endGesture(),
    });
  };

  const dragPoint = (e: React.PointerEvent, clip: AutomationClip, index: number) => {
    const origin = clip.points.map((p) => ({ ...p }));
    const h = LANE_H - CLIP_HEADER - 4 - 6;
    startDrag(e, {
      onStart: () => a.beginGesture(),
      onMove: (dx, dy, ev) => {
        const p = origin[index];
        const lo = index > 0 ? origin[index - 1].t : 0;
        const hi = index < origin.length - 1 ? origin[index + 1].t : clip.length;
        let t = p.t + dx / ppt;
        if (!ev.altKey && snap > 1) t = snapRound(t, Math.min(snap, TICKS_PER_STEP));
        const points = origin.map((q, i) => (i === index ? { t: Math.min(hi, Math.max(lo, t)), v: Math.min(1, Math.max(0, p.v - dy / h)) } : q));
        a.setAutomationPoints(clip.id, points);
      },
      onEnd: () => a.endGesture(),
    });
  };

  const addPoint = (clip: AutomationClip, clientX: number, clientY: number, el: HTMLElement) => {
    const svg = el.querySelector('svg')?.getBoundingClientRect();
    if (!svg) return;
    const t = Math.min(clip.length, Math.max(0, (clientX - svg.left) / ppt));
    const v = Math.min(1, Math.max(0, 1 - (clientY - svg.top - 3) / (svg.height - 6)));
    a.beginGesture();
    a.setAutomationPoints(clip.id, [...clip.points, { t, v }]);
    a.endGesture();
  };

  const onGridPointerDown = (e: React.PointerEvent) => {
    setActiveScope('playlist');
    const target = e.target as Element;
    const clipEl = target.closest<HTMLElement>('[data-clip]');
    const clip = clipEl ? clips.find((c) => c.id === clipEl.dataset.clip) : undefined;
    const pointIndex = target.closest('[data-point]')?.getAttribute('data-point');

    if (e.button === 2) {
      e.preventDefault();
      // The clip's name strip opens its menu; the rest of the clip is erased like in other DAWs.
      if (clip && target.closest('.clip-name')) {
        openClipMenu(e, clip);
        return;
      }
      if (clip?.kind === 'automation' && pointIndex != null) {
        if (clip.points.length > 1) {
          a.beginGesture();
          a.setAutomationPoints(clip.id, clip.points.filter((_, i) => i !== Number(pointIndex)));
          a.endGesture();
        }
        return;
      }
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
      if (clip.kind === 'automation' && pointIndex != null) {
        dragPoint(e, clip, Number(pointIndex));
        return;
      }
      if (clip.kind === 'pattern' && clip.patternId !== current.id) a.selectPattern(clip.patternId);
      if (clip.kind === 'audio') a.selectChannel(clip.channelId);
      const rect = clipEl.getBoundingClientRect();
      const edge = e.clientX > rect.right - EDGE_PX ? 'end' : clip.kind === 'audio' && e.clientX < rect.left + EDGE_PX ? 'start' : 'move';
      dragClip(e, clip, edge);
      return;
    }

    const p = toGrid(e.clientX, e.clientY);
    a.beginGesture();
    const id = a.addClip(current.id, p.track, snapFloor(p.tick, snap));
    setSelectedClip(id);
    const created = useStore.getState().project.playlist.clips.find((c) => c.id === id);
    if (created) dragClip(e, created, 'move');
  };

  const openClipMenu = (e: React.PointerEvent, clip: PlaylistClip) => {
    setSelectedClip(clip.id);
    openContextMenu(
      e,
      [
        {
          label: 'Duplicar (Ctrl+B)',
          action: () => {
            const copy = a.duplicateClip(clip.id);
            if (copy) setSelectedClip(copy);
          },
        },
        ...(clip.kind === 'pattern'
          ? [
              { label: 'Tornar único (cópia do pattern)', action: () => a.makeClipUnique(clip.id) },
              {
                label: 'Abrir no Channel Rack',
                action: () => {
                  a.selectPattern(clip.patternId);
                  a.toggleWindow('channelRack', true);
                },
              },
            ]
          : []),
        ...(clip.kind === 'audio' ? [{ label: 'Abrir o sampler', action: () => a.openPluginWindow({ kind: 'channel', channelId: clip.channelId }) }] : []),
        { label: 'Excluir', danger: true, action: () => a.removeClip(clip.id) },
      ],
      'Clip',
    );
  };

  const onDrop = (e: React.DragEvent) => {
    setDropping(false);
    if (!isAudioDrag(e.dataTransfer)) return;
    e.preventDefault();
    const p = toGrid(e.clientX, e.clientY);
    const start = snapFloor(p.tick, snap);
    void readDroppedAudio(e.dataTransfer).then(async (audio) => {
      if (!audio) return;
      const created = await addSamplerChannel(audio.name, audio.bytes);
      if (!created) return;
      const length = Math.max(TICKS_PER_STEP, Math.ceil(created.duration / spt / TICKS_PER_STEP) * TICKS_PER_STEP);
      const id = actions().addAudioClip(created.id, p.track, start, length);
      setSelectedClip(id);
    });
  };

  const clipView = (clip: PlaylistClip) => {
    const muted = tracks[clip.track]?.mute;
    const box = {
      left: clip.start * ppt,
      top: clip.track * LANE_H + 1,
      width: Math.max(6, clip.length * ppt - 1),
      height: LANE_H - 2,
    };
    const className = `clip clip-${clip.kind}${clip.id === selectedClip ? ' selected' : ''}${muted ? ' muted' : ''}`;
    if (clip.kind === 'pattern') {
      const p = patterns.get(clip.patternId);
      if (!p) return null;
      return (
        <div
          key={clip.id}
          data-clip={clip.id}
          className={className}
          style={{ ...box, background: `${p.color}33`, borderColor: p.color, color: p.color }}
          onDoubleClick={() => {
            a.selectPattern(p.id);
            a.toggleWindow('channelRack', true);
          }}
          title={`${p.name} — duplo clique abre no Channel Rack`}
        >
          <span className="clip-name" style={{ background: p.color }}>{p.name}</span>
          <PatternPreview pattern={p} clipLength={clip.length} />
        </div>
      );
    }
    if (clip.kind === 'audio') {
      const channel = channels.get(clip.channelId);
      return (
        <div
          key={clip.id}
          data-clip={clip.id}
          className={className}
          style={{ ...box, background: `${AUDIO_COLOR}22`, borderColor: AUDIO_COLOR, color: AUDIO_COLOR }}
          onDoubleClick={() => a.openPluginWindow({ kind: 'channel', channelId: clip.channelId })}
          title={`${channel?.name ?? 'Áudio'} — bordas: cortar · duplo clique: abrir o sampler`}
        >
          <span className="clip-name" style={{ background: AUDIO_COLOR }}>{channel?.name ?? 'Áudio'}</span>
          <AudioPreview clip={clip} channel={channel} ppt={ppt} spt={spt} />
        </div>
      );
    }
    const label = describeTarget(project, clip.target)?.label ?? 'Automação';
    return (
      <div
        key={clip.id}
        data-clip={clip.id}
        className={className}
        style={{ ...box, background: `${AUTOMATION_COLOR}1a`, borderColor: AUTOMATION_COLOR, color: AUTOMATION_COLOR }}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest('[data-point]')) addPoint(clip, e.clientX, e.clientY, e.currentTarget);
        }}
        title={`${label} — duplo clique: novo ponto · arraste os pontos · botão direito num ponto: apagar`}
      >
        <span className="clip-name" style={{ background: AUTOMATION_COLOR }}>{label}</span>
        <AutomationCurve clip={clip} ppt={ppt} />
      </div>
    );
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
        <span className="hint">
          Clique: colocar pattern · arrastar: mover · borda: esticar · botão direito: apagar (no nome do clip: menu) · Ctrl+B: duplicar · arraste áudio para criar clips
        </span>
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
                <div
                  key={t.id}
                  className={`pl-track${t.mute ? ' muted' : ''}`}
                  style={{ height: LANE_H }}
                  onContextMenu={(e) =>
                    openContextMenu(
                      e,
                      [
                        {
                          label: 'Renomear…',
                          action: () => {
                            const name = prompt('Nome da faixa', t.name);
                            if (name) a.updateTrack(i, { name });
                          },
                        },
                        { label: t.mute ? 'Ligar faixa' : 'Silenciar faixa', action: () => a.updateTrack(i, { mute: !t.mute }) },
                      ],
                      t.name,
                    )
                  }
                >
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
                    title={`${t.name} — duplo clique para renomear`}
                  >
                    {t.name}
                  </span>
                </div>
              ))}
            </div>
            <div
              className={`pl-grid${dropping ? ' dropping' : ''}`}
              ref={gridRef}
              style={{
                width,
                height,
                backgroundSize: `${TICKS_PER_BAR * 8 * ppt}px 100%, ${TICKS_PER_BAR * ppt}px 100%, 100% ${LANE_H}px`,
              }}
              onPointerDown={onGridPointerDown}
              onContextMenu={(e) => e.preventDefault()}
              onDragOver={(e) => {
                if (!isAudioDrag(e.dataTransfer)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={onDrop}
            >
              {clips.map(clipView)}
              <div ref={playheadRef} className="playhead" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
