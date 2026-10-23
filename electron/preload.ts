import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopApi, DesktopCommand } from '../src/desktop/api';

// Only these narrow, validated operations reach the main process; the page
// itself has no Node.js access.
const api: DesktopApi = {
  platform: process.platform,
  openProjectDialog: () => ipcRenderer.invoke('project:open-dialog'),
  readProject: (path) => ipcRenderer.invoke('project:read', path),
  saveProjectDialog: (name) => ipcRenderer.invoke('project:save-dialog', name),
  writeProject: (path, content) => ipcRenderer.invoke('project:write', path, content),
  exportFile: (name, data, kind) => ipcRenderer.invoke('export:save', name, data, kind),
  openMidiDialog: () => ipcRenderer.invoke('midi:open-dialog'),
  pickFolder: () => ipcRenderer.invoke('fs:pick-folder'),
  listDir: (dir) => ipcRenderer.invoke('fs:list', dir),
  readAudio: (path) => ipcRenderer.invoke('fs:read-audio', path),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSampleFolders: (folders) => ipcRenderer.invoke('settings:set-sample-folders', folders),
  setDocument: (state) => ipcRenderer.send('app:set-document', state),
  takePendingOpen: () => ipcRenderer.invoke('app:take-pending-open'),
  confirmClose: () => ipcRenderer.send('app:close-confirmed'),
  onCommand(listener) {
    const handler = (_event: IpcRendererEvent, command: DesktopCommand, arg?: string) => listener(command, arg);
    ipcRenderer.on('app:command', handler);
    return () => ipcRenderer.removeListener('app:command', handler);
  },
};

contextBridge.exposeInMainWorld('desktop', api);
