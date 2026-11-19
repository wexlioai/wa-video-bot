// Component library: every scene Claude designs that passes review is kept (data/library/), with
// versions, a thumbnail and a score. Next time, the designer starts from the closest component and
// adapts it instead of writing a scene from scratch; an adapted scene that scores at least as well
// becomes the component's next version. Seeded with the hand-made examples in styles/examples/.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg, ROOT } from './config.js';
import { readJson, writeJson, exists } from './util.js';

const LIB = () => path.join(cfg.dataDir, 'library');
const INDEX = () => path.join(LIB(), 'index.json');
const slug = (s) => String(s || 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'scene';

async function loadIndex() { return readJson(INDEX()).catch(() => ({ components: [] })); }
async function saveIndex(idx) { await fs.mkdir(LIB(), { recursive: true }); await writeJson(INDEX(), idx); }

/** First-line header written by the designer: <!-- component: new | name | kind | description --> or <!-- component: <id> | adapted --> */
export function parseHeader(text) {
  const m = String(text).match(/<!--\s*component:\s*([^>]*?)-->/i);
  if (!m) return { from: null, isNew: true, name: null, kind: null, description: null };
  const parts = m[1].split('|').map((x) => x.trim());
  if (parts[0].toLowerCase() === 'new') return { from: null, isNew: true, name: parts[1] || null, kind: parts[2] || null, description: parts[3] || null };
  return { from: parts[0], isNew: false };
}

/** Put the repo's example scenes into the library once. */
export async function seedLibrary() {
  const idx = await loadIndex();
  const dir = path.join(ROOT, 'styles', 'examples');
  for (const f of await fs.readdir(dir).catch(() => [])) {
    if (!f.endsWith('.html')) continue;
    const text = await fs.readFile(path.join(dir, f), 'utf8');
    const h = parseHeader(text);
    const id = `ex-${slug(f.replace(/\.html$/, ''))}`;
    if (idx.components.some((c) => c.id === id)) continue;
    const meta = text.match(/<!--\s*meta:\s*(\{[\s\S]*?\})\s*-->/);
    const extra = meta ? JSON.parse(meta[1]) : {};
    await fs.mkdir(path.join(LIB(), id), { recursive: true });
    await fs.writeFile(path.join(LIB(), id, 'v1.html'), text);
    idx.components.push({
      id, name: h.name || extra.name || f, kind: h.kind || extra.kind || 'scene', description: h.description || extra.description || '',
      style: extra.style || null, niche: extra.niche || 'islamic', version: 1, score: 5, uses: 0, source: 'example', updated: new Date().toISOString(),
    });
  }
  await saveIndex(idx);
  return idx;
}

/**
 * Copy the most relevant components into _ref/library/ for the designer.
 * Same style first, then the same niche; best scores first. Returns how many match the style.
 */
export async function prepareLibraryRefs(jobDir, { niche, style, limit = 40 }) {
  const idx = await seedLibrary();
  const ref = path.join(jobDir, '_ref', 'library');
  await fs.rm(ref, { recursive: true, force: true });
  await fs.mkdir(ref, { recursive: true });
  const rank = (c) => (c.style === style ? 2 : 0) + (c.niche === niche ? 1 : 0) + (c.score || 0) / 10 + Math.min(c.uses || 0, 20) / 200;
  const pick = idx.components.filter((c) => (c.niche || 'general') === niche || c.style === style).sort((a, b) => rank(b) - rank(a)).slice(0, limit);
  const list = [];
  for (const c of pick) {
    const src = path.join(LIB(), c.id, `v${c.version}.html`);
    if (!(await exists(src))) continue;
    await fs.copyFile(src, path.join(ref, `${c.id}.html`));
    const thumb = path.join(LIB(), c.id, 'thumb.jpg');
    if (await exists(thumb)) await fs.copyFile(thumb, path.join(ref, `${c.id}.jpg`));
    list.push({ id: c.id, name: c.name, kind: c.kind, description: c.description, style: c.style, version: c.version, score: c.score, uses: c.uses, file: `_ref/library/${c.id}.html`, thumb: (await exists(thumb)) ? `_ref/library/${c.id}.jpg` : null });
  }
  await writeJson(path.join(ref, 'index.json'), { _note: 'Scene components to start from. Copy the closest one into scenes/<id>.html and adapt it; only write a new scene when none fits.', components: list });
  return { total: list.length, sameStyle: list.filter((c) => c.style === style).length };
}

/**
 * After review: keep every scene that scored >= 4. New scenes become components; adapted scenes that
 * score at least as well as their source become its next version. scores: {sceneId: number}.
 */
export async function harvest(job, { plan, look, scores, thumbs = {} }) {
  const idx = await seedLibrary();
  const out = { added: [], improved: [], used: [] };
  for (const s of plan.scenes) {
    const file = path.join(job.dir, 'scenes', `${s.id}.html`);
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (!text) continue;
    const score = Number(scores[s.id]);
    const h = parseHeader(text);
    const base = h.from ? idx.components.find((c) => c.id === h.from) : null;
    if (base) { base.uses = (base.uses || 0) + 1; out.used.push(base.id); }
    if (!(score >= 4)) continue;
    const thumb = thumbs[s.id];
    if (base) {
      if (score >= (base.score || 0)) {
        base.version += 1;
        base.score = score;
        base.updated = new Date().toISOString();
        await fs.writeFile(path.join(LIB(), base.id, `v${base.version}.html`), text);
        if (thumb) await fs.copyFile(thumb, path.join(LIB(), base.id, 'thumb.jpg')).catch(() => {});
        out.improved.push(base.id);
      }
      continue;
    }
    const name = h.name || `${s.section || s.visual?.type || 'scene'} scene`;
    const id = `${slug(name)}-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 6)}`;
    if (idx.components.some((c) => c.id === id)) continue;
    await fs.mkdir(path.join(LIB(), id), { recursive: true });
    await fs.writeFile(path.join(LIB(), id, 'v1.html'), text);
    if (thumb) await fs.copyFile(thumb, path.join(LIB(), id, 'thumb.jpg')).catch(() => {});
    idx.components.push({
      id, name, kind: h.kind || s.section || s.visual?.type || 'scene', description: h.description || String(s.narration).slice(0, 120),
      style: look.style, niche: look.niche || 'general', version: 1, score, uses: 1, source: job.id, updated: new Date().toISOString(),
    });
    out.added.push(id);
  }
  await saveIndex(idx);
  return out;
}

export async function librarySize(niche) {
  const idx = await loadIndex();
  return idx.components.filter((c) => !niche || c.niche === niche).length;
}
