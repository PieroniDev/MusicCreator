import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ParamSpec } from '../plugins/params';
import { formatParam, normToValue, valueToNorm } from '../plugins/params';
import { actions } from '../state/store';

export type KnobSpec = Pick<ParamSpec, 'min' | 'max' | 'default' | 'scale' | 'step' | 'unit' | 'options'> & { name?: string };

interface DragOptions {
  onStart?(): void;
  onMove(dx: number, dy: number, event: PointerEvent): void;
  onEnd?(): void;
}

/** Pointer drag helper: captures the pointer and reports deltas from the start point. */
export function startDrag(event: React.PointerEvent, { onStart, onMove, onEnd }: DragOptions): void {
  const target = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  target.setPointerCapture(event.pointerId);
  onStart?.();
  const move = (e: PointerEvent) => onMove(e.clientX - startX, e.clientY - startY, e);
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    onEnd?.();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

/** Wraps a continuous control change into one undo step. */
function gestureHandlers() {
  return { onStart: () => actions().beginGesture(), onEnd: () => actions().endGesture() };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const a0 = ((from - 90) * Math.PI) / 180;
  const a1 = ((to - 90) * Math.PI) / 180;
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} ${sweep} ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
}

interface KnobProps {
  value: number;
  spec: KnobSpec;
  onChange(value: number): void;
  label?: string;
  size?: number;
  color?: string;
  /** Format override for the tooltip/readout. */
  format?: (value: number) => string;
  showValue?: boolean;
}

export function Knob({ value, spec, onChange, label, size = 34, color, format, showValue = true }: KnobProps) {
  const ref = useRef<HTMLDivElement>(null);
  const normRef = useRef(valueToNorm(spec as ParamSpec, value));
  const [active, setActive] = useState(false);
  const fullSpec = spec as ParamSpec;
  const norm = valueToNorm(fullSpec, value);
  const text = format ? format(value) : formatParam(fullSpec, value);

  const latest = useRef({ onChange, fullSpec });
  latest.current = { onChange, fullSpec };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // A burst of wheel ticks counts as one undo step.
      actions().beginGesture();
      clearTimeout(settle);
      settle = setTimeout(() => actions().endGesture(), 400);
      const { onChange: change, fullSpec: s } = latest.current;
      const step = s.options ? 1 / Math.max(1, s.max - s.min) : e.shiftKey ? 0.005 : 0.03;
      const n = valueToNorm(s, Number(el.dataset.value)) + (e.deltaY < 0 ? step : -step);
      change(normToValue(s, n));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', wheel);
      if (settle) actions().endGesture();
      clearTimeout(settle);
    };
  }, []);

  const bipolar = spec.min < 0 && spec.max > 0 && spec.scale !== 'log';
  const startAngle = -135;
  const valueAngle = startAngle + norm * 270;
  const zeroAngle = bipolar ? startAngle + valueToNorm(fullSpec, 0) * 270 : startAngle;
  const r = size / 2 - 3;
  const c = size / 2;
  const pointer = ((valueAngle - 90) * Math.PI) / 180;

  return (
    <div className={`knob${active ? ' active' : ''}`} title={`${label ?? spec.name ?? ''}: ${text}`}>
      <div
        ref={ref}
        data-value={value}
        className="knob-dial"
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          normRef.current = norm;
          let last = 0;
          setActive(true);
          startDrag(e, {
            ...gestureHandlers(),
            onMove: (_dx, dy, ev) => {
              const delta = (last - dy) / (ev.shiftKey ? 800 : 160);
              last = dy;
              normRef.current = Math.min(1, Math.max(0, normRef.current + delta));
              onChange(normToValue(fullSpec, normRef.current));
            },
            onEnd: () => {
              setActive(false);
              actions().endGesture();
            },
          });
        }}
        onDoubleClick={() => onChange(spec.default)}
      >
        <svg width={size} height={size}>
          <path d={arcPath(c, c, r, -135, 135)} className="knob-track" />
          {Math.abs(valueAngle - zeroAngle) > 0.5 && (
            <path
              d={arcPath(c, c, r, Math.min(zeroAngle, valueAngle), Math.max(zeroAngle, valueAngle))}
              className="knob-value"
              style={color ? { stroke: color } : undefined}
            />
          )}
          <circle cx={c} cy={c} r={r - 4} className="knob-cap" />
          <line
            x1={c + Math.cos(pointer) * (r - 11)}
            y1={c + Math.sin(pointer) * (r - 11)}
            x2={c + Math.cos(pointer) * (r - 4)}
            y2={c + Math.sin(pointer) * (r - 4)}
            className="knob-pointer"
          />
        </svg>
      </div>
      {label && <div className="knob-label">{label}</div>}
      {showValue && <div className="knob-readout">{text}</div>}
    </div>
  );
}

