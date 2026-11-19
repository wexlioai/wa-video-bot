// Long content (a long article, a book): measure it, split it into sections, group them into
// episodes, and work out what it would cost, so the person decides BEFORE anything expensive runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg } from './config.js';
import { readJson, writeJson } from './util.js';

const WPM = { en: 150, ur: 130 }; // narration speed, words per minute
export const LONG_MINUTES = () => Number(process.env.LONG_MINUTES || 15); // above this: long-content mode
export const SAMPLE_MINUTES = () => Number(process.env.SAMPLE_MINUTES || 4); // above this: 10-second sample first
const TARGET_WORDS = 1400; // section size when the text has no headings (≈ 9-10 minutes); episodes group sections
/** Target episode length in minutes (EPISODE_MINUTES, default 30). */
export const EP_MIN = () => Math.max(5, Math.min(120, Number(process.env.EPISODE_MINUTES || 30)));
const MIN_WORDS = 450;
const MAX_WORDS = 2200;

const countWords = (t) => (String(t).match(/\S+/g) || []).length;

export function measure(text, lang = 'en') {
  const words = countWords(text);
  const minutes = words / (WPM[lang] || 150);
  const pages = (String(text).match(/\f/g) || []).length + 1;
  return { words, minutes, pages: pages > 1 ? pages : Math.max(1, Math.round(words / 330)) };
}

const HEADING = /^\s*((chapter|part|section|lesson|unit|episode|باب|حصہ|فصل|سبق)\b[^\n]{0,80}|(\d{1,3}|[IVXLC]{1,6})[.)]\s+[^\n]{2,80})\s*$/i;

/** Split into sections at chapter-like headings, else into ~TARGET_WORDS chunks at paragraph breaks. */
export function splitSections(text) {
  const paras = String(text).replace(/\f/g, '\n\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let sections = [];
  const headingIdx = paras.map((p, i) => (p.length < 100 && HEADING.test(p) ? i : -1)).filter((i) => i >= 0);
  if (headingIdx.length >= 3) {
    let cur = { heading: 'Opening', paras: [] };
    for (const [i, p] of paras.entries()) {
      if (headingIdx.includes(i)) {
        if (cur.paras.length) sections.push(cur);
        cur = { heading: p.replace(/\s+/g, ' ').slice(0, 80), paras: [] };
      } else cur.paras.push(p);
    }
    if (cur.paras.length) sections.push(cur);
  } else {
    let cur = { heading: '', paras: [] };
    for (const p of paras) {
      cur.paras.push(p);
      if (countWords(cur.paras.join(' ')) >= TARGET_WORDS) { sections.push(cur); cur = { heading: '', paras: [] }; }
    }
    if (cur.paras.length) sections.push(cur);
  }
  // merge very short sections into the next one
  const merged = [];
  for (const s of sections) {
    const prev = merged[merged.length - 1];
    if (prev && countWords(prev.paras.join(' ')) < MIN_WORDS) {
      if (prev.heading === 'Opening' && s.heading) prev.heading = s.heading;
      prev.paras.push(...(s.heading ? [s.heading] : []), ...s.paras);
      continue;
    }
    merged.push(s);
  }
  // split very long sections at paragraph breaks
  sections = [];
  for (const s of merged) {
    if (countWords(s.paras.join(' ')) <= MAX_WORDS) { sections.push(s); continue; }
    let part = { heading: s.heading, paras: [] };
    let k = 1;
    for (const p of s.paras) {
      part.paras.push(p);
      if (countWords(part.paras.join(' ')) >= TARGET_WORDS) {
        sections.push(part);
        k++;
        part = { heading: s.heading ? `${s.heading} (part ${k})` : '', paras: [] };
      }
    }
    if (part.paras.length) sections.push(part);
  }
  return sections.map((s, i) => ({ n: i + 1, heading: s.heading || `Part ${i + 1}`, text: s.paras.join('\n\n') }));
}

/** Write sections/NNN.txt + sections.json (with a short preview of each for Claude). */
export async function writeSections(jobDir, text, lang) {
  const secs = splitSections(text);
  const dir = path.join(jobDir, 'sections');
  await fs.mkdir(dir, { recursive: true });
  const index = [];
  for (const s of secs) {
    const file = `${String(s.n).padStart(3, '0')}.txt`;
    await fs.writeFile(path.join(dir, file), s.text);
    const w = countWords(s.text);
    index.push({ n: s.n, heading: s.heading, words: w, minutes: +(w / (WPM[lang] || 150)).toFixed(1), file, preview: s.text.split(/\s+/).slice(0, 45).join(' ') });
  }
  await writeJson(path.join(jobDir, 'sections.json'), { sections: index });
  return index;
}

/** Fallback outline: one episode per section. */
/** Group neighbouring sections into episodes of about EP_MIN minutes (used when Claude's outline is missing). */
export function defaultOutline(sections, title = 'Series') {
  const target = EP_MIN();
  const episodes = [];
  let cur = null;
  for (const s of sections) {
    if (!cur || (cur.minutes > 0 && cur.minutes + s.minutes > target * 1.25)) {
      cur = { n: episodes.length + 1, title: s.heading || `Episode ${episodes.length + 1}`, sections: [], minutes: 0 };
      episodes.push(cur);
    }
    cur.sections.push(s.n);
    cur.minutes += s.minutes || 0;
  }
  return { title, episodes: episodes.map(({ minutes, ...e }) => e) };
}

/** Validate outline.json from Claude against the sections. */
export async function loadOutline(jobDir, sections) {
  const o = await readJson(path.join(jobDir, 'outline.json')).catch(() => null);
  const all = new Set(sections.map((s) => s.n));
  const used = new Set();
  const eps = [];
  for (const e of o?.episodes || []) {
    const secs = (e.sections || []).map(Number).filter((n) => all.has(n) && !used.has(n));
    if (!secs.length) continue;
    secs.forEach((n) => used.add(n));
    eps.push({ n: eps.length + 1, title: String(e.title || `Episode ${eps.length + 1}`).slice(0, 80), sections: secs });
  }
  if (!eps.length || used.size < all.size * 0.9) return defaultOutline(sections, o?.title);
  return { title: String(o.title || 'Series').slice(0, 90), summary: o.summary || '', episodes: eps };
}

export async function episodeText(jobDir, sections, nums) {
  const parts = [];
  for (const n of nums) {
    const s = sections.find((x) => x.n === n);
    if (s) parts.push(await fs.readFile(path.join(jobDir, 'sections', s.file), 'utf8'));
  }
  return parts.join('\n\n');
}

/** Rough costs: render time from this machine's engine test, voice credits from experience (~1,000/min). */
export async function estimate(minutes) {
  // learned from real renders first, else the engine test, else a cautious guess
  const stats = await readJson(path.join(cfg.dataDir, 'render-stats.json')).catch(() => null);
  const ok = await readJson(path.join(cfg.dataDir, 'engine-ok.json')).catch(() => null);
  const ratio = stats?.ratio || (ok?.seconds ? ok.renderSec / ok.seconds : 16);
  return {
    renderHours: (minutes * ratio) / 60,
    voiceCredits: Math.round(minutes * 1000),
  };
}

export const fmtHours = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`);
