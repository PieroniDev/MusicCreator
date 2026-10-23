import { engine } from './engine';

/** Recently previewed files, so clicking through a folder twice is instant. */
const cache = new Map<string, AudioBuffer>();
const CACHE_SIZE = 32;

let current: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let request = 0;

export function stopPreview(): void {
  if (!current) return;
  try {
    current.source.stop();
  } catch {
    /* already stopped */
  }
  current.gain.disconnect();
  current = null;
}

/** Plays a file from the browser straight to the output (outside the mixer). */
export async function previewFile(key: string, load: () => Promise<Uint8Array>): Promise<void> {
  stopPreview();
  const ticket = ++request;
  const ctx = engine.ensureRunning();
  let buffer = cache.get(key);
  if (!buffer) {
    try {
      const bytes = await load();
      buffer = await ctx.decodeAudioData(bytes.slice().buffer);
    } catch {
      return;
    }
    cache.set(key, buffer);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  // Another file was clicked while this one loaded.
  if (ticket !== request) return;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = 0.8;
  source.connect(gain).connect(ctx.destination);
  source.onended = () => {
    if (current?.source === source) stopPreview();
  };
  source.start();
  current = { source, gain };
}
