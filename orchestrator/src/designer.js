// The motion designer: Claude writes every scene as HTML + CSS + GSAP in the video's style (scenes/<id>.html),
// synced to the voice through word timings. Scenes are redesigned only when their words, content or the
// look change. Broken or banned scenes fall back to the basic style. Also makes the storyboard.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { askClaude, ClaudeLimitError } from './claude.js';
import { readJson, writeJson, exists } from './util.js';
import { prepareRefs, bannedIssues, styleLibrary, rulesText } from './look.js';
import { sceneHtml, esc } from './compose.js';
import { basicDesign } from './scenes-basic.js';
import { expandProps } from './props.js';
import { ROOT } from './config.js';

const BATCH = 4; // scenes per Claude call
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** What changes a scene's design: its words, its content hint, the look and the formats. */
function designKey(scene, visual, look, formats) {
  return sha(JSON.stringify([scene.narration, visual, look.style, look.palette, look.fonts?.heading?.family, look.fonts?.body?.family, look.motion, formats.slice().sort()]));
}

/** A compact content hint from the plan's visual (key text, number, list). */
function hint(v = {}) {
  switch (v.type) {
    case 'title': return { kind: 'opening title', title: v.heading, subtitle: v.subheading };
    case 'statement': return { kind: 'key statement', text: v.text, emphasise: v.highlight };
    case 'bullets': return { kind: 'list', heading: v.heading, items: v.items };
    case 'bignumber': return { kind: 'key number', value: v.value, label: v.label };
    case 'quote': return { kind: 'quote', text: v.text, author: v.author };
    case 'compare': return { kind: 'comparison', left: v.left, right: v.right };
    case 'bars': return { kind: 'data', heading: v.heading, bars: v.bars, unit: v.unit };
    default: return v;
  }
}

