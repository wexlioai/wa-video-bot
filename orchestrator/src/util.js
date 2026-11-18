import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

/** Run a command, resolve {code, stdout, stderr}. Rejects on non-zero exit unless allowFail. */
export function run(cmd, args, { cwd, timeoutMs = 0, allowFail = false, input, env } = {}) {
  return new Promise((resolve, reject) => {
    // Windows can only start .cmd/.bat shims through a shell; quote args for cmd.exe
    const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
    const p = shim
      ? spawn(`"${cmd}"`, args.map((a) => `"${String(a).replace(/"/g, '""')}"`), { cwd, env: env || process.env, shell: true })
      : spawn(cmd, args, { cwd, env: env || process.env });
    let stdout = '';
    let stderr = '';
    let timer;
    if (timeoutMs) timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !allowFail) {
        return reject(new Error(`${cmd} exited ${code}: ${(stderr || stdout).slice(-1500)}`));
      }
      resolve({ code, stdout, stderr });
    });
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

export async function audioDuration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ]);
  return parseFloat(stdout.trim());
}

export const readJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
export const writeJson = (f, v) => fs.writeFile(f, JSON.stringify(v, null, 2));
export const exists = (f) => fs.access(f).then(() => true, () => false);

/** One heavy job at a time (render, TTS, Claude) — this is a personal bot. */
let chain = Promise.resolve();
export function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}
