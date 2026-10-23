import { useEffect, useRef, useSyncExternalStore } from 'react';
import { engine } from '../audio/engine';

export function usePlaying(): boolean {
  return useSyncExternalStore(
    (cb) => engine.onChange(cb),
    () => engine.isPlaying,
  );
}

/**
 * Calls `onFrame` with the transport position (ticks) on every animation
 * frame while playing, and once with null when playback stops. Meant for
 * moving playheads through refs without re-rendering React trees.
 */
export function usePlayheadFrame(onFrame: (position: number | null) => void): void {
  const playing = usePlaying();
  const callback = useRef(onFrame);
  callback.current = onFrame;
  useEffect(() => {
    if (!playing) {
      callback.current(null);
      return;
    }
    let raf = 0;
    const loop = () => {
      callback.current(engine.getPosition());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

/** Size of an element, kept up to date with a ResizeObserver. */
export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>, onSize: (w: number, h: number) => void): void {
  const cb = useRef(onSize);
  cb.current = onSize;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => cb.current(el.clientWidth, el.clientHeight));
    ro.observe(el);
    cb.current(el.clientWidth, el.clientHeight);
    return () => ro.disconnect();
  }, [ref]);
}
