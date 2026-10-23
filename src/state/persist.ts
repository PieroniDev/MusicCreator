import type { Project } from '../model/types';
import { parseProject, serializeProject } from '../model/serialize';
import { isDirty, useStore, type UIState } from './store';

let layoutRestored = false;
/** Set when the window is closing without saving: no more autosaves after that. */
let frozen = false;

/** Whether a saved window layout was restored (otherwise the app fits one to the screen). */
export function hasSavedLayout(): boolean {
  return layoutRestored;
}

const PROJECT_KEY = 'musiccreator:project';
const LAYOUT_KEY = 'musiccreator:layout';

interface Autosave {
  project: Project;
  /** File the project belongs to (desktop). */
  path: string | null;
  /** Whether it had changes not yet saved to that file. */
  dirty: boolean;
}

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

function writeAutosave(save: Autosave): void {
  const json = (project: Project) => `{"path":${JSON.stringify(save.path)},"dirty":${save.dirty},"project":${serializeProject(project)}}`;
  // Over the storage quota (big samples): keep everything else.
  if (!write(PROJECT_KEY, json(save.project))) write(PROJECT_KEY, json({ ...save.project, samples: {} }));
}

/** Saves the current state right away (used before the window closes). */
export function flushAutosave(): void {
  if (frozen) return;
  const s = useStore.getState();
  writeAutosave({ project: s.project, path: s.doc.path, dirty: isDirty(s) });
}

/** Makes the next start open the last saved version instead of the unsaved changes. */
export function discardUnsavedAutosave(): void {
  frozen = true;
  const { doc } = useStore.getState();
  if (doc.saved) writeAutosave({ project: doc.saved, path: doc.path, dirty: false });
  else {
    try {
      localStorage.removeItem(PROJECT_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

/** Restores the autosaved project and window layout, then keeps saving changes. */
export function setupPersistence(): void {
  const saved = readJson(PROJECT_KEY) as Partial<Autosave> | null;
  if (saved) {
    try {
      // Older autosaves stored the bare project.
      const wrapped = saved && 'project' in saved;
      const project = parseProject(wrapped ? saved.project : saved);
      const path = wrapped && typeof saved.path === 'string' ? saved.path : null;
      useStore.getState().loadProject(project, path, !(wrapped && saved.dirty));
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
  let last: unknown[] = [];
  useStore.subscribe((state) => {
    const current = [state.project, state.ui.windows, state.doc];
    if (current.every((v, i) => v === last[i])) return;
    last = current;
    clearTimeout(timer);
    timer = setTimeout(() => {
      flushAutosave();
      write(LAYOUT_KEY, JSON.stringify({ windows: useStore.getState().ui.windows }));
    }, 800);
  });
}
