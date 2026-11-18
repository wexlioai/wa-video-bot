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
import { prepareRefs, bannedIssues, styleLibrary } from './look.js';
import { sceneHtml, esc } from './compose.js';
import { basicDesign } from './scenes-basic.js';

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

const BAD_JS = /(Math\.random|Date\.now|new Date|setTimeout|setInterval|requestAnimationFrame|fetch\s*\(|XMLHttpRequest|repeat\s*:\s*-1|import\s*\()/;

/** Parse + check one scene file. Returns { design } or { problems: [...] }. */
export function parseScene(text, look) {
  const problems = [];
  const css = (text.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || '';
  const js = (text.match(/<script[^>]*>([\s\S]*?)<\/script>/i) || [])[1] || '';
  const body = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').trim();
  if (!/class=["'][^"']*\bsc\b/.test(body)) problems.push('missing the <div class="sc"> root');
  if (!js.trim()) problems.push('no animation script');
  try { new vm.Script(`(function(){\n${js}\n})`); } catch (e) { problems.push(`script syntax error: ${e.message}`); }
  const bad = js.match(BAD_JS);
  if (bad) problems.push(`not allowed in the script: ${bad[0]}`);
  problems.push(...bannedIssues(text, { html: true }).filter((x) => x !== 'frame contains JavaScript').map((x) => x.replace('frame', 'scene')));
  if (problems.length) return { problems };
  return {
    design: {
      body, css, js,
      fonts: [look.fonts.heading.query, look.fonts.body.query],
      families: { heading: look.fonts.heading.family, body: look.fonts.body.family },
    },
  };
}

/**
 * Make sure every scene has a design. props = buildProps output (words per scene).
 * Returns { designs: {id: design}, failed: [id], designed: n }.
 */
export async function designScenes(job, { plan, props, look, formats, onProgress, extra = '' }) {
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
    if (index[s.id] !== keyOf(s) || !(await exists(path.join(scDir, `${s.id}.html`)))) todo.push(s);
  }
  const fps = props.fps || 30;
  const formatNote = formats.length > 1
    ? ' Design for the long 16:9 layout and add `.portrait .sc …` CSS rules so the same scene also works in the 9:16 Short.'
    : formats[0] === 'short' ? ' This is a 9:16 Short only (1080×1920, PORTRAIT is true).' : ' This is a 16:9 video only (1920×1080).';

  let done = 0;
  const failed = new Map();
  const runBatch = async (scenes, extraText) => {
    await writeJson(path.join(job.dir, 'design-input.json'), {
      scenes: scenes.map((s) => {
        const p = byId.get(s.id);
        return { id: s.id, D: +(p.durationInFrames / fps).toFixed(2), narration: s.narration, hint: hint(s.visual), words: (p.words || []).map((w, i) => [i, w.text, +w.start.toFixed(2)]) };
      }),
    });
    for (const s of scenes) await fs.rm(path.join(scDir, `${s.id}.html`), { force: true });
    try {
      await askClaude(job.dir, 'design', {
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
      const r = text ? parseScene(text, look) : { problems: ['scene file was not written'] };
      if (r.problems) failed.set(s.id, r.problems);
      else { failed.delete(s.id); index[s.id] = keyOf(s); }
    }
    await writeJson(indexFile, index);
  };

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    await onProgress?.(done, todo.length);
    await runBatch(batch);
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
    const r = text ? parseScene(text, look) : null;
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
    const r = parseScene(text, look);
    if (r.problems) bad.push(`${s.id}: ${r.problems.join('; ')}`);
    else index[s.id] = designKey(s, s.visual, look, formats);
  }
  await writeJson(indexFile, index);
  return bad;
}

// ------------------------------------------------------------------ storyboard
/**
 * One still per scene (at ~70 % of the scene, when it has built up), on a labelled contact sheet.
 * Rendered with Playwright by seeking the GSAP timeline, so it needs no video render.
 */
export async function storyboard(job, { props, designs, look, settings, format, gsapFile }) {
  const { chromium } = await import('playwright');
  const dir = path.join(job.dir, 'storyboard');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(gsapFile, path.join(dir, 'gsap.min.js'));
  const portrait = format === 'short';
  const [w, h] = portrait ? [1080, 1920] : [1920, 1080];
  const fps = props.fps || 30;
  const browser = await chromium.launch();
  const shots = [];
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const [i, s] of props.scenes.entries()) {
      const duration = s.durationInFrames / fps;
      const design = designs[s.id] || basicDesign(s.visual, { theme: props.theme, format, lang: props.language, words: s.words, look });
      const html = sceneHtml({ scene: { id: s.id, duration, words: s.words, audio: null, design }, format, lang: props.language, theme: props.theme, settings, motion: look?.motion });
      const file = path.join(dir, `${s.id}.html`);
      await fs.writeFile(file, html);
      await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      const t = Math.max(0.5, duration * 0.72);
      await page.evaluate((t) => {
        for (const el of document.querySelectorAll('[data-start]')) {
          if (el.id === 'root' || el.tagName === 'AUDIO') continue;
          const st = +el.dataset.start;
          const d = +el.dataset.duration;
          el.style.visibility = t >= st && t < st + d ? 'visible' : 'hidden';
        }
        window.__timelines?.scene?.seek(t, false);
      }, t).catch((e) => errors.push(e.message));
      await page.waitForTimeout(120);
      const img = path.join(dir, `${s.id}.jpg`);
      await page.screenshot({ path: img, type: 'jpeg', quality: 82 });
      shots.push({ n: i + 1, img, designed: !!designs[s.id], text: (s.words || []).map((x) => x.text).join(' ') });
    }
    // contact sheet
    const cols = portrait ? Math.min(5, shots.length) : Math.min(3, shots.length);
    const cw = portrait ? 300 : 560;
    const ch = Math.round(cw * (h / w));
    const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#f3f1ec;font:500 15px/1.35 Arial,sans-serif;color:#222}
      .g{display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:18px;padding:22px}
      .c img{width:${cw}px;height:${ch}px;display:block;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.12)}
      .c b{display:inline-block;background:#222;color:#fff;border-radius:6px;padding:1px 8px;margin:8px 6px 0 0}
      .c span{color:#555}</style></head><body><div class="g">${
      shots.map((x) => `<div class="c"><img src="${pathToFileURL(x.img).href}"><div><b>${x.n}</b><span>${esc(x.text.slice(0, portrait ? 60 : 110))}${x.text.length > (portrait ? 60 : 110) ? '…' : ''}</span></div></div>`).join('')
    }</div></body></html>`;
    const sheetHtml = path.join(dir, 'sheet.html');
    await fs.writeFile(sheetHtml, sheet);
    await page.setViewportSize({ width: cols * (cw + 18) + 26, height: 400 });
    await page.goto(pathToFileURL(sheetHtml).href, { waitUntil: 'load' });
    const out = path.join(dir, 'storyboard.jpg');
    await page.screenshot({ path: out, type: 'jpeg', quality: 85, fullPage: true });
    return { image: out, scenes: shots.length, errors: errors.slice(0, 5) };
  } finally {
    await browser.close();
  }
}
