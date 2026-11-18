import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..'); // wa-video-bot/
dotenv.config({ path: path.join(ROOT, '.env') }); // same .env as docker-compose

function defaultPython() {
  const venv = process.platform === 'win32'
    ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'bin', 'python');
  return fs.existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';
}

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

// "voiceId:Name,voiceId:Name" -> [{id, name}]
function parseVoices(s) {
  return (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [id, ...rest] = x.split(':');
      return { id: id.trim(), name: (rest.join(':') || id).trim() };
    });
}

export const cfg = {
  port: Number(process.env.PORT || 3000),
  secret: req('WEBHOOK_SECRET'),
  // URL Evolution (inside Docker) uses to reach this service, e.g. http://host.docker.internal:3000
  selfUrl: (process.env.SELF_URL || 'http://host.docker.internal:3000').replace(/\/$/, ''),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  videoDir: path.join(ROOT, 'video'),
  promptsDir: path.join(ROOT, 'prompts'),

  evo: {
    url: (process.env.EVO_URL || 'http://127.0.0.1:8080').replace(/\/$/, ''),
    apiKey: req('EVO_API_KEY'),
    instance: process.env.EVO_INSTANCE || 'videobot',
  },
  ownerNumber: req('OWNER_NUMBER').replace(/\D/g, ''), // e.g. 923001234567
  // true  = bot runs on YOUR number, you talk to it in "Message yourself" chat
  // false = bot runs on a second number, you message that number
  selfChat: (process.env.SELF_CHAT || 'true') === 'true',

  tts: {
    provider: process.env.TTS_PROVIDER || 'edge', // edge (free) | openspeaker | elevenlabs
    // python with the edge-tts package; the installers create .venv in the project folder
    python: process.env.PYTHON_BIN || defaultPython(),
    rate: process.env.TTS_RATE || '+0%', // e.g. -5% for slower speech
  },
  voicesEn: parseVoices(process.env.VOICES_EN),
  voicesUr: parseVoices(process.env.VOICES_UR),

  openspeaker: {
    apiKey: (process.env.TTS_PROVIDER === 'openspeaker' ? req('OPENSPEAKER_API_KEY') : process.env.OPENSPEAKER_API_KEY || ''),
    speed: Number(process.env.OPENSPEAKER_SPEED || 1), // 0.5 - 1.5
  },

  eleven: {
    apiKey: (process.env.TTS_PROVIDER === 'elevenlabs' ? req('ELEVEN_API_KEY') : process.env.ELEVEN_API_KEY || ''),
    model: process.env.ELEVEN_MODEL || 'eleven_v3',
    sampleChars: Number(process.env.SAMPLE_CHARS || 260),
  },

  claude: {
    bin: process.env.CLAUDE_BIN || 'claude',
    model: process.env.CLAUDE_MODEL || '', // empty = Claude Code default
    timeoutMs: Number(process.env.CLAUDE_TIMEOUT_MIN || 15) * 60_000,
  },

  render: {
    concurrency: process.env.RENDER_CONCURRENCY || '3',
    captions: (process.env.CAPTIONS || 'true') === 'true',
  },

  yt: {
    method: process.env.YT_METHOD || 'browser', // browser | api
    sessionFile: path.resolve(process.env.YT_SESSION_FILE || path.join(ROOT, 'data', 'yt-session.json')),
    clientId: process.env.YT_CLIENT_ID || '',
    clientSecret: process.env.YT_CLIENT_SECRET || '',
    refreshToken: process.env.YT_REFRESH_TOKEN || '',
    privacy: process.env.YT_PRIVACY || 'private',
    categoryId: process.env.YT_CATEGORY || '27', // 27 = Education
  },
};
