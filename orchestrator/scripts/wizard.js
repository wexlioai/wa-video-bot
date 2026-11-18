// Interactive setup wizard: asks for credentials (and explains where to get each one), checks them,
// writes .env, starts Evolution API, links WhatsApp with a QR in the terminal, sets up YouTube.
// Safe to re-run: existing answers become the defaults.
//   node scripts/wizard.js          full setup
//   node scripts/wizard.js --test   check the running bot and send a WhatsApp test message
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_FILE = path.join(ROOT, '.env');
const DATA = path.join(ROOT, 'data');
const SESSION = path.join(DATA, 'yt-session.json');
const WIN = process.platform === 'win32';
const HAS_DISPLAY = WIN || process.platform === 'darwin' || !!process.env.DISPLAY;

// ---------- small terminal helpers ----------
const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, cy: (s) => `\x1b[36m${s}\x1b[0m`,
};
const ok = (s) => console.log(c.g('  ✔ ') + s);
const warn = (s) => console.log(c.y('  ! ') + s);
const bad = (s) => console.log(c.r('  ✖ ') + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stepNo = 0;
const header = (t) => console.log(`\n${c.b(c.cy(`── Step ${++stepNo}: ${t} `.padEnd(70, '─')))}`);
const help = (lines) => console.log(lines.map((l) => c.d('   │ ') + l).join('\n'));

async function ask(q, def = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`  ${c.b('?')} ${q}${def ? c.d(` [${def.length > 40 ? def.slice(0, 12) + '…' : def}]`) : ''}: `)).trim();
  rl.close();
  return a || def;
}
async function askUntil(q, def, check) {
  for (;;) {
    const v = await ask(q, def);
    const err = await check(v);
    if (!err) return v;
    bad(err);
  }
}
async function choose(q, options, def = 1) {
  options.forEach((o, i) => console.log(`     ${c.b(i + 1)}) ${o}`));
  const v = await askUntil(q, String(def), (x) => (/^\d+$/.test(x) && x >= 1 && x <= options.length ? null : `Type a number 1-${options.length}`));
  return Number(v);
}
const yes = async (q, def = 'y') => /^y/i.test(await ask(`${q} (y/n)`, def));

// ---------- .env ----------
function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]),
  );
}
function writeEnv(e) {
  const order = ['PORT', 'WEBHOOK_SECRET', 'SELF_URL', 'EVO_URL', 'EVO_API_KEY', 'EVO_INSTANCE', 'OWNER_NUMBER', 'SELF_CHAT',
    'TTS_PROVIDER', 'TTS_RATE', 'PYTHON_BIN', 'OPENSPEAKER_API_KEY', 'OPENSPEAKER_SPEED', 'ELEVEN_API_KEY', 'ELEVEN_MODEL', 'VOICES_EN', 'VOICES_UR', 'SAMPLE_CHARS', 'CLAUDE_BIN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_MODEL', 'CLAUDE_TIMEOUT_MIN',
    'RENDER_CONCURRENCY', 'CAPTIONS', 'UPDATE_REPO', 'UPDATE_BRANCH', 'UPDATE_CHECK_MIN', 'YT_METHOD', 'YT_PRIVACY', 'YT_CATEGORY', 'YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN'];
  const keys = [...order.filter((k) => k in e), ...Object.keys(e).filter((k) => !order.includes(k))];
  fs.writeFileSync(ENV_FILE, '# written by scripts/wizard.js — re-run it to change values\n' + keys.map((k) => `${k}=${e[k]}`).join('\n') + '\n');
}

// ---------- process helpers ----------
function sh(cmd, args, opts = {}) {
  const shim = WIN && /\.(cmd|bat)$/i.test(cmd);
  return spawnSync(shim ? `"${cmd}"` : cmd, shim ? args.map((a) => `"${a}"`) : args, { encoding: 'utf8', shell: shim, ...opts });
}
function interactive(cmd, args, opts = {}) {
  const shim = WIN && /\.(cmd|bat)$/i.test(cmd);
  return new Promise((res) => {
    const p = spawn(shim ? `"${cmd}"` : cmd, args, { stdio: 'inherit', shell: shim, ...opts });
    p.on('close', res);
    p.on('error', () => res(-1));
  });
}

