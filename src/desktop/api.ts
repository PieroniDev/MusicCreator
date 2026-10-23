/**
 * The API the Electron preload exposes as `window.desktop`. In the browser
 * build it is undefined and the app falls back to downloads and file inputs.
 */

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface DesktopSettings {
  sampleFolders: string[];
  recent: string[];
}

export interface OpenedFile {
  path: string;
  content: string;
}

export interface DocumentState {
  title: string;
  dirty: boolean;
  path: string | null;
}

/** Commands sent from the native menu (and the OS) to the renderer. */
export type DesktopCommand =
  | 'new'
  | 'open'
  | 'open-path'
  | 'save'
  | 'save-as'
  | 'export-wav'
  | 'export-midi'
  | 'import-midi'
  | 'undo'
  | 'redo'
  | 'toggle-window'
  | 'reset-layout'
  | 'save-then-close'
  | 'discard-then-close';

export interface DesktopApi {
  platform: string;
  openProjectDialog(): Promise<OpenedFile | null>;
  readProject(path: string): Promise<OpenedFile>;
  saveProjectDialog(suggestedName: string): Promise<string | null>;
  writeProject(path: string, content: string): Promise<void>;
  /** Save dialog + write for exports: a WAV render or a MIDI file. */
  exportFile(suggestedName: string, data: Uint8Array, kind: 'wav' | 'mid'): Promise<string | null>;
  openMidiDialog(): Promise<{ name: string; data: Uint8Array } | null>;
  pickFolder(): Promise<string | null>;
  listDir(dir: string): Promise<DirEntry[]>;
  readAudio(path: string): Promise<Uint8Array>;
  getSettings(): Promise<DesktopSettings>;
  setSampleFolders(folders: string[]): Promise<void>;
  setDocument(state: DocumentState): void;
  takePendingOpen(): Promise<string | null>;
  confirmClose(): void;
  onCommand(listener: (command: DesktopCommand, arg?: string) => void): () => void;
}

export const desktop: DesktopApi | undefined = (globalThis as { desktop?: DesktopApi }).desktop;

export const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.aif', '.aiff', '.m4a', '.opus', '.webm'];

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
