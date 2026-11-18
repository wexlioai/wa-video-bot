import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg, ROOT } from './config.js';
import * as wa from './whatsapp.js';
import { createJob, currentJob, saveJob, loadPlan } from './jobs.js';
import { extractText, detectLanguage } from './extract.js';
import { askClaude, ClaudeLimitError } from './claude.js';
import { validatePlan } from './plan.js';
import { speak, sampleText } from './tts.js';
import { buildProps, renderVideo } from './render.js';
import { uploadVideo } from './youtube.js';
import { serial, exists } from './util.js';

const fileUrl = (job, rel) => `${cfg.selfUrl}/files/${cfg.secret}/${job.id}/${rel}`;
const BUSY = new Set(['PLANNING', 'SAMPLING', 'PRODUCING', 'EDITING', 'UPLOADING']);
// whole message must be an approval word, so "ok, but make the title bigger" is an edit
const APPROVE = /^\s*(ok|okay|yes|approve|approved|publish|upload|haan|han|theek|theek hai|ٹھیک|ٹھیک ہے|ہاں|done)[\s.!👍✅]*$/i;
const LIMIT_RETRY_MIN = 30;

const HELP = [
  'Send me a script as a *PDF, DOCX or TXT* (or paste a long text) and I will make a video.',
  'Commands: `status`, `retry`, `undo` (revert last change), `voice 2` (switch voice), `cancel`, `version`.',
].join('\n');

/** Is a video being made right now? (the supervisor waits for this before restarting) */
export async function isBusy() {
  const job = await currentJob();
  return !!job && BUSY.has(job.state);
}

export const readVersion = async () => (await fs.readFile(path.join(ROOT, 'VERSION'), 'utf8').catch(() => 'dev')).trim();

// ---------------------------------------------------------------------------------------
// Steps. Each one is retryable: its name is stored in job.lastStep before it runs.

