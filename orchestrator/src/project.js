// A video is a project, not just an MP4: settings.json (look-and-feel knobs a quick tweak can change
// without Claude), the plan / scene code, per-scene voice, and numbered versions you can go back to.
//
//   data/jobs/<id>/settings.json      captions, voice speed, music, motion energy
//   data/jobs/<id>/versions/vN/       snapshot of plan.json + settings.json (+ scenes/ when present)
//   data/jobs/<id>/clips/<format>/    rendered scene clips, cached by content hash
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson, exists } from './util.js';

export const CAPTION_SIZES = ['S', 'M', 'L', 'XL'];
export const CAPTION_POSITIONS = ['bottom', 'middle', 'top', 'off'];
export const CAPTION_STYLES = ['boxed', 'highlight', 'plain'];
export const LEVELS = ['off', 'low', 'medium', 'high']; // music volume

export function defaultSettings() {
  return {
    captions: { size: 'M', position: 'bottom', style: 'boxed' },
    voice: { speed: 1.0 },
    music: { volume: 'low' },
    motion: { energy: 'normal' }, // calm | normal | lively
  };
}

/** Fill in anything missing (older jobs, partial saved defaults). */
export function normalizeSettings(s = {}) {
  const d = defaultSettings();
  const out = {
    captions: { ...d.captions, ...(s.captions || {}) },
    voice: { ...d.voice, ...(s.voice || {}) },
    music: { ...d.music, ...(s.music || {}) },
    motion: { ...d.motion, ...(s.motion || {}) },
  };
  if (!CAPTION_SIZES.includes(out.captions.size)) out.captions.size = 'M';
  if (!CAPTION_POSITIONS.includes(out.captions.position)) out.captions.position = 'bottom';
  if (!CAPTION_STYLES.includes(out.captions.style)) out.captions.style = 'boxed';
  out.voice.speed = Math.min(1.3, Math.max(0.75, Number(out.voice.speed) || 1));
  if (!LEVELS.includes(out.music.volume)) out.music.volume = 'low';
  if (!['calm', 'normal', 'lively'].includes(out.motion.energy)) out.motion.energy = 'normal';
  return out;
}

const settingsFile = (job) => path.join(job.dir, 'settings.json');
export const loadSettings = async (job) => normalizeSettings(await readJson(settingsFile(job)).catch(() => ({})));
export const saveSettings = (job, s) => writeJson(settingsFile(job), normalizeSettings(s));

/** Create settings.json for a new job from the person's saved defaults (if any). */
export async function initSettings(job, personDefaults) {
  if (await exists(settingsFile(job))) return loadSettings(job);
  const s = normalizeSettings(personDefaults || {});
  await saveSettings(job, s);
  return s;
}

// ------------------------------------------------------------------ quick tweaks
// Each tweak is a pure change to settings. `needsVoice` = the voice has to be re-recorded.
const step = (list, cur, d) => list[Math.min(list.length - 1, Math.max(0, list.indexOf(cur) + d))];
export const TWEAKS = {
  'subs-bigger': { label: 'Subtitles bigger', apply: (s) => { s.captions.size = step(CAPTION_SIZES, s.captions.size, 1); if (s.captions.position === 'off') s.captions.position = 'bottom'; } },
  'subs-smaller': { label: 'Subtitles smaller', apply: (s) => { s.captions.size = step(CAPTION_SIZES, s.captions.size, -1); } },
  'subs-top': { label: 'Subtitles at the top', apply: (s) => { s.captions.position = 'top'; } },
  'subs-middle': { label: 'Subtitles in the middle', apply: (s) => { s.captions.position = 'middle'; } },
  'subs-bottom': { label: 'Subtitles at the bottom', apply: (s) => { s.captions.position = 'bottom'; } },
  'subs-off': { label: 'No subtitles', apply: (s) => { s.captions.position = 'off'; } },
  'subs-style': { label: 'Next subtitle style', apply: (s) => { s.captions.style = CAPTION_STYLES[(CAPTION_STYLES.indexOf(s.captions.style) + 1) % CAPTION_STYLES.length]; } },
  'voice-slower': { label: 'Voice slower', needsVoice: true, apply: (s) => { s.voice.speed = Math.round((s.voice.speed - 0.08) * 100) / 100; } },
  'voice-faster': { label: 'Voice faster', needsVoice: true, apply: (s) => { s.voice.speed = Math.round((s.voice.speed + 0.08) * 100) / 100; } },
  'music-louder': { label: 'Music louder', apply: (s) => { s.music.volume = step(LEVELS, s.music.volume, 1); } },
  'music-quieter': { label: 'Music quieter', apply: (s) => { s.music.volume = step(LEVELS, s.music.volume, -1); } },
  'music-off': { label: 'No music', apply: (s) => { s.music.volume = 'off'; } },
  'motion-calmer': { label: 'Calmer motion', apply: (s) => { s.motion.energy = s.motion.energy === 'lively' ? 'normal' : 'calm'; } },
  'motion-livelier': { label: 'Livelier motion', apply: (s) => { s.motion.energy = s.motion.energy === 'calm' ? 'normal' : 'lively'; } },
};

