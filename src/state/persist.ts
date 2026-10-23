import type { Project } from '../model/types';
import { parseProject, serializeProject } from '../model/serialize';
import { useStore, type UIState } from './store';

let layoutRestored = false;

/** Whether a saved window layout was restored (otherwise the app fits one to the screen). */
export function hasSavedLayout(): boolean {
  return layoutRestored;
}

const PROJECT_KEY = 'musiccreator:project';
const LAYOUT_KEY = 'musiccreator:layout';

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Restores the autosaved project and window layout, then keeps saving changes. */
export function setupPersistence(): void {
  const saved = readJson(PROJECT_KEY);
  if (saved) {
    try {
      useStore.getState().loadProject(parseProject(saved));
    } catch {
      /* corrupted autosave: keep the demo */
    }
  }
  const layout = readJson(LAYOUT_KEY) as Partial<UIState> | null;
  if (layout?.windows) {
    layoutRestored = true;
    useStore.setState((s) => {
      const windows = { ...s.ui.windows };
      for (const id of Object.keys(windows) as Array<keyof typeof windows>) {
        const w = layout.windows?.[id];
        if (w && [w.x, w.y, w.w, w.h].every((n) => typeof n === 'number' && Number.isFinite(n))) {
          windows[id] = { ...windows[id], ...w };
        }
      }
      return { ui: { ...s.ui, windows } };
    });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastProject: Project | undefined;
  let lastWindows: UIState['windows'] | undefined;
  useStore.subscribe((state) => {
    if (state.project === lastProject && state.ui.windows === lastWindows) return;
    lastProject = state.project;
    lastWindows = state.ui.windows;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { project, ui } = useStore.getState();
      if (!write(PROJECT_KEY, serializeProject(project))) {
        // Probably over the storage quota because of samples: keep the rest.
        write(PROJECT_KEY, serializeProject({ ...project, samples: {} }));
      }
      write(LAYOUT_KEY, JSON.stringify({ windows: ui.windows }));
    }, 800);
  });
}
