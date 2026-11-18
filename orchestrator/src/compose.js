// Builds one HyperFrames composition (index.html) per scene.
//
// A scene's own design is { body, css, js } — written by the motion designer (Claude, chunk 3) or,
// until then, by the built-in "basic" style below (from the plan's visual type). The wrapper adds
// what every scene shares and what settings.json controls: canvas, fonts, palette variables,
// the voice track and the captions. So a quick tweak (bigger subtitles…) never needs Claude.
//
// Scene JS runs with: tl (paused GSAP timeline), D (scene seconds), W, H, PORTRAIT, T (theme
// colours), LANG, RTL, E (motion energy multiplier for durations), $ / $$ (scoped querySelector).

export const FORMATS = { long: { w: 1920, h: 1080 }, short: { w: 1080, h: 1920 } };
const ENERGY = { calm: 1.35, normal: 1, lively: 0.75 };
// the look's motion personality also sets the base pace
const PERSONALITY = { gentle: 1.2, crisp: 0.9, playful: 1, cinematic: 1.3 };

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ colour helpers
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** First colour from candidates with enough contrast on bg, else black/white. */
export function readable(bg, candidates, min = 3) {
  for (const c of candidates) if (c && contrast(c, bg) >= min) return c;
  return contrast('#111111', bg) >= contrast('#ffffff', bg) ? '#111111' : '#ffffff';
}
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;

// ------------------------------------------------------------------ captions
const CAP_PX = { long: { S: 38, M: 48, L: 60, XL: 74 }, short: { S: 50, M: 60, L: 74, XL: 90 } };
const CAP_CHARS = { long: { S: 52, M: 42, L: 34, XL: 27 }, short: { S: 30, M: 25, L: 20, XL: 16 } };

/** Split timed words into caption lines that fit the chosen size. */
export function captionLines(words, format, size) {
  const max = CAP_CHARS[format][size];
  const lines = [];
  let cur = [];
  let len = 0;
  for (const w of words) {
    if (cur.length && len + w.text.length + 1 > max) { lines.push(cur); cur = []; len = 0; }
    cur.push(w);
    len += w.text.length + 1;
    if (/[.!?؟۔]$/.test(w.text)) { lines.push(cur); cur = []; len = 0; }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function captionsLayer({ words, format, settings, theme, lang, duration }) {
  const c = settings.captions;
  if (c.position === 'off' || !words?.length) return { html: '', css: '', js: '' };
  const lines = captionLines(words.filter((w) => w.start < duration), format, c.size);
  const px = CAP_PX[format][c.size] * (lang === 'ur' ? 1.05 : 1);
  const portrait = format === 'short';
  // Shorts: keep clear of YouTube's own buttons and title at the bottom
  const place = {
    bottom: `top:auto;bottom:${portrait ? 380 : 70}px;`,
    top: `bottom:auto;top:${portrait ? 230 : 64}px;`,
    middle: 'bottom:auto;top:50%;transform:translateY(-50%);',
  }[c.position];
  const boxBg = '#ffffff';
  const hlOnBox = readable(boxBg, [theme.accent, theme.primary, '#B4400F'], 3);
  const hlOnVideo = readable('#111111', [theme.accent, theme.primary, '#FFD166'], 4.5);
  const boxed = c.style !== 'highlight';
  const ink = boxed ? '#151515' : '#ffffff';
  const hl = c.style === 'plain' ? ink : boxed ? hlOnBox : hlOnVideo;

  const html = lines.map((ln, i) => {
    const start = ln[0].start;
    const end = Math.min(duration, lines[i + 1]?.[0].start ?? ln[ln.length - 1].end + 0.6);
    return `<div id="cap${i}" class="clip cap" data-start="${start.toFixed(3)}" data-duration="${Math.max(0.15, end - start).toFixed(3)}" data-track-index="9"><div class="capin">${
      ln.map((w, j) => `<span id="cw${i}_${j}">${esc(w.text)}</span>`).join(' ')}</div></div>`;
  }).join('\n');
  const css = `
  .cap { position:absolute; left:0; right:0; ${place} height:auto; text-align:center; z-index:50; pointer-events:none; }
  .capin { display:inline-block; max-width:${portrait ? 940 : 1600}px; font-size:${px}px; font-weight:700; line-height:${lang === 'ur' ? 1.9 : 1.25};
    ${boxed ? `background:${rgba(boxBg, 0.93)}; border-radius:${Math.round(px * 0.38)}px; padding:${Math.round(px * 0.22)}px ${Math.round(px * 0.55)}px; box-shadow:0 8px 30px rgba(0,0,0,.18);` : 'text-shadow:0 3px 14px rgba(0,0,0,.75), 0 0 2px rgba(0,0,0,.9);'}
    color:${ink}; }
  .capin span { display:inline-block; }`;
  const js = [
    ...lines.map((ln, i) => `tl.from('#cap${i} .capin', { y: ${c.position === 'top' ? -14 : 14}, opacity: 0, duration: 0.16, ease: 'power2.out' }, ${ln[0].start.toFixed(3)});`),
    ...(hl === ink ? [] : lines.flatMap((ln, i) => ln.map((w, j) =>
      `tl.set('#cw${i}_${j}', { color: '${hl}' }, ${w.start.toFixed(3)}); tl.set('#cw${i}_${j}', { color: '${ink}' }, ${Math.min(w.end + 0.04, duration).toFixed(3)});`))),
  ].join('\n');
  return { html, css, js };
}

// ------------------------------------------------------------------ the wrapper
/**
 * scene: { id, duration, words, audio (file name beside index.html or null), design: {body, css, js, fonts?} }
 * fonts: Google Fonts css2 family query, e.g. 'Poppins:wght@400;600;800'
 */
export function sceneHtml({ scene, format, lang, theme, settings, motion }) {
  const { w, h } = FORMATS[format];
  const D = scene.duration;
  const rtl = lang === 'ur';
  const fam = scene.design.families || { heading: 'Poppins', body: 'Poppins' };
  const given = [scene.design.fonts || 'Poppins:wght@400;600;800'].flat();
  const fonts = [...new Set([...given, ...(rtl ? ['Noto Nastaliq Urdu:wght@400;700'] : [])])];
  const fontLink = `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${f.replace(/ /g, '+')}`).join('&')}&display=block`;
  const caps = captionsLayer({ words: scene.words, format, settings, theme, lang, duration: D });
  const vars = Object.entries(theme).map(([k, v]) => `--${k}:${v};`).join('');
  return `<!doctype html>
<html lang="${rtl ? 'ur' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="UTF-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="${fontLink}">
<script src="./gsap.min.js"></script>
<style>
  html, body { margin:0; background:${theme.bg}; }
  #root { position:relative; width:${w}px; height:${h}px; overflow:hidden; background:${theme.bg}; color:${theme.text}; ${vars}
    --fh:'${fam.heading}'; --fb:'${fam.body}';
    font-family:'${fam.body}', ${rtl ? "'Noto Nastaliq Urdu', " : ''}Poppins, 'Segoe UI', Arial, sans-serif; }
  .clip { position:absolute; inset:0; }
  #stage { overflow:hidden; }
  .sc { position:absolute; inset:0; overflow:hidden; }
  ${scene.design.css || ''}
  ${caps.css}
