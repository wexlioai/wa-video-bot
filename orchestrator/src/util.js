import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

/** Run a command, resolve {code, stdout, stderr}. Rejects on non-zero exit unless allowFail. */
export function run(cmd, args, { cwd, timeoutMs = 0, allowFail = false, input, env, onData } = {}) {
  return new Promise((resolve, reject) => {
    // Windows can only start .cmd/.bat shims through a shell; quote args for cmd.exe
    const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
    const p = shim // one command string (passing args with shell:true is deprecated in Node 24)
      ? spawn([`"${cmd}"`, ...args.map((a) => `"${String(a).replace(/"/g, '""')}"`)].join(' '), { cwd, env: env || process.env, shell: true })
      : spawn(cmd, args, { cwd, env: env || process.env });
    let stdout = '';
    let stderr = '';
    let timer;
    if (timeoutMs) timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => { stdout += d; if (stdout.length > 2e6) stdout = stdout.slice(-1e6); onData?.(String(d)); });
    p.stderr.on('data', (d) => { stderr += d; if (stderr.length > 2e6) stderr = stderr.slice(-1e6); onData?.(String(d)); });
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
let pending = 0;
/** How many heavy steps are running or waiting. */
export const queueLength = () => pending;
export function serial(fn) {
  pending++;
  const next = chain.then(fn, fn).finally(() => { pending--; });
  chain = next.catch(() => {});
  return next;
}

// Windows keeps files locked for a moment after Chrome/FFmpeg exit (and antivirus scans new files),
// so deleting or moving them right away can fail with EBUSY/EPERM. These retry, and a failed cleanup
// never stops a job: leftovers are removed later.
const LOCKED = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Delete a file or folder; retries while it is locked, then gives up quietly (cleanup only). */
export async function rmSafe(p, { recursive = true } = {}) {
  try {
    await fs.rm(p, { recursive, force: true, maxRetries: 8, retryDelay: 400 });
  } catch (e) {
    if (!LOCKED.has(e.code)) throw e;
    console.log(`cleanup skipped (still in use, removed later): ${p}`);
  }
}

/** Move a file; retries while it is locked, then falls back to copy + delete. */
export async function moveFile(from, to) {
  for (let i = 0; i < 8; i++) {
    try { return await fs.rename(from, to); } catch (e) {
      if (!LOCKED.has(e.code) && e.code !== 'EXDEV') throw e;
      if (e.code === 'EXDEV') break;
      await wait(300 * (i + 1));
    }
  }
  await fs.copyFile(from, to);
  await rmSafe(from, { recursive: false });
}
