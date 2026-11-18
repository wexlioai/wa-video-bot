// Validates the plan.json that Claude writes. Keeping the video as data (not free-form
// code) means renders never break and edits only touch a few JSON fields.

const TYPES = {
  title: ['heading'],
  statement: ['text'],
  bullets: ['items'],
  bignumber: ['value', 'label'],
  quote: ['text'],
  compare: ['left', 'right'],
  bars: ['bars'],
};

const isHex = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

export function validatePlan(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['plan.json is not an object'];
  if (!['ur', 'en'].includes(p.language)) errs.push('language must be "ur" or "en"');
  if (!p.title || p.title.length > 100) errs.push('title missing or longer than 100 chars');
  if (typeof p.description !== 'string') errs.push('description missing');
  if (!Array.isArray(p.tags)) errs.push('tags must be an array');
  for (const k of ['bg', 'bg2', 'primary', 'accent', 'text']) {
    if (!isHex(p.theme?.[k])) errs.push(`theme.${k} must be a #rrggbb color`);
  }
  if (!Array.isArray(p.scenes) || p.scenes.length === 0) errs.push('scenes must be a non-empty array');
  const ids = new Set();
  (p.scenes || []).forEach((s, i) => {
    const where = `scenes[${i}]`;
    if (!s.id || ids.has(s.id)) errs.push(`${where}.id missing or duplicate`);
    ids.add(s.id);
    if (!s.narration || typeof s.narration !== 'string') errs.push(`${where}.narration missing`);
    else if (s.narration.length > 2500) errs.push(`${where}.narration too long (max 2500 chars, split the scene)`);
    const v = s.visual;
    if (!v || !TYPES[v.type]) errs.push(`${where}.visual.type must be one of ${Object.keys(TYPES).join(', ')}`);
    else for (const f of TYPES[v.type]) if (v[f] == null) errs.push(`${where}.visual.${f} missing for type ${v.type}`);
    if (v?.type === 'bullets' && (!Array.isArray(v.items) || v.items.length > 6)) errs.push(`${where}.visual.items must be 1-6 items`);
    if (v?.type === 'bars' && (!Array.isArray(v.bars) || v.bars.some((b) => typeof b.value !== 'number'))) errs.push(`${where}.visual.bars needs numeric values`);
  });
  return errs;
}