// ===================================================================================
async function main() {
  console.log(c.b('\n  WhatsApp → video → YouTube bot: setup wizard'));
  console.log(c.d(`  Project folder: ${ROOT}\n  Press Enter to keep the value shown in [brackets].`));
  fs.mkdirSync(DATA, { recursive: true });
  const e = readEnv();
  e.PORT ||= '3000';
  e.WEBHOOK_SECRET ||= crypto.randomBytes(24).toString('hex');
  e.EVO_API_KEY ||= crypto.randomBytes(24).toString('hex');
  e.SELF_URL ||= `http://host.docker.internal:${e.PORT}`;
  e.EVO_URL ||= 'http://127.0.0.1:8080';
  e.EVO_INSTANCE ||= 'videobot';
  e.ELEVEN_MODEL ||= 'eleven_v3';
  e.TTS_RATE ||= '+0%';
  e.SAMPLE_CHARS ||= '260';
  e.CLAUDE_TIMEOUT_MIN ||= '15';
  e.RENDER_CONCURRENCY ||= String(Math.max(1, Math.min(4, os.cpus().length - 1)));
  e.CAPTIONS ||= 'true';
  e.YT_METHOD ||= 'browser';
  e.YT_CATEGORY ||= '27';

  // ---------------------------------------------------------------- WhatsApp
  header('WhatsApp');
  help([
    'The bot talks to you on WhatsApp. Choose how:',
    `${c.b('Self chat')}: the bot links to YOUR WhatsApp (like WhatsApp Web) and you send scripts in`,
    '  the "Message yourself" chat. Nothing extra needed.',
    `${c.b('Second number')}: the bot links to another WhatsApp (spare SIM / WhatsApp Business) and`,
    '  you message it like a contact. A little more reliable, keeps your own chats separate.',
  ]);
  const mode = await choose('Which one?', ['Self chat (my own number)', 'Second number'], e.SELF_CHAT === 'false' ? 2 : 1);
  e.SELF_CHAT = mode === 1 ? 'true' : 'false';
  help(['Your personal WhatsApp number in international format, digits only.', 'Pakistan example: 0300 1234567  →  923001234567']);
  e.OWNER_NUMBER = await askUntil('Your WhatsApp number', e.OWNER_NUMBER || '', (v) =>
    /^\d{10,15}$/.test(v.replace(/\D/g, '')) ? null : 'Use digits only with country code, e.g. 923001234567');
  e.OWNER_NUMBER = e.OWNER_NUMBER.replace(/\D/g, '');
  let botNumber = e.OWNER_NUMBER;
  if (mode === 2) {
    botNumber = (await askUntil('The bot\'s WhatsApp number (the second number)', e.BOT_NUMBER || '', (v) =>
      /^\d{10,15}$/.test(v.replace(/\D/g, '')) ? null : 'Digits with country code')).replace(/\D/g, '');
    e.BOT_NUMBER = botNumber;
  }
  ok('WhatsApp settings saved');

  // ---------------------------------------------------------------- Voice
  await voiceStep(e);

  // ---------------------------------------------------------------- Claude
  header('Claude (your Claude Pro/Max plan)');
  help([
    'The bot uses Claude Code logged in to YOUR Claude account (no API key, no extra bill).',
    'You need a Claude Pro or Max subscription.',
    `${c.b('Sonnet')} uses less of your plan limit; ${c.b('Opus')} makes slightly better scene choices.`,
  ]);
  const m = await choose('Model for the bot', ['Sonnet (recommended)', 'Opus', 'Claude Code default'],
    e.CLAUDE_MODEL === 'opus' ? 2 : e.CLAUDE_MODEL === '' ? 3 : 1);
  e.CLAUDE_MODEL = ['sonnet', 'opus', ''][m - 1];
  e.CLAUDE_BIN = findClaude(e.CLAUDE_BIN);
  if (!e.CLAUDE_BIN) {
    bad('Claude Code is not installed. Re-run the setup script (it installs it) and then this wizard.');
    process.exit(1);
  }
  ok(`Claude Code found: ${e.CLAUDE_BIN}`);
  // A long-lived token (claude setup-token, ~1 year) so the background bot never hits
  // "OAuth session expired". It still uses your subscription, not API billing.
  while (!(e.CLAUDE_CODE_OAUTH_TOKEN && (await claudeWorks(e.CLAUDE_BIN, e.CLAUDE_CODE_OAUTH_TOKEN)))) {
    help([
      'The bot needs a long-lived Claude login token (valid ~1 year, uses your Pro/Max plan).',
      '  1. Press Enter: Claude Code runs "claude setup-token"',
      HAS_DISPLAY ? '  2. A browser opens: sign in to claude.ai and click Authorize'
        : '  2. Open the link it prints in your PC\'s browser, sign in, click Authorize, paste the code back here',
      '  3. The terminal shows a token starting with  sk-ant-oat01-  : copy it',
      '  4. Paste it below. Keep it private like a password.',
    ]);
    await ask('Press Enter to start');
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    await interactive(e.CLAUDE_BIN, ['setup-token'], { env });
    e.CLAUDE_CODE_OAUTH_TOKEN = (await askUntil('Paste the token', '', (v) =>
      /^sk-ant-oat\S{20,}$/.test(v.trim()) ? null : 'The token starts with sk-ant-oat01- (copy the whole line)')).trim();
  }
  ok('Claude works with your subscription');

  // ---------------------------------------------------------------- YouTube
  header('YouTube');
  help([
    'Videos are uploaded through YouTube Studio in a hidden (headless) browser, logged in as you.',
    'Visibility for new uploads: public = live immediately, unlisted = only people with the link, private = only you.',
  ]);
  const vis = await choose('Upload visibility', ['public', 'unlisted', 'private'], ['public', 'unlisted', 'private'].indexOf(e.YT_PRIVACY || 'public') + 1);
  e.YT_PRIVACY = ['public', 'unlisted', 'private'][vis - 1];
  writeEnv(e); // save progress
  await youtubeSession(e);

  await updatesStep(e);

  writeEnv(e);
  ok(`Settings written to ${ENV_FILE}`);

  // ---------------------------------------------------------------- Evolution
  header('Starting WhatsApp server (Evolution API in Docker)');
  await startEvolution(e);
  await linkWhatsApp(e, botNumber);

  console.log(`\n${c.g(c.b('  Setup finished.'))}\n`);
}

