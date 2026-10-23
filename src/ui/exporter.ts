import { create } from 'zustand';
import { exportWav } from './fileOps';

/** Progress (0..1) of the WAV export in progress, or null when idle. */
export const useExportProgress = create<{ progress: number | null }>(() => ({ progress: null }));

/** Renders and saves the WAV, reporting progress; ignores calls while one runs. */
export async function runExport(): Promise<void> {
  if (useExportProgress.getState().progress !== null) return;
  useExportProgress.setState({ progress: 0 });
  try {
    await exportWav((progress) => useExportProgress.setState({ progress }));
  } catch (err) {
    console.error(err);
    alert('Falha ao exportar o áudio.');
  } finally {
    useExportProgress.setState({ progress: null });
  }
}
