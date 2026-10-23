import { useRef, type ReactNode } from 'react';
import { startDrag } from './controls';

interface WindowProps {
  title: ReactNode;
  x: number;
  y: number;
  w?: number;
  h?: number;
  z: number;
  accent?: string;
  className?: string;
  /** Extra controls rendered in the title bar. */
  tools?: ReactNode;
  onMove(x: number, y: number): void;
  onResize?(w: number, h: number): void;
  onFocus(): void;
  onClose(): void;
  children: ReactNode;
}

const MIN_W = 260;
const MIN_H = 140;

/** A floating, draggable (and optionally resizable) window inside the workspace. */
export function Window({ title, x, y, w, h, z, accent, className, tools, onMove, onResize, onFocus, onClose, children }: WindowProps) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <section
      ref={ref}
      className={`window ${className ?? ''}`}
      style={{ left: x, top: y, width: w, height: h, zIndex: z }}
      onPointerDownCapture={onFocus}
    >
      <header
        className="window-title"
        style={accent ? { borderTopColor: accent } : undefined}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('button, select, input')) return;
          e.preventDefault();
          const parent = ref.current?.parentElement;
          const maxX = (parent?.clientWidth ?? 2000) - 80;
          const maxY = (parent?.clientHeight ?? 2000) - 30;
          startDrag(e, {
            onMove: (dx, dy) => onMove(Math.min(maxX, Math.max(-20, x + dx)), Math.min(maxY, Math.max(0, y + dy))),
          });
        }}
      >
        <span className="window-name">{title}</span>
        <div className="window-tools">{tools}</div>
        <button type="button" className="window-close" onClick={onClose} title="Fechar">
          ×
        </button>
      </header>
      <div className="window-body">{children}</div>
      {onResize && w !== undefined && h !== undefined && (
        <div
          className="window-resize"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            startDrag(e, { onMove: (dx, dy) => onResize(Math.max(MIN_W, w + dx), Math.max(MIN_H, h + dy)) });
          }}
        />
      )}
    </section>
  );
}