const BAD_JS = /(Math\.random|Date\.now|new Date|setTimeout|setInterval|requestAnimationFrame|fetch\s*\(|XMLHttpRequest|repeat\s*:\s*-1|import\s*\(|document\.getElementById)/;
// slow to render frame by frame: keep them out of scenes
const SLOW_CSS = /(backdrop-filter|blur\(\s*([7-9]|\d{2,})px)/i;

/** Parse + check one scene file. Returns { design } or { problems: [...] }. */
export function parseScene(text, look, sceneId = 's') {
  const problems = [];
  const css = (text.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || '';
  const js = (text.match(/<script[^>]*>([\s\S]*?)<\/script>/i) || [])[1] || '';
  const body = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').trim();
  if (!/class=["'][^"']*\bsc\b/.test(body)) problems.push('missing the <div class="sc"> root');
  if (!js.trim()) problems.push('no animation script');
  try { new vm.Script(`(function(){\n${js}\n})`); } catch (e) { problems.push(`script syntax error: ${e.message}`); }
  const bad = js.match(BAD_JS);
  if (bad) problems.push(`not allowed in the script: ${bad[0]}${bad[0].includes('getElementById') ? ' (use $("#id") instead)' : ''}`);
  const slow = `${css}\n${body}`.match(SLOW_CSS);
  if (slow) problems.push(`too slow to render: ${slow[0]} (avoid large blur filters and backdrop-filter)`);
  problems.push(...bannedIssues(text, { html: true }).filter((x) => x !== 'frame contains JavaScript').map((x) => x.replace('frame', 'scene')));
  const ex = expandProps(body, look.niche || 'general', sceneId);
  if (ex.unknown.length) problems.push(`unknown prop(s): ${ex.unknown.join(', ')} (use names from _ref/props-${look.niche}.json)`);
  if (problems.length) return { problems };
  return {
    design: {
      body: ex.html, css, js,
      fonts: [look.fonts.heading.query, look.fonts.body.query],
      families: { heading: look.fonts.heading.family, body: look.fonts.body.family },
    },
  };
}

/**
 * Make sure every scene has a design. props = buildProps output (words per scene).
 * Returns { designs: {id: design}, failed: [id], designed: n }.
 */
export async function designScenes(job, { plan, props, look, formats, onProgress, extra = '', force = {} }) {
  await prepareRefs(job.dir);
  const scDir = path.join(job.dir, 'scenes');
  await fs.mkdir(scDir, { recursive: true });
  const indexFile = path.join(scDir, 'index.json');
  const index = await readJson(indexFile).catch(() => ({}));
  const style = (await styleLibrary()).find((s) => s.id === look.style);
  const byId = new Map(props.scenes.map((s) => [s.id, s]));
  const keyOf = (s) => designKey(s, s.visual, look, formats);

  const todo = [];
  for (const s of plan.scenes) {
    if (force[s.id] || index[s.id] !== keyOf(s) || !(await exists(path.join(scDir, `${s.id}.html`)))) todo.push(s);
  }
  const fps = props.fps || 30;
  const formatNote = formats.length > 1
    ? ' Design for the long 16:9 layout and add `.portrait .sc …` CSS rules so the same scene also works in the 9:16 Short.'
    : formats[0] === 'short' ? ' This is a 9:16 Short only (1080×1920, PORTRAIT is true).' : ' This is a 16:9 video only (1920×1080).';

  let done = 0;
  const failed = new Map();
  const runBatch = async (scenes, extraText) => {
    await writeJson(path.join(job.dir, 'design-input.json'), {
      kind: plan.kind || 'general',
      scenes: scenes.map((s) => {
        const p = byId.get(s.id);
        return { id: s.id, D: +(p.durationInFrames / fps).toFixed(2), narration: s.narration, section: s.section || '', hint: hint(s.visual), words: (p.words || []).map((w, i) => [i, w.text, +w.start.toFixed(2)]) };
      }),
    });
    // keep the previous design: it comes back if the new one fails its checks
    for (const s of scenes) {
      const f = path.join(scDir, `${s.id}.html`);
      if (await exists(f)) await fs.rename(f, `${f}.bak`);
    }
    try {
      await askClaude(job.dir, 'design', {
        RULES: rulesText(look.niche),
        STYLE_FILE: style?.file || 'flat-explainer.md',
        STYLE_NAME: style?.name || look.styleName,
        FORMATS: formats.map((f) => (f === 'short' ? 'Short 9:16 (1080×1920)' : 'long 16:9 (1920×1080)')).join(' and '),
        FORMAT_NOTE: formatNote,
        EXTRA: [extra, extraText].filter(Boolean).join('\n\n'),
      }, { maxTurns: 45 });
    } catch (e) {
      if (e instanceof ClaudeLimitError) throw e;
      for (const s of scenes) failed.set(s.id, [`design call failed: ${e.message.slice(0, 200)}`]);
      return;
    }
    for (const s of scenes) {
      const f = path.join(scDir, `${s.id}.html`);
      const text = await fs.readFile(f, 'utf8').catch(() => null);
      const r = text ? parseScene(text, look, s.id) : { problems: ['scene file was not written'] };
      if (r.problems) {
        const bak = `${f}.bak`;
        const old = (await exists(bak)) ? parseScene(await fs.readFile(bak, 'utf8'), look, s.id) : null;
        if (old?.design && index[s.id] === keyOf(s)) { await fs.rename(bak, f); failed.delete(s.id); } // keep the earlier good one
        else failed.set(s.id, r.problems);
      } else { failed.delete(s.id); index[s.id] = keyOf(s); }
      await fs.rm(`${f}.bak`, { force: true });
    }
    await writeJson(indexFile, index);
  };

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    await onProgress?.(done, todo.length);
    const notes = batch.filter((s) => force[s.id]).map((s) => `- ${s.id}: ${force[s.id]}`);
    await runBatch(batch, notes.length ? `A reviewer asked for these changes; redesign these scenes with them in mind:\n${notes.join('\n')}` : '');
    done += batch.length;
  }
  // one repair round for scenes with problems
  if (failed.size) {
    const again = todo.filter((s) => failed.has(s.id));
    console.log(`${ts()} [${job.id}] redesigning ${again.length} scene(s): ${[...failed].map(([id, p]) => `${id}: ${p.join('; ')}`).join(' | ').slice(0, 600)}`);
    const note = `A previous attempt at these scenes had problems; avoid them:\n${again.map((s) => `- ${s.id}: ${failed.get(s.id).join('; ')}`).join('\n')}`;
    for (let i = 0; i < again.length; i += BATCH) await runBatch(again.slice(i, i + BATCH), note);
  }
  await onProgress?.(todo.length, todo.length);

  const designs = {};
  for (const s of plan.scenes) {
    if (failed.has(s.id)) continue;
    const text = await fs.readFile(path.join(scDir, `${s.id}.html`), 'utf8').catch(() => null);
    const r = text ? parseScene(text, look, s.id) : null;
    if (r?.design) designs[s.id] = r.design;
    else failed.set(s.id, r?.problems || ['missing']);
  }
  return { designs, failed: [...failed.keys()], designed: todo.length };
}

/** After Claude edited scene files by request: re-validate them and mark them current. */
export async function acceptEditedScenes(job, { plan, look, formats }) {
  const scDir = path.join(job.dir, 'scenes');
  const indexFile = path.join(scDir, 'index.json');
  const index = await readJson(indexFile).catch(() => ({}));
  const bad = [];
  for (const s of plan.scenes) {
    const text = await fs.readFile(path.join(scDir, `${s.id}.html`), 'utf8').catch(() => null);
    if (!text) continue;
    const r = parseScene(text, look, s.id);
    if (r.problems) bad.push(`${s.id}: ${r.problems.join('; ')}`);
    else index[s.id] = designKey(s, s.visual, look, formats);
  }
  await writeJson(indexFile, index);
  return bad;
}

// ------------------------------------------------------------------ capture, checks, storyboard
// Frames are rendered with Playwright by seeking each scene's GSAP timeline (no video render needed).

/** Runs inside the page: automatic layout checks for the frame currently shown. */
function inspectFrame({ W, H, portrait, capPos, bg, D }) {
  const issues = [];
  const stage = document.querySelector('#stage');
  if (!stage) return ['no stage'];
  const tl = window.__timelines?.scene;
  if (tl && tl.duration() > D + 0.15) issues.push(`animation runs ${(tl.duration() - D).toFixed(1)} s past the end of the scene`);
  const hex = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x));
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const c = hex(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.6) return c;
    }
    return bg;
  };
  const shown = (el) => {
    let o = 1;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      o *= parseFloat(cs.opacity);
    }
    return o > 0.6;
  };
  const texts = [...stage.querySelectorAll('*')].filter((el) => !(el.closest('svg') && el.tagName !== 'text')
    && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && shown(el));
  const boxes = [];
  const capTop = portrait ? H - 560 : H - 200;
  for (const el of texts) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const label = `"${el.textContent.trim().slice(0, 28)}"`;
    if (r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2) issues.push(`text cut off at the edge: ${label}`);
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < (portrait ? 30 : 24)) issues.push(`text too small (${Math.round(fs)} px): ${label}`);
    if (capPos === 'bottom' && r.bottom > capTop + 10 && r.top < H) issues.push(`text in the subtitle area: ${label}`);
    if (el.tagName !== 'text') {
      const fg = hex(cs.color);
      if (fg && ratio(fg, bgOf(el)) < 3) issues.push(`low contrast text: ${label}`);
    }
    boxes.push({ el, r, label });
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]; const b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left));
      const iy = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top));
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (small && (ix * iy) / small > 0.2) issues.push(`texts overlap: ${a.label} and ${b.label}`);
    }
  }
  return [...new Set(issues)].slice(0, 6);
}

