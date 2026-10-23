import { parseProject, serializeProject, FILE_EXTENSION } from '../model/serialize';
import { renderProject } from '../audio/render';
import { encodeWav } from '../audio/wav';
import { bytesToBase64 } from '../audio/samples';
import { actions, isDirty, useStore } from '../state/store';
import { engine } from '../audio/engine';
import { baseName, desktop } from '../desktop/api';

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'projeto';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

function showError(err: unknown, fallback: string): void {
  alert(err instanceof Error && err.message ? err.message : fallback);
}

/** Asks before throwing away unsaved changes. */
export function confirmDiscard(): boolean {
  return !isDirty(useStore.getState()) || confirm('O projeto tem alterações não salvas. Descartar e continuar?');
}

/**
 * Saves the project. On the desktop it writes to the project's file (asking
 * for one the first time or with `saveAs`); in the browser it downloads it.
 * Returns whether it was saved.
 */
export async function saveProject(saveAs = false): Promise<boolean> {
  const a = actions();
  if (!desktop) {
    const { project } = useStore.getState();
    downloadBlob(new Blob([serializeProject(project)], { type: 'application/json' }), `${safeName(project.name)}${FILE_EXTENSION}`);
    a.markSaved(null);
    return true;
  }
  try {
    let path = saveAs ? null : useStore.getState().doc.path;
    if (!path) {
      path = await desktop.saveProjectDialog(`${safeName(useStore.getState().project.name)}${FILE_EXTENSION}`);
      if (!path) return false;
      // A new file names the project, like in other DAWs.
      const fileName = baseName(path).replace(/\.mcproj$/i, '');
      if (fileName && fileName !== useStore.getState().project.name) a.setProjectName(fileName);
    }
    const { project } = useStore.getState();
    await desktop.writeProject(path, serializeProject(project));
    a.markSaved(path);
    return true;
  } catch (err) {
    showError(err, 'Não foi possível salvar o projeto.');
    return false;
  }
}

function openParsed(content: string, path: string | null): void {
  const project = parseProject(JSON.parse(content));
  engine.stop();
  actions().loadProject(project, path);
}

export async function openProject(): Promise<void> {
  if (!confirmDiscard()) return;
  try {
    if (desktop) {
      const file = await desktop.openProjectDialog();
      if (file) openParsed(file.content, file.path);
      return;
    }
    const file = await pickFile(`${FILE_EXTENSION},.json`);
    if (file) openParsed(await file.text(), null);
  } catch (err) {
    showError(err, 'Não foi possível abrir o arquivo.');
  }
}

/** Opens a project by path (recent files, double-click in the OS). Desktop only. */
export async function openProjectPath(path: string): Promise<void> {
  if (!desktop || !confirmDiscard()) return;
  try {
    const file = await desktop.readProject(path);
    openParsed(file.content, file.path);
  } catch (err) {
    showError(err, `Não foi possível abrir "${path}".`);
  }
}

export function newProject(): void {
  if (!confirmDiscard()) return;
  engine.stop();
  actions().newProject();
}

export async function exportWav(onProgress: (fraction: number) => void): Promise<void> {
  const { project, ui } = useStore.getState();
  const buffer = await renderProject(project, { mode: ui.mode, patternId: ui.selectedPatternId, onProgress });
  const suffix = ui.mode === 'pattern' ? ` - ${project.patterns.find((p) => p.id === ui.selectedPatternId)?.name ?? 'pattern'}` : '';
  const name = `${safeName(project.name + suffix)}.wav`;
  const wav = encodeWav(buffer);
  if (desktop) await desktop.exportAudio(name, new Uint8Array(wav));
  else downloadBlob(new Blob([wav], { type: 'audio/wav' }), name);
}

const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a';
const MAX_SAMPLE_BYTES = 50 * 1024 * 1024;

/** Checks the bytes are audio the engine can decode; returns them base64-encoded. */
async function validateAudio(name: string, bytes: Uint8Array): Promise<string | null> {
  if (bytes.byteLength > MAX_SAMPLE_BYTES) {
    alert(`"${name}" é grande demais (máximo 50 MB).`);
    return null;
  }
  try {
    await engine.ensureRunning().decodeAudioData(bytes.slice().buffer);
  } catch {
    alert(`Não foi possível ler "${name}" como áudio.`);
    return null;
  }
  return bytesToBase64(bytes);
}

/** Puts audio into a channel's sampler. */
export async function loadSampleBytes(channelId: string, name: string, bytes: Uint8Array): Promise<boolean> {
  const data = await validateAudio(name, bytes);
  if (data) actions().setChannelSample(channelId, name, data);
  return !!data;
}

/** Creates a Sampler channel playing the given audio; returns its id. */
export async function addSamplerChannel(name: string, bytes: Uint8Array): Promise<string | null> {
  const data = await validateAudio(name, bytes);
  if (!data) return null;
  const a = actions();
  const id = a.addChannel('sampler');
  a.setChannelSample(id, name, data);
  return id;
}

/** Reads an audio file chosen by the user (or dropped) into a channel's sampler. */
export async function loadSampleFile(channelId: string, file?: File | null): Promise<void> {
  const f = file ?? (await pickFile(AUDIO_ACCEPT));
  if (!f) return;
  await loadSampleBytes(channelId, f.name, new Uint8Array(await f.arrayBuffer()));
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|aiff?|m4a|opus|webm)$/i.test(file.name);
}