// ===================================================================================
async function elevenVoices(key) {
  if (!/^sk_|^[a-f0-9]{32}$/i.test(key)) throw new Error('That does not look like an ElevenLabs key (starts with sk_)');
  const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
  if (r.status === 401) throw new Error('ElevenLabs rejected the key (401). Check it, and that it has "Voices: Read" permission.');
  if (!r.ok) throw new Error(`ElevenLabs error ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const j = await r.json();
  return (j.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name.replace(/[,:]/g, ' ').trim(),
    info: [v.labels?.language, v.labels?.accent, v.labels?.gender, v.labels?.age, v.category].filter(Boolean).join(', '),
  }));
}

async function pickVoices(lang, voices, current, reload, defaults = []) {
  // current .env value only counts if it belongs to the provider being configured
  const known = new Set(voices.map((v) => v.id));
  if (current && !current.split(',').every((x) => known.has(x.split(':')[0]))) current = '';
  const defNums = defaults.map((id) => voices.findIndex((v) => v.id === id) + 1).filter((n) => n > 0).join(',');
  for (;;) {
    console.log(`\n   ${c.b(`Voices for ${lang} scripts`)}`);
    voices.forEach((v, i) => console.log(`     ${String(i + 1).padStart(3)}) ${v.name.padEnd(30)} ${c.d(v.info)}`));
    const curNames = (current || '').split(',').filter((x) => x.includes(':')).map((x) => x.split(':')[1]).join(', ');
    if (curNames) console.log(c.d(`     current: ${curNames}  (press Enter to keep)`));
    const a = await ask(`Pick 3-4 numbers for ${lang}, e.g. 1,4,7${reload ? '  (r = reload list)' : ''}`, current ? 'keep' : defNums);
    if (a === 'keep') return current;
    if (reload && a.toLowerCase() === 'r') { voices.splice(0, voices.length, ...(await reload())); continue; }
    const nums = [...new Set(a.split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= voices.length))];
    if (nums.length < 1 || nums.length > 4) { bad('Pick between 1 and 4 voices'); continue; }
    if (nums.length < 3) warn('Tip: 3-4 voices give you a better choice. Continuing anyway.');
    ok(`${lang}: ${nums.map((n) => voices[n - 1].name).join(', ')}`);
    return nums.map((n) => `${voices[n - 1].id}:${voices[n - 1].name}`).join(',');
  }
}

async function voiceStep(e) {
  header('Voice');
  help([
    `${c.b('Free Microsoft voices')}: Edge "Read aloud" neural voices. No account, no key, no cost.`,
    `${c.b('OpenSpeaker')}: one API key for ElevenLabs, MiniMax, Fish Audio, Edge, Kokoro and Vbee voices (pay with OpenSpeaker credits).`,
    `${c.b('ElevenLabs')}: directly with your own ElevenLabs API key.`,
    'You can switch any time by re-running this wizard.',
  ]);
  const cur = { edge: 1, openspeaker: 2, elevenlabs: 3 }[e.TTS_PROVIDER] || 1;
  const p = await choose('Which voice service?', ['Free Microsoft voices', 'OpenSpeaker', 'ElevenLabs'], cur);
  e.TTS_PROVIDER = ['edge', 'openspeaker', 'elevenlabs'][p - 1];
  if (p === 1) return edgeVoices(e);
  if (p === 2) return openSpeakerStep(e);
  return elevenStep(e);
}

const OS_API = 'https://api.openspeaker.ai';
async function osGet(key, p) {
  const r = await fetch(`${OS_API}${p}`, { headers: { 'xi-api-key': key } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw new Error('OpenSpeaker rejected the API key (401/403). Copy it again from the API Document page.');
  if (!r.ok || j.success === false) throw new Error(`OpenSpeaker error ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
  return j;
}

