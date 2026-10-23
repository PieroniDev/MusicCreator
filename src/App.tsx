import { useEffect, useRef, useState, type ReactNode } from 'react';
import { actions, pluginWindowKey, selectedChannel, selectedPattern, useStore, type WindowId } from './state/store';
import { Toolbar } from './ui/Toolbar';
import { Browser } from './ui/Browser';
import { Window } from './ui/Window';
import { ChannelRack } from './ui/ChannelRack';
import { PianoRoll } from './ui/PianoRoll';
import { Playlist } from './ui/Playlist';
import { Mixer } from './ui/Mixer';
import { PluginWindow } from './ui/PluginEditor';
import { installKeyboard } from './ui/keyboard';
import { ContextMenuHost } from './ui/ContextMenu';
import { useElementSize } from './ui/hooks';
import { hasSavedLayout } from './state/persist';
import { resetLayout, setWorkspaceBounds } from './ui/layout';

interface Bounds {
  w: number;
  h: number;
}

/** Keeps a window inside the workspace without changing its saved geometry. */
function fit(x: number, y: number, w: number, h: number, bounds: Bounds | null) {
  if (!bounds) return { x, y, w, h };
  const width = Math.max(260, Math.min(w, bounds.w - 8));
  const height = Math.max(140, Math.min(h, bounds.h - 8));
  return {
    x: Math.max(0, Math.min(x, bounds.w - width - 4)),
    y: Math.max(0, Math.min(y, bounds.h - height - 4)),
    w: width,
    h: height,
  };
}

function DockedWindow({ id, title, children, accent, bounds }: { id: WindowId; title: ReactNode; children: ReactNode; accent?: string; bounds: Bounds | null }) {
  const win = useStore((s) => s.ui.windows[id]);
  const a = actions();
  if (!win.open) return null;
  const r = fit(win.x, win.y, win.w, win.h, bounds);
  return (
    <Window
      title={title}
      x={r.x}
      y={r.y}
      w={r.w}
      h={r.h}
      z={win.z}
      accent={accent}
      className={`win-${id}`}
      onMove={(x, y) => a.setWindowRect(id, { x, y })}
      onResize={(width, height) => a.setWindowRect(id, { w: width, h: height })}
      onFocus={() => a.focusWindow(id)}
      onClose={() => a.toggleWindow(id, false)}
    >
      {children}
    </Window>
  );
}

export function App() {
  const pluginWindows = useStore((s) => s.ui.pluginWindows);
  const pattern = useStore(selectedPattern);
  const channel = useStore(selectedChannel);

  const workspace = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const laidOut = useRef(hasSavedLayout());

  useEffect(() => installKeyboard(), []);
  useElementSize(workspace, (w, h) => {
    if (!w || !h) return;
    setBounds({ w, h });
    setWorkspaceBounds(w, h);
    // First run: fit the default layout to this screen.
    if (!laidOut.current) {
      laidOut.current = true;
      actions().resetLayout(w, h);
    }
  });

  return (
    <div className="app">
      <Toolbar onResetLayout={resetLayout} />
      <div className="main">
        <Browser />
        <div className="workspace" ref={workspace}>
          <DockedWindow id="playlist" title="Playlist — arranjo" bounds={bounds}>
            <Playlist />
          </DockedWindow>
          <DockedWindow id="channelRack" title={`Channel Rack — ${pattern.name}`} accent={pattern.color} bounds={bounds}>
            <ChannelRack />
          </DockedWindow>
          <DockedWindow id="mixer" title="Mixer" bounds={bounds}>
            <Mixer />
          </DockedWindow>
          <DockedWindow id="pianoRoll" title={`Piano Roll — ${channel?.name ?? 'nenhum canal'} · ${pattern.name}`} accent={channel?.color} bounds={bounds}>
            <PianoRoll />
          </DockedWindow>
          {pluginWindows.map((w) => (
            <PluginWindow key={pluginWindowKey(w)} win={w} />
          ))}
        </div>
      </div>
      <ContextMenuHost />
    </div>
  );
}
