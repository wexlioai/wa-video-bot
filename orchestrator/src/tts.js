import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg, ROOT } from './config.js';
import { audioDuration, run } from './util.js';

/** Speak with the configured provider: 'edge' (free), 'openspeaker' or 'elevenlabs'. */
export async function speak(text, voiceId, outFile, language) {
  if (cfg.tts.provider === 'elevenlabs') return speakEleven(text, voiceId, outFile, language);
  if (cfg.tts.provider === 'openspeaker') return speakOpenSpeaker(text, voiceId, outFile);
  return speakEdge(text, voiceId, outFile);
}

// ---------------------------------------------------------------- OpenSpeaker
// Docs: https://openspeaker.ai/app/api-document  (v3 TTS is async: submit -> poll task -> download)
const OS_API = 'https://api.openspeaker.ai';
const osHeaders = () => ({ 'xi-api-key': cfg.openspeaker.apiKey });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OpenSpeaker sometimes answers 429 / 5xx ("Task polling temporarily busy") or drops a
// connection. Those are temporary: wait and try again (up to ~3 minutes) instead of failing.
async function osJson(url, opts = {}) {
  let wait = 3000;
  for (let attempt = 1; ; attempt++) {
    let r;
    let text = '';
    try {
      r = await fetch(url, { ...opts, headers: { ...osHeaders(), ...(opts.headers || {}) } });
      text = await r.text();
    } catch (e) {
      if (attempt >= 10) throw new Error(`OpenSpeaker unreachable: ${e.message}`);
      await sleep(wait); wait = Math.min(wait * 1.6, 30_000); continue;
    }
    let j;
    try { j = JSON.parse(text); } catch { j = { raw: text }; }
    const transient = r.status === 429 || r.status >= 500;
    if (transient && attempt < 10) {
      console.log(`OpenSpeaker ${r.status} (temporary), retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait); wait = Math.min(wait * 1.6, 30_000); continue;
    }
    if (!r.ok || j.success === false) {
      throw new Error(`OpenSpeaker ${r.status}: ${(j.message || j.error || j.error_message || text).toString().slice(0, 250)}`);
    }
    return j;
  }
}

async function speakOpenSpeaker(text, voiceId, outFile) {
  const fd = new FormData();
  fd.append('text', text);
  fd.append('voice_id', voiceId);
  fd.append('speed', String(cfg.openspeaker.speed));
  fd.append('with_transcript', 'true');
  fd.append('file_name', path.basename(outFile, path.extname(outFile)));
  const sub = await osJson(`${OS_API}/v3/text-to-speech`, { method: 'POST', body: fd });
  if (!sub.task_id) throw new Error(`OpenSpeaker returned no task id: ${JSON.stringify(sub).slice(0, 200)}`);

  let task;
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    await sleep(i < 4 ? 3000 : 5000); // gentle polling; busy answers are retried inside osJson
    task = await osJson(`${OS_API}/v1/task/${sub.task_id}`);
    if (task.status === 'done') break;
    if (task.status === 'error') throw new Error(`OpenSpeaker task failed: ${task.error_message || 'unknown error'}`);
    if (Date.now() - t0 > 20 * 60_000) throw new Error('OpenSpeaker task timed out after 20 minutes');
  }
  const md = task.metadata || {};
  const audioUrl = md.audio_url || md.url || md.output_url;
  if (!audioUrl) throw new Error(`OpenSpeaker task has no audio_url: ${JSON.stringify(md).slice(0, 200)}`);

  // download; convert to mp3 if the service returned another format
  const ar = await fetch(audioUrl);
  if (!ar.ok) throw new Error(`OpenSpeaker audio download failed (${ar.status})`);
  const buf = Buffer.from(await ar.arrayBuffer());
  const ext = (path.extname(new URL(audioUrl).pathname) || '.mp3').toLowerCase();
  if (ext === '.mp3') {
    await fs.writeFile(outFile, buf);
  } else {
    const tmp = `${outFile}${ext}`;
    await fs.writeFile(tmp, buf);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', '160k', outFile]);
    await fs.rm(tmp, { force: true });
  }
  const duration = await audioDuration(outFile);

  // word timings for captions: try the JSON transcript, then the SRT, else estimate
  let words = null;
  if (md.json_url) {
    words = await fetch(md.json_url).then((r) => (r.ok ? r.json() : null)).then((j) => (j ? wordsFromAnyJson(j, duration) : null)).catch(() => null);
  }
  if (!words?.length && md.srt_url) {
    words = await fetch(md.srt_url).then((r) => (r.ok ? r.text() : '')).then((t) => wordsFromSrt(t)).catch(() => null);
  }
  if (!words?.length) words = estimateWords(text, duration);
  return { words: withOriginalText(words, text), duration };
}

/** Credits left (for the wizard / status). */
export async function openSpeakerCredits() {
  return (await osJson(`${OS_API}/v1/credits`)).credits;
}

// Transcript JSON formats differ per provider: find either an ElevenLabs-style character
// alignment or any list of {text|word, start, end} items (seconds or milliseconds).
function wordsFromAnyJson(j, duration) {
  const seen = new Set();
  let align = null;
  let list = null;
  (function walk(o) {
    if (!o || typeof o !== 'object' || seen.has(o) || (align && list)) return;
    seen.add(o);
    if (!align && Array.isArray(o.characters) && Array.isArray(o.character_start_times_seconds)) align = o;
    if (Array.isArray(o)) {
      const f = o[0];
      if (!list && f && typeof f === 'object' && ('text' in f || 'word' in f) &&
        ['start', 'start_time', 'startTime', 'begin', 'from'].some((k) => k in f)) list = o;
      o.forEach(walk);
    } else Object.values(o).forEach(walk);
  })(j);
  if (align) return wordsFromAlignment(align);
  if (!list) return null;
  const num = (o, ks) => { for (const k of ks) if (o[k] != null) return Number(o[k]); return NaN; };
  let items = list.filter((o) => !o.type || o.type === 'word').map((o) => ({
    text: String(o.text ?? o.word ?? '').trim(),
    start: num(o, ['start', 'start_time', 'startTime', 'begin', 'from']),
    end: num(o, ['end', 'end_time', 'endTime', 'stop', 'to']),
  })).filter((w) => w.text && isFinite(w.start));
  const maxEnd = Math.max(...items.map((w) => (isFinite(w.end) ? w.end : w.start)));
  if (duration && maxEnd > duration * 20) items = items.map((w) => ({ ...w, start: w.start / 1000, end: w.end / 1000 }));
  items = items.map((w, i) => ({ ...w, end: isFinite(w.end) ? w.end : (items[i + 1]?.start ?? w.start + 0.4) }));
  return items.flatMap(splitSegment);
}

function wordsFromSrt(srt) {
  const t = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  const segs = [];
  for (const block of srt.replace(/\r/g, '').split(/\n\n+/)) {
    const m = block.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)\s*\n([\s\S]*)/);
    if (m) segs.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: m[9].replace(/\n/g, ' ').trim() });
  }
  return segs.flatMap(splitSegment);
}

// A timed segment holding several words -> one item per word, time split by word length.
function splitSegment(seg) {
  const parts = seg.text.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts.length ? [seg] : [];
  const total = parts.reduce((a, w) => a + w.length + 1, 0);
  let t = seg.start;
  return parts.map((w) => {
    const d = ((w.length + 1) / total) * (seg.end - seg.start);
    const out = { text: w, start: t, end: t + d };
    t += d;
    return out;
  });
}

const EDGE_SCRIPT = path.join(ROOT, 'orchestrator', 'scripts', 'edge_tts_run.py');

async function speakEdge(text, voice, outFile) {
  const tmpText = `${outFile}.txt`;
  const meta = `${outFile}.words.json`;
  await fs.writeFile(tmpText, text);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) { // the free service occasionally drops a connection
    try {
      await run(cfg.tts.python, [EDGE_SCRIPT, 'speak', '--voice', voice, '--text-file', tmpText, '--out', outFile, '--meta', meta, '--rate', cfg.tts.rate], { timeoutMs: 180_000 });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  if (lastErr) throw new Error(`Free voice (edge-tts) failed: ${String(lastErr.message).slice(-300)}`);
  const duration = await audioDuration(outFile);
  const raw = JSON.parse(await fs.readFile(meta, 'utf8'));
  await fs.rm(tmpText, { force: true });
  await fs.rm(meta, { force: true });
  return { words: raw.length ? withOriginalText(raw, text) : estimateWords(text, duration), duration };
}

// Edge reports words without punctuation; when the counts line up, show the script's own
// words (with their punctuation) in the captions using Edge's timings.
// Captions always show the SCRIPT's own words. Timings come from the voice service.
// If the service's words line up 1:1 with the script, use them directly; otherwise
// (e.g. OpenSpeaker transcribes Urdu audio into Hindi script, or splits words differently)
// place each script word on the speech timeline by its character position.
function withOriginalText(words, text) {
  const tokens = text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
  const timed = words.filter((w) => w.text && isFinite(w.start) && isFinite(w.end) && w.end >= w.start);
  if (!tokens.length || !timed.length) return words;
  if (tokens.length === timed.length) return timed.map((w, i) => ({ ...w, text: tokens[i] }));

  // piecewise-linear map: fraction of spoken characters -> time
  const tLen = timed.reduce((a, w) => a + w.text.length, 0) || 1;
  const pts = [];
  let acc = 0;
  for (const w of timed) {
    pts.push([acc / tLen, w.start]);
    acc += w.text.length;
    pts.push([acc / tLen, w.end]);
  }
  const at = (f) => {
    for (let i = 1; i < pts.length; i++) {
      const [f0, t0] = pts[i - 1];
      const [f1, t1] = pts[i];
      if (f <= f1) return f1 === f0 ? t1 : t0 + ((f - f0) / (f1 - f0)) * (t1 - t0);
    }
    return pts[pts.length - 1][1];
  };
  const total = tokens.reduce((a, t) => a + t.length, 0) || 1;
  let c = 0;
  return tokens.map((t) => {
    const start = at(c / total);
    c += t.length;
    return { text: t, start, end: Math.max(start + 0.05, at(c / total)) };
  });
}

/** List the free voices (for the setup wizard). */
export async function listEdgeVoices() {
  const { stdout } = await run(cfg.tts.python, [EDGE_SCRIPT, 'list'], { timeoutMs: 60_000 });
  return JSON.parse(stdout);
}

const API = 'https://api.elevenlabs.io/v1';
const headers = () => ({ 'xi-api-key': cfg.eleven.apiKey, 'Content-Type': 'application/json' });

/**
 * ElevenLabs. Returns { words:[{text,start,end}], duration }.
 * Tries the with-timestamps endpoint (exact word timing for captions); if the model
 * doesn't support it, falls back to plain TTS and spreads word timings by length.
 */
async function speakEleven(text, voiceId, outFile, language) {
  const body = JSON.stringify({
    text,
    model_id: cfg.eleven.model,
    ...(language ? { language_code: language } : {}),
  });
  const q = '?output_format=mp3_44100_128';

  let res = await fetch(`${API}/text-to-speech/${voiceId}/with-timestamps${q}`, { method: 'POST', headers: headers(), body });
  if (res.status === 422 || res.status === 400) {
    // retry once without language_code (not every model accepts it)
    const b2 = JSON.stringify({ text, model_id: cfg.eleven.model });
    res = await fetch(`${API}/text-to-speech/${voiceId}/with-timestamps${q}`, { method: 'POST', headers: headers(), body: b2 });
  }
  if (res.ok) {
    const j = await res.json();
    await fs.writeFile(outFile, Buffer.from(j.audio_base64, 'base64'));
    const duration = await audioDuration(outFile);
    const al = j.alignment || j.normalized_alignment;
    const words = al ? wordsFromAlignment(al) : estimateWords(text, duration);
    return { words, duration };
  }
  if (res.status === 401 || res.status === 402 || res.status === 429) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  // Fallback: plain endpoint
  const r2 = await fetch(`${API}/text-to-speech/${voiceId}${q}`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ text, model_id: cfg.eleven.model }),
  });
  if (!r2.ok) throw new Error(`ElevenLabs ${r2.status}: ${(await r2.text()).slice(0, 300)}`);
  await fs.writeFile(outFile, Buffer.from(await r2.arrayBuffer()));
  const duration = await audioDuration(outFile);
  return { words: estimateWords(text, duration), duration };
}

function wordsFromAlignment(al) {
  const chars = al.characters || [];
  const st = al.character_start_times_seconds || [];
  const en = al.character_end_times_seconds || [];
  const words = [];
  let cur = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { text: '', start: st[i] ?? 0, end: en[i] ?? 0 };
    cur.text += c;
    cur.end = en[i] ?? cur.end;
  }
  if (cur) words.push(cur);
  // strip ElevenLabs v3 audio tags like [excited] if any slipped in
  return words.filter((w) => !/^\[.*\]$/.test(w.text));
}

function estimateWords(text, duration) {
  const parts = text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((a, w) => a + w.length + 1, 0) || 1;
  let t = 0;
  return parts.map((w) => {
    const d = ((w.length + 1) / total) * duration;
    const word = { text: w, start: t, end: t + d };
    t += d;
    return word;
  });
}

/** First ~N chars of the script, cut at a sentence end, for voice samples. */
export function sampleText(fullText) {
  const n = cfg.eleven.sampleChars;
  if (fullText.length <= n) return fullText;
  const cut = fullText.slice(0, n + 120);
  const m = cut.slice(n - 80).search(/[.!?؟۔]\s/);
  return m >= 0 ? cut.slice(0, n - 80 + m + 1) : fullText.slice(0, n);
}
