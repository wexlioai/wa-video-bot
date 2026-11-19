// HyperFrames engine: HTML + CSS + GSAP compositions rendered to MP4 (https://github.com/heygen-com/hyperframes).
// Lives in <repo>/motion (its own package.json; the supervisor installs it).
// Phase 0: an "engine test" that proves rendering works on this machine and measures speed.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, cfg } from './config.js';
import { compositionHtml } from './compose.js';
import { localFontsCss, ensureCaptionFonts } from './fonts.js';
import { buildAss } from './captions.js';
import { finishVideo, splitAt, highlights } from './finish.js';
import { basicDesign } from './scenes-basic.js';
import { progressLayer } from './overlay.js';
import { sfxVolume } from './music.js';
import { run, exists, audioDuration } from './util.js';

export const MOTION_DIR = path.join(ROOT, 'motion');
const bin = () => path.join(MOTION_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes');
const gsapFile = () => path.join(MOTION_DIR, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
export const gsapPath = gsapFile;

/** Is the engine installed? Returns null when ready, otherwise a reason. */
export async function engineMissing() {
  if (!(await exists(path.join(MOTION_DIR, 'package.json')))) return 'the motion/ folder is missing (update not installed yet)';
  if (!(await exists(bin()))) return 'HyperFrames is not installed yet (the bot installs it automatically after an update; give it a few minutes)';
  if (!(await exists(gsapFile()))) return 'GSAP is not installed yet';
  return null;
}

/** Parallel Chrome workers per render (each ~256 MB). HF_WORKERS in .env overrides. */
export const workers = () => String(Number(process.env.HF_WORKERS) || Math.min(6, Math.max(1, os.cpus().length - 2)));

/** Run the HyperFrames CLI in a project folder. */
export function hf(args, { cwd, onData, timeoutMs = 30 * 60_000, allowFail = false } = {}) {
  return run(bin(), args, { cwd, onData, timeoutMs, allowFail, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------------------------------------
// The 15-second test film: a small "Flat Explainer" piece (seed → chart → tree) with word-synced
// captions and voice. It uses the things real videos need: SVG drawing, staggered type, a chart,
// a counter, a scene wipe, caption highlighting and an audio track.
export const TEST_NARRATION = 'Small habits grow into big results. Get one percent better each day, and a year later you are almost thirty-eight times better. Start small, keep going, and watch it grow.';
const DURATION = 15;

/** Group timed words into caption lines of up to 5 words (break early on sentence ends). */
function captionLines(words) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= 5 || /[.!?,]$/.test(w.text)) { lines.push(cur); cur = []; }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

export function testCompositionHtml({ words = [], audio = null }) {
  const P = { bg: '#F6F1E7', ink: '#1F2A44', accent: '#E07A5F', green: '#81B29A', sand: '#F2CC8F' };
  const lines = captionLines(words.filter((w) => w.end <= DURATION));
  const capHtml = lines.map((ln, i) => {
    const start = ln[0].start;
    const end = Math.min(DURATION, (lines[i + 1]?.[0].start ?? ln[ln.length - 1].end + 0.4));
    return `<div id="cap${i}" class="clip cap" data-start="${start.toFixed(2)}" data-duration="${Math.max(0.2, end - start).toFixed(2)}" data-track-index="3"><div class="capbox">${
      ln.map((w, j) => `<span id="w${i}_${j}">${esc(w.text)}</span>`).join(' ')}</div></div>`;
  }).join('\n    ');
  const capPop = lines.map((ln, i) => `tl.from('#cap${i} .capbox', { y: 16, opacity: 0, duration: 0.18, ease: 'power2.out' }, ${ln[0].start.toFixed(2)});`).join('\n    ');
  const capJs = lines.flatMap((ln, i) => ln.map((w, j) =>
    `tl.set('#w${i}_${j}', { color: P.accent }, ${w.start.toFixed(2)}); tl.set('#w${i}_${j}', { color: P.ink }, ${Math.min(w.end + 0.05, DURATION).toFixed(2)});`)).join('\n    ');
  const bars = [1, 1.6, 2.6, 4.3, 7].map((h, i) =>
    `<rect class="bar" x="${140 + i * 150}" y="${560 - h * 60}" width="96" height="${h * 60}" rx="14" fill="${i === 4 ? P.accent : P.green}"/>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=Inter:wght@500;700&display=block" rel="stylesheet">
<script src="./gsap.min.js"></script>
<style>
  html, body { margin: 0; background: ${P.bg}; }
  #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: ${P.bg}; font-family: Inter, 'Segoe UI', Arial, sans-serif; color: ${P.ink}; }
  .clip { position: absolute; inset: 0; }
  .scene { overflow: hidden; }
  h1 { font-family: Fraunces, Georgia, serif; font-weight: 700; margin: 0; letter-spacing: -1px; }
  .word { display: inline-block; }
  #s1 h1 { position: absolute; left: 980px; top: 330px; font-size: 128px; line-height: 1.02; }
  #s1 p  { position: absolute; left: 986px; top: 620px; font-size: 52px; margin: 0; font-weight: 500; }
  #s2 { background: ${P.sand}; }
  #s2 .label { position: absolute; left: 1180px; top: 300px; font-size: 54px; font-weight: 700; width: 620px; }
  #s2 .count { position: absolute; left: 1180px; top: 400px; font-family: Fraunces, Georgia, serif; font-size: 220px; font-weight: 700; color: ${P.accent}; }
  #s3 { background: ${P.bg}; }
  #s3 h1 { position: absolute; width: 100%; text-align: center; top: 150px; font-size: 112px; }
  .cap { inset: auto 0 64px 0; height: auto; text-align: center; font-size: 46px; font-weight: 700; }
  .cap span { display: inline-block; padding: 0 4px; }
  .capbox { display: inline-block; background: rgba(255,255,255,.88); border-radius: 18px; padding: 14px 28px; }
</style>
</head>
<body>
  <div id="root" data-composition-id="enginetest" data-start="0" data-duration="${DURATION}" data-width="1920" data-height="1080">
    <section id="s1" class="clip scene" data-start="0" data-duration="5.9" data-track-index="0">
      <svg width="1920" height="1080" style="position:absolute;inset:0">
        <circle id="sun" cx="560" cy="300" r="120" fill="${P.sand}"/>
        <rect x="0" y="800" width="1920" height="280" fill="${P.green}" opacity=".35"/>
        <ellipse id="seed" cx="560" cy="790" rx="46" ry="30" fill="${P.ink}"/>
        <path id="stem" d="M560 790 C 560 700, 540 640, 560 560" stroke="${P.green}" stroke-width="18" fill="none" stroke-linecap="round"/>
        <path id="leafL" d="M556 620 C 480 600, 450 540, 470 510 C 520 520, 556 560, 556 620 Z" fill="${P.green}"/>
        <path id="leafR" d="M562 590 C 640 570, 670 510, 650 480 C 600 490, 562 530, 562 590 Z" fill="${P.green}"/>
      </svg>
      <h1><span class="word">Small</span> <span class="word">habits</span></h1>
      <p id="sub">grow into big results.</p>
    </section>
    <section id="s2" class="clip scene" data-start="5" data-duration="5.8" data-track-index="1">
      <svg width="1920" height="1080" style="position:absolute;inset:0">
        <line x1="110" y1="562" x2="900" y2="562" stroke="${P.ink}" stroke-width="6" stroke-linecap="round"/>
        ${bars}
        <path id="curve" d="M188 500 C 420 480, 640 380, 860 110" stroke="${P.ink}" stroke-width="10" fill="none" stroke-linecap="round"/>
      </svg>
      <div class="label">1% better every day for a year</div>
      <div class="count"><span id="num">1.0</span>×</div>
    </section>
    <section id="s3" class="clip scene" data-start="10" data-duration="5" data-track-index="2">
      <svg width="1920" height="1080" style="position:absolute;inset:0">
        <rect x="0" y="860" width="1920" height="220" fill="${P.green}" opacity=".35"/>
        <rect id="trunk" x="930" y="560" width="60" height="320" rx="20" fill="#8C6A4F"/>
        <circle class="leaf" cx="960" cy="520" r="150" fill="${P.green}"/>
        <circle class="leaf" cx="840" cy="590" r="105" fill="#6FA287"/>
        <circle class="leaf" cx="1080" cy="590" r="105" fill="#6FA287"/>
        <circle class="fruit" cx="900" cy="480" r="22" fill="${P.accent}"/>
        <circle class="fruit" cx="1030" cy="440" r="22" fill="${P.accent}"/>
        <circle class="fruit" cx="1060" cy="600" r="22" fill="${P.accent}"/>
      </svg>
      <h1><span class="word">Start</span> <span class="word">small.</span> <span class="word">Keep</span> <span class="word">going.</span></h1>
    </section>
    ${capHtml}
    ${audio ? `<audio id="voice" data-start="0" data-volume="1" src="./${audio}"></audio>` : ''}
  </div>
  <script>
    const P = ${JSON.stringify(P)};
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // Scene 1: seed drops, sprout draws, leaves pop, words rise
    tl.from('#sun', { scale: 0, transformOrigin: '50% 50%', duration: 1, ease: 'back.out(1.6)' }, 0.1);
    tl.from('#seed', { y: -500, duration: 0.7, ease: 'bounce.out' }, 0.2);
    const stemLen = 260;
    tl.fromTo('#stem', { strokeDasharray: stemLen, strokeDashoffset: stemLen }, { strokeDashoffset: 0, duration: 1, ease: 'power2.inOut' }, 0.9);
    tl.from(['#leafL', '#leafR'], { scale: 0, transformOrigin: '50% 100%', duration: 0.6, ease: 'back.out(2)', stagger: 0.15 }, 1.6);
    tl.from('#s1 .word', { y: 120, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.12 }, 0.4);
    tl.from('#sub', { y: 40, opacity: 0, duration: 0.6, ease: 'power2.out' }, 1.3);
    // Scene 2: circular wipe in, bars grow, curve draws, counter climbs
    tl.fromTo('#s2', { clipPath: 'circle(0% at 560px 540px)' }, { clipPath: 'circle(150% at 560px 540px)', duration: 0.8, ease: 'power2.inOut' }, 5);
    tl.from('#s2 .bar', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.6, ease: 'back.out(1.4)', stagger: 0.18 }, 5.5);
    tl.fromTo('#curve', { strokeDasharray: 900, strokeDashoffset: 900 }, { strokeDashoffset: 0, duration: 1.6, ease: 'power1.inOut' }, 6.2);
    tl.from('#s2 .label', { x: 80, opacity: 0, duration: 0.6, ease: 'power2.out' }, 5.6);
    const n = { v: 1 };
    tl.to(n, { v: 37.8, duration: 2.4, ease: 'power2.in', onUpdate: () => { document.getElementById('num').textContent = n.v.toFixed(1); } }, 6.2);
    tl.from('#s2 .count', { scale: 0.6, opacity: 0, transformOrigin: '0% 50%', duration: 0.5, ease: 'back.out(2)' }, 6.1);
    // Scene 3: slide-up wipe, tree grows, fruit pops, words land
    tl.fromTo('#s3', { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 0.7, ease: 'power3.inOut' }, 10);
    tl.from('#trunk', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.8, ease: 'power2.out' }, 10.5);
    tl.from('#s3 .leaf', { scale: 0, transformOrigin: '50% 50%', duration: 0.7, ease: 'back.out(1.8)', stagger: 0.12 }, 11);
    tl.from('#s3 .fruit', { scale: 0, transformOrigin: '50% 50%', duration: 0.4, ease: 'back.out(3)', stagger: 0.15 }, 11.8);
    tl.from('#s3 .word', { y: -80, opacity: 0, duration: 0.6, ease: 'power3.out', stagger: 0.15 }, 10.7);
    tl.to('#s3 svg', { scale: 1.04, transformOrigin: '50% 80%', duration: 3, ease: 'sine.inOut' }, 12);
    // Captions: each line pops in, the spoken word turns accent
    ${capPop}
    ${capJs}
    tl.set({}, {}, ${DURATION});
    window.__timelines.enginetest = tl;
  </script>
</body>
</html>`;
}

/**
 * Build + render the test film in dir. Returns timings and file info.
 * speakFn(text, outFile) -> {words, duration} | throws (then the test renders without voice).
 */
export async function runEngineTest(dir, { speakFn, onStage } = {}) {
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(gsapFile(), path.join(dir, 'gsap.min.js'));
  const t0 = Date.now();
  let words = [];
  let audio = null;
  let voiceError = null;
  if (speakFn) {
    onStage?.('voice');
    try {
      const r = await speakFn(TEST_NARRATION, path.join(dir, 'voice.mp3'));
      words = r.words || [];
      audio = 'voice.mp3';
      if ((r.duration || (await audioDuration(path.join(dir, 'voice.mp3')))) > DURATION) words = words.filter((w) => w.end <= DURATION);
    } catch (e) { voiceError = e.message.slice(0, 200); }
  }
  await fs.writeFile(path.join(dir, 'index.html'), testCompositionHtml({ words, audio }));
  const voiceSec = (Date.now() - t0) / 1000;

  onStage?.('lint');
  const lint = await hf(['lint'], { cwd: dir, allowFail: true, timeoutMs: 120_000 }).catch((e) => ({ code: -1, stdout: '', stderr: e.message }));

  onStage?.('render');
  const out = path.join(dir, 'engine-test.mp4');
  const t1 = Date.now();
  let lastPct = -1;
  const r = await hf(['render', '--output', out, '--quality', 'looks', '--workers', workers()], {
    cwd: dir,
    allowFail: true,
    onData: (s) => {
      const m = s.match(/(\d{1,3})\s?%/);
      if (m && +m[1] !== lastPct && +m[1] <= 100) { lastPct = +m[1]; onStage?.('render', lastPct); }
    },
  });
  const renderSec = (Date.now() - t1) / 1000;
  await fs.writeFile(path.join(dir, 'render-output.txt'), `${r.stdout}\n${r.stderr}`).catch(() => {});
  console.log(`engine test render output (last lines):\n${`${r.stdout}\n${r.stderr}`.trim().split('\n').filter((l) => l.trim()).slice(-15).join('\n')}`);
  const ok = r.code === 0 && (await exists(out));
  const result = {
    ok,
    renderSec,
    voiceSec,
    voiceError,
    words: words.length,
    machine: `${os.platform()} ${os.arch()}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM, ${workers()} render workers`,
    lint: (lint.stdout + lint.stderr).trim().split('\n').slice(-6).join('\n'),
    lintOk: lint.code === 0,
    error: ok ? null : (r.stderr || r.stdout || '').trim().split('\n').slice(-12).join('\n'),
  };
  if (ok) {
    result.file = out;
    result.mb = (await fs.stat(out)).size / 1048576;
    result.seconds = await audioDuration(out).catch(() => DURATION);
  }
  return result;
}

/** `hyperframes doctor` output (first lines), for the report when something fails. */
export async function doctor(cwd) {
  const r = await hf(['doctor'], { cwd: cwd || MOTION_DIR, allowFail: true, timeoutMs: 120_000 }).catch((e) => ({ stdout: '', stderr: e.message }));
  return (r.stdout + r.stderr).trim().split('\n').slice(0, 25).join('\n');
}

// =============================================================================================
// Rendering a real video: one HyperFrames render per scene (cached), then joined with FFmpeg.
// A scene whose composition did not change (same design, captions, voice) is not rendered again,
// so a change to one scene re-renders only that scene; a subtitle tweak re-renders without Claude.

const OK_FILE = () => path.join(cfg.dataDir, 'engine-ok.json');
export const markEngineOk = (info) => fs.writeFile(OK_FILE(), JSON.stringify({ ...info, at: new Date().toISOString() }, null, 2));

/** Which engine renders videos: MOTION_ENGINE=remotion|hyperframes|auto (auto = HyperFrames once `engine test` passed here). */
export async function motionEngine() {
  const want = (process.env.MOTION_ENGINE || 'auto').toLowerCase();
  if (want === 'remotion') return 'remotion';
  if (await engineMissing()) return 'remotion';
  if (want === 'hyperframes') return 'hyperframes';
  return (await exists(OK_FILE())) ? 'hyperframes' : 'remotion';
}

const readJsonSafe = (f) => fs.readFile(f, 'utf8').then(JSON.parse).catch(() => null);
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/** Group scenes into render chunks: a new chunk at each section change, at most 8 scenes or 90 s. */
export function chunkScenes(scenes, fps) {
  const chunks = [];
  let cur = [];
  let secs = 0;
  for (const s of scenes) {
    const d = s.durationInFrames / fps;
    const newSection = cur.length && (s.section || '') !== (cur[cur.length - 1].section || '') && !cur[cur.length - 1].hook;
    if (cur.length && (newSection || cur.length >= 8 || secs + d > 90)) { chunks.push(cur); cur = []; secs = 0; }
    cur.push(s);
    secs += d;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Render statistics: seconds of rendering per second of video (learned from real renders). */
const STATS_FILE = () => path.join(cfg.dataDir, 'render-stats.json');
export async function recordRenderSpeed(videoSec, renderSec) {
  if (!(videoSec > 1) || !(renderSec > 0)) return;
  const st = await readJsonSafe(STATS_FILE()) || { ratio: null, samples: 0 };
  const r = renderSec / videoSec;
  st.ratio = st.ratio ? st.ratio * 0.7 + r * 0.3 : r; // moving average
  st.samples = (st.samples || 0) + 1;
  st.at = new Date().toISOString();
  await fs.writeFile(STATS_FILE(), JSON.stringify(st, null, 2));
}

async function hfRender(dir, out, { draft, fps, onPct }) {
  const base = ['render', '--output', out, '--quality', draft ? 'draft' : 'looks', '--fps', String(fps), '--workers', workers()];
  let r = await hf([...base, '--video-frame-format', 'jpg'], { cwd: dir, allowFail: true, timeoutMs: 6 * 60 * 60_000, onData: onPct });
  if (r.code !== 0 && /unknown|unrecognized|invalid/i.test(`${r.stderr}${r.stdout}`)) {
    r = await hf(base, { cwd: dir, allowFail: true, timeoutMs: 6 * 60 * 60_000, onData: onPct }); // older HyperFrames
  }
  return r;
}

/**
 * props: output of render.buildProps (scenes with id, audio, durationInFrames, words, visual, section).
 * designs: { [sceneId]: {body, css, js, fonts, families} }; missing → basic style.
 * Scenes are rendered in chunks (one browser session per section), cached by content, then finished in
 * ONE encode (progress layer + subtitles + mixed audio with two-pass loudness).
 * draft: quick low-quality render (demos). Returns { full, preview, hd, qc }.
 */
export async function renderProject(job, format, { props, settings, designs = {}, onPercent, music = null, sfx = null, kit = {}, bed = null, events = [], name = format, draft = false, partMinutes = 0 }) {
  const fps = draft ? 24 : (props.fps || 30);
  const work = path.join(job.dir, 'render', `${name}`);
  const clipDir = path.join(job.dir, 'clips', format);
  await fs.mkdir(clipDir, { recursive: true });
  await fs.mkdir(work, { recursive: true });
  const gsap = await fs.readFile(gsapFile());
  const look = await readJsonSafe(path.join(job.dir, 'look.json'));
  const totalFrames = props.scenes.reduce((a, s) => a + s.durationInFrames, 0);
  const t0 = Date.now();

  // absolute offsets
  let acc = 0;
  const timed = props.scenes.map((s) => { const o = acc; acc += s.durationInFrames / (props.fps || 30); return { ...s, offset: o, duration: s.durationInFrames / (props.fps || 30) }; });
  const chunks = chunkScenes(timed, props.fps || 30);
  const fontQueries = new Set();
  const designOf = (s) => designs[s.id] || basicDesign(s.visual, { theme: props.theme, format, lang: props.language, words: s.words, look });
  for (const s of timed) for (const q of [designOf(s).fonts || []].flat()) fontQueries.add(q);
  if (props.language === 'ur') fontQueries.add('Noto Nastaliq Urdu:wght@400;700');

  const clips = [];
  const cueList = [];
  let doneSec = 0;
  for (const [ci, ch] of chunks.entries()) {
    const start = ch[0].offset;
    const scenes = ch.map((s) => ({ id: s.id, offset: s.offset - start, duration: s.duration, words: s.words, audio: s.audio ? `voice-${s.id}${path.extname(s.audio)}` : null, design: designOf(s) }));
    const dir = path.join(work, `chunk-${String(ci).padStart(3, '0')}`);
    await fs.mkdir(dir, { recursive: true });
    const fontsCss = await localFontsCss([...fontQueries], dir);
    const html = compositionHtml({ scenes, format, lang: props.language, theme: props.theme, settings, motion: look?.motion, fontsCss, captions: false, compId: 'chunk' });
    const audioKey = ch.map((s) => (s.audio ? path.basename(s.audio) : 'none')).join(',');
    const clip = path.join(clipDir, `chunk-${sha(`${html}|${audioKey}|${fps}|${draft}`)}.mp4`);
    const chSec = ch.reduce((a, s) => a + s.duration, 0);
    const sfxFile = `${clip}.sfx.json`;
    if (!(await exists(clip))) {
      await fs.writeFile(path.join(dir, 'index.html'), html);
      // sound cues the scene code asked for with sfx(name, t) (read once, cached next to the clip)
      const cues = await readCues(path.join(dir, 'index.html')).catch((e) => { console.log(`sound cues skipped: ${e.message.slice(0, 120)}`); return []; });
      await fs.writeFile(sfxFile, JSON.stringify(cues));
      await fs.writeFile(path.join(dir, 'gsap.min.js'), gsap);
      await fs.copyFile(path.join(MOTION_DIR, 'motion-lib.js'), path.join(dir, 'motion-lib.js')).catch(() => {});
      for (const s of ch) if (s.audio) await fs.copyFile(path.join(job.dir, s.audio), path.join(dir, `voice-${s.id}${path.extname(s.audio)}`));
      const tmp = path.join(dir, 'out.mp4');
      const r = await hfRender(dir, tmp, {
        draft,
        fps,
        onPct: (d) => {
          const m = [...d.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)].pop();
          if (m) onPercent?.(Math.min(94, Math.round(((doneSec + (Number(m[1]) / 100) * chSec) / (totalFrames / (props.fps || 30))) * 94)));
        },
      });
      if (r.code !== 0 || !(await exists(tmp))) {
        throw new Error(`HyperFrames could not render scenes ${ch[0].id}-${ch[ch.length - 1].id}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-8).join(' | ').slice(0, 900)}`);
      }
      await fs.rename(tmp, clip);
      await fs.rm(dir, { recursive: true, force: true });
    }
    clips.push(clip);
    for (const c of (await readJsonSafe(sfxFile)) || []) cueList.push({ ...c, t: c.t + start });
    doneSec += chSec;
    onPercent?.(Math.round((doneSec / (totalFrames / (props.fps || 30))) * 94));
  }

  // finishing pass: one encode
  const full = path.join(job.dir, `${name}.mp4`);
  const progress = settings.progress?.show !== false && !draft
    ? await progressLayer({ scenes: props.scenes, fps: props.fps || 30, format, theme: props.theme, lang: props.language, workDir: path.join(work, 'overlay') }).catch((e) => { console.log(`progress layer skipped: ${e.message.slice(0, 160)}`); return null; })
    : null;
  let assFile = null;
  let fontsDir = null;
  const ass = buildAss({ scenes: timed, format, settings, theme: props.theme, lang: props.language });
  if (ass) {
    assFile = path.join(work, 'captions.ass');
    await fs.writeFile(assFile, ass);
    fontsDir = await ensureCaptionFonts();
  }
  // transitions: a page turn when a new section starts, a soft swoosh otherwise (never two in a row the same at fast cuts)
  const cutSounds = [];
  timed.slice(1).forEach((s, i) => {
    const newSection = s.section && s.section !== timed[i].section;
    const file = newSection ? (kit.page || kit.swoosh || sfx) : (kit.swoosh || sfx);
    if (file) cutSounds.push({ file, t: Math.max(0, s.offset - 0.35), vol: newSection ? 0.4 : 0.28 });
  });
  const cueSounds = settings.sound?.effects === false ? [] : thinCues(cueList).filter((c) => kit[c.name]).map((c) => ({ file: kit[c.name], t: c.t, vol: Math.min(1, c.vol ?? 1) * sfxVolume(c.name) }));
  if (cueSounds.length) console.log(`sound effects: ${cueSounds.length} cues`);
  // over YouTube's limit: cut points at scene starts, each part at most partMinutes long
  const cuts = [];
  if (partMinutes > 0) {
    let last = 0;
    for (const s of timed) if (s.offset - last > partMinutes * 60) { const prev = timed.filter((x) => x.offset < s.offset).pop(); cuts.push(prev.offset); last = prev.offset; }
  }
  await finishVideo({ chunks: clips, out: full, work, progress, assFile, fontsDir, music, volume: settings.music?.volume || 'low', events: [...cutSounds, ...cueSounds, ...events], keyframes: cuts, bed });
  onPercent?.(99);
  const qc = await checkVideo(full);
  if (!draft) await recordRenderSpeed(totalFrames / (props.fps || 30), (Date.now() - t0) / 1000);

  const out = { ...(await makePreview(full, format, job.dir, name)), qc };
  if (cuts.length) out.parts = await splitAt(full, cuts, path.join(job.dir, name));
  if (format === 'long' || !(await exists(path.join(job.dir, 'frame.png')))) {
    await run('ffmpeg', ['-y', '-ss', '1.2', '-i', full, '-frames:v', '1', path.join(job.dir, 'frame.png')], { allowFail: true });
  }
  if (name !== format) return out; // partial (demo) render: keep the full video's cache
  const keep = new Set(clips.map((c) => path.basename(c)));
  for (const f of await fs.readdir(clipDir)) if (!keep.has(f)) await fs.rm(path.join(clipDir, f), { force: true });
  return out;
}

/** WhatsApp preview: the full-HD file itself (sent as a document) unless it is very large. */
export async function makePreview(full, format, dir, name = format) {
  const preview = path.join(dir, `${name}-preview.mp4`);
  const dur = await audioDuration(full).catch(() => 0);
  if (dur > 20 * 60) { // long videos: a highlights preview (start, middle, end) instead of the whole file
    await highlights(full, preview, dur);
    return { full, preview, hd: false, highlights: true };
  }
  const size = (await fs.stat(full)).size;
  if (size <= cfg.render.maxHdPreviewMb * 1024 * 1024) {
    await fs.copyFile(full, preview);
    return { full, preview, hd: true };
  }
  const scale = format === 'short' ? 'scale=720:-2' : 'scale=-2:720';
  await run('ffmpeg', ['-y', '-i', full, '-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', preview], { timeoutMs: 30 * 60_000 });
  return { full, preview, hd: false };
}

/** After the render: black or frozen stretches (signs of a broken scene). Returns warnings. */
export async function checkVideo(file) {
  const r = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.6:pix_th=0.06,freezedetect=n=-60dB:d=3', '-an', '-f', 'null', '-'], { allowFail: true, timeoutMs: 20 * 60_000 }).catch(() => ({ stderr: '' }));
  const out = [];
  for (const m of r.stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) out.push(`black screen ${(+m[1]).toFixed(1)}-${(+m[2]).toFixed(1)} s`);
  const starts = [...r.stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...r.stderr.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => +m[1]);
  starts.forEach((s, i) => out.push(`no movement ${s.toFixed(1)}-${ends[i] != null ? ends[i].toFixed(1) : 'end'} s`));
  return out.slice(0, 6);
}

/** Load a composition once and read the sound cues its scenes registered with sfx(name, t). */
async function readCues(htmlFile) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`file://${htmlFile.replace(/\\/g, '/')}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__timelines && Object.keys(window.__timelines).length, null, { timeout: 30_000 }).catch(() => {});
    const cues = await page.evaluate(() => (window.__sfx || []).filter((c) => c && typeof c.name === 'string' && Number.isFinite(c.t)));
    return cues.map((c) => ({ name: c.name, t: +c.t.toFixed(3), vol: Number.isFinite(c.vol) ? c.vol : 1 }));
  } finally {
    await browser.close();
  }
}

/** Keep effects sparse: at least 0.6 s apart, at most 3 per 10 seconds. */
function thinCues(list) {
  const out = [];
  for (const c of [...list].sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1];
    if (last && c.t - last.t < 0.6) continue;
    if (out.filter((x) => c.t - x.t < 10).length >= 3) continue;
    out.push(c);
  }
  return out;
}