</style>
</head>
<body>
<div id="root" class="${format === 'short' ? 'portrait' : 'landscape'}" data-composition-id="scene" data-start="0" data-duration="${D.toFixed(3)}" data-width="${w}" data-height="${h}" data-fps="30">
<section id="stage" class="clip" data-start="0" data-duration="${D.toFixed(3)}" data-track-index="0">
${scene.design.body}
</section>
${caps.html}
${scene.audio ? `<audio id="voice" data-start="0" data-volume="1" src="./${scene.audio}"></audio>` : ''}
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
const D = ${D.toFixed(3)}, W = ${w}, H = ${h}, PORTRAIT = ${format === 'short'}, LANG = '${lang}', RTL = ${rtl}, E = ${((ENERGY[settings.motion.energy] || 1) * (PERSONALITY[motion] || 1)).toFixed(3)};
const T = ${JSON.stringify(theme)};
const WORDS = ${JSON.stringify((scene.words || []).map((w) => ({ text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3) })))};
const _n = (x) => String(x).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const at = (i) => (WORDS[Math.max(0, Math.min(WORDS.length - 1, i))] || { start: 0 }).start;
const when = (word, after = 0) => {
  const k = _n(word);
  const w = WORDS.find((x) => x.start >= after && (_n(x.text) === k || (k.length > 3 && _n(x.text).startsWith(k))));
  return w ? Math.max(0, w.start) : Math.min(Math.max(0, D - 0.6), after + 0.4);
};
const rand = (i) => { const x = Math.sin((i + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };
const $ = (s) => document.querySelector('#stage ' + s), $$ = (s) => Array.from(document.querySelectorAll('#stage ' + s));
try {
${scene.design.js || ''}
} catch (e) { console.error('scene animation error', e); }
${caps.js}
tl.set({}, {}, D);
window.__timelines.scene = tl;
</script>
</body>
</html>`;
}
