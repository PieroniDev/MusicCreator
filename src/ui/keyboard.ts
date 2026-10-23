import { engine } from '../audio/engine';
import { actions, useStore, type WindowId } from '../state/store';
import { liveNoteOff, liveNoteOn, releaseAllLive } from './liveInput';
import { isTyping } from './focus';
import { newProject, openProject, saveProject } from './fileOps';
import { runExport } from './exporter';
import { desktop } from '../desktop/api';

/** Physical key → semitone offset, laid out like a piano on a QWERTY keyboard. */
const LOWER_ROW = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma'];
const UPPER_ROW = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP'];

const NOTE_KEYS = new Map<string, number>([
  ...LOWER_ROW.map((code, i) => [code, 48 + i] as [string, number]),
  ...UPPER_ROW.map((code, i) => [code, 60 + i] as [string, number]),
]);

const WINDOW_KEYS: Record<string, WindowId> = { F5: 'playlist', F6: 'channelRack', F7: 'pianoRoll', F9: 'mixer' };

/** Global shortcuts: transport, windows, undo, and the computer-keyboard piano. */
export function installKeyboard(): () => void {
  const held = new Set<string>();

  const down = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const a = actions();

    if (ctrl) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        a.undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        a.redo();
      } else if (k === 's') {
        e.preventDefault();
        void saveProject(e.shiftKey);
      } else if (desktop && k === 'o') {
        // In a browser tab these belong to the browser; the desktop app takes them.
        e.preventDefault();
        void openProject();
      } else if (desktop && k === 'n') {
        e.preventDefault();
        newProject();
      } else if (desktop && k === 'r') {
        e.preventDefault();
        void runExport();
      }
      return;
    }
    if (e.altKey) return;

    if (e.code === 'Space') {
      e.preventDefault();
      // Otherwise the focused button would also be "clicked" when Space is released.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      if (!e.repeat) engine.toggle();
      return;
    }
    if (WINDOW_KEYS[e.key]) {
      e.preventDefault();
      a.toggleWindow(WINDOW_KEYS[e.key]);
      return;
    }
    if (e.code === 'KeyL' && !e.repeat) {
      a.setMode(useStore.getState().ui.mode === 'pattern' ? 'song' : 'pattern');
      return;
    }
    const key = NOTE_KEYS.get(e.code);
    if (key !== undefined) {
      e.preventDefault();
      if (e.repeat || held.has(e.code)) return;
      held.add(e.code);
      liveNoteOn('kbd', key, 0.8);
    }
  };

  const up = (e: KeyboardEvent) => {
    const key = NOTE_KEYS.get(e.code);
    if (key !== undefined && held.delete(e.code)) liveNoteOff('kbd', key);
  };

  const releaseAll = () => {
    held.clear();
    releaseAllLive();
  };

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', releaseAll);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', releaseAll);
  };
}
