// Local fonts: downloaded once from Google Fonts as TrueType into data/fonts/, then used from disk.
// Renders no longer depend on the network (no silent fallback fonts), and the subtitle layer
// (libass) can use the same font files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg } from './config.js';
import { exists } from './util.js';

export const FONTS_DIR = () => path.join(cfg.dataDir, 'fonts');
// an old Safari user agent makes Google Fonts answer with TrueType files (needed by libass)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.59.10 (KHTML, like Gecko) Version/5.1.9 Safari/534.59.10';
const slug = (s) => String(s).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/** Download one Google Fonts css2 query (e.g. "Lora:wght@400;700"). Returns [{family, weight, style, file}] or []. */
async function fetchQuery(query) {
  const dir = FONTS_DIR();
  const index = path.join(dir, `${slug(query)}.json`);
  if (await exists(index)) return JSON.parse(await fs.readFile(index, 'utf8'));
  await fs.mkdir(dir, { recursive: true });
  const url = `https://fonts.googleapis.com/css2?family=${query.replace(/ /g, '+')}&display=block`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Google Fonts ${r.status} for ${query}`);
  const css = await r.text();
  const faces = [];
  for (const block of css.split('@font-face').slice(1)) {
    const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = block.match(/font-weight:\s*(\d+)/)?.[1] || '400';
    const style = block.match(/font-style:\s*(\w+)/)?.[1] || 'normal';
    const src = block.match(/url\((https:[^)]+)\)/)?.[1];
    if (!family || !src) continue;
    const ext = /\.otf/i.test(src) ? 'otf' : 'ttf';
    const file = `${slug(family)}-${weight}${style === 'italic' ? 'i' : ''}.${ext}`;
    if (!(await exists(path.join(dir, file)))) {
      const f = await fetch(src);
      if (!f.ok) continue;
      await fs.writeFile(path.join(dir, file), Buffer.from(await f.arrayBuffer()));
    }
    faces.push({ family, weight, style, file });
  }
  if (faces.length) await fs.writeFile(index, JSON.stringify(faces));
  return faces;
}

/**
 * Make sure these font queries are on disk; copy them into renderDir/fonts and return @font-face CSS
 * pointing there. Returns '' when a font cannot be fetched (the page then uses Google Fonts links).
 */
export async function localFontsCss(queries, renderDir) {
  try {
    const all = [];
    for (const q of [...new Set(queries)]) all.push(...(await fetchQuery(q)));
    if (!all.length) return '';
    if (renderDir) {
      await fs.mkdir(path.join(renderDir, 'fonts'), { recursive: true });
      for (const f of all) {
        const dst = path.join(renderDir, 'fonts', f.file);
        if (!(await exists(dst))) await fs.copyFile(path.join(FONTS_DIR(), f.file), dst);
      }
    }
    return all.map((f) => `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};src:url('./fonts/${f.file}') format('truetype');font-display:block;}`).join('\n');
  } catch (e) {
    console.log(`local fonts unavailable (${e.message}); using Google Fonts links`);
    return '';
  }
}

/** Fonts the subtitle layer needs (Latin + the honorific glyph + Urdu). */
export async function ensureCaptionFonts() {
  for (const q of ['Inter:wght@600;700', 'Amiri:wght@400;700', 'Noto Nastaliq Urdu:wght@400;700']) {
    await fetchQuery(q).catch((e) => console.log(`caption font ${q} not downloaded: ${e.message}`));
  }
  return FONTS_DIR();
}
