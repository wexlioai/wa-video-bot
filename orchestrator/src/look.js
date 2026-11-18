// Art direction: Claude writes a creative brief and 3 "directions" (style + palette + fonts + motion),
// each with a designed style frame. We check them (banned looks, contrast, fonts, overflow),
// screenshot the frames, and the chosen one becomes the video's look (look.json).
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './config.js';
import { readJson, writeJson, exists } from './util.js';
import { contrast, readable } from './compose.js';

export const STYLES_DIR = path.join(ROOT, 'styles');
const isHex = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

export async function styleLibrary() {
  return (await readJson(path.join(STYLES_DIR, 'index.json'))).styles;
}
async function fontList() {
  return (await readJson(path.join(STYLES_DIR, 'fonts.json'))).fonts;
}

/** Copy the style library into the job folder so Claude can read it (it only reads inside the job). */
export async function prepareRefs(jobDir) {
  const ref = path.join(jobDir, '_ref');
  await fs.mkdir(ref, { recursive: true });
  for (const f of await fs.readdir(STYLES_DIR)) {
    if (/\.(md|json)$/.test(f)) await fs.copyFile(path.join(STYLES_DIR, f), path.join(ref, f));
  }
  await fs.mkdir(path.join(jobDir, 'look'), { recursive: true });
}

// ------------------------------------------------------------------ banned looks
const BANNED_WORDS = /\b(neon|cyber\w*|synthwave|vaporwave|glitch\w*|scan[- ]?lines?|terminal|command[- ]?prompt|console window|code window|hacker|matrix|hud|heads[- ]up display|neural|brain[- ]?circuit|circuit[- ]?board|ascii|xp|level[- ]?ups?|quests?|power[- ]?ups?|unlock\w*|achievements?|leaderboard)\b/i;
const BANNED_FONTS = /(monospace|courier|consolas|menlo|fira ?code|jetbrains|source code|share tech|vt323|orbitron|press start|audiowide|space mono|ibm plex mono|roboto mono)/i;
// a coloured glow: text/box-shadow with zero offsets and a large blur, or drop-shadow glow filters
const GLOW = /(text|box)-shadow\s*:[^;]*\b0(px)?\s+0(px)?\s+(1[2-9]|[2-9]\d|\d{3})px\s+(#|rgb|hsl)(?![^;]*rgba?\(\s*0\s*,\s*0\s*,\s*0)/i;

function hsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  return { s: sat, l };
}
/** Neon = fully saturated mid-light colours, worst on a dark background. */
export function neonPalette(p) {
  const hot = [p.primary, p.accent].filter((c) => { const { s, l } = hsl(c); return s > 0.9 && l > 0.45 && l < 0.7; });
  const darkBg = hsl(p.bg).l < 0.18;
  return hot.length >= 2 || (darkBg && hot.length >= 1);
}

/** Problems with banned looks/words in some text or HTML. */
export function bannedIssues(text, { html = false } = {}) {
  const issues = [];
  const visible = html ? String(text).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ') : String(text);
  const m = visible.match(BANNED_WORDS);
  if (m) issues.push(`banned word "${m[0]}"`);
  if (html) {
    const f = String(text).match(BANNED_FONTS);
    if (f) issues.push(`banned font "${f[0]}"`);
    if (GLOW.test(text)) issues.push('glow effect');
    if (/<script/i.test(text)) issues.push('frame contains JavaScript');
    if (/<img\b|url\((?!['"]?data:)/i.test(String(text).replace(/https:\/\/fonts\.googleapis\.com[^"')]+/g, ''))) issues.push('frame loads images');
  }
  return issues;
}