/**
 * Render frames of every scene at given fractions of its length, with automatic checks.
 * Returns [{ id, n, frames: [{t, img}], issues: [...], designed }].
 */
export async function captureScenes(job, { props, designs, look, settings, format, gsapFile, fractions = [0.72], dirName = 'storyboard', onlyIds = null }) {
  const { chromium } = await import('playwright');
  const dir = path.join(job.dir, dirName);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(gsapFile, path.join(dir, 'gsap.min.js'));
  await fs.copyFile(path.join(ROOT, 'motion', 'motion-lib.js'), path.join(dir, 'motion-lib.js')).catch(() => {});
  const portrait = format === 'short';
  const [W, H] = portrait ? [1080, 1920] : [1920, 1080];
  const fps = props.fps || 30;
  const bgRgb = (() => { const n = parseInt((props.theme.bg || '#ffffff').slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }; })();
  const browser = await chromium.launch();
  const out = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    for (const [i, s] of props.scenes.entries()) {
      if (onlyIds && !onlyIds.includes(s.id)) continue;
      const errors = [];
      const onErr = (e) => errors.push(e.message);
      const onConsole = (m) => { if (m.type() === 'error' && /scene animation error/.test(m.text())) errors.push(m.text()); };
      page.on('pageerror', onErr);
      page.on('console', onConsole);
      const duration = s.durationInFrames / fps;
      const design = designs[s.id] || basicDesign(s.visual, { theme: props.theme, format, lang: props.language, words: s.words, look });
      const html = sceneHtml({ scene: { id: s.id, duration, words: s.words, audio: null, design }, format, lang: props.language, theme: props.theme, settings, motion: look?.motion });
      const file = path.join(dir, `${s.id}.html`);
      await fs.writeFile(file, html);
      await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      const frames = [];
      const issues = [];
      for (const f of fractions) {
        const t = Math.max(0.3, Math.min(duration - 0.05, duration * f));
        await page.evaluate((t) => {
          for (const el of document.querySelectorAll('[data-start]')) {
            if (el.id === 'root' || el.tagName === 'AUDIO') continue;
            const st = +el.dataset.start;
            const d = +el.dataset.duration;
            el.style.visibility = t >= st && t < st + d ? 'visible' : 'hidden';
          }
          window.__timelines?.scene?.seek(t, false);
        }, t).catch((e) => errors.push(e.message));
        await page.waitForTimeout(100);
        const img = path.join(dir, `${s.id}-${Math.round(f * 100)}.jpg`);
        await page.screenshot({ path: img, type: 'jpeg', quality: 80 });
        frames.push({ t, img });
        if (f >= 0.6) {
          issues.push(...await page.evaluate(inspectFrame, { W, H, portrait, capPos: settings.captions.position, bg: bgRgb, D: duration }).catch(() => []));
        }
      }
      page.off('pageerror', onErr);
      page.off('console', onConsole);
      if (errors.length) issues.unshift(`script error: ${errors[0].slice(0, 160)}`);
      out.push({ id: s.id, n: i + 1, frames, issues: [...new Set(issues)], designed: !!designs[s.id], text: (s.words || []).map((x) => x.text).join(' ') });
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** A labelled contact sheet of frames (one row item per frame). */
export async function contactSheet(items, outFile, { portrait = false, cols, width } = {}) {
  const { chromium } = await import('playwright');
  cols ||= portrait ? Math.min(5, items.length) : Math.min(3, items.length);
  const cw = width || (portrait ? 300 : 560);
  const ch = Math.round(cw * (portrait ? 16 / 9 : 9 / 16));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#f3f1ec;font:500 15px/1.35 Arial,sans-serif;color:#222}
    .g{display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:18px;padding:22px}
    .c img{width:${cw}px;height:${ch}px;display:block;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.12)}
    .c b{display:inline-block;background:#222;color:#fff;border-radius:6px;padding:1px 8px;margin:8px 6px 0 0}
    .c span{color:#555}</style></head><body><div class="g">${
    items.map((x) => `<div class="c"><img src="${pathToFileURL(x.img).href}"><div><b>${esc(x.label)}</b><span>${esc(x.caption || '')}</span></div></div>`).join('')
  }</div></body></html>`;
  const sheetHtml = outFile.replace(/\.jpg$/, '.html');
  await fs.writeFile(sheetHtml, html);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: cols * (cw + 18) + 26, height: 400 } });
    await page.goto(pathToFileURL(sheetHtml).href, { waitUntil: 'load' });
    await page.screenshot({ path: outFile, type: 'jpeg', quality: 85, fullPage: true });
  } finally {
    await browser.close();
  }
  return outFile;
}

/** The storyboard you see on WhatsApp: one frame per scene. */
export async function storyboard(job, opts) {
  const shots = await captureScenes(job, { ...opts, fractions: [0.72], dirName: 'storyboard' });
  const portrait = opts.format === 'short';
  const n = portrait ? 60 : 110;
  const image = await contactSheet(shots.map((x) => ({
    img: x.frames[0].img, label: String(x.n), caption: `${x.text.slice(0, n)}${x.text.length > n ? '…' : ''}`,
  })), path.join(job.dir, 'storyboard', 'storyboard.jpg'), { portrait });
  return { image, scenes: shots.length, issues: shots.filter((x) => x.issues.length).map((x) => `${x.n}: ${x.issues.join('; ')}`) };
}

// ------------------------------------------------------------------ the critic loop
const SEVERE = /(cut off|overlap|subtitle area|script error|low contrast|too small|past the end)/i;

/**
 * Score designed scenes (automatic checks + Claude looking at frames) and redesign the weak ones.
 * Returns { designs, review, rounds, fixed: [ids], weak: [ids still under 4] }.
 */
export async function reviewScenes(job, { plan, props, look, settings, formats, gsapFile, designs, onProgress, model, maxRounds = 2 }) {
  const style = (await styleLibrary()).find((s) => s.id === look.style);
  const format = formats.includes('long') ? 'long' : 'short';
  const fixed = new Set();
  let review = { scenes: [], suggestions: [] };
  let weak = [];
  for (let round = 1; round <= maxRounds + 1; round++) {
    await onProgress?.(`🔎 Checking every scene${round > 1 ? ` again (round ${round})` : ''}…`);
    const shots = await captureScenes(job, { props, designs, look, settings, format, gsapFile, fractions: [0.35, 0.78], dirName: 'critic' });
    const portrait = format === 'short';
    const sheets = [];
    for (let i = 0; i < shots.length; i += 6) {
      const part = shots.slice(i, i + 6);
      const items = part.flatMap((x) => x.frames.map((f, k) => ({ img: f.img, label: `${x.n}${'ab'[k]}`, caption: x.designed ? '' : '(simple style)' })));
      sheets.push(await contactSheet(items, path.join(job.dir, 'critic', `sheet-${sheets.length + 1}.jpg`), { portrait, cols: portrait ? 4 : 4, width: portrait ? 260 : 440 }));
    }
    await writeJson(path.join(job.dir, 'critic', 'input.json'), {
      scenes: shots.map((x) => ({ n: x.n, id: x.id, narration: plan.scenes.find((s) => s.id === x.id)?.narration, designed: x.designed, auto_issues: x.issues })),
      sheets: sheets.map((f) => path.relative(job.dir, f).split(path.sep).join('/')),
    });
    try {
      await askClaude(job.dir, 'critic', { STYLE_FILE: style?.file || 'flat-explainer.md', RULES: rulesText(look.niche) }, { maxTurns: 15, model });
      review = await readJson(path.join(job.dir, 'critic', 'review.json'));
    } catch (e) {
      if (e instanceof ClaudeLimitError) throw e;
      console.log(`${ts()} [${job.id}] critic failed: ${e.message.slice(0, 200)}`);
      review = { scenes: [], suggestions: [] };
    }
    const byId = new Map((review.scenes || []).map((r) => [r.id, r]));
    const need = {};
    for (const x of shots) {
      if (!x.designed) continue;
      const r = byId.get(x.id);
      const severe = x.issues.filter((i) => SEVERE.test(i));
      if ((r && Number(r.score) < 4) || severe.length) {
        need[x.id] = [r?.fix, ...(r?.problems || []), ...severe].filter(Boolean).join('; ').slice(0, 600);
      }
    }
    weak = Object.keys(need);
    console.log(`${ts()} [${job.id}] review round ${round}: scores ${(review.scenes || []).map((r) => `${r.id}=${r.score}`).join(' ')}; redo: ${weak.join(', ') || 'none'}`);
    if (!weak.length || round > maxRounds) break;
    await onProgress?.(`🛠 Improving ${weak.length} scene${weak.length > 1 ? 's' : ''} the review flagged…`);
    const r = await designScenes(job, { plan, props, look, formats, force: need });
    for (const id of weak) {
      if (r.designs[id]) { designs[id] = r.designs[id]; fixed.add(id); }
    }
  }
  await writeJson(path.join(job.dir, 'critic', 'review.json'), review).catch(() => {});
  return { designs, review, fixed: [...fixed], weak };
}
