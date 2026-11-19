// Retention overlay added to the joined video (not to scene clips, so scene caches stay valid):
// a thin progress line along the top edge and the video's sections ("FACTS · ISSUES · HOLDING · SOURCES")
// with the current one lit, so viewers always see where they are and what is still coming.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './util.js';

const LABEL = (s) => String(s).replace(/[-_]+/g, ' ').toUpperCase();

/** Consecutive scenes with the same section become one section span (hook scenes are left out). */
export function sectionSpans(scenes, fps = 30) {
  const spans = [];
  let t = 0;
  for (const s of scenes) {
    const d = s.durationInFrames / fps;
    const name = s.hook ? null : s.section;
    const last = spans[spans.length - 1];
    if (name && last && last.name === name) last.end = t + d;
    else if (name) spans.push({ name, start: t, end: t + d });
    t += d;
  }
  return { spans, total: t };
}

async function chipImages(dir, spans, { format, theme, lang }) {
  const { chromium } = await import('playwright');
  const portrait = format === 'short';
  const W = portrait ? 1080 : 1920;
  const files = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: 70 } });
    for (const [i] of spans.entries()) {
      const items = spans.map((s, k) => `<span class="${k === i ? 'on' : k < i ? 'done' : ''}">${LABEL(s.name)}</span>`).join('<i>·</i>');
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;background:transparent}
        .bar{height:70px;display:flex;align-items:center;justify-content:center;gap:${portrait ? 10 : 16}px;
          font:600 ${portrait ? 19 : 21}px/1 Inter,'Segoe UI',Arial,sans-serif;letter-spacing:${portrait ? 2 : 4}px;direction:${lang === 'ur' ? 'rtl' : 'ltr'}}
        span{color:${theme.text};opacity:.42;padding:7px 12px;border-radius:999px}
        span.done{opacity:.62}
        span.on{opacity:1;background:${theme.accent};color:${theme.bg}}
        i{font-style:normal;color:${theme.text};opacity:.35}
      </style></head><body><div class="bar">${items}</div></body></html>`;
      const f = path.join(dir, `chips-${i}.html`);
      await fs.writeFile(f, html);
      await page.goto(pathToFileURL(f).href, { waitUntil: 'load' });
      const png = path.join(dir, `chips-${i}.png`);
      await page.screenshot({ path: png, omitBackground: true });
      files.push(png);
    }
  } finally {
    await browser.close();
  }
  return files;
}

/**
 * input → output with the overlay burned in (video re-encoded once, audio copied).
 * Returns false (and does nothing) when there is nothing useful to show.
 */
export async function addProgressOverlay(input, output, { scenes, fps, format, theme, lang, workDir }) {
  const { spans, total } = sectionSpans(scenes, fps);
  if (spans.length < 3 || total < 40) return false;
  await fs.mkdir(workDir, { recursive: true });
  const chips = await chipImages(workDir, spans, { format, theme, lang });
  const portrait = format === 'short';
  const y = portrait ? 160 : 18;
  const hex = (c) => `0x${String(c).replace('#', '')}`;
  const args = ['-y', '-i', input];
  for (const c of chips) args.push('-i', c);
  const parts = [];
  let cur = '[0:v]';
  chips.forEach((_, i) => {
    const s = spans[i];
    const out = `[v${i}]`;
    parts.push(`${cur}[${i + 1}:v]overlay=x=(W-w)/2:y=${y}:enable='between(t,${s.start.toFixed(2)},${s.end.toFixed(2)})'${out}`);
    cur = out;
  });
  // thin progress line on the very top edge
  parts.push(`${cur}drawbox=x=0:y=0:w=iw:h=6:color=${hex(theme.text)}@0.18:t=fill,drawbox=x=0:y=0:w='iw*t/${total.toFixed(2)}':h=6:color=${hex(theme.accent)}@0.95:t=fill[vout]`);
  args.push('-filter_complex', parts.join(';'), '-map', '[vout]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', output);
  await run('ffmpeg', args, { timeoutMs: 60 * 60_000 });
  return true;
}
