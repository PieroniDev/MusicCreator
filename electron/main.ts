import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DesktopCommand, DesktopSettings, DirEntry, DocumentState } from '../src/desktop/api';
import { AUDIO_EXTENSIONS } from '../src/desktop/api';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const PROJECT_EXTENSIONS = ['.mcproj', '.json'];
const MAX_PROJECT_BYTES = 512 * 1024 * 1024;
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
const MAX_RECENT = 10;
const MAX_MIDI_BYTES = 16 * 1024 * 1024;
const EXPORT_FORMATS = {
  wav: { ext: 'wav', label: 'WAV', title: 'Exportar áudio' },
  mid: { ext: 'mid', label: 'MIDI', title: 'Exportar MIDI' },
} as const;

interface StoredSettings extends DesktopSettings {
  bounds?: { x: number; y: number; width: number; height: number; maximized: boolean };
}

let win: BrowserWindow | null = null;
let doc: DocumentState = { title: 'MusicCreator', dirty: false, path: null };
let allowClose = false;
let pendingOpen: string | null = projectFromArgs(process.argv);
let settings: StoredSettings = { sampleFolders: [], recent: [] };

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

async function loadSettings(): Promise<void> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsFile(), 'utf8')) as Partial<StoredSettings>;
    settings = {
      sampleFolders: Array.isArray(raw.sampleFolders) ? raw.sampleFolders.filter((p) => typeof p === 'string') : [],
      recent: Array.isArray(raw.recent) ? raw.recent.filter((p) => typeof p === 'string') : [],
      bounds: raw.bounds,
    };
  } catch {
    // First run: suggest the user's music folder in the browser.
    settings = { sampleFolders: [app.getPath('music')], recent: [] };
  }
}

async function saveSettings(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
    await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Could not save settings', err);
  }
}

function projectFromArgs(argv: string[]): string | null {
  return argv.slice(1).find((a) => a.toLowerCase().endsWith('.mcproj')) ?? null;
}

function hasExtension(file: string, extensions: string[]): boolean {
  return extensions.includes(path.extname(file).toLowerCase());
}

function requirePath(value: unknown, extensions?: string[]): string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Caminho inválido.');
  if (extensions && !hasExtension(value, extensions)) throw new Error('Tipo de arquivo não permitido.');
  return path.normalize(value);
}

async function readLimited(file: string, max: number): Promise<Buffer> {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('Não é um arquivo.');
  if (stat.size > max) throw new Error('Arquivo grande demais.');
  return fs.readFile(file);
}

/** Writes through a temporary file so a crash never leaves a half-written project. */
async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

function addRecent(file: string): void {
  settings.recent = [file, ...settings.recent.filter((p) => p !== file)].slice(0, MAX_RECENT);
  app.addRecentDocument(file);
  void saveSettings();
  buildMenu();
}

