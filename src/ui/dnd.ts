import { baseName, desktop } from '../desktop/api';
import { isAudioFile } from './fileOps';

/** Drag type used for audio files dragged from the sample browser (value: file path). */
export const SAMPLE_MIME = 'application/x-musiccreator-sample';

/** Whether a drag carries audio: from the sample browser or files from the OS. */
export function isAudioDrag(dt: DataTransfer): boolean {
  return dt.types.includes(SAMPLE_MIME) || dt.types.includes('Files');
}

/**
 * Reads the audio of a drop. Call synchronously from the drop handler: the
 * drag data is only readable during the event.
 */
export function readDroppedAudio(dt: DataTransfer): Promise<{ name: string; bytes: Uint8Array } | null> {
  const path = dt.getData(SAMPLE_MIME);
  if (path && desktop) {
    return desktop.readAudio(path).then((bytes) => ({ name: baseName(path), bytes }));
  }
  const file = [...dt.files].find(isAudioFile);
  if (!file) return Promise.resolve(null);
  return file.arrayBuffer().then((buf) => ({ name: file.name, bytes: new Uint8Array(buf) }));
}
