import { actions, isDirty, useStore, type WindowId } from '../state/store';
import { discardUnsavedAutosave, flushAutosave } from '../state/persist';
import { newProject, openProject, openProjectPath, saveProject } from '../ui/fileOps';
import { runExport } from '../ui/exporter';
import { resetLayout } from '../ui/layout';
import { baseName, desktop, type DesktopCommand } from './api';

async function handleCommand(command: DesktopCommand, arg?: string): Promise<void> {
  const a = actions();
  switch (command) {
    case 'new': return newProject();
    case 'open': return openProject();
    case 'open-path': return arg ? openProjectPath(arg) : undefined;
    case 'save': return void (await saveProject(false));
    case 'save-as': return void (await saveProject(true));
    case 'export-wav': return runExport();
    case 'undo': return a.undo();
    case 'redo': return a.redo();
    case 'toggle-window': return arg ? a.toggleWindow(arg as WindowId) : undefined;
    case 'reset-layout': return resetLayout();
    case 'save-then-close':
      if (await saveProject(false)) {
        flushAutosave();
        desktop?.confirmClose();
      }
      return;
    case 'discard-then-close':
      discardUnsavedAutosave();
      desktop?.confirmClose();
      return;
  }
}

/**
 * Keeps the window title in sync with the project (name, file, unsaved
 * changes) and, in the desktop app, wires the native menu and OS file opens.
 */
export function installDocumentIntegration(): void {
  let last = '';
  const sync = () => {
    const state = useStore.getState();
    const dirty = isDirty(state);
    const file = state.doc.path ? baseName(state.doc.path) : null;
    const title = `${dirty ? '• ' : ''}${state.project.name}${file ? ` (${file})` : ''} — MusicCreator`;
    const key = `${title}|${state.doc.path}|${dirty}`;
    if (key === last) return;
    last = key;
    document.title = title;
    desktop?.setDocument({ title, dirty, path: state.doc.path });
  };
  sync();
  useStore.subscribe(sync);

  if (!desktop) return;
  desktop.onCommand((command, arg) => void handleCommand(command, arg));
  void desktop.takePendingOpen().then((path) => {
    if (path) void openProjectPath(path);
  });
}
