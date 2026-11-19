// "Basic" style: animated HyperFrames versions of the plan's 7 visual types. It is the bridge until
// the motion designer (Claude writing each scene, chunk 3) takes over, and stays as the safe fallback
// for any designed scene that fails its checks. Output: { body, css, js } for compose.sceneHtml().
import { esc, readable } from './compose.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Font size that shrinks for long text. */
const fit = (text, base, refLen) => Math.round(base * clamp(Math.sqrt(refLen / Math.max(1, String(text).length)), 0.5, 1));
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Words wrapped for a masked rise: <span class="wm"><span class="w">word</span></span> */
const maskWords = (text, cls = '') => String(text).split(/\s+/).filter(Boolean)
  .map((w) => `<span class="wm"><span class="w ${cls}">${esc(w)}</span></span>`).join(' ');

/** When (seconds) is `phrase` first spoken at/after `from`? Uses the voice's word timings. */
function spokenAt(words, phrase, from = 0) {
  const keys = String(phrase).split(/\s+/).map(norm).filter((k) => k.length > 2).slice(0, 3);
  if (!keys.length || !words?.length) return null;
  for (const w of words) {
    if (w.start < from) continue;
    if (keys.includes(norm(w.text))) return w.start;
  }
  return null;
}

function backdrop(theme, portrait) {
  const big = portrait ? 1100 : 1200;
  return {
    html: `<div class="bd"><div class="blob b1"></div><div class="blob b2"></div><div class="grain"></div></div>`,
    css: `
  .bd { position:absolute; inset:0; background:linear-gradient(160deg, ${theme.bg} 0%, ${theme.bg2} 100%); }
  .blob { position:absolute; border-radius:50%; filter:blur(2px); }
  .b1 { width:${big}px; height:${big}px; left:-${big * 0.35}px; top:-${big * 0.45}px; background:${theme.primary}; opacity:.10; }
  .b2 { width:${big * 0.7}px; height:${big * 0.7}px; right:-${big * 0.25}px; bottom:-${big * 0.3}px; background:${theme.accent}; opacity:.10; }
  .grain { position:absolute; inset:0; background-image:radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px); background-size:6px 6px; }`,
    js: `
tl.fromTo('.b1', { x: 0, y: 0 }, { x: PORTRAIT ? 60 : 140, y: PORTRAIT ? 120 : 60, duration: D, ease: 'sine.inOut' }, 0);
tl.fromTo('.b2', { x: 0, y: 0, scale: 0.92 }, { x: PORTRAIT ? -60 : -120, y: -50, scale: 1.05, duration: D, ease: 'sine.inOut' }, 0);`,
  };
}

const BASE_CSS = (portrait, lang) => `
  .wrap { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; align-items:${lang === 'ur' ? 'flex-end' : 'flex-start'};
    padding:${portrait ? '220px 90px 600px' : '120px 190px 230px'}; box-sizing:border-box; gap:${portrait ? 40 : 34}px; }
  .wrap.center { align-items:center; text-align:center; }
  .wm { display:inline-block; overflow:hidden; vertical-align:bottom; padding-bottom:.08em; margin-bottom:-.08em; }
  .w { display:inline-block; }
  .hd { font-family:var(--fh), var(--fb), sans-serif; font-weight:800; line-height:${lang === 'ur' ? 1.8 : 1.08}; letter-spacing:${lang === 'ur' ? 0 : -1}px; margin:0; }`;