/** Mixer fader: gain 0..2 with 0 dB at about 70% of the travel. */
export function gainToFader(gain: number): number {
  return Math.sqrt(Math.max(0, gain) / 2);
}

export function faderToGain(pos: number): number {
  const p = Math.min(1, Math.max(0, pos));
  return p * p * 2;
}

export function formatDb(gain: number): string {
  if (gain <= 0.0001) return '-∞ dB';
  const db = 20 * Math.log10(gain);
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

interface FaderProps {
  value: number;
  onChange(value: number): void;
  height?: number;
}

export function Fader({ value, onChange, height = 150 }: FaderProps) {
  const pos = gainToFader(value);
  const travel = height - 18;
  return (
    <div
      className="fader"
      style={{ height }}
      title={formatDb(value)}
      onDoubleClick={() => onChange(0.8)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const start = pos;
        startDrag(e, {
          ...gestureHandlers(),
          onMove: (_dx, dy, ev) => onChange(faderToGain(start - dy / (ev.shiftKey ? travel * 5 : travel))),
        });
      }}
    >
      <div className="fader-track" />
      <div className="fader-zero" style={{ bottom: gainToFader(1) * travel + 8 }} />
      <div className="fader-thumb" style={{ bottom: pos * travel }} />
    </div>
  );
}

interface LedProps {
  on: boolean;
  onClick(e: React.MouseEvent): void;
  onContextMenu?(e: React.MouseEvent): void;
  title?: string;
  color?: string;
}

export function Led({ on, onClick, onContextMenu, title, color }: LedProps) {
  return (
    <button
      type="button"
      className={`led${on ? ' on' : ''}`}
      style={on && color ? { background: color, boxShadow: `0 0 6px ${color}` } : undefined}
      onClick={onClick}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu(e);
      }}
      title={title}
    />
  );
}

interface DragNumberProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Pixels of drag per step. */
  pixels?: number;
  onChange(value: number, gesture: boolean): void;
  format?: (v: number) => string;
  className?: string;
  title?: string;
}

/** A number edited by dragging up/down or by typing after a double-click. */
export function DragNumber({ value, min, max, step = 1, pixels = 4, onChange, format, className, title }: DragNumberProps) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        className={`drag-number editing ${className ?? ''}`}
        autoFocus
        defaultValue={String(value)}
        onBlur={(e) => {
          const v = Number(e.currentTarget.value.replace(',', '.'));
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)), false);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <div
      className={`drag-number ${className ?? ''}`}
      title={title}
      onDoubleClick={() => setEditing(true)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const start = value;
        startDrag(e, {
          ...gestureHandlers(),
          onMove: (_dx, dy, ev) => {
            const steps = Math.round(-dy / (ev.shiftKey ? pixels * 4 : pixels));
            const fine = ev.shiftKey ? step / 10 : step;
            onChange(Math.min(max, Math.max(min, start + steps * fine)), true);
          },
        });
      }}
    >
      {format ? format(value) : value}
    </div>
  );
}

export function IconButton({
  children,
  onClick,
  active,
  title,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick(e: React.MouseEvent): void;
  active?: boolean;
  title?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? ' active' : ''} ${className ?? ''}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