async function openSpeakerStep(e) {
  help([
    'Where to get the OpenSpeaker API key:',
    '  1. Open https://openspeaker.ai/app and sign up / log in (top right: LOGIN)',
    '  2. Buy or check credits in your account if needed (TTS uses credits)',
    '  3. Open https://openspeaker.ai/app/api-document',
    '  4. Click the "API Key" box at the top of that page → create / copy your key',
  ]);
  let credits = null;
  e.OPENSPEAKER_API_KEY = (await askUntil('OpenSpeaker API key', e.OPENSPEAKER_API_KEY || '', async (v) => {
    if (v.trim().length < 10) return 'Paste the full API key';
    try { credits = (await osGet(v.trim(), '/v1/credits')).credits; return null; } catch (err) { return err.message; }
  })).trim();
  ok(`Key works. Credits available: ${credits}`);

  help([
    'Which voice provider inside OpenSpeaker?',
    `  ${c.b('ElevenLabs')} has the most natural voices and supports Urdu (v3). ${c.b('Edge')} also has Urdu (Asad, Uzma).`,
    '  Checked live: ElevenLabs has 6 Urdu voices (Amjid, Saira, Naqsh, Kamran, Reva…), Edge has 4, MiniMax has none.',
    '  Cost: about 1 credit per character + 10 credits per scene for caption timings.',
  ]);
  const provs = ['elevenlabs', 'minimax', 'edge', 'fishaudio', 'kokoro', 'vbee'];
  const curProv = (e.VOICES_UR || '').split('_')[0];
  const pi = await choose('Voice provider', provs.map((x) => ({ elevenlabs: 'ElevenLabs (recommended)', minimax: 'MiniMax', edge: 'Edge (Microsoft)', fishaudio: 'Fish Audio', kokoro: 'Kokoro', vbee: 'Vbee' }[x])),
    Math.max(1, provs.indexOf(curProv) + 1));
  const prov = provs[pi - 1];

  // Tested against the live API: the language filter takes ISO codes (ur / en), "search=urdu"
  // finds more ElevenLabs Urdu voices, and some providers ignore filters, so we also filter here.
  const fetchVoices = async (lang) => {
    const code = lang === 'Urdu' ? 'ur' : 'en';
    const qs = [`language=${code}`];
    if (code === 'ur') qs.push('search=urdu');
    if (code === 'en' && prov === 'elevenlabs') qs.unshift(`language=en&category=premade`); // curated list first
    const seen = new Map();
    for (const q of qs) {
      const j = await osGet(e.OPENSPEAKER_API_KEY, `/v3/voices?provider=${prov}&page_size=100&${q}`).catch(() => ({ data: [] }));
      for (const v of j.data || []) {
        const langs = [v.language, v.locale, ...(v.languages || []).map((l) => l.language || l.locale)].filter(Boolean).map((x) => String(x).toLowerCase());
        if (langs.some((x) => x === code || x.startsWith(`${code}-`)) && !seen.has(v.voice_id)) seen.set(v.voice_id, v);
      }
      if (code === 'en' && seen.size >= 20) break;
    }
    return [...seen.values()].slice(0, 60).map((v) => ({
      id: v.voice_id,
      name: String(v.name || v.voice_id).replace(/[,:]/g, ' ').replace(/\s+/g, ' ').slice(0, 36).trim(),
      info: [v.gender, v.locale || v.language, v.category].filter(Boolean).join(', '),
    }));
  };
  const DEFAULTS = {
    elevenlabs: {
      Urdu: ['vH5LP38dcYJ3CIbC2rKX', 'hA0RyxVmITMttngSpcOF', 'L1f58R08RFtEqY28c3BT', 'UT6USLtoAlXHj5k4sOLY'], // Amjid, Saira, Naqsh, Reva
      English: ['JBFqnCBsd6RMkjVDRZzb', 'EXAVITQu4vr4xnSDxMaL', 'CwhRBWXzGAHq8TQ4Fs17', 'hpp4J3VqNfWAUOO0d1Us'], // George, Sarah, Roger, Bella
    },
    edge: {
      Urdu: ['ur-PK-AsadNeural', 'ur-PK-UzmaNeural', 'ur-IN-SalmanNeural', 'ur-IN-GulNeural'],
      English: ['en-US-AndrewMultilingualNeural', 'en-US-AvaMultilingualNeural', 'en-US-BrianMultilingualNeural', 'en-GB-RyanNeural'],
    },
  };
  for (const [lang, key] of [['Urdu', 'VOICES_UR'], ['English', 'VOICES_EN']]) {
    process.stdout.write(c.d(`   loading ${prov} voices for ${lang}… `));
    const list = await fetchVoices(lang);
    console.log(`${list.length} found`);
    if (!list.length) {
      warn(`${prov} has no ${lang} voices${lang === 'Urdu' ? ' (MiniMax, for example, has none). Choose ElevenLabs or Edge for Urdu' : ''}.`);
      continue;
    }
    const defs = (DEFAULTS[prov]?.[lang] || []).map((id) => `${prov}_${id}`);
    e[key] = await pickVoices(lang, list, e[key], () => fetchVoices(lang), defs);
  }
  const sp = await choose('Speaking speed', ['Normal (1.0)', 'A little slower (0.92)', 'A little faster (1.08)'],
    e.OPENSPEAKER_SPEED === '0.92' ? 2 : e.OPENSPEAKER_SPEED === '1.08' ? 3 : 1);
  e.OPENSPEAKER_SPEED = ['1', '0.92', '1.08'][sp - 1];
}