// ------------------------------------------------------------------ the 7 types
const TYPES = {
  title(v, { theme, portrait }) {
    const size = fit(v.heading, portrait ? 120 : 132, 22);
    return {
      body: `<div class="wrap center"><div class="kbar"></div><h1 class="hd ttl" style="font-size:${size}px">${maskWords(v.heading)}</h1>${
        v.subheading ? `<div class="sub" style="font-size:${fit(v.subheading, portrait ? 56 : 54, 40)}px">${esc(v.subheading)}</div>` : ''}</div>`,
      css: `.kbar { width:${portrait ? 160 : 200}px; height:12px; border-radius:6px; background:${theme.accent}; transform-origin:50% 50%; }
  .sub { opacity:.85; max-width:${portrait ? 900 : 1300}px; line-height:1.35; }`,
      js: `
tl.from('.kbar', { scaleX: 0, duration: 0.6 * E, ease: 'power3.inOut' }, 0.1);
tl.from('.ttl .w', { yPercent: 115, duration: 0.75 * E, ease: 'power4.out', stagger: 0.07 * E }, 0.2);
tl.from('.sub', { y: 30, opacity: 0, duration: 0.6 * E, ease: 'power2.out' }, 0.75);
tl.fromTo('.wrap', { scale: 1 }, { scale: 1.035, duration: D, ease: 'none' }, 0);`,
    };
  },

  statement(v, { theme, portrait }) {
    const hl = new Set(String(v.highlight || '').split(/\s+/).map(norm).filter(Boolean));
    const size = fit(v.text, portrait ? 98 : 104, 45);
    const words = String(v.text).split(/\s+/).filter(Boolean).map((w) =>
      hl.has(norm(w))
        ? `<span class="wm"><span class="w hlw">${esc(w)}<i class="mk"></i></span></span>`
        : `<span class="wm"><span class="w">${esc(w)}</span></span>`).join(' ');
    return {
      body: `<div class="wrap"><p class="hd stm" style="font-size:${size}px">${words}</p></div>`,
      css: `.stm { max-width:${portrait ? 920 : 1500}px; font-weight:700; }
  .hlw { position:relative; color:${readable(theme.bg, [theme.accent, theme.primary], 3)}; }
  .mk { position:absolute; left:-4px; right:-4px; bottom:.1em; height:.3em; background:${theme.accent}; opacity:.28; border-radius:6px; transform:scaleX(0); transform-origin:${'0%'} 50%; z-index:-1; }`,
      js: `
const n = $$('.stm .w').length;
tl.from('.stm .w', { yPercent: 110, duration: 0.6 * E, ease: 'power3.out', stagger: Math.min(0.09, (D * 0.35) / Math.max(1, n)) * E }, 0.15);
tl.to('.mk', { scaleX: 1, duration: 0.5 * E, ease: 'power2.inOut', stagger: 0.15 }, Math.min(D * 0.45, 0.4 + n * 0.08));`,
    };
  },

  bullets(v, { theme, portrait, words, lang }) {
    const items = v.items.slice(0, 6);
    const longest = Math.max(...items.map((x) => x.length), 10);
    const size = fit('x'.repeat(longest), portrait ? 62 : 58, 34);
    let from = 0;
    const times = items.map((it, i) => {
      const t = spokenAt(words, it, from);
      if (t != null) { from = t + 0.2; return Math.max(0.3, t - 0.15); }
      return null;
    });
    const D0 = words?.length ? words[words.length - 1].end : 6;
    const gap = clamp((D0 * 0.7) / items.length, 0.45, 2.6);
    const at = times.map((t, i) => (t != null ? t : 0.6 + i * gap));
    for (let i = 1; i < at.length; i++) if (at[i] < at[i - 1] + 0.25) at[i] = at[i - 1] + 0.25; // keep order
    return {
      body: `<div class="wrap">${v.heading ? `<h2 class="hd bh" style="font-size:${fit(v.heading, portrait ? 80 : 78, 26)}px">${maskWords(v.heading)}</h2>` : ''}
<div class="list">${items.map((it, i) => `<div class="item" id="it${i}"><span class="dot"><b>${i + 1}</b></span><span class="txt" style="font-size:${size}px">${esc(it)}</span></div>`).join('')}</div></div>`,
      css: `.bh { color:${readable(theme.bg, [theme.accent, theme.primary], 3)}; }
  .list { display:flex; flex-direction:column; gap:${portrait ? 30 : 24}px; }
  .item { display:flex; align-items:center; gap:${portrait ? 30 : 28}px; ${lang === 'ur' ? 'flex-direction:row-reverse;' : ''} }
  .dot { flex:none; width:${portrait ? 78 : 70}px; height:${portrait ? 78 : 70}px; border-radius:50%; background:${theme.primary}; color:${readable(theme.primary, ['#ffffff', theme.bg], 3)};
    display:grid; place-items:center; font-weight:800; font-size:${portrait ? 36 : 32}px; }
  .txt { font-weight:600; line-height:${lang === 'ur' ? 1.8 : 1.25}; }`,
      js: `
if ($('.bh')) tl.from('.bh .w', { yPercent: 110, duration: 0.6 * E, ease: 'power3.out', stagger: 0.06 * E }, 0.1);
const AT = ${JSON.stringify(at.map((t) => +t.toFixed(2)))};
AT.forEach((t, i) => {
  tl.from('#it' + i + ' .dot', { scale: 0, duration: 0.45 * E, ease: 'back.out(2.2)' }, t);
  tl.from('#it' + i + ' .txt', { x: RTL ? 60 : -60, opacity: 0, duration: 0.55 * E, ease: 'power3.out' }, t + 0.08);
  if (i > 0) tl.to('#it' + (i - 1), { opacity: 0.55, duration: 0.4 }, t);
});`,
    };
  },

  bignumber(v, { theme, portrait }) {
    const m = String(v.value).match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
    const prefix = m ? m[1] : '';
    const num = m ? Number(m[2].replace(/,/g, '')) : null;
    const suffix = m ? m[3] : '';
    const dec = m && m[2].includes('.') ? m[2].split('.')[1].length : 0;
    const commas = !!(m && m[2].includes(','));
    const size = fit(v.value, portrait ? 230 : 200, 6);
    const R = portrait ? 380 : 290;
    return {
      body: `<div class="wrap center"><div class="ringbox"><svg class="ring" viewBox="0 0 ${R * 2 + 40} ${R * 2 + 40}"><circle cx="${R + 20}" cy="${R + 20}" r="${R}" /></svg>
<div class="num" style="font-size:${size}px">${esc(prefix)}<span id="nv">${num == null ? esc(v.value) : 0}</span>${esc(suffix)}</div></div>
<div class="lbl" style="font-size:${fit(v.label, portrait ? 62 : 58, 35)}px">${esc(v.label)}</div></div>`,
      css: `.ringbox { position:relative; display:grid; place-items:center; width:${R * 2 + 40}px; height:${R * 2 + 40}px; margin:-${portrait ? 40 : 30}px 0; }
  .ring { position:absolute; inset:0; width:100%; height:100%; transform:rotate(-90deg); }
  .ring circle { fill:none; stroke:${theme.accent}; stroke-width:14; stroke-linecap:round; opacity:.9; }
  .num { position:relative; font-family:var(--fh), var(--fb), sans-serif; font-weight:800; color:${readable(theme.bg, [theme.primary, theme.accent], 3)}; letter-spacing:-2px; }
  .lbl { font-weight:600; max-width:${portrait ? 900 : 1300}px; line-height:1.3; }`,
      js: `
const C = 2 * Math.PI * ${R};
tl.fromTo('.ring circle', { strokeDasharray: C, strokeDashoffset: C }, { strokeDashoffset: 0, duration: 1.4 * E, ease: 'power2.inOut' }, 0.1);
tl.from('.num', { scale: 0.6, opacity: 0, duration: 0.6 * E, ease: 'back.out(1.8)' }, 0.2);
${num == null ? '' : `const o = { v: 0 };
tl.to(o, { v: ${num}, duration: Math.min(1.8, D * 0.4) * E, ease: 'power2.out', onUpdate: () => {
  const s = o.v.toFixed(${dec});
  $('#nv').textContent = ${commas} ? Number(s).toLocaleString('en-US', { minimumFractionDigits: ${dec}, maximumFractionDigits: ${dec} }) : s;
} }, 0.3);`}
tl.from('.lbl', { y: 30, opacity: 0, duration: 0.6 * E, ease: 'power2.out' }, 0.9);`,
    };
  },

  quote(v, { theme, portrait, lang }) {
    const size = fit(v.text, portrait ? 76 : 78, 70);
    return {
      body: `<div class="wrap center"><div class="qm">“</div><p class="qt" style="font-size:${size}px">${maskWords(v.text)}</p>${
        v.author ? `<div class="qa"><span class="ql"></span>${esc(v.author)}</div>` : ''}</div>`,
      css: `.qm { font-family:Georgia, serif; font-size:${portrait ? 320 : 300}px; line-height:.6; height:${portrait ? 150 : 140}px; color:${theme.accent}; }
  .qt { margin:0; font-weight:600; ${lang === 'ur' ? '' : 'font-style:italic;'} line-height:${lang === 'ur' ? 1.9 : 1.3}; max-width:${portrait ? 920 : 1450}px; }
  .qa { display:flex; align-items:center; gap:20px; font-size:${portrait ? 48 : 44}px; font-weight:600; color:${readable(theme.bg, [theme.primary, theme.accent], 3)}; }
  .ql { display:inline-block; width:70px; height:6px; border-radius:3px; background:currentColor; transform-origin:0 50%; }`,
      js: `
tl.from('.qm', { scale: 0, rotation: -14, duration: 0.7 * E, ease: 'back.out(2)' }, 0.05);
const n = $$('.qt .w').length;
tl.from('.qt .w', { yPercent: 110, opacity: 0, duration: 0.55 * E, ease: 'power3.out', stagger: Math.min(0.08, (D * 0.4) / Math.max(1, n)) * E }, 0.35);
if ($('.qa')) { tl.from('.ql', { scaleX: 0, duration: 0.5 * E, ease: 'power2.out' }, Math.min(D * 0.6, 0.6 + n * 0.08)); tl.from('.qa', { opacity: 0, x: -20, duration: 0.5 * E }, Math.min(D * 0.6, 0.6 + n * 0.08)); }`,
    };
  },

  compare(v, { theme, portrait, lang }) {
    const card = (side, k, color) => `<div class="card c${k}"><div class="ct" style="background:${color};color:${readable(color, ['#ffffff', '#111111'], 4.5)}">${esc(side.title)}</div>
<ul>${(side.items || []).slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    return {
      body: `<div class="wrap center"><div class="cmp">${card(v.left, 0, theme.primary)}<div class="vs">VS</div>${card(v.right, 1, theme.accent)}</div></div>`,
      css: `.cmp { display:flex; ${portrait ? 'flex-direction:column;' : ''} align-items:stretch; gap:${portrait ? 34 : 50}px; width:100%; ${lang === 'ur' && !portrait ? 'flex-direction:row-reverse;' : ''} }
  .card { flex:1; background:rgba(255,255,255,.72); border-radius:34px; overflow:hidden; box-shadow:0 18px 50px rgba(0,0,0,.10); text-align:${lang === 'ur' ? 'right' : 'left'}; }
  .ct { padding:${portrait ? '26px 40px' : '30px 46px'}; font-size:${portrait ? 54 : 52}px; font-weight:800; }
  .card ul { margin:0; padding:${portrait ? '24px 40px 30px' : '30px 46px 36px'}; list-style:none; display:flex; flex-direction:column; gap:16px; }
  .card li { font-size:${portrait ? 44 : 40}px; font-weight:600; line-height:${lang === 'ur' ? 1.8 : 1.3}; color:#1d1d1d; }
  .vs { align-self:center; flex:none; width:${portrait ? 110 : 120}px; height:${portrait ? 110 : 120}px; border-radius:50%; background:${theme.text}; color:${theme.bg};
    display:grid; place-items:center; font-weight:800; font-size:40px; ${portrait ? 'margin:-60px 0; z-index:2;' : ''} }`,
      js: `
tl.from('.c0', { x: PORTRAIT ? 0 : -120, y: PORTRAIT ? -80 : 0, opacity: 0, duration: 0.7 * E, ease: 'power3.out' }, 0.15);
tl.from('.c1', { x: PORTRAIT ? 0 : 120, y: PORTRAIT ? 80 : 0, opacity: 0, duration: 0.7 * E, ease: 'power3.out' }, 0.35);
tl.from('.vs', { scale: 0, rotation: -90, duration: 0.6 * E, ease: 'back.out(2.2)' }, 0.7);
tl.from('.c0 li', { opacity: 0, y: 16, duration: 0.4 * E, stagger: Math.min(0.5, D * 0.12) }, 0.9);
tl.from('.c1 li', { opacity: 0, y: 16, duration: 0.4 * E, stagger: Math.min(0.5, D * 0.12) }, 0.9 + Math.min(D * 0.3, 1.6));`,
    };
  },

  bars(v, { theme, portrait, lang }) {
    const bars = v.bars.slice(0, 6);
    const max = Math.max(...bars.map((b) => b.value), 1);
    const unit = v.unit || '';
    const fill = (i) => (i % 2 ? theme.accent : theme.primary);
    return {
      body: `<div class="wrap">${v.heading ? `<h2 class="hd bh" style="font-size:${fit(v.heading, portrait ? 76 : 74, 26)}px">${maskWords(v.heading)}</h2>` : ''}
<div class="rows">${bars.map((b, i) => `<div class="row" id="r${i}"><div class="rl">${esc(b.label)}</div><div class="track"><div class="fill" style="width:${(100 * b.value / max).toFixed(1)}%;background:${fill(i)}"></div></div><div class="rv"><span id="v${i}">0</span>${esc(unit)}</div></div>`).join('')}</div></div>`,
      css: `.rows { width:100%; display:flex; flex-direction:column; gap:${portrait ? 34 : 26}px; }
  .row { display:grid; grid-template-columns:${portrait ? '1fr' : '360px 1fr 200px'}; ${portrait ? 'grid-template-areas:"l v" "t t"; grid-template-columns:1fr auto;' : ''} align-items:center; gap:${portrait ? '10px 20px' : '30px'}; direction:${lang === 'ur' ? 'rtl' : 'ltr'}; }
  .rl { font-size:${portrait ? 44 : 40}px; font-weight:600; ${portrait ? 'grid-area:l;' : ''} }
  .track { height:${portrait ? 46 : 52}px; border-radius:26px; background:rgba(0,0,0,.07); overflow:hidden; ${portrait ? 'grid-area:t;' : ''} }
  .fill { height:100%; border-radius:26px; transform-origin:${lang === 'ur' ? '100%' : '0%'} 50%; }
  .rv { font-size:${portrait ? 46 : 44}px; font-weight:800; ${portrait ? 'grid-area:v;' : ''} }`,
      js: `
if ($('.bh')) tl.from('.bh .w', { yPercent: 110, duration: 0.6 * E, ease: 'power3.out', stagger: 0.06 * E }, 0.1);
const V = ${JSON.stringify(bars.map((b) => b.value))};
const step = Math.min(0.45, (D * 0.5) / V.length);
V.forEach((val, i) => {
  const t = 0.4 + i * step;
  tl.from('#r' + i, { opacity: 0, y: 20, duration: 0.4 * E }, t);
  tl.from('#r' + i + ' .fill', { scaleX: 0, duration: 0.9 * E, ease: 'power3.out' }, t + 0.1);
  const o = { v: 0 }, dec = String(val).includes('.') ? String(val).split('.')[1].length : 0;
  tl.to(o, { v: val, duration: 0.9 * E, ease: 'power3.out', onUpdate: () => { $('#v' + i).textContent = o.v.toFixed(dec); } }, t + 0.1);
});`,
    };
  },
};

/** Design { body, css, js, fonts } for one plan scene. */
export function basicDesign(visual, { theme, format, lang, words, look }) {
  const portrait = format === 'short';
  const make = TYPES[visual?.type] || TYPES.statement;
  const v = TYPES[visual?.type] ? visual : { type: 'statement', text: visual?.text || visual?.heading || '' };
  const bd = backdrop(theme, portrait);
  const d = make(v, { theme, portrait, lang, words });
  const fonts = look?.fonts?.heading?.query
    ? [look.fonts.heading.query, look.fonts.body.query]
    : ['Poppins:wght@400;600;700;800'];
  return {
    fonts,
    families: look?.fonts?.heading ? { heading: look.fonts.heading.family, body: look.fonts.body.family } : { heading: 'Poppins', body: 'Poppins' },
    body: `${bd.html}\n${d.body}`,
    css: `${bd.css}\n${BASE_CSS(portrait, lang)}\n  ${d.css}`,
    js: `${bd.js}\n${d.js}`,
  };
}
