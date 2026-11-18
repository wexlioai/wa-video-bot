// HyperFrames engine: HTML + CSS + GSAP compositions rendered to MP4 (https://github.com/heygen-com/hyperframes).
// Lives in <repo>/motion (its own package.json; the supervisor installs it).
// Phase 0: an "engine test" that proves rendering works on this machine and measures speed.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './config.js';
import { run, exists, audioDuration } from './util.js';

export const MOTION_DIR = path.join(ROOT, 'motion');
const bin = () => path.join(MOTION_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes');
const gsapFile = () => path.join(MOTION_DIR, 'node_modules', 'gsap', 'dist', 'gsap.min.js');

/** Is the engine installed? Returns null when ready, otherwise a reason. */
export async function engineMissing() {
  if (!(await exists(path.join(MOTION_DIR, 'package.json')))) return 'the motion/ folder is missing (update not installed yet)';
  if (!(await exists(bin()))) return 'HyperFrames is not installed yet (the bot installs it automatically after an update; give it a few minutes)';
  if (!(await exists(gsapFile()))) return 'GSAP is not installed yet';
  return null;
}

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
  const r = await hf(['render', '--output', out, '--quality', 'looks'], {
    cwd: dir,
    allowFail: true,
    onData: (s) => {
      const m = s.match(/(\d{1,3})\s?%/);
      if (m && +m[1] !== lastPct && +m[1] <= 100) { lastPct = +m[1]; onStage?.('render', lastPct); }
    },
  });
  const renderSec = (Date.now() - t1) / 1000;
  const ok = r.code === 0 && (await exists(out));
  const result = {
    ok,
    renderSec,
    voiceSec,
    voiceError,
    words: words.length,
    machine: `${os.platform()} ${os.arch()}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`,
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
