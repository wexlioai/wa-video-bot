// Supervisor: runs the bot (app.js) and keeps it up to date without re-running setup.
//
// - Every UPDATE_CHECK_MIN minutes (default 10) pulls new code from the bot's GitHub repo
//   (git, set up by the wizard). Your .env and data/ are not in git, so they are never touched.
// - Restarts the bot when its code or .env changes (waits until no video is being made).
// - Runs `npm install` first if a package.json changed.
// - Restarts the bot if it crashes.
// - If this file itself changes, exits so the service / Windows task starts the new one.
//
// Prompts (prompts/*.md) and the video template (video/src) are read fresh for every job,
// so changes there apply to the next video without any restart.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'orchestrator', 'src', 'app.js');
const SELF = fileURLToPath(import.meta.url);
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Clean UTF-8 log files written by the bot itself (data/logs/bot-YYYY-MM-DD.log, kept 14 days),
// so they read correctly no matter how Windows / systemd capture the console.
const LOG_DIR = path.join(ROOT, 'data', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = () => path.join(LOG_DIR, `bot-${new Date().toISOString().slice(0, 10)}.log`);
function write(chunk) {
  process.stdout.write(chunk);
  try { fs.appendFileSync(logFile(), chunk); } catch {}
}
try {
  const cutoff = Date.now() - 14 * 86_400_000;
  for (const f of fs.readdirSync(LOG_DIR)) {
    const p = path.join(LOG_DIR, f);
    if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
  }
} catch {}
const log = (m) => write(`${ts()} [supervisor] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function envValue(key, def) {
  try {
    const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : def;
  } catch { return def; }
}

function port() {
  try {
    const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('PORT='));
    return Number(line?.split('=')[1]) || 3000;
  } catch { return 3000; }
}

// ---------- child process ----------
let child = null;
let stopping = false;
let crashes = 0;

function start() {
  stopping = false;
  child = spawn(process.execPath, [APP], { cwd: path.join(ROOT, 'orchestrator'), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', write);
  child.stderr.on('data', write);
  const started = Date.now();
  child.on('exit', async (code) => {
    child = null;
    if (stopping) return;
    crashes = Date.now() - started < 30_000 ? crashes + 1 : 0;
    const wait = Math.min(60, 5 * 2 ** Math.min(crashes, 4));
    log(`bot exited (code ${code}); restarting in ${wait}s`);
    await sleep(wait * 1000);
    if (!child && !stopping) start();
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    stopping = true;
    const c = child;
    const t = setTimeout(() => c.kill('SIGKILL'), 10_000);
    c.once('exit', () => { clearTimeout(t); resolve(); });
    c.kill();
  });
}

async function isBusy() {
  try {
    const r = await fetch(`http://127.0.0.1:${port()}/health`, { signal: AbortSignal.timeout(5000) });
    return (await r.json()).busy === true;
  } catch { return false; } // not answering = nothing to protect
}

// ---------- watching ----------
const hashOf = (f) => { try { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return ''; } };
const PKGS = ['orchestrator', 'video', 'motion'].map((d) => path.join(ROOT, d, 'package.json'));
const pkgHash = Object.fromEntries(PKGS.map((p) => [p, hashOf(p)]));
const selfHash = hashOf(SELF);

// Files whose change needs a restart. Checked by content every 5 s: simpler and more reliable
// than fs.watch, which misses files that editors/unzippers replace instead of edit.
function watchedFiles() {
  const out = [path.join(ROOT, '.env'), ...PKGS];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, ent.name);
      if (ent.isDirectory()) walk(f);
      else if (/\.(js|mjs|json)$/.test(ent.name)) out.push(f);
    }
  };
  try { walk(path.join(ROOT, 'orchestrator', 'src')); } catch {}
  return out;
}
const snapshot = () => watchedFiles().map((f) => `${f}:${hashOf(f)}`).sort().join('|');
let lastSnap = snapshot();

let pending = false;
setInterval(() => {
  if (pending) return; // changes during a restart are picked up on the next check
  const snap = snapshot();
  if (snap !== lastSnap) { lastSnap = snap; applyChanges(); }
}, 5000);

function npm(dir, args) {
  return new Promise((resolve) => {
    // one command string (npm is a .cmd on Windows, so it needs a shell)
    const p = spawn(`npm ${args.join(' ')}`, { cwd: dir, shell: true });
    p.stdout.on('data', write);
    p.stderr.on('data', write);
    p.on('exit', (code) => resolve(code));
    p.on('error', () => resolve(-1));
  });
}

async function applyChanges() {
  if (pending) return;
  pending = true;
  try {
    // let a multi-file update finish landing before acting
    for (let i = 0; i < 10; i++) { await sleep(3000); const snap = snapshot(); if (snap === lastSnap) break; lastSnap = snap; }
    let waited = false;
    while (await isBusy()) {
      if (!waited) log('change detected; waiting for the current video to finish before restarting');
      waited = true;
      await sleep(15_000);
    }
    for (const p of PKGS) {
      const h = hashOf(p);
      if (h && h !== pkgHash[p]) {
        log(`${path.relative(ROOT, p)} changed: running npm install`);
        await npm(path.dirname(p), ['install', '--no-audit', '--no-fund', '--loglevel=error']);
        pkgHash[p] = h;
      }
    }
    if (hashOf(SELF) !== selfHash) {
      log('supervisor updated: restarting it');
      await stop();
      process.exit(0); // systemd / the Windows task loop starts the new supervisor
    }
    log('code or settings changed: restarting bot');
    await stop();
    lastSnap = snapshot();
    start();
  } finally {
    pending = false;
  }
}

// ---------- automatic updates from GitHub ----------
function git(args) {
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd: ROOT });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => resolve({ code, out: out.trim() }));
    p.on('error', (e) => resolve({ code: -1, out: e.message }));
  });
}

async function checkForUpdates() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return;
  const branch = envValue('UPDATE_BRANCH', 'main');
  const f = await git(['fetch', '--quiet', 'origin', branch]);
  if (f.code !== 0) return log(`update check failed: ${f.out.split('\n')[0]}`);
  const local = (await git(['rev-parse', 'HEAD'])).out;
  const remote = (await git(['rev-parse', `origin/${branch}`])).out;
  if (!remote || local === remote) return;
  log(`new version on GitHub (${remote.slice(0, 7)}): installing`);
  // tracked files only; .env, data/, node_modules/, .venv/ are git-ignored and stay as they are
  const r = await git(['reset', '--hard', `origin/${branch}`]);
  if (r.code !== 0) return log(`update failed: ${r.out.split('\n')[0]}`);
  applyChanges(); // restart when idle (also needed when only prompts/VERSION changed, so you get the update notice)
}

const everyMin = Number(envValue('UPDATE_CHECK_MIN', '10'));
if (everyMin > 0) {
  setTimeout(checkForUpdates, 20_000);
  setInterval(checkForUpdates, everyMin * 60_000);
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stop(); process.exit(0); });

// A package folder that arrived with an update but was never installed (e.g. a new engine):
// install it in the background so the bot starts right away.
(async () => {
  for (const p of PKGS) {
    const dir = path.dirname(p);
    if (fs.existsSync(p) && !fs.existsSync(path.join(dir, 'node_modules'))) {
      log(`${path.relative(ROOT, dir)}: installing packages (first time, can take a few minutes)`);
      const code = await npm(dir, ['install', '--no-audit', '--no-fund', '--loglevel=error']);
      log(`${path.relative(ROOT, dir)}: npm install ${code === 0 ? 'done' : `failed (exit ${code})`}`);
    }
  }
})();

log('starting bot (auto-restarts on updates)');
start();