function send(command: DesktopCommand, arg?: string): void {
  win?.webContents.send('app:command', command, arg);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  // The renderer handles these shortcuts itself (they also work in the web
  // build), so the menu only displays them instead of registering them.
  const item = (label: string, command: DesktopCommand, accelerator?: string, arg?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(command, arg),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Arquivo',
      submenu: [
        item('Novo projeto', 'new', 'CmdOrCtrl+N'),
        item('Abrir…', 'open', 'CmdOrCtrl+O'),
        {
          label: 'Abrir recente',
          submenu: settings.recent.length
            ? settings.recent.map((file) => ({ label: file, click: () => send('open-path', file) }))
            : [{ label: 'Nenhum arquivo recente', enabled: false }],
        },
        { type: 'separator' },
        item('Salvar', 'save', 'CmdOrCtrl+S'),
        item('Salvar como…', 'save-as', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        item('Exportar WAV…', 'export-wav', 'CmdOrCtrl+R'),
        item('Exportar MIDI…', 'export-midi'),
        item('Importar MIDI…', 'import-midi'),
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Fechar janela' } : { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        item('Desfazer', 'undo', 'CmdOrCtrl+Z'),
        item('Refazer', 'redo', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        item('Playlist', 'toggle-window', 'F5', 'playlist'),
        item('Channel Rack', 'toggle-window', 'F6', 'channelRack'),
        item('Piano Roll', 'toggle-window', 'F7', 'pianoRoll'),
        item('Mixer', 'toggle-window', 'F9', 'mixer'),
        { type: 'separator' },
        { label: 'Reorganizar janelas', click: () => send('reset-layout') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamanho real' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        ...(DEV_URL || !app.isPackaged
          ? [{ type: 'separator' as const }, { role: 'forceReload' as const }, { role: 'toggleDevTools' as const }]
          : []),
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Sobre o MusicCreator',
          click: () =>
            void dialog.showMessageBox(win!, {
              type: 'info',
              title: 'MusicCreator',
              message: `MusicCreator ${app.getVersion()}`,
              detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
            }),
        },
        { label: 'Pasta de configurações', click: () => void shell.openPath(app.getPath('userData')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle('project:open-dialog', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Abrir projeto',
      properties: ['openFile'],
      filters: [{ name: 'Projeto MusicCreator', extensions: ['mcproj', 'json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    const content = (await readLimited(file, MAX_PROJECT_BYTES)).toString('utf8');
    addRecent(file);
    return { path: file, content };
  });

  ipcMain.handle('project:read', async (_e, value: unknown) => {
    const file = requirePath(value, PROJECT_EXTENSIONS);
    const content = (await readLimited(file, MAX_PROJECT_BYTES)).toString('utf8');
    addRecent(file);
    return { path: file, content };
  });

  ipcMain.handle('project:save-dialog', async (_e, suggested: unknown) => {
    const name = typeof suggested === 'string' && suggested ? suggested : 'projeto.mcproj';
    const result = await dialog.showSaveDialog(win!, {
      title: 'Salvar projeto',
      defaultPath: path.join(doc.path ? path.dirname(doc.path) : app.getPath('documents'), name),
      filters: [{ name: 'Projeto MusicCreator', extensions: ['mcproj'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return hasExtension(result.filePath, ['.mcproj']) ? result.filePath : `${result.filePath}.mcproj`;
  });

  ipcMain.handle('project:write', async (_e, value: unknown, content: unknown) => {
    const file = requirePath(value, PROJECT_EXTENSIONS);
    if (typeof content !== 'string') throw new Error('Conteúdo inválido.');
    await writeAtomic(file, content);
    addRecent(file);
  });

  ipcMain.handle('export:save', async (_e, suggested: unknown, data: unknown, kind: unknown) => {
    if (!(data instanceof Uint8Array)) throw new Error('Dados inválidos.');
    const format = EXPORT_FORMATS[kind === 'mid' ? 'mid' : 'wav'];
    const name = typeof suggested === 'string' && suggested ? suggested : `export.${format.ext}`;
    const result = await dialog.showSaveDialog(win!, {
      title: format.title,
      defaultPath: path.join(doc.path ? path.dirname(doc.path) : app.getPath('music'), name),
      filters: [{ name: format.label, extensions: [format.ext] }],
    });
    if (result.canceled || !result.filePath) return null;
    const file = hasExtension(result.filePath, [`.${format.ext}`]) ? result.filePath : `${result.filePath}.${format.ext}`;
    await writeAtomic(file, data);
    return file;
  });

  ipcMain.handle('midi:open-dialog', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Importar MIDI',
      properties: ['openFile'],
      filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }],
    });
    const file = result.canceled ? undefined : result.filePaths[0];
    if (!file) return null;
    return { name: path.basename(file), data: new Uint8Array(await readLimited(file, MAX_MIDI_BYTES)) };
  });

  ipcMain.handle('fs:pick-folder', async () => {
    const result = await dialog.showOpenDialog(win!, { title: 'Adicionar pasta de samples', properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('fs:list', async (_e, value: unknown): Promise<DirEntry[]> => {
    const dir = requirePath(value);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || (e.isFile() && hasExtension(e.name, AUDIO_EXTENSIONS))))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name), isDir: e.isDirectory() }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  });

  ipcMain.handle('fs:read-audio', async (_e, value: unknown) => {
    const file = requirePath(value, AUDIO_EXTENSIONS);
    return new Uint8Array(await readLimited(file, MAX_AUDIO_BYTES));
  });

  ipcMain.handle('settings:get', (): DesktopSettings => ({ sampleFolders: settings.sampleFolders, recent: settings.recent }));

  ipcMain.handle('settings:set-sample-folders', async (_e, folders: unknown) => {
    if (!Array.isArray(folders)) throw new Error('Lista inválida.');
    settings.sampleFolders = folders.filter((f): f is string => typeof f === 'string' && path.isAbsolute(f)).slice(0, 50);
    await saveSettings();
  });

  ipcMain.handle('app:take-pending-open', () => {
    const file = pendingOpen;
    pendingOpen = null;
    return file;
  });

  ipcMain.on('app:set-document', (_e, state: DocumentState) => {
    if (!state || typeof state.title !== 'string') return;
    doc = { title: state.title, dirty: !!state.dirty, path: typeof state.path === 'string' ? state.path : null };
    if (!win) return;
    win.setTitle(doc.title);
    win.setDocumentEdited(doc.dirty);
    if (doc.path) win.setRepresentedFilename(doc.path);
  });

  ipcMain.on('app:close-confirmed', () => {
    allowClose = true;
    win?.close();
  });
}

function createWindow(): void {
  const b = settings.bounds;
  win = new BrowserWindow({
    width: b?.width ?? 1440,
    height: b?.height ?? 900,
    x: b?.x,
    y: b?.y,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#121519',
    title: 'MusicCreator',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The audio scheduler must keep running when the window is in the background.
      backgroundThrottling: false,
    },
  });
  if (b?.maximized) win.maximize();
  win.once('ready-to-show', () => win?.show());

  // The page never navigates or opens other windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.on('close', (event) => {
    if (win) {
      const bounds = win.getNormalBounds();
      settings.bounds = { ...bounds, maximized: win.isMaximized() };
      void saveSettings();
    }
    if (allowClose || !doc.dirty) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'question',
      buttons: ['Salvar', 'Não salvar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      title: 'MusicCreator',
      message: 'Salvar as alterações do projeto antes de sair?',
      detail: 'Se você não salvar, as alterações feitas desde o último salvamento serão perdidas.',
    });
    if (choice === 0) send('save-then-close');
    else if (choice === 1) send('discard-then-close');
  });
  win.on('closed', () => {
    win = null;
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// AudioContexts may start without a click, like in a native app.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const file = projectFromArgs(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (file) send('open-path', file);
    }
  });

  // macOS: double-clicking a project in Finder.
  app.on('open-file', (event, file) => {
    event.preventDefault();
    if (win) send('open-path', file);
    else pendingOpen = file;
  });

  app.whenReady().then(async () => {
    await loadSettings();
    // MIDI keyboards and audio inputs; nothing else is ever granted.
    const allowed = new Set(['midi', 'media']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
    registerIpc();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
