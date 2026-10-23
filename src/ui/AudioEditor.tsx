import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { actions, useStore } from '../state/store';
import { engine } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { bytesToBase64, primeDecodedSample } from '../audio/samples';
import * as edit from '../audio/edit';
import type { FrameRange, Pcm } from '../audio/edit';
import { useDecodedSample } from './hooks';

const HEIGHT = 220;
const DB3 = Math.pow(10, 3 / 20);

function seconds(frames: number, sampleRate: number): string {
  return `${(frames / sampleRate).toFixed(3).replace('.', ',')} s`;
}

/**
 * Destructive editor for a channel's sample: select a range on the waveform,
 * listen to it and apply edits (each edit is one undo step and replaces the
 * channel's sample with the result).
 */
export function AudioEditor({ channelId }: { channelId: string }) {
  const channel = useStore((s) => s.project.channels.find((c) => c.id === channelId));
  const sampleName = useStore((s) => (channel?.sampleId ? s.project.samples[channel.sampleId]?.name : undefined));
  const buffer = useDecodedSample(channel?.sampleId);
  const [sel, setSel] = useState<FrameRange | null>(null);
  const [cursor, setCursor] = useState(0);
  const [view, setView] = useState<FrameRange | null>(null);
  const [width, setWidth] = useState(760);
  const [playing, setPlaying] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const voice = useRef<{ src: AudioBufferSourceNode; t0: number; from: number; raf: number } | null>(null);

  const length = buffer?.length ?? 0;
  const sr = buffer?.sampleRate ?? 44100;
  const shown = view && view.end <= length ? view : { start: 0, end: Math.max(1, length) };
  const framesPerPx = (shown.end - shown.start) / width;
  const xOf = (frame: number) => (frame - shown.start) / framesPerPx;
  const frameAt = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    return Math.round(Math.min(length, Math.max(0, shown.start + (clientX - rect.left) * framesPerPx)));
  };

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(100, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Waveform: min/max per pixel, one lane per channel.
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = devicePixelRatio;
    el.width = width * dpr;
    el.height = HEIGHT * dpr;
    ctx.clearRect(0, 0, el.width, el.height);
    if (!buffer) return;
    const lanes = buffer.numberOfChannels;
    const laneH = el.height / lanes;
    const per = (shown.end - shown.start) / el.width;
    ctx.fillStyle = channel?.color ?? '#3dc6ff';
    for (let c = 0; c < lanes; c++) {
      const data = buffer.getChannelData(c);
      const mid = laneH * c + laneH / 2;
      ctx.fillRect(0, mid, el.width, 1);
      for (let x = 0; x < el.width; x++) {
        const a = Math.floor(shown.start + x * per);
        const b = Math.min(data.length, Math.max(a + 1, Math.floor(shown.start + (x + 1) * per)));
        let min = 0;
        let max = 0;
        const stride = Math.max(1, Math.floor((b - a) / 256));
        for (let i = a; i < b; i += stride) {
          const v = data[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        ctx.fillRect(x, mid - max * (laneH / 2 - 2), 1, Math.max(1, (max - min) * (laneH / 2 - 2)));
      }
    }
  }, [buffer, width, shown.start, shown.end, channel?.color]);

  // Wheel: zoom around the mouse; shift+wheel scrolls.
  const latest = useRef({ shown, length, framesPerPx });
  latest.current = { shown, length, framesPerPx };
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { shown: s, length: n, framesPerPx: fpp } = latest.current;
      if (n === 0) return;
      const span = s.end - s.start;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const delta = (e.shiftKey ? e.deltaY : e.deltaX) * fpp;
        const start = Math.round(Math.min(n - span, Math.max(0, s.start + delta)));
        setView({ start, end: start + span });
        return;
      }
      const rect = el.getBoundingClientRect();
      const anchor = s.start + (e.clientX - rect.left) * fpp;
      const next = Math.min(n, Math.max(64, Math.round(span * (e.deltaY > 0 ? 1.25 : 0.8))));
      const start = Math.round(Math.min(n - next, Math.max(0, anchor - ((anchor - s.start) / span) * next)));
      setView(next >= n ? null : { start, end: start + next });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const stop = () => {
    const v = voice.current;
    if (!v) return;
    voice.current = null;
    cancelAnimationFrame(v.raf);
    v.src.onended = null;
    try {
      v.src.stop();
    } catch {
      /* already stopped */
    }
    v.src.disconnect();
    if (playhead.current) playhead.current.style.display = 'none';
    setPlaying(false);
  };
  useEffect(() => stop, []);

  const play = () => {
    if (!buffer) return;
    stop();
    const ctx = engine.ensureRunning();
    const r = sel ?? { start: cursor < length ? cursor : 0, end: length };
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    src.start(t0, r.start / sr, (r.end - r.start) / sr);
    src.onended = stop;
    const tick = () => {
      const v = voice.current;
      if (!v) return;
      const frame = v.from + Math.max(0, ctx.currentTime - v.t0) * sr;
      const el = playhead.current;
      if (el) {
        el.style.display = 'block';
        const { shown: s, framesPerPx: fpp } = latest.current;
        el.style.transform = `translateX(${(frame - s.start) / fpp}px)`;
      }
      v.raf = requestAnimationFrame(tick);
    };
    voice.current = { src, t0, from: r.start, raf: requestAnimationFrame(tick) };
    setPlaying(true);
  };

  /** Replaces the sample with the result of an edit (one undo step). */
  const apply = (fn: (pcm: Pcm, r: FrameRange) => Pcm, after?: (r: FrameRange) => void) => {
    if (!buffer || !channel) return;
    stop();
    const pcm = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const r = edit.normalizeRange(pcm, sel);
    const out = fn(pcm, r);
    const frames = out[0]?.length ?? 0;
    if (frames === 0) {
      alert('A edição deixaria o sample vazio.');
      return;
    }
    const wav = encodeWav({ numberOfChannels: out.length, sampleRate: sr, length: frames, getChannelData: (c) => out[c] });
    const id = actions().setChannelSample(channel.id, sampleName ?? 'Áudio editado.wav', bytesToBase64(new Uint8Array(wav)));
    // The result is already decoded: show and play it right away.
    const decoded = new AudioBuffer({ length: frames, numberOfChannels: Math.min(2, out.length), sampleRate: sr });
    for (let c = 0; c < decoded.numberOfChannels; c++) decoded.copyToChannel(Float32Array.from(out[c]), c);
    primeDecodedSample(id, decoded);
    after?.(r);
  };

  const resetView = () => setView(null);
  const hasSel = sel !== null && sel.end > sel.start;

  if (!channel) return null;
  if (!channel.sampleId) return <div className="empty-hint">Este canal não tem sample. Carregue um áudio no sampler primeiro.</div>;

  const selStart = hasSel ? Math.max(shown.start, sel!.start) : 0;
  const selEnd = hasSel ? Math.min(shown.end, sel!.end) : 0;

  return (
    <div
      className="audio-editor"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Delete' && hasSel) {
          e.preventDefault();
          e.stopPropagation();
          apply(edit.remove, (r) => {
            setSel(null);
            setCursor(r.start);
          });
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          e.stopPropagation();
          setSel({ start: 0, end: length });
        }
      }}
    >
      <div className="ae-toolbar">
        <button type="button" className="text-btn" onClick={playing ? stop : play} disabled={!buffer} title="Ouvir a seleção (ou a partir do cursor)">
          {playing ? '■ Parar' : '▶ Ouvir'}
        </button>
        <span className="ae-sep" />
        <button type="button" className="text-btn" disabled={!hasSel} onClick={() =>
            apply(edit.crop, () => {
              setSel(null);
              setView(null);
            })
          } title="Mantém só a seleção">
          Recortar
        </button>
        <button
          type="button"
          className="text-btn"
          disabled={!hasSel}
          onClick={() =>
            apply(edit.remove, (r) => {
              setSel(null);
              setCursor(r.start);
            })
          }
          title="Apaga a seleção (Delete)"
        >
          Apagar
        </button>
        <button type="button" className="text-btn" onClick={() => apply(edit.silence)} title="Silencia a seleção (ou tudo)">
          Silenciar
        </button>
        <button type="button" className="text-btn" onClick={() => apply((p, r) => edit.normalize(p, r))} title="Leva o pico a -0,3 dB">
          Normalizar
        </button>
        <button type="button" className="text-btn" onClick={() => apply((p, r) => edit.fade(p, r, 'in'))}>
          Fade in
        </button>
        <button type="button" className="text-btn" onClick={() => apply((p, r) => edit.fade(p, r, 'out'))}>
          Fade out
        </button>
        <button type="button" className="text-btn" onClick={() => apply(edit.reverse)} title="Toca a seleção de trás para frente">
          Reverso
        </button>
        <button type="button" className="text-btn" onClick={() => apply((p, r) => edit.gain(p, r, DB3))}>
          +3 dB
        </button>
        <button type="button" className="text-btn" onClick={() => apply((p, r) => edit.gain(p, r, 1 / DB3))}>
          −3 dB
        </button>
        <button type="button" className="text-btn" onClick={() => apply(edit.removeDc)} title="Remove deslocamento DC (centraliza a onda)">
          Remover DC
        </button>
        <span className="ae-sep" />
        <button type="button" className="text-btn" disabled={!hasSel} onClick={() => hasSel && setView({ ...sel! })}>
          Zoom na seleção
        </button>
        <button type="button" className="text-btn" disabled={!view} onClick={resetView}>
          Ver tudo
        </button>
      </div>
      <div
        ref={wrap}
        className="ae-wave"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => {
          if (e.button !== 0 || !buffer) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
          const from = frameAt(e.clientX);
          const target = e.currentTarget;
          target.setPointerCapture(e.pointerId);
          // Shift extends the existing selection.
          const anchor = e.shiftKey && hasSel ? (Math.abs(from - sel!.start) < Math.abs(from - sel!.end) ? sel!.end : sel!.start) : from;
          let moved = e.shiftKey;
          setSel(e.shiftKey && hasSel ? { start: Math.min(anchor, from), end: Math.max(anchor, from) } : null);
          setCursor(from);
          const move = (ev: PointerEvent) => {
            const f = frameAt(ev.clientX);
            if (!moved && Math.abs(f - from) / framesPerPx < 3) return;
            moved = true;
            setSel({ start: Math.min(anchor, f), end: Math.max(anchor, f) });
          };
          const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
          };
          target.addEventListener('pointermove', move);
          target.addEventListener('pointerup', up);
        }}
      >
        <canvas ref={canvas} style={{ width, height: HEIGHT }} />
        {hasSel && selEnd > selStart && (
          <div className="ae-selection" style={{ left: xOf(selStart), width: Math.max(1, xOf(selEnd) - xOf(selStart)) }} />
        )}
        {!hasSel && cursor >= shown.start && cursor <= shown.end && <div className="ae-cursor" style={{ left: xOf(cursor) }} />}
        <div ref={playhead} className="ae-playhead" />
        {!buffer && <div className="empty-hint ae-loading">Carregando o áudio…</div>}
      </div>
      <div className="ae-info">
        <span>{sampleName}</span>
        {buffer && (
          <span>
            {sr} Hz · {buffer.numberOfChannels === 1 ? 'mono' : 'estéreo'} · {seconds(length, sr)}
            {hasSel ? ` · seleção ${seconds(sel!.start, sr)} – ${seconds(sel!.end, sr)} (${seconds(sel!.end - sel!.start, sr)})` : ` · cursor ${seconds(cursor, sr)}`}
          </span>
        )}
        <span className="hint">Arraste para selecionar · Shift: estender · roda: zoom · Shift+roda: rolar · Ctrl+A: tudo · Delete: apagar</span>
      </div>
    </div>
  );
}
