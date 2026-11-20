// Voice catalog, shown on WhatsApp 6 at a time, best first.
// English is the focus: hand-picked natural, human-sounding narrators.
// Samples (5-6 s, same sentence for every voice) are generated once and cached forever.
import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg } from './config.js';
import { run, exists, rmSafe } from './util.js';
import { speak } from './tts.js';

export const BATCH = 6;

// [rawId, name, short description]
const ELEVEN = {
  en: [
    // batch 1: the strongest narrators
    ['YlMxCLHyPPgCcF5NbKrO', 'Mart', 'Euro-Brit, easy listening'],
    ['JBFqnCBsd6RMkjVDRZzb', 'George', 'warm British storyteller'],
    ['nPczCjzI2devNBz1zQrb', 'Brian', 'deep, resonant American'],
    ['onwK4e9ZLuTAKqWW03F9', 'Daniel', 'steady British broadcaster'],
    ['Xb7hH8MSUJpSbSDYk0k2', 'Alice', 'clear British educator'],
    ['XrExE9yKIg1WjnnlVkGX', 'Matilda', 'knowledgeable, professional'],
    // batch 2
    ['EXAVITQu4vr4xnSDxMaL', 'Sarah', 'mature, confident'],
    ['cjVigY5qzO86Huf0OWal', 'Eric', 'smooth, trustworthy'],
    ['pqHfZKP75CvOlQylNhV4', 'Bill', 'wise, mature'],
    ['iP95p4xoKVk53GoZ742B', 'Chris', 'charming, down-to-earth'],
    ['pFZP5JQG7iQjIQuC4Bku', 'Lily', 'velvety British'],
    ['hpp4J3VqNfWAUOO0d1Us', 'Bella', 'bright, warm'],
    // batch 3: professional narrators from the voice library
    ['n0VJsPm60ki3xLLyCLFE', 'Vaughn', 'rich, smooth narrator'],
    ['CHsGFh1S1CR2UcoErJDe', 'Jamie', 'warm British professional'],
    ['EyNKucUOLFyS180FBsMt', 'Declan', 'calm, measured'],
    ['n0WRwrTcEpmeyP31HKGu', 'Ruthie', 'clear, lively'],
    ['z1srV6per6HBc58kB70F', 'Thomas', 'calm American'],
    ['bIHbv24MWmeRgasZH58o', 'Will', 'relaxed, optimistic'],
    ['bw7U2BkuPkNT7YOsif4t', 'Wren', 'warm instructor'],
  ],
  ur: [
    ['vH5LP38dcYJ3CIbC2rKX', 'Amjid', 'Urdu documentary narrator'],
    ['hA0RyxVmITMttngSpcOF', 'Saira', 'rich Urdu storyteller'],
    ['L1f58R08RFtEqY28c3BT', 'Naqsh', 'documentary'],
    ['UT6USLtoAlXHj5k4sOLY', 'Reva', 'warm Urdu narration'],
    ['GnmcdQ5D9NktfEwK2h3j', 'Kamran', 'dramatic'],
    ['o85TqPN3F4P7dWae2paA', 'Reva (soft)', 'soothing'],
  ],
};

const EDGE = {
  en: [
    ['en-US-AndrewMultilingualNeural', 'Andrew', 'warm, confident (US)'],
    ['en-US-AvaMultilingualNeural', 'Ava', 'expressive, caring (US)'],
    ['en-US-BrianMultilingualNeural', 'Brian', 'approachable, casual (US)'],
    ['en-US-EmmaMultilingualNeural', 'Emma', 'cheerful, clear (US)'],
    ['en-GB-RyanNeural', 'Ryan', 'friendly British'],
    ['en-GB-SoniaNeural', 'Sonia', 'friendly British'],
    ['en-US-ChristopherNeural', 'Christopher', 'reliable, authoritative'],
    ['en-US-JennyNeural', 'Jenny', 'friendly, considerate'],
    ['en-US-GuyNeural', 'Guy', 'passionate'],
    ['en-US-AriaNeural', 'Aria', 'positive, confident'],
    ['en-US-SteffanNeural', 'Steffan', 'rational'],
    ['en-US-MichelleNeural', 'Michelle', 'friendly, pleasant'],
  ],
  ur: [
    ['ur-PK-AsadNeural', 'Asad', 'Pakistani Urdu'],
    ['ur-PK-UzmaNeural', 'Uzma', 'Pakistani Urdu'],
    ['ur-IN-SalmanNeural', 'Salman', 'Urdu'],
    ['ur-IN-GulNeural', 'Gul', 'Urdu'],
  ],
};

