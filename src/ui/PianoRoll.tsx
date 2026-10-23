import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Channel, Note, Pattern } from '../model/types';
import { actions, selectedChannel, selectedPattern, useStore } from '../state/store';
import { patternLength } from '../model/pattern';
import { createNote } from '../model/defaults';
import { barTicks, beatTicks, isBlackKey, keyName, resolveSnap, SNAP_BAR, snapFloor, snapRound, TICKS_PER_STEP } from '../model/time';
import { engine } from '../audio/engine';
import type { Voice } from '../plugins/types';
import { startDrag } from './controls';
import { usePlayheadFrame } from './hooks';
import { getActiveScope, isTyping, setActiveScope } from './focus';
import { openContextMenu } from './ContextMenu';
import { arpeggiate, chop, chordsFrom, CHORDS, fitToScale, flip, humanize, inScale, legato, quantize, SCALES, strum } from '../model/noteTools';
import { wrap } from '../model/time';

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const ROW_H = 14;
const KEYS_W = 64;
const RULER_H = 22;
const VELOCITY_H = 72;

/** Note properties the event lane under the piano roll edits. */
type EventLane = 'velocity' | 'pan' | 'fine';
const LANES: Array<{ id: EventLane; label: string }> = [
  { id: 'velocity', label: 'Velocity' },
  { id: 'pan', label: 'Pan' },
  { id: 'fine', label: 'Afinação fina' },
];

/** A note's value in a lane, as 0..1 from the bottom of the lane. */
function laneNorm(n: Note, lane: EventLane): number {
  if (lane === 'velocity') return n.velocity;
  if (lane === 'pan') return ((n.pan ?? 0) + 1) / 2;
  return ((n.fine ?? 0) + 100) / 200;
}

/** The note patch for a position (0..1 from the bottom) in a lane; the centre snaps to zero. */
function lanePatch(norm: number, lane: EventLane): Partial<Note> {
  const x = Math.min(1, Math.max(0, norm));
  if (lane === 'velocity') return { velocity: Math.max(0.01, x) };
  const bipolar = Math.abs(x * 2 - 1) < 0.04 ? 0 : x * 2 - 1;
  return lane === 'pan' ? { pan: bipolar } : { fine: Math.round(bipolar * 100) };
}

function laneText(n: Note): string {
  const pan = n.pan ? ` · pan ${Math.round(Math.abs(n.pan) * 100)}% ${n.pan < 0 ? 'E' : 'D'}` : '';
  const fine = n.fine ? ` · ${n.fine > 0 ? '+' : ''}${n.fine} ct` : '';
  return `vel. ${Math.round(n.velocity * 100)}%${pan}${fine}`;
}
const KEY_COUNT = 128;
const BASE_PPT = 0.75;
const EDGE_PX = 6;

export const SNAP_OPTIONS: Array<{ label: string; ticks: number }> = [
  { label: 'Livre', ticks: 1 },
  { label: '1/6 passo', ticks: 4 },
  { label: '1/4 passo', ticks: 6 },
  { label: '1/3 passo', ticks: 8 },
  { label: '1/2 passo', ticks: 12 },
  { label: 'Passo (1/16)', ticks: 24 },
  { label: '1/8 tercina', ticks: 32 },
  { label: '1/2 tempo (1/8)', ticks: 48 },
  { label: 'Tempo (1/4)', ticks: 96 },
  { label: 'Compasso', ticks: SNAP_BAR },
];

const keyY = (key: number) => (KEY_COUNT - 1 - key) * ROW_H;

/** Key rows; with a scale chosen, keys outside it are shaded and the root is marked. */
const RowBackground = memo(function RowBackground({ width, scaleRoot, scale }: { width: number; scaleRoot: number; scale: number }) {
  const steps = SCALES[scale]?.steps;
  return (
    <div className="pr-rows" style={{ width }}>
      {Array.from({ length: KEY_COUNT }, (_, i) => {
        const key = KEY_COUNT - 1 - i;
        let cls = `pr-row${isBlackKey(key) ? ' black' : ''}${key % 12 === 0 ? ' c' : ''}`;
        if (steps) cls += inScale(key, scaleRoot, steps) ? (wrap(key - scaleRoot, 12) === 0 ? ' scale-root' : ' in-scale') : ' off-scale';
        return <div key={key} className={cls} style={{ height: ROW_H }} />;
      })}
    </div>
  );
});

