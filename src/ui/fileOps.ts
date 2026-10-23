import { parseProject, serializeProject, FILE_EXTENSION } from '../model/serialize';
import { renderProject } from '../audio/render';
import { encodeWav } from '../audio/wav';
import { bytesToBase64 } from '../audio/samples';
import { actions, useStore } from '../state/store';
import { engine } from '../audio/engine';

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

export function saveProjectFile(): void {
  const { project } = useStore.getState();
  downloadBlob(new Blob([serializeProject(project)], { type: 'application/json' }), `${safeName(project.name)}${FILE_EXTENSION}`);
}

export async function openProjectFile(): Promise<void> {
  const file = await pickFile(`${FILE_EXTENSION},.json`);
  if (!file) return;
  try {
    const project = parseProject(JSON.parse(await file.text()));
    engine.stop();
    actions().loadProject(project);
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Não foi possível abrir o arquivo.');
  }
}

export async function exportWav(onProgress: (fraction: number) => void): Promise<void> {
  const { project, ui } = useStore.getState();
  const buffer = await renderProject(project, { mode: ui.mode, patternId: ui.selectedPatternId, onProgress });
  const suffix = ui.mode === 'pattern' ? ` - ${project.patterns.find((p) => p.id === ui.selectedPatternId)?.name ?? 'pattern'}` : '';
  downloadBlob(new Blob([encodeWav(buffer)], { type: 'audio/wav' }), `${safeName(project.name + suffix)}.wav`);
}

const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a';

/** Reads an audio file into a channel's sampler. */
export async function loadSampleFile(channelId: string, file?: File | null): Promise<void> {
  const f = file ?? (await pickFile(AUDIO_ACCEPT));
  if (!f) return;
  const MAX_BYTES = 30 * 1024 * 1024;
  if (f.size > MAX_BYTES) {
    alert('Arquivo muito grande (máximo 30 MB).');
    return;
  }
  const bytes = new Uint8Array(await f.arrayBuffer());
  // Make sure the browser can decode it before storing it in the project.
  try {
    const ctx = engine.ensureRunning();
    await ctx.decodeAudioData(bytes.slice().buffer);
  } catch {
    alert(`O navegador não conseguiu ler "${f.name}" como áudio.`);
    return;
  }
  actions().setChannelSample(channelId, f.name, bytesToBase64(bytes));
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|aiff?|m4a)$/i.test(file.name);
}
