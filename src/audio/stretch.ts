/**
 * Time-stretching (changing a sample's length without changing its pitch)
 * with WSOLA: overlapping windowed frames are copied from the input at a
 * different rate than they are written, each one nudged to the position that
 * best continues the previous frame's waveform. Long samples are processed in
 * a worker and cached per sample and stretch factor.
 */

/**
 * Stretches audio by `factor` (2 = twice as long). Self-contained on purpose:
 * its source is also run inside the worker.
 */
export function wsola(input: Float32Array[], factor: number, sampleRate: number): Float32Array<ArrayBuffer>[] {
  const length = input[0]?.length ?? 0;
  const outLength = Math.max(1, Math.round(length * factor));
  // ~23 ms frames at 44.1 kHz (short enough to keep drum hits tight); 50% overlap of Hann windows sums to 1.
  const frame = Math.pow(2, Math.round(Math.log2(sampleRate * 0.023)));
  const hop = frame / 2;
  // Search far enough to line up one period of an ~85 Hz wave.
  const tolerance = frame / 2;
  const out = input.map(() => new Float32Array(outLength + frame));
  const weight = new Float32Array(outLength + frame);
  if (length < frame * 2) {
    // Too short to stretch: resample by linear interpolation instead.
    return input.map((ch) => {
      const o = new Float32Array(outLength);
      for (let i = 0; i < outLength; i++) {
        const x = (i / factor);
        const a = Math.floor(x);
        const f = x - a;
        o[i] = (ch[a] ?? 0) * (1 - f) + (ch[a + 1] ?? ch[a] ?? 0) * f;
      }
      return o;
    });
  }
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);

  // The similarity search runs on a decimated mono mix (cheap), then is refined at full rate.
  const dec = 8;
  const monoLength = Math.floor(length / dec);
  const mono = new Float32Array(monoLength);
  for (let i = 0; i < monoLength; i++) {
    let s = 0;
    for (let k = 0; k < dec; k++) for (const ch of input) s += ch[i * dec + k];
    mono[i] = s;
  }
  const full = new Float32Array(length);
  for (const ch of input) for (let i = 0; i < length; i++) full[i] += ch[i];

  const maxPos = length - frame;
  let prev = 0;
  for (let k = 0; k * hop < outLength; k++) {
    const target = Math.min(maxPos, Math.max(0, Math.round((k * hop) / factor)));
    let pos = target;
    if (k > 0) {
      const natural = prev + hop;
      if (natural <= maxPos) {
        // Coarse search on the decimated signal.
        const n0 = Math.floor(natural / dec);
        const span = Math.floor(frame / dec);
        let best = -Infinity;
        const lo = Math.max(0, Math.floor((target - tolerance) / dec));
        const hi = Math.min(Math.floor(maxPos / dec), Math.floor((target + tolerance) / dec));
        for (let c = lo; c <= hi; c++) {
          let dot = 0;
          let energy = 1e-9;
          for (let i = 0; i < span && n0 + i < monoLength && c + i < monoLength; i++) {
            const v = mono[c + i];
            dot += mono[n0 + i] * v;
            energy += v * v;
          }
          const score = dot / Math.sqrt(energy);
          if (score > best) {
            best = score;
            pos = c * dec;
          }
        }
        // Refine around the coarse match at full rate, over the overlapping half.
        const coarse = pos;
        best = -Infinity;
        for (let c = Math.max(0, coarse - dec); c <= Math.min(maxPos, coarse + dec); c++) {
          let dot = 0;
          let energy = 1e-9;
          for (let i = 0; i < hop; i++) {
            const v = full[c + i];
            dot += full[natural + i] * v;
            energy += v * v;
          }
          const score = dot / Math.sqrt(energy);
          if (score > best) {
            best = score;
            pos = c;
          }
        }
      }
    }
    const at = k * hop;
    for (let c = 0; c < input.length; c++) {
      const src = input[c];
      const dst = out[c];
      for (let i = 0; i < frame; i++) {
        // The first frame starts at full level instead of fading in from silence.
        const w = k === 0 && i < hop ? 1 : window[i];
        dst[at + i] += src[pos + i] * w;
        if (c === 0) weight[at + i] += w;
      }
    }
    prev = pos;
  }
  return out.map((ch) => {
    const o = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) o[i] = ch[i] / Math.max(weight[i], 1e-3);
    return o;
  });
}