function findPython(current) {
  const venv = WIN ? path.join(ROOT, '.venv', 'Scripts', 'python.exe') : path.join(ROOT, '.venv', 'bin', 'python');
  for (const py of [current, venv, WIN ? 'python' : 'python3'].filter(Boolean)) {
    if (sh(py, ['-c', 'import edge_tts']).status === 0) return py;
  }
  return '';
}

async function edgeVoices(e) {
  e.PYTHON_BIN = findPython(e.PYTHON_BIN);
  if (!e.PYTHON_BIN) {
    bad('The free voice package (edge-tts) is not installed. Re-run the setup script; it installs it.');
    process.exit(1);
  }
  const script = path.join(ROOT, 'orchestrator', 'scripts', 'edge_tts_run.py');
  const load = () => {
    const r = sh(e.PYTHON_BIN, [script, 'list'], { timeout: 60_000 });
    if (r.status !== 0) throw new Error(`Could not load voice list: ${(r.stderr || '').slice(-300)}`);
    return JSON.parse(r.stdout);
  };
  let all;
  for (;;) {
    try { all = load(); break; } catch (err) { bad(err.message); await ask('Check the internet connection and press Enter to retry'); }
  }
  const nice = (v) => {
    const [l1, l2, name] = v.id.split('-');
    return { id: v.id, name: `${name.replace(/Neural$/, '').replace(/Multilingual/, ' Multilingual')} ${l1}-${l2}`, info: [v.gender, v.tags].filter(Boolean).join(', ') };
  };
  const ur = all.filter((v) => v.locale.startsWith('ur-')).map(nice);
  const en = all.filter((v) => /^en-(US|GB|IN|AU)$/.test(v.locale)).map(nice);
  ok(`${all.length} free voices available (${ur.length} Urdu)`);
  help(['You will hear each chosen voice as a WhatsApp sample before every video, and pick one there.']);
  e.VOICES_UR = await pickVoices('Urdu', ur, e.VOICES_UR, null, ['ur-PK-AsadNeural', 'ur-PK-UzmaNeural', 'ur-IN-SalmanNeural', 'ur-IN-GulNeural']);
  e.VOICES_EN = await pickVoices('English', en, e.VOICES_EN, null,
    ['en-US-AndrewMultilingualNeural', 'en-US-AvaMultilingualNeural', 'en-US-BrianMultilingualNeural', 'en-GB-RyanNeural']);
  const rate = await choose('Speaking speed', ['Normal', 'A little slower (-8%)', 'A little faster (+8%)'],
    e.TTS_RATE === '-8%' ? 2 : e.TTS_RATE === '+8%' ? 3 : 1);
  e.TTS_RATE = ['+0%', '-8%', '+8%'][rate - 1];

  process.stdout.write(c.d('   test: generating a short Urdu sample… '));
  const tmp = path.join(os.tmpdir(), `wz-${Date.now()}`);
  fs.writeFileSync(`${tmp}.txt`, 'السلام علیکم، یہ آواز کا ایک مختصر نمونہ ہے۔');
  const r = sh(e.PYTHON_BIN, [script, 'speak', '--voice', e.VOICES_UR.split(':')[0], '--text-file', `${tmp}.txt`, '--out', `${tmp}.mp3`, '--meta', `${tmp}.json`], { timeout: 90_000 });
  const words = r.status === 0 ? JSON.parse(fs.readFileSync(`${tmp}.json`, 'utf8')).length : 0;
  console.log(r.status === 0 ? c.g(`ok (${words} word timings for captions)`) : c.r('failed'));
  if (r.status !== 0) warn((r.stderr || '').slice(-300));
}

async function elevenStep(e) {
  help([
    'Where to get the API key:',
    '  1. Open https://elevenlabs.io and sign in (a paid plan is needed for API use of library voices)',
    '  2. Click your profile (bottom-left) → "API Keys"   (or go to https://elevenlabs.io/app/settings/api-keys)',
    '  3. "Create API key" → name it "video bot"',
    '     If it asks for permissions: Text to Speech = Access, Voices = Read, User = Read',
    '  4. Copy the key (starts with sk_). It is shown only once.',
  ]);
  let voices = [];
  e.ELEVEN_API_KEY = await askUntil('ElevenLabs API key', e.ELEVEN_API_KEY || '', async (v) => {
    try { voices = await elevenVoices(v); return null; } catch (err) { return err.message; }
  });
  ok(`Key works. ${voices.length} voices in your account.`);
  help([
    `For good ${c.b('Urdu')} voices: https://elevenlabs.io/app/voice-library → filter Language: Urdu (or Hindi)`,
    '→ "Add to my voices" on the ones you like. Then type  r  here to reload the list.',
  ]);
  const reload = () => elevenVoices(e.ELEVEN_API_KEY);
  e.VOICES_EN = await pickVoices('English', voices, e.VOICES_EN, reload);
  e.VOICES_UR = await pickVoices('Urdu', voices, e.VOICES_UR, reload);
}

