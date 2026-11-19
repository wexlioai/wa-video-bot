// Ready-made SVG props (styles/props/<niche>/): scenes write <prop name="wax-seal" class="x" style="…" text="1 AH"></prop>
// and we swap in the SVG, so maps, seals, documents… look the same in every video and cost Claude no tokens.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const cache = new Map();
function catalog(niche) {
  if (!cache.has(niche)) {
    const dir = path.join(ROOT, 'styles', 'props', niche);
    let props = {};
    try { props = JSON.parse(fs.readFileSync(path.join(dir, 'props.json'), 'utf8')).props; } catch { props = {}; }
    const svgs = {};
    for (const [name, p] of Object.entries(props)) {
      try { svgs[name] = fs.readFileSync(path.join(dir, p.file), 'utf8'); } catch { /* missing file */ }
    }
    cache.set(niche, { props, svgs });
  }
  return cache.get(niche);
}

export const hasProps = (niche) => Object.keys(catalog(niche).svgs).length > 0;

const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((m) => [m[1], m[3] ?? m[4]]));
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Replace <prop …></prop> / <prop … /> tags with their SVG. Unknown names are reported. */
export function expandProps(html, niche, sceneId = 's') {
  const { props, svgs } = catalog(niche);
  const unknown = [];
  let n = 0;
  const out = String(html).replace(/<prop\b([^>]*?)(?:\/>|>\s*<\/prop>)/gi, (_, a) => {
    const at = attrsOf(a);
    const svg = svgs[at.name];
    if (!svg) { unknown.push(at.name || '(no name)'); return ''; }
    n++;
    const params = { ...(props[at.name]?.params || {}), id: `${sceneId}-${n}` };
    for (const k of Object.keys(params)) if (at[k] != null) params[k] = at[k];
    let s = svg.replace(/\{\{(\w+)\}\}/g, (m, k) => escText(params[k] ?? ''));
    const cls = `prop prop-${at.name}${at.class ? ` ${escAttr(at.class)}` : ''}`;
    s = s.replace(/^<svg class="[^"]*"/, `<svg class="${cls}"${at.style ? ` style="${escAttr(at.style)}"` : ''}${at.id ? ` id="${escAttr(at.id)}"` : ''}`);
    return s;
  });
  return { html: out, unknown };
}