// ------------------------------------------------------------------ directions
/** Validate + repair directions.json. Returns { brief, directions, recommended, dropped: [reason] }. */
export async function loadDirections(jobDir, language) {
  const brief = await readJson(path.join(jobDir, 'look', 'brief.json')).catch(() => ({}));
  const raw = await readJson(path.join(jobDir, 'look', 'directions.json'));
  const styles = await styleLibrary();
  const ready = new Map(styles.filter((s) => s.ready).map((s) => [s.id, s]));
  const fonts = new Map((await fontList()).map((f) => [f.family.toLowerCase(), f]));
  const dropped = [];
  const briefIssues = bannedIssues(JSON.stringify(brief));
  if (briefIssues.length) dropped.push(`brief: ${briefIssues.join(', ')}`);

  const out = [];
  for (const [i, d] of (raw.directions || []).entries()) {
    const n = i + 1;
    const why = [];
    if (!ready.has(d.style)) why.push(`style "${d.style}" is not available`);
    const p = d.palette || {};
    for (const k of ['bg', 'bg2', 'ink', 'primary', 'accent']) if (!isHex(p[k])) why.push(`palette.${k} invalid`);
    if (!why.length && neonPalette(p)) why.push('neon palette');
    why.push(...bannedIssues(`${d.name} ${d.why}`));
    const frame = path.join(jobDir, 'look', `d${n}.html`);
    const html = (await exists(frame)) ? await fs.readFile(frame, 'utf8') : null;
    if (!html) why.push('no style frame');
    else why.push(...bannedIssues(html, { html: true }));
    if (why.length) { dropped.push(`direction ${n}: ${why.join(', ')}`); continue; }

    // automatic repairs rather than rejections
    if (contrast(p.ink, p.bg) < 7) p.ink = readable(p.bg, [p.ink, '#1b1b1b', '#111111'], 7);
    const pick = (fam, fallback) => fonts.get(String(fam || '').toLowerCase()) || fonts.get(fallback.toLowerCase());
    let heading = pick(d.fonts?.heading, 'Poppins');
    let body = pick(d.fonts?.body, 'Inter');
    if (language === 'ur') {
      if (!/nastaliq|gulzar/i.test(heading.family)) heading = fonts.get('gulzar');
      body = fonts.get('noto nastaliq urdu');
    }
    out.push({
      n,
      name: String(d.name || ready.get(d.style).name).slice(0, 40),
      style: d.style,
      styleName: ready.get(d.style).name,
      why: String(d.why || '').slice(0, 200),
      palette: p,
      fonts: { heading, body },
      motion: ['gentle', 'crisp', 'playful', 'cinematic'].includes(d.motion) ? d.motion : 'crisp',
      frame,
    });
  }
  const recommended = out.find((d) => d.n === raw.recommended) ? raw.recommended : out[0]?.n;
  return { brief, directions: out, recommended, dropped };
}

/** Screenshot style frames to JPEG (Playwright Chromium, already installed for YouTube). Adds .image and .issues. */
export async function shootFrames(directions) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    for (const d of directions) {
      d.image = d.frame.replace(/\.html$/, '.jpg');
      await page.goto(pathToFileURL(d.frame).href, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await page.waitForTimeout(250);
      d.issues = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          if (!el.childNodes.length || ![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
          const r = el.getBoundingClientRect();
          if (r.width && (r.left < 0 || r.top < 0 || r.right > 1920 || r.bottom > 1080)) out.push(`text outside the frame: "${el.textContent.trim().slice(0, 30)}"`);
        }
        return out.slice(0, 3);
      }).catch(() => []);
      await page.screenshot({ path: d.image, type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    }
  } finally {
    await browser.close();
  }
  return directions;
}

// ------------------------------------------------------------------ the chosen look
/** look.json = what every later step designs with. Also re-colours plan.theme for the classic engine. */
export async function applyLook(jobDir, direction, brief) {
  const look = {
    name: direction.name,
    style: direction.style,
    styleName: direction.styleName,
    palette: direction.palette,
    fonts: direction.fonts,
    motion: direction.motion,
    brief,
  };
  await writeJson(path.join(jobDir, 'look.json'), look);
  const planFile = path.join(jobDir, 'plan.json');
  const plan = await readJson(planFile);
  const p = direction.palette;
  plan.theme = { bg: p.bg, bg2: p.bg2, primary: p.primary, accent: p.accent, text: p.ink };
  await writeJson(planFile, plan);
  return look;
}

export const loadLook = (jobDir) => readJson(path.join(jobDir, 'look.json')).catch(() => null);

/** Prompt text about the person's saved style and past picks. */
export function savedText(saved) {
  if (!saved) return '';
  return `The person saved a preferred style. Make exactly ONE direction, using style "${saved.style}"${
    saved.fonts ? ` with heading font "${saved.fonts.heading}" and body font "${saved.fonts.body}"` : ''}. Still choose its palette from this script.`;
}
export function tasteText(picks = []) {
  if (!picks.length) return '';
  return `Looks this person picked before (most recent last), use as a hint to their taste, not a rule:\n${picks.slice(-5).map((p) => `- ${p.styleName}: "${p.name}" (${p.motion})`).join('\n')}`;
}