function findClaude(current) {
  const cands = [current, 'claude',
    path.join(os.homedir(), '.local', 'bin', WIN ? 'claude.exe' : 'claude'),
    WIN && path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
    '/usr/local/bin/claude', '/usr/bin/claude'].filter(Boolean);
  for (const p of cands) {
    const r = sh(p, ['--version']);
    if (r.status === 0) {
      if (p === 'claude') { // resolve to an absolute path for the service
        const w = sh(WIN ? 'where' : 'which', ['claude']);
        const first = (w.stdout || '').split(/\r?\n/).find(Boolean);
        return first?.trim() || p;
      }
      return p;
    }
  }
  return '';
}

async function claudeWorks(bin, token) {
  process.stdout.write(c.d('   checking Claude token… '));
  const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
  delete env.ANTHROPIC_API_KEY;
  const r = sh(bin, ['-p', '--output-format', 'json', '--max-turns', '1'], { input: 'Reply with just the word OK', env, timeout: 120_000 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch {}
  const good = j && !j.is_error;
  console.log(good ? c.g('works') : c.y('not working yet'));
  if (!good && j?.result) console.log(c.d(`   (${String(j.result).slice(0, 160)})`));
  return good;
}

async function youtubeSession(e) {
  if (fs.existsSync(SESSION)) {
    ok('YouTube login already saved (data/yt-session.json)');
    if (!(await yes('Log in to YouTube again?', 'n'))) return;
  }
  const opts = [];
  if (HAS_DISPLAY) opts.push('Log in now in a browser window (recommended)');
  opts.push('Import cookies exported from my normal Chrome');
  if (!HAS_DISPLAY) opts.push('I will copy yt-session.json from my PC');
  opts.push('Skip YouTube for now');
  const pick = opts[(await choose('How do you want to connect YouTube?', opts)) - 1];

  if (pick.startsWith('Log in now')) {
    help([
      'A Chrome window opens. Sign in with the Google account that owns your YouTube channel,',
      'wait until YouTube Studio has fully loaded, and the window closes by itself.',
      'If Google says "This browser may not be secure", close it and choose the cookies option instead.',
    ]);
    await ask('Press Enter to open the browser');
    const code = await interactive(process.execPath, [path.join(ROOT, 'orchestrator', 'scripts', 'yt-login.js'), SESSION], { cwd: path.join(ROOT, 'orchestrator') });
    if (code === 0 && fs.existsSync(SESSION)) return ok('YouTube login saved');
    bad('Browser login did not finish.');
    return youtubeSession(e);
  }
  if (pick.startsWith('Import cookies')) {
    help([
      '1. In your normal Chrome install the extension "Cookie-Editor" (cookie-editor.com)',
      '2. Open https://studio.youtube.com (signed in) → click Cookie-Editor → Export → "Export as JSON"',
      '   → paste into a file  youtube.json',
      '3. Open https://myaccount.google.com → Cookie-Editor → Export as JSON → file  google.json',
      HAS_DISPLAY ? '' : `4. Copy both files to the server, e.g.:  scp youtube.json google.json ${os.userInfo().username}@SERVER_IP:~/`,
    ].filter(Boolean));
    const files = (await askUntil('Paths of the JSON files (separated by space)', '', (v) => {
      const fsx = v.split(/\s+/).filter(Boolean);
      if (!fsx.length) return 'Give at least the youtube.json path';
      const missing = fsx.find((f) => !fs.existsSync(f.replace(/^~/, os.homedir())));
      return missing ? `File not found: ${missing}` : null;
    })).split(/\s+/).map((f) => f.replace(/^~/, os.homedir()));
    const r = sh(process.execPath, [path.join(ROOT, 'orchestrator', 'scripts', 'yt-cookies.js'), ...files], { cwd: path.join(ROOT, 'orchestrator'), env: { ...process.env, YT_SESSION_FILE: SESSION } });
    if (r.status === 0) return ok('YouTube cookies imported');
    bad(r.stderr || r.stdout);
    return youtubeSession(e);
  }
  if (pick.startsWith('I will copy')) {
    help([
      'On your Windows PC (after running setup-windows.ps1 there, or just its YouTube step):',
      `  scp "%USERPROFILE%\\wa-video-bot\\data\\yt-session.json" ${os.userInfo().username}@SERVER_IP:${SESSION}`,
      'Then press Enter here. You can also do it later; uploads will tell you if it is missing.',
    ]);
    await ask('Press Enter when copied (or to continue without it)');
    return fs.existsSync(SESSION) ? ok('YouTube login found') : warn('No YouTube login yet; add it later and uploads will work.');
  }
  warn('YouTube skipped. Re-run this wizard any time to connect it.');
}

// ---------- automatic updates ----------
async function updatesStep(e) {
  header('Automatic updates (GitHub)');
  const hasGit = sh('git', ['--version']).status === 0;
  const isRepo = fs.existsSync(path.join(ROOT, '.git'));
  const remote = isRepo ? (sh('git', ['remote', 'get-url', 'origin'], { cwd: ROOT }).stdout || '').trim() : '';
  help([
    'The bot can update itself: new versions are pushed to a private GitHub repo, and the bot',
    'checks it every 10 minutes, installs the update and restarts when no video is being made.',
    'Your settings (.env), WhatsApp link and videos are never touched by updates.',
  ]);
  if (!hasGit) { warn('git is not installed, so automatic updates are off. Re-run the setup script to install it.'); return; }
  if (remote) ok(`Updates already connected: ${remote.replace(/\/\/[^@]+@/, '//***@')}`);
  const want = await yes(remote ? 'Change the update repo or token?' : 'Turn on automatic updates now?', remote ? 'n' : 'y');
  if (!want) { if (!remote) warn('Automatic updates are off. Re-run this wizard to turn them on.'); return; }

  help([
    'You need: (1) the repo address and (2) a read-only GitHub token for it.',
    '  Repo: the private repo holding this bot, e.g. https://github.com/YOUR-NAME/wa-video-bot',
    '  Token (read-only, only this repo):',
    '    1. https://github.com/settings/personal-access-tokens/new',
    '    2. Name "video bot updates", Expiration: 1 year (or longer)',
    '    3. Repository access: "Only select repositories" → pick the bot repo',
    '    4. Permissions → Repository permissions → Contents: "Read-only"',
    '    5. Generate token → copy it (starts with github_pat_)',
  ]);
  const url = (await askUntil('Repo address', e.UPDATE_REPO || '', (v) =>
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(v.trim()) ? null : 'Use the form https://github.com/NAME/REPO')).trim().replace(/\/$/, '').replace(/\.git$/, '');
  const token = (await askUntil('Read-only token', '', (v) =>
    /^(github_pat_|ghp_)\S{20,}$/.test(v.trim()) ? null : 'The token starts with github_pat_ (or ghp_)')).trim();
  const authUrl = `${url.replace('https://', `https://x-access-token:${token}@`)}.git`;
  const branch = e.UPDATE_BRANCH || 'main';

  process.stdout.write(c.d('   checking access… '));
  const ls = sh('git', ['ls-remote', authUrl, `refs/heads/${branch}`], { timeout: 60_000 });
  if (ls.status !== 0) {
    console.log(c.r('failed'));
    bad((ls.stderr || '').split('\n').find(Boolean) || 'Could not reach the repo with that token');
    return updatesStep(e);
  }
  if (!ls.stdout.trim()) { console.log(c.y('repo is empty')); warn(`No "${branch}" branch yet. Updates start once the bot code is pushed there.`); }
  else console.log(c.g('ok'));

  if (!isRepo) sh('git', ['init', '-q'], { cwd: ROOT });
  sh('git', ['remote', 'remove', 'origin'], { cwd: ROOT });
  sh('git', ['remote', 'add', 'origin', authUrl], { cwd: ROOT });
  e.UPDATE_REPO = url;
  e.UPDATE_BRANCH = branch;
  e.UPDATE_CHECK_MIN ||= '10';
  if (ls.stdout.trim()) {
    const f = sh('git', ['fetch', '-q', 'origin', branch], { cwd: ROOT, timeout: 120_000 });
    const r = f.status === 0 ? sh('git', ['reset', '-q', '--hard', `origin/${branch}`], { cwd: ROOT }) : f;
    if (r.status === 0) ok('Automatic updates on. The bot is now on the latest version from GitHub.');
    else bad(`Could not sync with GitHub: ${(r.stderr || '').split('\n')[0]}`);
  } else ok('Automatic updates on.');
}

// ---------- Docker / Evolution ----------
function dockerCmd() {
  if (sh('docker', ['info']).status === 0) return ['docker'];
  if (!WIN && sh('sudo', ['-n', 'docker', 'info']).status === 0) return ['sudo', 'docker'];
  return null;
}

async function startEvolution(e) {
  let d = dockerCmd();
  while (!d) {
    bad('Docker is not running.');
    help(WIN
      ? ['Start "Docker Desktop" from the Start menu and wait until it says "Engine running".',
        'First start may ask you to accept terms and enable WSL; restart Windows if it asks.']
      : ['Try: sudo systemctl start docker']);
    await ask('Press Enter to check again');
    d = dockerCmd();
  }
  const [bin, ...pre] = d;
  console.log(c.d('   docker compose up -d …'));
  const code = await interactive(bin, [...pre, 'compose', 'up', '-d'], { cwd: ROOT });
  if (code !== 0) { bad('docker compose failed (see output above).'); process.exit(1); }
  process.stdout.write(c.d('   waiting for Evolution API to start '));
  for (let i = 0; i < 90; i++) {
    const r = await fetch(`${e.EVO_URL}/`, { headers: { apikey: e.EVO_API_KEY } }).catch(() => null);
    if (r && r.status < 500) { console.log(c.g('up')); return; }
    process.stdout.write('.');
    await sleep(2000);
  }
  bad(`Evolution API did not start. Check: ${bin} ${pre.join(' ')} compose logs evolution`);
  process.exit(1);
}

async function evo(e, method, p, body) {
  const r = await fetch(`${e.EVO_URL}${p}`, { method, headers: { apikey: e.EVO_API_KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function linkWhatsApp(e, botNumber) {
  const name = e.EVO_INSTANCE;
  const list = await evo(e, 'GET', '/instance/fetchInstances');
  const exists = Array.isArray(list.body) && list.body.some((i) => (i.name || i.instance?.instanceName) === name);
  if (!exists) {
    const r = await evo(e, 'POST', '/instance/create', { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true });
    if (r.status >= 300) { bad(`Could not create WhatsApp instance: ${JSON.stringify(r.body).slice(0, 200)}`); process.exit(1); }
  }
  const wh = await evo(e, 'POST', `/webhook/set/${name}`, {
    webhook: { enabled: true, url: `${e.SELF_URL}/webhook/${e.WEBHOOK_SECRET}`, byEvents: false, base64: true, events: ['MESSAGES_UPSERT'] },
  });
  if (wh.status >= 300) warn(`Webhook not set: ${JSON.stringify(wh.body).slice(0, 200)}`); else ok('Webhook set');

  const state = async () => (await evo(e, 'GET', `/instance/connectionState/${name}`)).body?.instance?.state;
  if ((await state()) === 'open') return ok('WhatsApp is already linked');

  header('Link WhatsApp');
  const phone = e.SELF_CHAT === 'true' ? 'your phone' : 'the phone with the bot\'s number';
  const how = await choose('How do you want to link?', [
    `Scan a QR code shown here (WhatsApp on ${phone} → Settings → Linked devices → Link a device)`,
    'Enter an 8-letter pairing code on the phone (easier if the QR is hard to scan)',
  ]);
  const { default: qrcode } = await import('qrcode-terminal').catch(() => ({ default: null }));
  for (let round = 0; round < 10; round++) {
    const conn = await evo(e, 'GET', `/instance/connect/${name}${how === 2 ? `?number=${botNumber}` : ''}`);
    if (how === 2 && conn.body?.pairingCode) {
      console.log(`\n   Pairing code:  ${c.b(c.g(conn.body.pairingCode))}`);
      help([`On ${phone}: WhatsApp → Settings → Linked devices → Link a device`,
        '→ "Link with phone number instead" → type the code above.']);
    } else if (conn.body?.code && qrcode) {
      console.log('');
      qrcode.generate(conn.body.code, { small: true });
      help([`Scan with ${phone}: WhatsApp → Settings → Linked devices → Link a device.`, 'The code refreshes every ~40 s.']);
    } else {
      warn(`Could not get a code from Evolution (${JSON.stringify(conn.body).slice(0, 150)}). Retrying…`);
    }
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      if ((await state()) === 'open') return ok('WhatsApp linked!');
    }
    console.log(c.d('   code expired, making a new one…'));
  }
  bad('WhatsApp was not linked. Re-run the wizard to try again.');
}

// ---------- --test ----------
async function selfTest() {
  const e = readEnv();
  process.stdout.write(c.d('   waiting for the bot to start '));
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    up = await fetch(`http://127.0.0.1:${e.PORT || 3000}/health`).then((r) => r.ok).catch(() => false);
    if (!up) { process.stdout.write('.'); await sleep(2000); }
  }
  console.log(up ? c.g('running') : c.r('not responding'));
  if (!up) return process.exit(1);
  const r = await evo(e, 'POST', `/message/sendText/${e.EVO_INSTANCE}`, {
    number: e.OWNER_NUMBER,
    text: '🤖 Setup complete! Send me a script (PDF, DOCX or TXT) to make a video. Send *help* for commands.',
  });
  if (r.status < 300) ok('Test message sent to your WhatsApp' + (e.SELF_CHAT === 'true' ? ' ("Message yourself" chat)' : ''));
  else bad(`Could not send WhatsApp message: ${JSON.stringify(r.body).slice(0, 200)}`);
}

(process.argv.includes('--test') ? selfTest() : main()).catch((err) => {
  bad(err.stack || err.message);
  process.exit(1);
});