function Keyboard({ channelId }: { channelId: string | null }) {
  const voice = useRef<Voice | null>(null);
  const stop = () => {
    voice.current?.release(engine.context?.currentTime ?? 0);
    voice.current = null;
  };
  return (
    <div className="pr-keys" onPointerUp={stop} onPointerLeave={stop}>
      {Array.from({ length: KEY_COUNT }, (_, i) => {
        const key = KEY_COUNT - 1 - i;
        return (
          <div
            key={key}
            className={`pr-key${isBlackKey(key) ? ' black' : ''}`}
            style={{ height: ROW_H }}
            onPointerDown={(e) => {
              e.preventDefault();
              stop();
              if (channelId) voice.current = engine.previewNote(channelId, key, 0.8);
            }}
          >
            {key % 12 === 0 ? keyName(key) : ''}
          </div>
        );
      })}
    </div>
  );
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function PianoRoll() {
  const pattern = useStore(selectedPattern);
  const channel = useStore(selectedChannel);
  const channels = useStore((s) => s.project.channels);
  const { snap, zoom, scaleRoot, scale, stamp } = useStore((s) => s.ui.pianoRoll);
  const mode = useStore((s) => s.ui.mode);
  const a = actions();

  if (!channel) {
    return <div className="empty-hint">Selecione um canal no Channel Rack para editar suas notas.</div>;
  }
  return (
    <PianoRollEditor
      key={channel.id}
      pattern={pattern}
      channel={channel}
      channels={channels}
      snap={snap}
      zoom={zoom}
      scaleRoot={scaleRoot}
      scale={scale}
      stamp={stamp}
      mode={mode}
      a={a}
    />
  );
}

interface EditorProps {
  pattern: Pattern;
  channel: Channel;
  channels: Channel[];
  snap: number;
  zoom: number;
  scaleRoot: number;
  scale: number;
  stamp: number;
  mode: string;
  a: ReturnType<typeof actions>;
}

function PianoRollEditor({ pattern, channel, channels, snap, zoom, scaleRoot, scale, stamp, mode, a }: EditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLDivElement>(null);
  const [lane, setLane] = useState<EventLane>('velocity');
  const playheadRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const lastLength = useRef(TICKS_PER_STEP);
  const clipboard = useRef<Note[]>([]);
  const pasteShift = useRef(0);

  const notes = pattern.notes[channel.id] ?? [];
  const sig = useStore((s) => s.project.timeSig);
  const bar = barTicks(sig);
  const beat = beatTicks(sig);
  const ppt = BASE_PPT * zoom;
  const length = patternLength(pattern, bar);
  const totalTicks = length + bar * 2;
  const width = totalTicks * ppt;
  const height = KEY_COUNT * ROW_H;
  const snapTicks = resolveSnap(snap, sig);

  const ghosts = useMemo(
    () =>
      channels
        .filter((c) => c.id !== channel.id)
        .flatMap((c) => (pattern.notes[c.id] ?? []).map((n) => ({ ...n, color: c.color }))),
    [channels, channel.id, pattern.notes],
  );

  // Scroll to the channel's notes (or around C5) when the editor opens.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const keys = notes.map((n) => n.key);
    const center = keys.length ? (Math.min(...keys) + Math.max(...keys)) / 2 : 60;
    el.scrollTop = keyY(Math.round(center)) - el.clientHeight / 2 + RULER_H;
  }, []);

  usePlayheadFrame((pos) => {
    const el = playheadRef.current;
    if (!el) return;
    if (pos === null || mode !== 'pattern') {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.transform = `translateX(${pos * ppt}px)`;
  });

  // Keyboard shortcuts while this editor is the active one.
  const latest = useRef({ notes, selection, pattern, channel, snapTicks });
  latest.current = { notes, selection, pattern, channel, snapTicks };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (getActiveScope() !== 'pianoRoll' || isTyping(e)) return;
      const a = actions();
      const { notes: list, selection: sel, pattern: p, channel: c, snapTicks: sn } = latest.current;
      const selected = list.filter((n) => sel.has(n.id));
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selected.length) return;
        e.preventDefault();
        a.removeNotes(p.id, c.id, selected.map((n) => n.id));
        setSelection(new Set());
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(new Set(list.map((n) => n.id)));
      } else if (e.key === 'Escape') {
        setSelection(new Set());
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selected.length) {
        e.preventDefault();
        const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        if (selected.some((n) => n.key + delta < 0 || n.key + delta > 127)) return;
        a.updateNotes(p.id, c.id, Object.fromEntries(selected.map((n) => [n.id, { key: n.key + delta }])), true);
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selected.length) {
        e.preventDefault();
        const delta = (e.key === 'ArrowRight' ? 1 : -1) * sn;
        if (selected.some((n) => n.start + delta < 0)) return;
        a.updateNotes(p.id, c.id, Object.fromEntries(selected.map((n) => [n.id, { start: n.start + delta }])), true);
      } else if (ctrl && e.key.toLowerCase() === 'c' && selected.length) {
        e.preventDefault();
        clipboard.current = selected;
        pasteShift.current = 0;
      } else if (ctrl && (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'b')) {
        const source = e.key.toLowerCase() === 'b' ? selected : clipboard.current;
        if (!source.length) return;
        e.preventDefault();
        const start = Math.min(...source.map((n) => n.start));
        const end = Math.max(...source.map((n) => n.start + n.length));
        const span = Math.ceil((end - start) / sn) * sn;
        if (e.key.toLowerCase() === 'b') pasteShift.current = span;
        else pasteShift.current += span;
        const copies = source.map((n) => ({ ...n, ...createNote(n.key, n.start + pasteShift.current, n.length, n.velocity) }));
        a.addNotes(p.id, c.id, copies);
        setSelection(new Set(copies.map((n) => n.id)));
        if (e.key.toLowerCase() === 'b') clipboard.current = copies;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pointToGrid = (clientX: number, clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return { x, y, tick: Math.max(0, x / ppt), key: Math.min(127, Math.max(0, KEY_COUNT - 1 - Math.floor(y / ROW_H))) };
  };

  const preview = (() => {
    let voice: Voice | null = null;
    let current = -1;
    return {
      play(key: number, velocity: number) {
        if (key === current) return;
        voice?.release(engine.context?.currentTime ?? 0);
        current = key;
        voice = engine.previewNote(channel.id, key, velocity);
      },
      stop() {
        voice?.release(engine.context?.currentTime ?? 0);
        voice = null;
        current = -1;
      },
    };
  })();

  const moveNotes = (e: React.PointerEvent, targets: Note[], grabbed: Note) => {
    const originals = targets.map((n) => ({ ...n }));
    const minStart = Math.min(...originals.map((n) => n.start));
    const minKey = Math.min(...originals.map((n) => n.key));
    const maxKey = Math.max(...originals.map((n) => n.key));
    preview.play(grabbed.key, grabbed.velocity);
    startDrag(e, {
      onStart: () => a.beginGesture(),
      onMove: (dx, dy, ev) => {
        let dTick = snapRound(dx / ppt, ev.altKey ? 1 : snapTicks);
        // Snap the grabbed note itself to the grid (not just the offset).
        if (!ev.altKey && snapTicks > 1) dTick = snapRound(grabbed.start + dTick, snapTicks) - grabbed.start;
        dTick = Math.max(-minStart, dTick);
        const dKey = Math.min(127 - maxKey, Math.max(-minKey, -Math.round(dy / ROW_H)));
        a.updateNotes(
          pattern.id,
          channel.id,
          Object.fromEntries(originals.map((n) => [n.id, { start: n.start + dTick, key: n.key + dKey }])),
        );
        preview.play(grabbed.key + dKey, grabbed.velocity);
      },
      onEnd: () => {
        preview.stop();
        a.endGesture();
      },
    });
  };

  const resizeNotes = (e: React.PointerEvent, targets: Note[], grabbed: Note) => {
    const originals = targets.map((n) => ({ ...n }));
    startDrag(e, {
      onStart: () => a.beginGesture(),
      onMove: (dx, _dy, ev) => {
        const step = ev.altKey ? 1 : snapTicks;
        let delta = snapRound(dx / ppt, step);
        if (step > 1) delta = snapRound(grabbed.start + grabbed.length + delta, step) - grabbed.start - grabbed.length;
        a.updateNotes(
          pattern.id,
          channel.id,
          Object.fromEntries(originals.map((n) => [n.id, { length: Math.max(step, n.length + delta) }])),
        );
      },
      onEnd: () => {
        const updated = useStore.getState().project.patterns.find((p) => p.id === pattern.id)?.notes[channel.id]?.find((n) => n.id === grabbed.id);
        if (updated) lastLength.current = updated.length;
        a.endGesture();
      },
    });
  };

  const eraseAt = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-note]');
    const id = el?.dataset.note;
    if (id) a.removeNotes(pattern.id, channel.id, [id]);
  };

  const onGridPointerDown = (e: React.PointerEvent) => {
    setActiveScope('pianoRoll');
    const noteEl = (e.target as HTMLElement).closest<HTMLElement>('[data-note]');
    const note = noteEl ? notes.find((n) => n.id === noteEl.dataset.note) : undefined;

    if (e.button === 2) {
      e.preventDefault();
      a.beginGesture();
      if (note) a.removeNotes(pattern.id, channel.id, [note.id]);
      startDrag(e, { onMove: (_dx, _dy, ev) => eraseAt(ev.clientX, ev.clientY), onEnd: () => a.endGesture() });
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();

    if (note && noteEl) {
      if (e.shiftKey) {
        const next = new Set(selection);
        if (next.has(note.id)) next.delete(note.id);
        else next.add(note.id);
        setSelection(next);
        return;
      }
      const group = selection.has(note.id) ? notes.filter((n) => selection.has(n.id)) : [note];
      if (!selection.has(note.id)) setSelection(new Set());
      const rect = noteEl.getBoundingClientRect();
      if (e.clientX > rect.right - EDGE_PX) resizeNotes(e, group, note);
      else {
        lastLength.current = note.length;
        moveNotes(e, group, note);
      }
      return;
    }

    const p = pointToGrid(e.clientX, e.clientY);
    if (e.ctrlKey || e.metaKey) {
      const start = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      setMarquee(start);
      startDrag(e, {
        onMove: (_dx, _dy, ev) => {
          const q = pointToGrid(ev.clientX, ev.clientY);
          const m = { ...start, x1: q.x, y1: q.y };
          setMarquee(m);
          const [t0, t1] = [Math.min(m.x0, m.x1) / ppt, Math.max(m.x0, m.x1) / ppt];
          const [y0, y1] = [Math.min(m.y0, m.y1), Math.max(m.y0, m.y1)];
          setSelection(
            new Set(
              notes
                .filter((n) => n.start < t1 && n.start + n.length > t0 && keyY(n.key) + ROW_H > y0 && keyY(n.key) < y1)
                .map((n) => n.id),
            ),
          );
        },
        onEnd: () => setMarquee(null),
      });
      return;
    }

    setSelection(new Set());
    const created = createNote(p.key, snapFloor(p.tick, snapTicks), lastLength.current, 0.78);
    // With a chord stamp, one click places the whole chord.
    const placed = CHORDS[stamp] ? chordsFrom([created], CHORDS[stamp].intervals) : [created];
    a.beginGesture();
    a.addNotes(pattern.id, channel.id, placed);
    moveNotes(e, placed, created);
  };

  /** Runs a note tool on the selection (or on every note when nothing is selected). */
  const applyTool = (tool: (targets: Note[]) => Note[]) => {
    const targets = selection.size ? notes.filter((n) => selection.has(n.id)) : notes;
    if (!targets.length) return;
    const result = tool(targets);
    a.replaceNotes(pattern.id, channel.id, targets.map((n) => n.id), result);
    if (selection.size) setSelection(new Set(result.map((n) => n.id)));
  };

  const openTools = (e: React.MouseEvent) => {
    const steps = SCALES[scale]?.steps;
    const where = selection.size ? `${selection.size} nota(s) selecionada(s)` : 'todas as notas';
    openContextMenu(
      e,
      [
        { label: 'Quantizar início', action: () => applyTool((t) => quantize(t, snapTicks)) },
        { label: 'Quantizar início e duração', action: () => applyTool((t) => quantize(t, snapTicks, 1, true)) },
        { label: 'Quantizar 50%', action: () => applyTool((t) => quantize(t, snapTicks, 0.5)) },
        { label: 'Legato', action: () => applyTool(legato) },
        { label: 'Arpejar ↑ (na grade)', action: () => applyTool((t) => arpeggiate(t, snapTicks, 'up')) },
        { label: 'Arpejar ↓ (na grade)', action: () => applyTool((t) => arpeggiate(t, snapTicks, 'down')) },
        { label: 'Arpejar ↑↓ (na grade)', action: () => applyTool((t) => arpeggiate(t, snapTicks, 'updown')) },
        { label: 'Strum (dedilhar)', action: () => applyTool((t) => strum(t, 6)) },
        { label: 'Picotar na grade', action: () => applyTool((t) => chop(t, snapTicks)) },
        { label: 'Humanizar', action: () => applyTool((t) => humanize(t, 4, 0.12)) },
        { label: 'Inverter (de cabeça para baixo)', action: () => applyTool(flip) },
        { label: 'Transformar em acorde maior', action: () => applyTool((t) => chordsFrom(t, CHORDS[0].intervals)) },
        { label: 'Transformar em acorde menor', action: () => applyTool((t) => chordsFrom(t, CHORDS[1].intervals)) },
        {
          label: steps ? `Encaixar na escala (${PITCH_CLASSES[scaleRoot]} ${SCALES[scale].name})` : 'Encaixar na escala (escolha uma escala)',
          disabled: !steps,
          action: () => steps && applyTool((t) => fitToScale(t, scaleRoot, steps)),
        },
      ],
      `Ferramentas · ${where}`,
    );
  };

  /** Event lane: drag over the notes to draw their values; the right button resets them. */
  const onVelocityPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    setActiveScope('pianoRoll');
    const el = velRef.current!;
    const reset = e.button === 2;
    const apply = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left + el.scrollLeft;
      const norm = reset ? (lane === 'velocity' ? 0.78 : 0.5) : 1 - (clientY - rect.top - 4) / VELOCITY_H;
      const patch = lanePatch(norm, lane);
      const hit = notes.filter((n) => Math.abs(n.start * ppt - x) <= 5);
      const targets = hit.some((n) => selection.has(n.id)) ? hit.filter((n) => selection.has(n.id)) : hit;
      if (targets.length) a.updateNotes(pattern.id, channel.id, Object.fromEntries(targets.map((n) => [n.id, patch])));
    };
    apply(e.clientX, e.clientY);
    startDrag(e, { onStart: () => a.beginGesture(), onMove: (_dx, _dy, ev) => apply(ev.clientX, ev.clientY), onEnd: () => a.endGesture() });
  };

  const gridStyle = {
    width,
    height,
    backgroundSize: `${bar * 2 * ppt}px 100%, ${bar * ppt}px 100%, ${beat * ppt}px 100%, ${TICKS_PER_STEP * ppt}px 100%`,
  };

  return (
    <div className="piano-roll" onPointerDownCapture={() => setActiveScope('pianoRoll')}>
      <div className="pr-toolbar">
        <label className="inline-field">
          Canal
          <select value={channel.id} onChange={(e) => a.selectChannel(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <span className="pattern-chip" style={{ background: pattern.color }}>{pattern.name}</span>
        <label className="inline-field">
          Grade
          <select value={snap} onChange={(e) => a.setPianoRollView({ snap: Number(e.target.value) })}>
            {SNAP_OPTIONS.map((o) => (
              <option key={o.ticks} value={o.ticks}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          Zoom
          <input type="range" min={0.25} max={4} step={0.05} value={zoom} onChange={(e) => a.setPianoRollView({ zoom: Number(e.target.value) })} />
        </label>
        <button type="button" className="text-btn" onClick={openTools} title="Quantizar, legato, arpejador, strum, humanizar…">
          Ferramentas ▾
        </button>
        <label className="inline-field" title="Carimbo de acorde: cada clique cria o acorde inteiro">
          Acorde
          <select value={stamp} onChange={(e) => a.setPianoRollView({ stamp: Number(e.target.value) })}>
            <option value={-1}>Nota única</option>
            {CHORDS.map((c, i) => (
              <option key={c.name} value={i}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="inline-field" title="Destaca as notas da escala no piano roll">
          Escala
          <select value={scaleRoot} onChange={(e) => a.setPianoRollView({ scaleRoot: Number(e.target.value) })} disabled={scale < 0}>
            {PITCH_CLASSES.map((name, i) => (
              <option key={name} value={i}>{name}</option>
            ))}
          </select>
          <select value={scale} onChange={(e) => a.setPianoRollView({ scale: Number(e.target.value) })}>
            <option value={-1}>Nenhuma</option>
            {SCALES.map((sc, i) => (
              <option key={sc.name} value={i}>{sc.name}</option>
            ))}
          </select>
        </label>
        <span className="hint">
          Clique: criar/mover · borda: duração · botão direito: apagar · Ctrl+arrastar: selecionar · Shift+clique: (des)selecionar · Del · Ctrl+A/C/V/B · ↑↓ transpor · Alt: sem grade
        </span>
      </div>
      <div
        className="pr-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          if (velRef.current) velRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
      >
        <div className="pr-inner" style={{ gridTemplateColumns: `${KEYS_W}px ${width}px`, gridTemplateRows: `${RULER_H}px ${height}px` }}>
          <div className="pr-corner" />
          <div className="pr-ruler">
            {Array.from({ length: Math.ceil(totalTicks / bar) }, (_, i) => (
              <span key={i} style={{ left: i * bar * ppt }} className={i * bar >= length ? 'outside' : ''}>
                {i + 1}
              </span>
            ))}
            <div className="pr-length-marker" style={{ left: length * ppt }} title="Fim do pattern" />
          </div>
          <Keyboard channelId={channel.id} />
          <div className="pr-grid" ref={gridRef} style={gridStyle} onPointerDown={onGridPointerDown} onContextMenu={(e) => e.preventDefault()}>
            <RowBackground width={width} scaleRoot={scaleRoot} scale={scale} />
            <div className="pr-outside" style={{ left: length * ppt }} />
            {ghosts.map((n) => (
              <div
                key={`g${n.id}`}
                className="pr-ghost"
                style={{ left: n.start * ppt, top: keyY(n.key) + 1, width: Math.max(2, n.length * ppt - 1), height: ROW_H - 2, background: n.color }}
              />
            ))}
            {notes.map((n) => (
              <div
                key={n.id}
                data-note={n.id}
                className={`pr-note${selection.has(n.id) ? ' selected' : ''}`}
                style={{
                  left: n.start * ppt,
                  top: keyY(n.key) + 1,
                  width: Math.max(4, n.length * ppt - 1),
                  height: ROW_H - 2,
                  background: channel.color,
                  opacity: 0.55 + n.velocity * 0.45,
                }}
                title={`${keyName(n.key)} · ${laneText(n)}`}
              >
                {n.length * ppt > 26 && <span>{keyName(n.key)}</span>}
              </div>
            ))}
            {marquee && (
              <div
                className="marquee"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}
            <div ref={playheadRef} className="playhead" style={{ display: 'none' }} />
          </div>
        </div>
      </div>
      <div className="pr-velocity-wrap">
        <div className="pr-velocity-label">
          <select value={lane} onChange={(e) => setLane(e.target.value as EventLane)} title="Propriedade das notas editada nesta faixa">
            {LANES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>
        <div
          className="pr-velocity"
          ref={velRef}
          onPointerDown={onVelocityPointerDown}
          onContextMenu={(e) => e.preventDefault()}
          title="Arraste sobre as notas para desenhar os valores · botão direito: valor padrão"
        >
          <div style={{ width, height: VELOCITY_H, position: 'relative' }}>
            {lane !== 'velocity' && <div className="ev-center" />}
            {notes.map((n) => {
              const v = laneNorm(n, lane);
              if (lane === 'velocity') {
                return (
                  <div
                    key={n.id}
                    className={`vel-bar${selection.has(n.id) ? ' selected' : ''}`}
                    style={{ left: n.start * ppt, height: v * VELOCITY_H, background: channel.color }}
                  />
                );
              }
              const y = (1 - v) * VELOCITY_H;
              const mid = VELOCITY_H / 2;
              return (
                <div key={n.id}>
                  <div
                    className={`ev-bar${selection.has(n.id) ? ' selected' : ''}`}
                    style={{ left: n.start * ppt, top: Math.min(y, mid), height: Math.max(1, Math.abs(y - mid)), background: channel.color }}
                  />
                  <div className="ev-dot" style={{ left: n.start * ppt - 2, top: y - 3, background: channel.color }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