interface Job {
  key: string;
  sampleId: string;
  source: AudioBuffer;
  factor: number;
  waiters: Array<(buffer: AudioBuffer) => void>;
}

/** Stretched buffers by `${sampleId}|${factor}`; a few factors per sample are kept. */
const ready = new Map<string, AudioBuffer>();
const queue: Job[] = [];
let running: Job | null = null;
let worker: Worker | null | undefined;
const KEEP_PER_SAMPLE = 3;

function keyOf(sampleId: string, factor: number): string {
  return `${sampleId}|${factor.toFixed(4)}`;
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const src = `const wsola = ${wsola.toString()};
onmessage = (e) => {
  const { channels, factor, sampleRate } = e.data;
  const out = wsola(channels, factor, sampleRate);
  postMessage(out, out.map((c) => c.buffer));
};`;
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch {
    worker = null;
  }
  return worker;
}

function finish(job: Job, channels: Float32Array<ArrayBuffer>[]): void {
  const buffer = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate: job.source.sampleRate });
  channels.forEach((data, c) => buffer.copyToChannel(data, c));
  ready.set(job.key, buffer);
  // Forget the oldest factors of this sample.
  const mine = [...ready.keys()].filter((k) => k.startsWith(`${job.sampleId}|`));
  for (const k of mine.slice(0, Math.max(0, mine.length - KEEP_PER_SAMPLE))) ready.delete(k);
  for (const w of job.waiters) w(buffer);
  running = null;
  runNext();
}

function runNext(): void {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = job;
  const channels = Array.from({ length: job.source.numberOfChannels }, (_, c) => job.source.getChannelData(c).slice());
  const w = getWorker();
  if (w) {
    w.onmessage = (e: MessageEvent<Float32Array<ArrayBuffer>[]>) => finish(job, e.data);
    w.postMessage({ channels, factor: job.factor, sampleRate: job.source.sampleRate }, channels.map((c) => c.buffer));
  } else {
    setTimeout(() => finish(job, wsola(channels, job.factor, job.source.sampleRate)), 0);
  }
}

function request(sampleId: string, source: AudioBuffer, factor: number, waiter?: (b: AudioBuffer) => void): void {
  const key = keyOf(sampleId, factor);
  if (running?.key === key) {
    if (waiter) running.waiters.push(waiter);
    return;
  }
  const queued = queue.find((j) => j.key === key);
  if (queued) {
    if (waiter) queued.waiters.push(waiter);
    return;
  }
  // Only the newest request per sample is worth computing (e.g. while the tempo is being dragged),
  // unless someone is waiting for an older one.
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].sampleId === sampleId && queue[i].waiters.length === 0) queue.splice(i, 1);
  }
  queue.push({ key, sampleId, source, factor, waiters: waiter ? [waiter] : [] });
  runNext();
}

/** The stretched sample if it is ready; otherwise starts computing it and returns undefined. */
export function getStretched(sampleId: string, source: AudioBuffer, factor: number): AudioBuffer | undefined {
  const done = ready.get(keyOf(sampleId, factor));
  if (done) return done;
  request(sampleId, source, factor);
  return undefined;
}

/** Resolves once the stretched sample is ready (offline renders wait for it). */
export function whenStretched(sampleId: string, source: AudioBuffer, factor: number): Promise<AudioBuffer> {
  const done = ready.get(keyOf(sampleId, factor));
  if (done) return Promise.resolve(done);
  return new Promise((resolve) => request(sampleId, source, factor, resolve));
}
