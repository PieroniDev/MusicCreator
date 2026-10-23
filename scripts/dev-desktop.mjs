// Runs the Vite dev server and opens it in Electron (with hot reload of the UI).
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

await import('./build-electron.mjs');
const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];

const args = ['.'];
// Chromium refuses to run as root with its sandbox (containers, CI).
if (process.getuid?.() === 0) args.push('--no-sandbox');
const child = spawn(electron, args, { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