const steps = {
  async plan(job) {
    job.state = 'PLANNING';
    await saveJob(job);
    await askClaude(job.dir, 'plan', { SOURCE: job.srcName });
    let plan = await loadPlan(job).catch(() => null);
    let errs = validatePlan(plan);
    if (errs.length) {
      await askClaude(job.dir, 'fix', { ERRORS: errs.map((e) => `- ${e}`).join('\n') });
      plan = await loadPlan(job).catch(() => null);
      errs = validatePlan(plan);
      if (errs.length) throw new Error(`Plan still invalid: ${errs.slice(0, 3).join('; ')}`);
    }
    job.language = plan.language;
    await saveJob(job);
    return steps.samples(job);
  },

  async samples(job) {
    job.state = 'SAMPLING';
    await saveJob(job);
    const plan = await loadPlan(job);
    let voices = plan.language === 'ur' ? cfg.voicesUr : cfg.voicesEn;
    if (!voices.length) voices = [...cfg.voicesUr, ...cfg.voicesEn];
    voices = voices.slice(0, 4);
    if (!voices.length) throw new Error('No voices configured (VOICES_EN / VOICES_UR in .env)');

    const text = sampleText(plan.scenes.map((s) => s.narration).join(' '));
    await fs.mkdir(path.join(job.dir, 'samples'), { recursive: true });
    await wa.sendText(`*${plan.title}*\n${plan.scenes.length} scenes. Here are ${voices.length} voice samples:`);
    for (let i = 0; i < voices.length; i++) {
      const rel = `samples/v${i + 1}.mp3`;
      await speak(text, voices[i].id, path.join(job.dir, rel), plan.language);
      await wa.sendText(`Voice ${i + 1}: ${voices[i].name}`);
      await wa.sendAudio(fileUrl(job, rel));
    }
    const chars = plan.scenes.reduce((a, s) => a + s.narration.length, 0);
    const estSec = Math.round(chars / (plan.language === 'ur' ? 13 : 15));
    job.voices = voices;
    job.estSeconds = estSec;
    job.state = 'AWAIT_VOICE';
    await saveJob(job);
    await wa.sendText(
      `Estimated length ~${fmt(estSec)}` + (cfg.tts.provider === 'elevenlabs' ? ` (${chars} characters of ElevenLabs credit)` : '') + '.\n' +
      'Reply with the voice number and the format:\n' +
      '`2 L` = long video 16:9\n`2 S` = YouTube Short 9:16\n`2 B` = both\n' +
      `Just \`2\` picks ${estSec <= 75 ? 'Short' : 'Long'} automatically.`,
    );
  },

  async produce(job) {
    job.state = 'PRODUCING';
    await saveJob(job);
    const plan = await loadPlan(job);
    await wa.sendText(`Making the voiceover and video (${job.formats.join(' + ')}) with ${job.voice.name}. This takes a few minutes…`);
    const { seconds, charsSpent } = await buildProps(job, plan);
    job.seconds = seconds;
    for (const f of job.formats) {
      job.outputs[f] = await renderVideo(job, f);
    }
    job.state = 'AWAIT_APPROVAL';
    await saveJob(job);
    for (const f of job.formats) {
      const rel = path.relative(job.dir, job.outputs[f].preview);
      const size = (await fs.stat(job.outputs[f].preview)).size;
      const label = f === 'short' ? 'Short 9:16' : 'Long 16:9';
      await wa.sendVideo(fileUrl(job, rel), `${plan.title} (${label}, ${fmt(seconds)}, preview quality)`, size > 15 * 1024 * 1024, `${f}.mp4`);
    }
    if (job.formats.includes('short') && seconds > 180) {
      await wa.sendText('⚠️ The Short is over 3 minutes, so YouTube will treat it as a normal vertical video.');
    }
    await wa.sendText(
      (charsSpent && cfg.tts.provider === 'elevenlabs' ? `Voice credits used now: ${charsSpent} characters.\n` : '') +
      'Reply `ok` to upload to YouTube, or tell me what to change, e.g.\n' +
      '• "scene 3 ka text chota karo"\n• "make the colors green"\n• "title: My new title"\n• `voice 3` / `undo`',
    );
  },

  async edit(job, request) {
    job.state = 'EDITING';
    await saveJob(job);
    await fs.copyFile(path.join(job.dir, 'plan.json'), path.join(job.dir, 'plan.prev.json'));
    const reply = (await askClaude(job.dir, 'edit', { REQUEST: request.replace(/"""/g, '"'), SOURCE: job.srcName })).trim();
    if (/^CANNOT:/i.test(reply)) {
      await fs.copyFile(path.join(job.dir, 'plan.prev.json'), path.join(job.dir, 'plan.json'));
      job.state = 'AWAIT_APPROVAL';
      await saveJob(job);
      return wa.sendText(`I can't do that one: ${reply.replace(/^CANNOT:\s*/i, '')}`);
    }
    const errs = validatePlan(await loadPlan(job).catch(() => null));
    if (errs.length) {
      await fs.copyFile(path.join(job.dir, 'plan.prev.json'), path.join(job.dir, 'plan.json'));
      throw new Error(`Edit produced an invalid plan (reverted): ${errs[0]}`);
    }
    await wa.sendText(`✏️ ${reply.split('\n').pop().slice(0, 300)}`);
    return steps.produce(job);
  },

  async publish(job) {
    job.state = 'UPLOADING';
    await saveJob(job);
    const plan = await loadPlan(job);
    await wa.sendText('Uploading to YouTube…');
    for (const f of job.formats) {
      if (job.uploads[f]) continue;
      job.uploads[f] = await uploadVideo({
        file: job.outputs[f].full,
        title: plan.title,
        description: plan.description,
        tags: plan.tags,
        language: plan.language,
        thumb: f === 'long' ? path.join(job.dir, 'thumb.png') : null,
        isShort: f === 'short',
        debugDir: job.dir,
      });
      await saveJob(job);
    }
    job.state = 'DONE';
    await saveJob(job);
    const links = job.formats.map((f) => `${f === 'short' ? 'Short' : 'Long'}: ${job.uploads[f]}`).join('\n');
    await wa.sendText(
      `✅ Uploaded (${cfg.yt.privacy}).\n${links}` +
      (cfg.yt.privacy === 'private' ? '\nOpen YouTube Studio to make it public or schedule it (or set YT_PRIVACY=public).' : ''),
    );
  },
};

// Run a step with error handling. Claude usage limits are retried automatically.
async function runStep(job, name, arg) {
  job.lastStep = { name, arg };
  await saveJob(job);
  try {
    await serial(() => steps[name](job, arg));
  } catch (e) {
    console.error(`[${job.id}] step ${name} failed:`, e);
    const prevState = job.state;
    job.state = 'FAILED';
    job.failedFrom = prevState;
    await saveJob(job);
    if (e instanceof ClaudeLimitError) {
      await wa.sendText(`Claude usage limit reached. I'll retry automatically every ${LIMIT_RETRY_MIN} min until it resets.`).catch(() => {});
      scheduleLimitRetry(job.id);
    } else {
      await wa.sendText(`❌ ${String(e.message).slice(0, 500)}\nSend \`retry\` to try again.`).catch(() => {});
      if (e.screenshot && (await exists(e.screenshot))) {
        await wa.sendImage(fileUrl(job, path.relative(job.dir, e.screenshot)), 'What the browser saw').catch(() => {});
      }
    }
  }
}

let limitTimer = null;
function scheduleLimitRetry(jobId) {
  clearTimeout(limitTimer);
  limitTimer = setTimeout(async () => {
    const job = await currentJob();
    if (job?.id === jobId && job.state === 'FAILED' && job.lastStep) {
      await runStep(job, job.lastStep.name, job.lastStep.arg);
    }
  }, LIMIT_RETRY_MIN * 60_000);
}

// ---------------------------------------------------------------------------------------
// Incoming messages

async function startJob(saveSource) {
  const job = await createJob();
  await saveSource(job);
  const text = await extractText(job.dir, path.join(job.dir, job.srcName));
  const words = text.split(/\s+/).filter(Boolean).length;
  await wa.sendText(
    `Got it, reading your script${words ? ` (~${words} words, ${detectLanguage(text) === 'ur' ? 'Urdu' : 'English'})` : ''}. ` +
    "I'll send voice samples shortly.",
  );
  await runStep(job, 'plan');
}

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export async function onMessage(data) {
  const k = data?.key || {};
  if (!wa.isFromOwner(data)) {
    // log why, so a "nothing happens" problem is visible in data/bot.log
    if (!wa.isOwnSend(k.id) && !k.fromMe) {
      console.log(`${ts()} [in] ignored: from ${k.remoteJid} (alt ${k.remoteJidAlt || k.senderPn || '-'}), not OWNER_NUMBER ${cfg.ownerNumber}` +
        (cfg.selfChat ? ' (SELF_CHAT=true only accepts your "Message yourself" chat)' : ''));
    }
    return;
  }
  const msg = wa.parseMessage(data);
  if (!msg) return;
  console.log(`${ts()} [in] ${msg.kind === 'doc' ? `document ${msg.fileName}` : `text "${msg.text.slice(0, 60)}"`}`);

  if (msg.kind === 'doc') {
    const buf = await wa.downloadMedia(data);
    const prev = await currentJob();
    if (prev && BUSY.has(prev.state)) {
      return wa.sendText('I am still working on the previous video. Send `cancel` first if you want to start the new one.');
    }
    const safe = msg.fileName.replace(/[^\w.\-]+/g, '_').slice(-80) || 'script';
    return startJob(async (job) => {
      job.srcName = `source${path.extname(safe).toLowerCase() || '.pdf'}`;
      await fs.writeFile(path.join(job.dir, job.srcName), buf);
      await saveJob(job);
    });
  }

  const text = msg.text;
  const lower = text.toLowerCase();
  const job = await currentJob();

  if (lower === 'help' || lower === 'menu') return wa.sendText(HELP);
  if (lower === 'version') return wa.sendText(`Bot version ${await readVersion()}`);
  if (lower === 'status') {
    return wa.sendText(job ? `Current video: ${job.id}, state: ${job.state}` : 'No video in progress.');
  }
  if (lower === 'cancel') {
    if (job) { job.state = 'CANCELLED'; await saveJob(job); }
    return wa.sendText('Cancelled. Send a new script whenever you like.');
  }

  const active = job && !['DONE', 'CANCELLED'].includes(job.state);
  if (!active) {
    if (text.length > 300) {
      return startJob(async (j) => {
        j.srcName = 'source.txt';
        await fs.writeFile(path.join(j.dir, j.srcName), text);
        await saveJob(j);
      });
    }
    return wa.sendText(HELP);
  }

  if (BUSY.has(job.state)) return wa.sendText(`Still working (${job.state.toLowerCase()})… I'll message you when it's ready.`);

  if (lower === 'retry') {
    if (job.state !== 'FAILED' || !job.lastStep) return wa.sendText('Nothing to retry.');
    return runStep(job, job.lastStep.name, job.lastStep.arg);
  }

  if (job.state === 'AWAIT_VOICE') {
    const m = text.match(/^\s*(\d)\s*([lsb])?\s*$/i);
    const n = m ? Number(m[1]) : 0;
    if (!m || n < 1 || n > (job.voices?.length || 0)) {
      return wa.sendText(`Reply with a voice number 1-${job.voices?.length || 4}, optionally with L / S / B (e.g. \`2 L\`).`);
    }
    job.voice = job.voices[n - 1];
    const f = (m[2] || (job.estSeconds <= 75 ? 's' : 'l')).toLowerCase();
    job.formats = f === 'b' ? ['long', 'short'] : f === 's' ? ['short'] : ['long'];
    return runStep(job, 'produce');
  }

  if (job.state === 'FAILED' && !Object.keys(job.outputs || {}).length) {
    return wa.sendText('The last step failed. Send `retry` to try again, or send a new script.');
  }

  if (job.state === 'AWAIT_APPROVAL' || job.state === 'FAILED') {
    if (APPROVE.test(text)) return runStep(job, 'publish');
    const v = lower.match(/^voice\s*(\d)$/);
    if (v) {
      const n = Number(v[1]);
      if (!job.voices?.[n - 1]) return wa.sendText('No such voice.');
      job.voice = job.voices[n - 1];
      return runStep(job, 'produce');
    }
    if (lower === 'undo') {
      const prev = path.join(job.dir, 'plan.prev.json');
      if (!(await exists(prev))) return wa.sendText('Nothing to undo.');
      await fs.copyFile(prev, path.join(job.dir, 'plan.json'));
      return runStep(job, 'produce');
    }
    return runStep(job, 'edit', text);
  }

  return wa.sendText(HELP);
}

/** On boot: tell the owner if the bot was updated, and mark a job that was mid-step as failed so `retry` works. */
export async function recover() {
  const marker = path.join(cfg.dataDir, 'last-version.txt');
  const now = await readVersion();
  const before = (await fs.readFile(marker, 'utf8').catch(() => '')).trim();
  if (before && before !== now) await wa.sendText(`🔄 Bot updated: ${before} → ${now}`).catch(() => {});
  await fs.writeFile(marker, now).catch(() => {});

  const job = await currentJob();
  if (job && BUSY.has(job.state)) {
    job.failedFrom = job.state;
    job.state = 'FAILED';
    await saveJob(job);
    await wa.sendText('The bot restarted while working. Send `retry` to continue.').catch(() => {});
  }
}

function fmt(sec) {
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
