import type { SampleAsset } from '../model/types';

/**
 * Decoded samples by asset id. AudioBuffers are not tied to a context, so
 * the live engine and offline renders share them. Asset data never changes
 * for a given id (a new file gets a new id), so entries never go stale.
 */
const decoded = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | undefined>>();
const failed = new Set<string>();

export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function getDecodedSample(id: string | undefined): AudioBuffer | undefined {
  return id ? decoded.get(id) : undefined;
}

export function decodeSample(ctx: BaseAudioContext, asset: SampleAsset): Promise<AudioBuffer | undefined> {
  const done = decoded.get(asset.id);
  if (done) return Promise.resolve(done);
  if (failed.has(asset.id)) return Promise.resolve(undefined);
  let job = pending.get(asset.id);
  if (!job) {
    job = ctx
      .decodeAudioData(base64ToBytes(asset.data).buffer)
      .then((buf) => {
        decoded.set(asset.id, buf);
        return buf;
      })
      .catch((err) => {
        console.warn(`Não foi possível decodificar o sample "${asset.name}"`, err);
        failed.add(asset.id);
        return undefined;
      })
      .finally(() => pending.delete(asset.id));
    pending.set(asset.id, job);
  }
  return job;
}
