import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg } from './config.js';
import { run, readJson, writeJson, exists } from './util.js';
import { speak } from './tts.js';

const FPS = 30;
const GAP = 0.45; // seconds of breathing room after each scene's narration

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

/**
 * Generate (or reuse cached) voiceover for every scene, then write props.json for Remotion.
 * Audio is cached by narration+voice+model, so an edit only re-voices the scenes it changed.
 */
export async function buildProps(job, plan, onScene) {
  const audioDir = path.join(job.dir, 'audio');
  await fs.mkdir(audioDir, { recursive: true });
  const scenes = [];
  let charsSpent = 0;
  for (const [idx, s] of plan.scenes.entries()) {
    await onScene?.(idx + 1, plan.scenes.length);
    const key = hash(`${cfg.tts.provider}|${{ elevenlabs: cfg.eleven.model, openspeaker: cfg.openspeaker.speed }[cfg.tts.provider] ?? cfg.tts.rate}|${job.voice.id}|${s.narration}`);
    const rel = `audio/${s.id}-${key}.mp3`;
    const meta = path.join(job.dir, `audio/${s.id}-${key}.json`);
    let info;
    if ((await exists(meta)) && (await exists(path.join(job.dir, rel)))) {
      info = await readJson(meta);
    } else {
      info = await speak(s.narration, job.voice.id, path.join(job.dir, rel), plan.language);
      await writeJson(meta, info);
      charsSpent += s.narration.length;
    }
    scenes.push({
      id: s.id,
      audio: rel,
      durationInFrames: Math.ceil((info.duration + GAP) * FPS),
      words: info.words,
      visual: s.visual,
    });
  }
  const props = { fps: FPS, language: plan.language, theme: plan.theme, captions: cfg.render.captions, scenes };
  await writeJson(path.join(job.dir, 'props.json'), props);
  const seconds = scenes.reduce((a, s) => a + s.durationInFrames, 0) / FPS;
  return { seconds, charsSpent };
}

// Run the Remotion CLI through node directly (works the same on Linux and Windows, no .cmd shims)
let cliJs;
async function remotion(args, opts) {
  if (!cliJs) {
    const pkgDir = path.join(cfg.videoDir, 'node_modules', '@remotion', 'cli');
    const pkg = await readJson(path.join(pkgDir, 'package.json'));
    cliJs = path.join(pkgDir, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.remotion);
  }
  return run(process.execPath, [cliJs, ...args], opts);
}

/** format: 'long' | 'short'. Returns {full, preview} absolute paths. onPercent(0-100) reports render progress. */
export async function renderVideo(job, format, onPercent) {
  const comp = format === 'short' ? 'Short' : 'Long';
  const full = path.join(job.dir, `${format}.mp4`);
  const preview = path.join(job.dir, `${format}-preview.mp4`);
  await remotion([
    'render', 'src/index.ts', comp, full,
    `--props=${path.join(job.dir, 'props.json')}`,
    `--public-dir=${job.dir}`,
    `--concurrency=${cfg.render.concurrency}`,
    '--codec=h264', '--crf=20',
  ], {
    cwd: cfg.videoDir,
    timeoutMs: 90 * 60_000,
    // Remotion prints "Rendered 120/900" / "Encoded 120/900"; turn the last pair into a percent
    onData: (chunk) => {
      const all = [...chunk.matchAll(/(Render|Encod)\w*[^\d\n]{0,40}?(\d+)\s*\/\s*(\d+)/gi)];
      const m = all[all.length - 1];
      if (m && Number(m[3]) > 0) onPercent?.(Math.min(99, Math.round((Number(m[2]) / Number(m[3])) * (/encod/i.test(m[1]) ? 10 : 90) + (/encod/i.test(m[1]) ? 90 : 0))));
    },
  });

  // small copy for WhatsApp
  const scale = format === 'short' ? 'scale=720:-2' : 'scale=-2:720';
  await run('ffmpeg', [
    '-y', '-i', full, '-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', preview,
  ], { timeoutMs: 30 * 60_000 });

  if (format === 'long') {
    await remotion([
      'still', 'src/index.ts', comp, path.join(job.dir, 'thumb.png'),
      `--props=${path.join(job.dir, 'props.json')}`, `--public-dir=${job.dir}`, '--frame=20', '--log=error',
    ], { cwd: cfg.videoDir, allowFail: true });
  }
  return { full, preview };
}
