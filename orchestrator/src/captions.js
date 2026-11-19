// Subtitles as a separate layer (ASS file burned in by FFmpeg/libass at the end), not part of the scene
// renders: changing subtitles never re-renders scenes, lines break at phrases, colours follow the look,
// and the spoken word is highlighted.
import { readable, contrast } from './compose.js';

const SIZE = { long: { S: 40, M: 50, L: 62, XL: 76 }, short: { S: 52, M: 62, L: 76, XL: 92 } };
const CHARS = { long: { S: 52, M: 42, L: 34, XL: 27 }, short: { S: 30, M: 25, L: 20, XL: 16 } };

/** #rrggbb + alpha(0 opaque..255) → ASS &HAABBGGRR */
function ass(hex, alpha = 0) {
  const n = String(hex || '#ffffff').replace('#', '');
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${n.slice(4, 6)}${n.slice(2, 4)}${n.slice(0, 2)}`.toUpperCase();
}
const t = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const escText = (s) => String(s).replace(/[{}]/g, '').replace(/\\/g, '');

/** Break timed words into lines at phrases: sentence ends always, commas/semicolons when the line is long enough. */
export function phraseLines(words, format, size) {
  const max = CHARS[format][size];
  const lines = [];
  let cur = [];
  let len = 0;
  for (const w of words) {
    if (cur.length && len + w.text.length + 1 > max) { lines.push(cur); cur = []; len = 0; }
    cur.push(w);
    len += w.text.length + 1;
    if (/[.!?؟۔]$/.test(w.text) || (/[,;:،]$/.test(w.text) && len > max * 0.55)) { lines.push(cur); cur = []; len = 0; }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/**
 * scenes: [{offset, words}] (absolute seconds). Returns the .ass text, or '' when captions are off.
 * Glyph ﷺ is set in Amiri (Inter has no glyph for it); Urdu uses Noto Nastaliq Urdu.
 */
export function buildAss({ scenes, format, settings, theme, lang }) {
  const c = settings.captions;
  if (c.position === 'off') return '';
  const [W, H] = format === 'short' ? [1080, 1920] : [1920, 1080];
  const px = Math.round(SIZE[format][c.size] * (lang === 'ur' ? 1.05 : 1));
  const font = lang === 'ur' ? 'Noto Nastaliq Urdu' : 'Inter';
  const boxed = c.style !== 'highlight';
  const box = '#ffffff';
  const ink = boxed ? '#151515' : '#ffffff';
  const hl = c.style === 'plain' ? ink : boxed
    ? readable(box, [theme.accent, theme.primary, '#B4400F'], 3)
    : readable('#111111', [theme.accent, theme.primary, '#FFD166'], 4.5);
  const portrait = format === 'short';
  const align = { bottom: 2, middle: 5, top: 8 }[c.position] || 2;
  const marginV = c.position === 'top' ? (portrait ? 250 : 120) : c.position === 'bottom' ? (portrait ? 390 : 70) : 0;
  // BorderStyle 3 = opaque box (Outline = padding); 1 = outline + shadow
  const style = boxed
    ? `Style: Cap,${font},${px},${ass(ink)},${ass(ink)},${ass(box, 0x14)},${ass('#000000', 0xB0)},-1,0,0,0,100,100,0,0,3,${Math.round(px * 0.28)},0,${align},60,60,${marginV},1`
    : `Style: Cap,${font},${px},${ass(ink)},${ass(ink)},${ass('#000000', 0x30)},${ass('#000000', 0x80)},-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(px * 0.07))},${Math.round(px * 0.06)},${align},60,60,${marginV},1`;
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${style}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const word = (w, on) => {
    let txt = escText(w.text).replace(/ﷺ/g, '{\\fnAmiri}ﷺ{\\fn' + font + '}');
    if (on && hl !== ink) txt = `{\\c${ass(hl)}}${txt}{\\c${ass(ink)}}`;
    return txt;
  };
  const events = [];
  for (const s of scenes) {
    const lines = phraseLines((s.words || []).filter((w) => w.text), format, c.size);
    lines.forEach((ln, i) => {
      const start = s.offset + ln[0].start;
      const lineEnd = s.offset + (lines[i + 1]?.[0].start ?? ln[ln.length - 1].end + 0.5);
      // one event per word so the spoken word is highlighted
      ln.forEach((w, k) => {
        const a = k === 0 ? start : s.offset + w.start;
        const b = k === ln.length - 1 ? lineEnd : s.offset + ln[k + 1].start;
        if (b - a < 0.02) return;
        events.push(`Dialogue: 0,${t(a)},${t(b)},Cap,,0,0,0,,${ln.map((x, j) => word(x, j === k)).join(' ')}`);
      });
    });
  }
  return head + events.join('\n') + '\n';
}

export { contrast };
