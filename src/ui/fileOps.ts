import { parseProject, serializeProject, FILE_EXTENSION } from '../model/serialize';
import { renderProject } from '../audio/render';
import { encodeWav } from '../audio/wav';
import { bytesToBase64 } from '../audio/samples';
import { actions, isDirty, useStore } from '../state/store';
import { engine } from '../audio/engine';
import { baseName, desktop } from '../desktop/api';
import { readMidi, writeMidi, type MidiSong, type MidiTrack } from '../model/midiFile';
import { patternEvents, songEvents } from '../model/events';
import { patternLength, songLength } from '../model/pattern';
import { createNote } from '../model/defaults';

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
  if (desktop) await desktop.exportFile(name, new Uint8Array(wav), 'wav');
  else downloadBlob(new Blob([wav], { type: 'audio/wav' }), name);
}

const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a';
const MAX_SAMPLE_BYTES = 50 * 1024 * 1024;

/** Checks the bytes are audio the engine can decode; returns them base64-encoded with their duration. */
async function validateAudio(name: string, bytes: Uint8Array): Promise<{ data: string; duration: number } | null> {
  if (bytes.byteLength > MAX_SAMPLE_BYTES) {
    alert(`"${name}" é grande demais (máximo 50 MB).`);
    return null;
  }
  try {
    const buffer = await engine.ensureRunning().decodeAudioData(bytes.slice().buffer);
    return { data: bytesToBase64(bytes), duration: buffer.duration };
  } catch {
    alert(`Não foi possível ler "${name}" como áudio.`);
    return null;
  }
}

/** Puts audio into a channel's sampler. */
export async function loadSampleBytes(channelId: string, name: string, bytes: Uint8Array): Promise<boolean> {
  const audio = await validateAudio(name, bytes);
  if (audio) actions().setChannelSample(channelId, name, audio.data);
  return !!audio;
}

/** Creates a Sampler channel playing the given audio; returns its id and the audio's length in seconds. */
export async function addSamplerChannel(name: string, bytes: Uint8Array): Promise<{ id: string; duration: number } | null> {
  const audio = await validateAudio(name, bytes);
  if (!audio) return null;
  const a = actions();
  const id = a.addChannel('sampler');
  a.setChannelSample(id, name, audio.data);
  return { id, duration: audio.duration };
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

/** General MIDI drum keys → Drum Synth preset, for importing drum tracks. */
const GM_DRUMS: Array<[number[], string]> = [
  [[35, 36], 'Kick'],
  [[38, 40], 'Snare'],
  [[39], 'Clap'],
  [[42, 44], 'Hat fechado'],
  [[46], 'Hat aberto'],
  [[41, 43, 45, 47, 48, 50], 'Tom'],
  [[37], 'Rim'],
  [[56], 'Cowbell'],
  [[49, 51, 52, 55, 57, 59], 'Prato'],
];

/** General MIDI key of each Drum Synth voice (same order as DRUM_VOICES). */
const GM_KEY_BY_VOICE = [36, 38, 39, 42, 46, 45, 37, 56, 49];

/** Exports the notes of the pattern (PAT mode) or the whole song (SONG mode) as a .mid file. */
export async function exportMidi(): Promise<void> {
  const { project, ui } = useStore.getState();
  const song = ui.mode === 'song';
  const pattern = project.patterns.find((p) => p.id === ui.selectedPatternId) ?? project.patterns[0];
  const events = song ? songEvents(project, 0, songLength(project)) : patternEvents(project, pattern.id, 0, patternLength(pattern));
  let nextChannel = 0;
  const tracks: MidiTrack[] = [];
  for (const channel of project.channels) {
    const notes = events.filter((e) => e.channelId === channel.id);
    if (!notes.length) continue;
    const drums = channel.instrument === 'drums' || channel.instrument === 'pads';
    // Drums go to MIDI channel 10 (index 9), like General MIDI drums.
    const midiChannel = drums ? 9 : nextChannel === 9 ? ++nextChannel : nextChannel;
    if (!drums) nextChannel = (midiChannel + 1) % 16;
    // A Drum Synth channel plays one drum: write it on that drum's General MIDI key.
    const gmKey = channel.instrument === 'drums' ? GM_KEY_BY_VOICE[Math.round(channel.params.voice ?? 0)] : undefined;
    tracks.push({
      name: channel.name,
      channel: midiChannel,
      notes: notes.map(({ key, start, length, velocity }) => ({ key: gmKey ?? key, start, length, velocity })),
    });
  }
  if (!tracks.length) {
    alert(song ? 'A música não tem notas para exportar.' : 'Este pattern não tem notas para exportar.');
    return;
  }
  const data = writeMidi({ bpm: project.bpm, tracks });
  const name = `${safeName(song ? project.name : `${project.name} - ${pattern.name}`)}.mid`;
  if (desktop) await desktop.exportFile(name, data, 'mid');
  else downloadBlob(new Blob([data], { type: 'audio/midi' }), name);
}

/**
 * Imports a .mid file into the selected pattern: one new channel per track
 * (drum tracks are split into Drum Synth channels per drum), as one undo step.
 */
export async function importMidi(): Promise<void> {
  let bytes: Uint8Array | null = null;
  if (desktop) bytes = (await desktop.openMidiDialog())?.data ?? null;
  else {
    const file = await pickFile('.mid,.midi,audio/midi');
    if (file) bytes = new Uint8Array(await file.arrayBuffer());
  }
  if (!bytes) return;
  let song: MidiSong;
  try {
    song = readMidi(bytes);
  } catch (err) {
    showError(err, 'Não foi possível ler o arquivo MIDI.');
    return;
  }
  const tracks = song.tracks.filter((t) => t.notes.length);
  if (!tracks.length) {
    alert('O arquivo MIDI não tem notas.');
    return;
  }
  const a = actions();
  const { project, ui } = useStore.getState();
  const patternId = ui.selectedPatternId;
  a.beginGesture();
  for (const track of tracks) {
    if (track.channel === 9) {
      for (const [keys, preset] of GM_DRUMS) {
        const hits = track.notes.filter((n) => keys.includes(n.key));
        if (!hits.length) continue;
        const id = a.addChannel('drums', preset);
        // Drum Synth plays its sound at the channel's root key.
        a.addNotes(patternId, id, hits.map((n) => createNote(60, n.start, n.length, n.velocity)));
      }
      continue;
    }
    const id = a.addChannel('trio', 'Pluck');
    a.updateChannel(id, { name: track.name });
    a.addNotes(patternId, id, track.notes.map((n) => createNote(n.key, n.start, n.length, n.velocity)));
  }
  a.endGesture();
  if (song.bpm && Math.abs(song.bpm - project.bpm) > 0.01 && confirm(`Usar o andamento do arquivo MIDI (${song.bpm} BPM)?`)) {
    a.setBpm(song.bpm);
  }
  a.toggleWindow('channelRack', true);
}

/** Puts audio on a Drum Pads pad (from bytes, or a file picked by the user). */
export async function loadPadSample(channelId: string, pad: number, audio?: { name: string; bytes: Uint8Array }): Promise<void> {
  let source = audio;
  if (!source) {
    const f = await pickFile(AUDIO_ACCEPT);
    if (!f) return;
    source = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
  }
  const checked = await validateAudio(source.name, source.bytes);
  if (checked) actions().setPadSample(channelId, pad, source.name, checked.data);
}