/** Apply tweak keys; returns {settings, changes: [human text], needsVoice}. */
export function applyTweaks(settings, keys) {
  const s = normalizeSettings(JSON.parse(JSON.stringify(settings)));
  const before = describeSettings(s);
  let needsVoice = false;
  for (const k of keys) {
    const t = TWEAKS[k];
    if (!t) continue;
    t.apply(s);
    if (t.needsVoice) needsVoice = true;
  }
  const after = describeSettings(normalizeSettings(s));
  const changes = Object.keys(after).filter((k) => after[k] !== before[k]).map((k) => `${k}: ${before[k]} → ${after[k]}`);
  return { settings: normalizeSettings(s), changes, needsVoice };
}

export function describeSettings(s) {
  return {
    'Subtitles': s.captions.position === 'off' ? 'off' : `${s.captions.size}, ${s.captions.position}, ${s.captions.style}`,
    'Voice speed': `${s.voice.speed.toFixed(2)}×`,
    'Music': s.music.volume,
    'Motion': s.motion.energy,
  };
}

// ------------------------------------------------------------------ versions
const VERSIONED = ['plan.json', 'settings.json', 'scenes'];

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

/** Save the current plan/settings/scenes as the next version. Returns its number. */
export async function snapshotVersion(job, note = '') {
  const base = path.join(job.dir, 'versions');
  await fs.mkdir(base, { recursive: true });
  const nums = (await fs.readdir(base)).map((n) => Number(n.replace(/^v/, ''))).filter(Number.isFinite);
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  const dir = path.join(base, `v${n}`);
  await fs.mkdir(dir, { recursive: true });
  for (const name of VERSIONED) {
    const src = path.join(job.dir, name);
    if (!(await exists(src))) continue;
    if ((await fs.stat(src)).isDirectory()) await copyDir(src, path.join(dir, name));
    else await fs.copyFile(src, path.join(dir, name));
  }
  await writeJson(path.join(dir, 'version.json'), { n, note, at: new Date().toISOString() });
  return n;
}

export async function listVersions(job) {
  const base = path.join(job.dir, 'versions');
  const names = await fs.readdir(base).catch(() => []);
  const out = [];
  for (const name of names) {
    const meta = await readJson(path.join(base, name, 'version.json')).catch(() => null);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Put version n back as the current plan/settings/scenes. */
export async function restoreVersion(job, n) {
  const dir = path.join(job.dir, 'versions', `v${n}`);
  if (!(await exists(dir))) throw new Error(`version ${n} not found`);
  for (const name of VERSIONED) {
    const src = path.join(dir, name);
    const dst = path.join(job.dir, name);
    if (!(await exists(src))) continue;
    if ((await fs.stat(src)).isDirectory()) {
      await fs.rm(dst, { recursive: true, force: true });
      await copyDir(src, dst);
    } else await fs.copyFile(src, dst);
  }
}
