import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';

export interface MenuItem {
  label: string;
  action(): void;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  title?: string;
  items: MenuItem[];
}

const useMenu = create<{ menu: MenuState | null }>(() => ({ menu: null }));

/** Opens the app's context menu at the pointer (call from an onContextMenu handler). */
export function openContextMenu(event: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[], title?: string): void {
  event.preventDefault();
  useMenu.setState({ menu: { x: event.clientX, y: event.clientY, items, title } });
}

export function closeContextMenu(): void {
  useMenu.setState({ menu: null });
}

/** Renders the open context menu; mount once at the app root. */
export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Keep the menu on screen.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, innerWidth - width - 4), y: Math.min(menu.y, innerHeight - height - 4) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      closeContextMenu();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('blur', closeContextMenu);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('blur', closeContextMenu);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div ref={ref} className="context-menu floating" style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {menu.title && <div className="context-title">{menu.title}</div>}
      {menu.items.map((item) => (
        <button
          type="button"
          role="menuitem"
          key={item.label}
          className={item.danger ? 'danger' : undefined}
          disabled={item.disabled}
          onClick={() => {
            closeContextMenu();
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