const SAMPLE_TEXT = {
  en: 'Hi! This is how your next video will sound: clear, natural, and ready for YouTube.',
  ur: 'السلام علیکم! آپ کی اگلی ویڈیو کی آواز کچھ ایسی ہوگی، صاف اور قدرتی۔',
};

/** Which voice family the configured service uses. */
function family() {
  if (cfg.tts.provider === 'openspeaker') return cfg.openspeaker.voiceProvider === 'edge' ? 'edge' : 'elevenlabs';
  return cfg.tts.provider === 'elevenlabs' ? 'elevenlabs' : 'edge';
}

/** Full voice id as the TTS service expects it. */
function fullId(raw) {
  if (cfg.tts.provider === 'openspeaker') return `${family()}_${raw}`;
  return raw;
}

/** Curated list for a language: [{id, name, desc}] */
export function catalog(lang) {
  const src = family() === 'edge' ? EDGE : ELEVEN;
  const list = src[lang] || src.en;
  return list.map(([raw, name, desc]) => ({ id: fullId(raw), name, desc }));
}

/**
 * Voices for page n (0-based). After the curated list, OpenSpeaker users get more
 * professional narrators from the live voice library.
 */
export async function voicePage(lang, n) {
  const cur = catalog(lang);
  const start = n * BATCH;
  const live = cfg.tts.provider === 'openspeaker' && family() === 'elevenlabs'; // can page into the live library
  if (start < cur.length) return { voices: cur.slice(start, start + BATCH), more: start + BATCH < cur.length || live };
  if (!live) return { voices: [], more: false };
  const extraPage = n - Math.ceil(cur.length / BATCH) + 1; // 1-based page of the live library
  const known = new Set(cur.map((v) => v.id));
  try {
    const q = lang === 'ur' ? 'language=ur&search=urdu' : 'language=en&category=professional&use_case=narrative_story';
    const r = await fetch(`https://api.openspeaker.ai/v3/voices?provider=elevenlabs&page_size=${BATCH}&page=${extraPage}&${q}`, {
      headers: { 'xi-api-key': cfg.openspeaker.apiKey },
    });
    const j = await r.json();
    const voices = (j.data || []).filter((v) => !known.has(v.voice_id)).map((v) => {
      const [name, ...rest] = String(v.name || v.voice_id).split(' - ');
      return { id: v.voice_id, name: name.trim().slice(0, 20), desc: (rest.join(' - ') || v.accent || '').slice(0, 40) };
    });
    return { voices, more: !!j.pagination?.has_more };
  } catch {
    return { voices: [], more: false };
  }
}

const sampleRel = (voice, lang) => path.join('voice-samples', cfg.tts.provider, `${voice.id.replace(/[^\w.-]+/g, '_')}-${lang}.mp3`);

/** Has this voice's sample already been made? */
export const hasSample = (voice, lang) => exists(path.join(cfg.dataDir, sampleRel(voice, lang)));

/** Cached 5-6 second sample of a voice; generated only the first time. Returns a path relative to dataDir. */
export async function sampleFor(voice, lang) {
  const rel = sampleRel(voice, lang);
  const out = path.join(cfg.dataDir, rel);
  if (await exists(out)) return rel;
  await fs.mkdir(path.dirname(out), { recursive: true });
  const raw = `${out}.raw.mp3`;
  await speak(SAMPLE_TEXT[lang] || SAMPLE_TEXT.en, voice.id, raw, lang);
  // keep it short: max 6 s with a soft fade at the end
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-t', '6', '-af', 'afade=t=out:st=5.5:d=0.5', '-c:a', 'libmp3lame', '-b:a', '128k', out]);
  await rmSafe(raw);
  return rel;
}

/** Is this saved voice usable with the current service? */
export function sameService(saved) {
  return saved && saved.provider === cfg.tts.provider && saved.family === family();
}
export const currentFamily = family;
