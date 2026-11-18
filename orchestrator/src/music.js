// Background music and a transition sound, mixed under the voice.
//
// Music library (data/music/): tracks generated once with OpenSpeaker's Suno endpoint (about 3,600
// credits for 2 tracks) and reused for later videos with a similar mood. Least-used match first,
// never the same track two videos in a row. MUSIC_GENERATE=off uses only what is already there.
// SFX (data/sfx/): one soft whoosh at scene cuts, generated once (about 60 credits).
import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg } from './config.js';
import { readJson, writeJson, exists, run, audioDuration } from './util.js';
import { osJson, OS_API } from './tts.js';

const LIB = () => path.join(cfg.dataDir, 'music');
const INDEX = () => path.join(LIB(), 'index.json');
const SFX = () => path.join(cfg.dataDir, 'sfx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !['and', 'the', 'with', 'for', 'music', 'mood', 'background'].includes(w)));

export const canGenerate = () => cfg.tts.provider === 'openspeaker' && !!cfg.openspeaker.apiKey && (process.env.MUSIC_GENERATE || 'auto') !== 'off';

async function loadIndex() { return readJson(INDEX()).catch(() => ({ tracks: [], last: null })); }

/** Run an OpenSpeaker task and wait for it. */
async function osTask(url, body) {
  const sub = await osJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!sub.task_id) throw new Error(`OpenSpeaker returned no task id: ${JSON.stringify(sub).slice(0, 200)}`);
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    await sleep(i < 4 ? 5000 : 10_000);
    const task = await osJson(`${OS_API}/v1/task/${sub.task_id}`);
    if (task.status === 'done') return task;
    if (task.status === 'error') throw new Error(`OpenSpeaker task failed: ${task.error_message || 'unknown error'}`);
    if (Date.now() - t0 > 15 * 60_000) throw new Error('OpenSpeaker task timed out');
  }
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
}

/** Generate 2 instrumental tracks for a mood and add them to the library. */
async function generateTracks(mood) {
  const task = await osTask(`${OS_API}/v1s/task/music-generation`, {
    create_mode: 'simple',
    make_instrumental: true,
    gpt_description_prompt: `Instrumental background music for a narrated explainer video. Mood: ${mood}. Unobtrusive and steady, no vocals, no sudden drops, warm mix, sits under a voice.`.slice(0, 500),
  });
  const md = task.metadata || {};
  const urls = md.all_audio_urls?.length ? md.all_audio_urls : (md.suno_result?.clips || []).map((c) => c.audio_url).filter(Boolean);
  if (!urls.length && md.audio_url) urls.push(md.audio_url);
  if (!urls.length) throw new Error('music task returned no audio');
  await fs.mkdir(LIB(), { recursive: true });
  const idx = await loadIndex();
  const added = [];
  for (const [i, u] of urls.slice(0, 2).entries()) {
    const file = `${Date.now()}-${i}.mp3`;
    await download(u, path.join(LIB(), file));
    const duration = await audioDuration(path.join(LIB(), file)).catch(() => 0);
    const t = { file, mood, title: md.title || mood, duration, uses: 0, at: new Date().toISOString() };
    idx.tracks.push(t);
    added.push(t);
  }
  await writeJson(INDEX(), idx);
  return added;
}

/**
 * Choose a track for this mood. Returns { file, track, generated } or null (no music).
 * exclude: track file to avoid (e.g. "change music").
 */
export async function pickMusic(mood, { exclude = null, forceNew = false, onStatus } = {}) {
  const idx = await loadIndex();
  const want = words(mood);
  const scored = idx.tracks
    .filter((t) => t.file !== exclude)
    .map((t) => ({ t, score: [...words(t.mood)].filter((w) => want.has(w)).length }))
    .filter((x) => x.score > 0 || !want.size)
    .sort((a, b) => b.score - a.score || a.t.uses - b.t.uses);
  let pick = !forceNew && (scored.find((x) => x.t.file !== idx.last) || scored[0]);
  let generated = false;
  if (!pick && canGenerate()) {
    await onStatus?.('🎵 Composing background music for this mood (first time for this mood, 1-3 minutes)…');
    try {
      const added = await generateTracks(mood || 'calm, warm, hopeful');
      pick = { t: added[0] };
      generated = true;
    } catch (e) {
      console.log(`music generation failed: ${e.message}`);
    }
  }
  if (!pick && idx.tracks.length) pick = { t: idx.tracks.filter((t) => t.file !== exclude).sort((a, b) => a.uses - b.uses)[0] };
  if (!pick?.t) return null;
  const fresh = await loadIndex();
  const tr = fresh.tracks.find((t) => t.file === pick.t.file);
  if (tr) tr.uses = (tr.uses || 0) + 1;
  fresh.last = pick.t.file;
  await writeJson(INDEX(), fresh);
  return { file: path.join(LIB(), pick.t.file), track: pick.t, generated };
}

/** The soft whoosh used at scene cuts (generated once). null if not available. */
export async function whoosh() {
  const f = path.join(SFX(), 'whoosh.mp3');
  if (await exists(f)) return f;
  if (!canGenerate()) return null;
  try {
    await fs.mkdir(SFX(), { recursive: true });
    const task = await osTask(`${OS_API}/v1/task/sound-effect`, {
      text: 'very soft, short airy paper whoosh transition, gentle, clean, no reverb tail', duration_seconds: 1, prompt_influence: 0.5, loop: false,
    });
    const u = task.metadata?.output_uri || task.metadata?.audio_url;
    if (!u) return null;
    await download(u, f);
    return f;
  } catch (e) {
    console.log(`sfx generation failed: ${e.message}`);
    return null;
  }
}

const LEVEL = { low: 0.11, medium: 0.18, high: 0.27 };

/**
 * Mix music (ducked under the voice) and whooshes at the cuts into `input`, writing `output`
 * with loudness normalised to -14 LUFS. cuts = scene start times (s) after the first.
 */
export async function mixSound(input, output, { music, volume = 'low', cuts = [], sfx = null }) {
  const D = await audioDuration(input);
  const args = ['-y', '-i', input];
  const parts = [];
  let n = 1;
  let musicLabel = null;
  if (music && volume !== 'off') {
    args.push('-stream_loop', '-1', '-i', music);
    const v = LEVEL[volume] || LEVEL.low;
    parts.push(`[0:a]asplit=2[voice][key]`);
    parts.push(`[${n}:a]atrim=0:${D.toFixed(2)},asetpts=PTS-STARTPTS,volume=${v},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, D - 3).toFixed(2)}:d=3[m]`);
    parts.push(`[m][key]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=450[duck]`);
    musicLabel = 'duck';
    n++;
  } else {
    parts.push('[0:a]anull[voice]');
  }
  const sfxLabels = [];
  if (sfx && cuts.length) {
    args.push('-i', sfx);
    const k = n++;
    parts.push(`[${k}:a]asplit=${cuts.length}${cuts.map((_, i) => `[s${i}]`).join('')}`);
    cuts.forEach((t, i) => {
      const ms = Math.max(0, Math.round((t - 0.35) * 1000));
      parts.push(`[s${i}]volume=0.35,adelay=${ms}|${ms}[w${i}]`);
      sfxLabels.push(`[w${i}]`);
    });
  }
  const inputs = ['[voice]', ...(musicLabel ? [`[${musicLabel}]`] : []), ...sfxLabels];
  parts.push(`${inputs.join('')}amix=inputs=${inputs.length}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`);
  args.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', output);
  await run('ffmpeg', args, { timeoutMs: 30 * 60_000 });
}
