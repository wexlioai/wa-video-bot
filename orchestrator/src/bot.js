import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg, ROOT } from './config.js';
import * as wa from './whatsapp.js';
import { createJob, currentJob, saveJob, loadPlan, userDir, migrateSingleUser } from './jobs.js';
import { extractText, detectLanguage } from './extract.js';
import { askClaude, ClaudeLimitError } from './claude.js';
import { validatePlan } from './plan.js';
import { buildProps, renderVideo } from './render.js';
import { uploadVideo } from './youtube.js';
import { serial, exists, readJson, writeJson, queueLength } from './util.js';
import { voicePage, sampleFor, hasSample, sameService, currentFamily } from './voices.js';
import { startProgress } from './progress.js';
import { engineMissing, runEngineTest, doctor } from './motion.js';
import { speak } from './tts.js';

const toUrl = (p) => p.split(path.sep).join('/');
const fileUrl = (job, rel) => `${cfg.selfUrl}/files/${cfg.secret}/${job.id}/${toUrl(rel)}`;
const sampleUrl = (rel) => `${cfg.selfUrl}/samples/${cfg.secret}/${toUrl(path.relative('voice-samples', rel))}`;
const BUSY = new Set(['PLANNING', 'SAMPLING', 'PRODUCING', 'EDITING', 'UPLOADING']);
// whole message must be an approval word, so "ok, but make the title bigger" is an edit
const APPROVE = /^\s*(ok|okay|yes|approve|approved|publish|upload|haan|han|theek|theek hai|ٹھیک|ٹھیک ہے|ہاں|done)[\s.!👍✅]*$/i;
const LIMIT_RETRY_MIN = 30;

const HELP = [
  'Send me a script as a *PDF, DOCX or TXT* (or paste a long text) and I will make a video.',
  'I ask you everything with tap-to-choose menus (you can also reply with the option number).',
  'Commands: `status`, `retry`, `undo`, `change voice`, `forget voice`, `use lists` / `use polls`, `cancel`, `version`, `engine test`.',
].join('\n');

/** Is a video being made right now? (the supervisor waits for this before restarting) */
let engineBusy = false;
export async function isBusy() {
  if (engineBusy) return true;
  for (const number of cfg.ownerNumbers) {
    const job = await wa.chat.run({ number }, currentJob);
    if (job && BUSY.has(job.state)) return true;
  }
  return false;
}

export const readVersion = async () => (await fs.readFile(path.join(ROOT, 'VERSION'), 'utf8').catch(() => 'dev')).trim();

// ---------------------------------------------------------------------------------------
// Saved preferences (data/users/<number>/prefs.json): { voices: { en: {id,name,provider,family,mode}, ur: {...} } }
const PREFS = () => path.join(userDir(), 'prefs.json'); // per person
const loadPrefs = async () => readJson(PREFS()).catch(() => ({ voices: {} }));
const savePrefs = (p) => writeJson(PREFS(), p);

// ---------------------------------------------------------------------------------------
// Choices: a WhatsApp poll (tap to choose). Typing the option number also works.

const BUTTON = { voice: 'Choose voice', keepVoice: 'Choose', format: 'Choose format', approve: 'Options' };

let listRejected = false; // Evolution refused a list once: use polls until the bot restarts
async function choiceStyle() {
  const style = (await loadPrefs()).choiceStyle || cfg.choiceStyle;
  return style === 'list' && listRejected ? 'poll' : style;
}

async function ask(job, kind, question, options, extra = {}) {
  const labels = options.map((o, i) => `${i + 1}. ${o.label}`);
  const seq = Date.now().toString(36);
  let pollId = null;
  let style = await choiceStyle();
  if (style === 'list') {
    try {
      await wa.sendList(question, `${question}\n(or reply with a number 1-${options.length})`, BUTTON[kind] || 'Choose',
        options.map((o, i) => ({ title: `${i + 1}. ${o.label}`, description: o.desc || '', rowId: `${seq}:${i}` })));
      const prefs = await loadPrefs();
      if ((prefs.listHints || 0) < 3) {
        prefs.listHints = (prefs.listHints || 0) + 1;
        await savePrefs(prefs);
        await wa.sendText("Don't see a menu button above? Reply with the number, or send `use polls`.");
      }
    } catch (e) {
      console.log(`list message rejected by Evolution (${String(e.message).slice(0, 120)}); using polls instead`);
      listRejected = true;
      style = 'poll';
    }
  }
  if (style === 'poll') {
    try {
      pollId = await wa.sendPoll(`${question} (tap one, or reply 1-${options.length})`, labels);
    } catch (e) {
      console.error('poll failed, falling back to text', e.message);
      style = 'text';
    }
  }
  if (style === 'text') await wa.sendText(`${question}\n${labels.join('\n')}\n\nReply with the number.`);
  job.choice = { kind, pollId, seq, options, ...extra };
  job.state = kind === 'approve' ? 'AWAIT_APPROVAL' : 'AWAIT_CHOICE';
  await saveJob(job);
}

/** Map a poll vote ("2. Ava") or a typed reply ("2", "ava") to one of the current options. */
function matchOption(choice, answer, fromPoll = false) {
  if (!choice || answer == null) return null;
  const a = String(answer).trim().toLowerCase();
  // poll options are numbered "N. label"; a typed reply must be a bare number,
  // so an edit like "3 scenes shorter" is never mistaken for option 3
  const n = fromPoll ? a.match(/^(\d{1,2})[.)]/) : a.match(/^(\d{1,2})[.)]?$/);
  if (n) return choice.options[Number(n[1]) - 1] || null;
  const plain = (x) => x.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return choice.options.find((o) => plain(o.label) === plain(a) || (o.name && o.name.toLowerCase() === a)) || null;
}

async function onChoice(job, option) {
  const choice = job.choice;
  job.choice = null;
  await saveJob(job);
  const v = option.value;
  switch (choice.kind) {
    case 'voice':
      if (v === 'more') return runStep(job, 'voices', { page: choice.page + 1, after: choice.after });
      if (v === 'restart') return runStep(job, 'voices', { page: 0, after: choice.after });
      return voiceChosen(job, v, choice.after);
    case 'keepVoice': {
      const prefs = await loadPrefs();
      prefs.voices ||= {};
      prefs.voices[job.language] = { ...job.voice, mode: v };
      await savePrefs(prefs);
      await wa.sendText(v === 'always'
        ? `👍 I'll use *${job.voice.name}* for your next ${job.language === 'ur' ? 'Urdu' : 'English'} videos. Send \`change voice\` any time.`
        : '👍 I will ask you to pick a voice for every video.');
      return choice.after === 'produce' ? runStep(job, 'produce') : askFormat(job);
    }
    case 'format':
      job.formats = v === 'both' ? ['long', 'short'] : [v];
      return runStep(job, 'produce');
    case 'approve':
      if (v === 'upload') return runStep(job, 'publish');
      if (v === 'voice') return runStep(job, 'voices', { page: 0, after: 'produce' });
      if (v === 'undo') return undo(job);
      if (v === 'cancel') { job.state = 'CANCELLED'; await saveJob(job); return wa.sendText('🗑 Cancelled. Send a new script whenever you like.'); }
      if (v === 'edit') {
        job.state = 'AWAIT_APPROVAL';
        await saveJob(job);
        return wa.sendText('✏️ Type what to change, for example:\n• "make scene 3 shorter"\n• "use green colors"\n• "title: My new title"');
      }
      return null;
    default:
      return null;
  }
}

async function voiceChosen(job, voice, after) {
  job.voice = { id: voice.id, name: voice.name, provider: cfg.tts.provider, family: currentFamily() };
  await saveJob(job);
  const prefs = await loadPrefs();
  const saved = prefs.voices?.[job.language];
  if (saved?.mode === 'always' && saved.id === voice.id) {
    return after === 'produce' ? runStep(job, 'produce') : askFormat(job);
  }
  return ask(job, 'keepVoice', `Use *${voice.name}* for your next videos too?`, [
    { label: `Yes, always use ${voice.name}`, value: 'always' },
    { label: 'No, ask me every time', value: 'ask' },
  ], { after });
}

async function askFormat(job) {
  const est = job.estSeconds || 60;
  const long = est > 180;
  return ask(job, 'format', `Your video will be about ${fmt(est)}. Which format?`, [
    { label: 'Long video 16:9', value: 'long' },
    { label: `YouTube Short 9:16${long ? ' (over 3 min: posts as normal vertical video)' : ''}`, value: 'short' },
    { label: 'Both', value: 'both' },
  ]);
}

async function askApproval(job) {
  const opts = [
    { label: '✅ Upload to YouTube', value: 'upload' },
    { label: '✏️ Change something', value: 'edit' },
    { label: '🎙 Change voice', value: 'voice' },
  ];
  if (await exists(path.join(job.dir, 'plan.prev.json'))) opts.push({ label: '↩️ Undo last change', value: 'undo' });
  opts.push({ label: '🗑 Cancel this video', value: 'cancel' });
  return ask(job, 'approve', 'What next?', opts);
}

async function undo(job) {
  const prev = path.join(job.dir, 'plan.prev.json');
  if (!(await exists(prev))) return wa.sendText('Nothing to undo.');
  await fs.copyFile(prev, path.join(job.dir, 'plan.json'));
  await fs.rm(prev, { force: true });
  return runStep(job, 'produce');
}

// ---------------------------------------------------------------------------------------
// Steps. Each one is retryable: its name is stored in job.lastStep before it runs.

const steps = {
  async plan(job) {
    job.state = 'PLANNING';
    await saveJob(job);
    const p = await startProgress('🧠 Claude is reading your script and planning the scenes… (usually about a minute)');
    try {
      await askClaude(job.dir, 'plan', { SOURCE: job.srcName });
    } finally {
      await p.done();
    }
    let plan = await loadPlan(job).catch(() => null);
    let errs = validatePlan(plan);
    if (errs.length) {
      await askClaude(job.dir, 'fix', { ERRORS: errs.map((e) => `- ${e}`).join('\n') });
      plan = await loadPlan(job).catch(() => null);
      errs = validatePlan(plan);
      if (errs.length) throw new Error(`Plan still invalid: ${errs.slice(0, 3).join('; ')}`);
    }
    job.language = plan.language;
    const chars = plan.scenes.reduce((a, s) => a + s.narration.length, 0);
    job.estSeconds = Math.round(chars / (plan.language === 'ur' ? 13 : 15));
    await saveJob(job);
    await wa.sendText(`📝 *${plan.title}*\n${plan.scenes.length} scenes, about ${fmt(job.estSeconds)}.`);

    const saved = (await loadPrefs()).voices?.[job.language];
    if (saved?.mode === 'always' && sameService(saved)) {
      job.voice = { id: saved.id, name: saved.name, provider: saved.provider, family: saved.family };
      await saveJob(job);
      await wa.sendText(`🎙 Using your saved voice *${saved.name}*. (Send \`change voice\` to pick another.)`);
      return askFormat(job);
    }
    return steps.voices(job, { page: 0, after: 'format' });
  },

  // Send up to 6 voice samples (cached after the first time) and a poll to pick one.
  async voices(job, { page = 0, after = 'format' } = {}) {
    job.state = 'SAMPLING';
    await saveJob(job);
    const lang = job.language || 'en';
    let { voices, more } = await voicePage(lang, page);
    if (!voices.length && page > 0) ({ voices, more } = await voicePage(lang, (page = 0)));
    if (!voices.length) throw new Error('No voices available for this voice service.');

    // generate missing samples, 3 at a time
    const rels = new Array(voices.length);
    const missing = (await Promise.all(voices.map((v) => hasSample(v, lang)))).filter((h) => !h).length;
    const p = missing
      ? await startProgress(`🎧 Making ${missing} voice sample${missing > 1 ? 's' : ''} for you… (first time only, about ${missing * 10}s; after that they're instant)`)
      : null;
    let ready = voices.length - missing;
    try {
      for (let i = 0; i < voices.length; i += 2) { // 2 at a time is gentle on the voice service
        await Promise.all(voices.slice(i, i + 2).map(async (v, k) => {
          const had = await hasSample(v, lang);
          rels[i + k] = await sampleFor(v, lang);
          if (!had) await p?.update(`🎧 Making voice samples… ${++ready}/${voices.length} ready`);
        }));
      }
    } finally {
      await p?.done();
    }
    await wa.sendText(`🎧 ${page === 0 ? 'Pick a voice' : 'More voices'}: listen to each sample (about 5 seconds), then choose below.`);
    for (let i = 0; i < voices.length; i++) {
      await wa.sendText(`${i + 1}. *${voices[i].name}*: ${voices[i].desc}`);
      await wa.sendAudio(sampleUrl(rels[i]));
    }
    const options = voices.map((v) => ({ label: v.name, name: v.name, desc: v.desc, value: v }));
    if (more) options.push({ label: '➡️ More voices', desc: 'Show the next 6 voices', value: 'more' });
    else if (page > 0) options.push({ label: '🔁 First voices', desc: 'Back to the first 6 voices', value: 'restart' });
    return ask(job, 'voice', 'Which voice do you like?', options, { page, after });
  },

  async produce(job) {
    job.state = 'PRODUCING';
    await saveJob(job);
    const plan = await loadPlan(job);
    const p = await startProgress(`🎙 Recording the voiceover with ${job.voice.name}…`);
    try {
      const { seconds } = await buildProps(job, plan, (i, n) => p.update(`🎙 Recording the voiceover with ${job.voice.name}: scene ${i}/${n}`));
      job.seconds = seconds;
      for (const [k, f] of job.formats.entries()) {
        const label = f === 'short' ? 'Short (9:16)' : 'long video (16:9)';
        const part = job.formats.length > 1 ? ` (${k + 1}/${job.formats.length})` : '';
        await p.update(`🎬 Rendering the ${label}${part}… 0%`, true);
        let lastPct = 0;
        job.outputs[f] = await renderVideo(job, f, (pct) => {
          if (pct >= lastPct + 10) { lastPct = pct - (pct % 10); p.update(`🎬 Rendering the ${label}${part}… ${lastPct}%`); }
        });
      }
      await p.done(`✅ Video ready (took ${p.elapsed()}). Sending the preview…`);
    } catch (e) {
      await p.done();
      throw e;
    }
    const seconds = job.seconds;
    job.state = 'AWAIT_APPROVAL';
    await saveJob(job);
    for (const f of job.formats) {
      const out = job.outputs[f];
      const rel = path.relative(job.dir, out.preview);
      const size = (await fs.stat(out.preview)).size;
      const label = f === 'short' ? 'Short 9:16' : 'Long 16:9';
      const mb = (size / 1048576).toFixed(1);
      const name = `${plan.title.replace(/[^\w\s-]+/g, '').trim().slice(0, 50) || 'video'} (${label.replace(':', 'x')}).mp4`;
      // HD previews go as a document: WhatsApp keeps the original quality (tap to play)
      await wa.sendVideo(fileUrl(job, rel),
        `${plan.title} (${label}, ${fmt(seconds)}${out.hd ? `, full HD, ${mb} MB` : ', 720p preview'})`,
        out.hd || size > 15 * 1024 * 1024, name);
    }
    if (job.formats.includes('short') && seconds > 180) {
      await wa.sendText('⚠️ The Short is over 3 minutes, so YouTube will treat it as a normal vertical video.');
    }
    return askApproval(job);
  },

  async edit(job, request) {
    job.state = 'EDITING';
    await saveJob(job);
    await fs.copyFile(path.join(job.dir, 'plan.json'), path.join(job.dir, 'plan.prev.json'));
    const p = await startProgress('✏️ Claude is applying your change…');
    let reply;
    try {
      reply = (await askClaude(job.dir, 'edit', { REQUEST: request.replace(/"""/g, '"'), SOURCE: job.srcName })).trim();
    } finally {
      await p.done();
    }
    if (/^CANNOT:/i.test(reply)) {
      await fs.copyFile(path.join(job.dir, 'plan.prev.json'), path.join(job.dir, 'plan.json'));
      job.state = 'AWAIT_APPROVAL';
      await saveJob(job);
      await wa.sendText(`I can't do that one: ${reply.replace(/^CANNOT:\s*/i, '')}`);
      return askApproval(job);
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
    const p = await startProgress('⬆️ Uploading to YouTube…');
    try {
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
    } finally {
      await p.done();
    }
    job.state = 'DONE';
    await saveJob(job);
    const links = job.formats.map((f) => `${f === 'short' ? 'Short' : 'Long'}: ${job.uploads[f]}`).join('\n');
    await wa.sendText(
      `✅ Uploaded (${cfg.yt.privacy}).\n${links}` +
      (cfg.yt.privacy === 'private' ? '\nOpen YouTube Studio to make it public or schedule it.' : ''),
    );
  },
};

// Run a step with error handling. Claude usage limits are retried automatically.
async function runStep(job, name, arg) {
  job.lastStep = { name, arg };
  await saveJob(job);
  const ahead = queueLength();
  if (ahead > 0 && cfg.ownerNumbers.length > 1) {
    await wa.sendText(`⏳ You're in the queue: ${ahead} other video step${ahead > 1 ? 's are' : ' is'} running first. I'll start yours right after.`).catch(() => {});
  }
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

const limitTimers = new Map();
function scheduleLimitRetry(jobId) {
  clearTimeout(limitTimers.get(jobId));
  limitTimers.set(jobId, setTimeout(async () => {
    const job = await currentJob();
    if (job?.id === jobId && job.state === 'FAILED' && job.lastStep) {
      await runStep(job, job.lastStep.name, job.lastStep.arg);
    }
  }, LIMIT_RETRY_MIN * 60_000));
}

// ---------------------------------------------------------------------------------------
// Incoming messages

async function startJob(saveSource) {
  const job = await createJob();
  await saveSource(job);
  const text = await extractText(job.dir, path.join(job.dir, job.srcName));
  const words = text.split(/\s+/).filter(Boolean).length;
  await wa.sendText(
    `📄 Got your script${words ? ` (~${words} words, ${detectLanguage(text) === 'ur' ? 'Urdu' : 'English'})` : ''}.`,
  );
  await runStep(job, 'plan');
}

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const handledPolls = new Set(); // a vote can arrive twice (upsert + update); act once

async function handleVote(pollId, selected) {
  const job = await currentJob();
  if (!job?.choice || !pollId || job.choice.pollId !== pollId) return; // old or unrelated poll
  if (!selected.length) {
    return wa.sendText('I could not read that vote. Please reply with the option number instead.');
  }
  const key = `${pollId}:${selected.join('|')}`;
  if (handledPolls.has(key)) return;
  handledPolls.add(key);
  const opt = matchOption(job.choice, selected[0], true);
  if (!opt) return wa.sendText('Please reply with the option number.');
  console.log(`${ts()} [in] poll vote "${selected[0]}"`);
  return onChoice(job, opt);
}

async function handleSelect(rowId, title) {
  const job = await currentJob();
  if (!job?.choice) return;
  let opt = null;
  if (rowId && rowId.includes(':')) {
    const [seq, i] = rowId.split(':');
    if (seq !== job.choice.seq) return; // tap on an old menu
    opt = job.choice.options[Number(i)];
  }
  opt ||= matchOption(job.choice, title, true);
  if (!opt) return wa.sendText('Please reply with the option number.');
  console.log(`${ts()} [in] menu choice "${opt.label}"`);
  return onChoice(job, opt);
}

/** messages.update with aggregated poll results */
export async function onPollUpdate(d) {
  const selected = (d.pollUpdates || []).filter((o) => (o.voters || []).length).map((o) => o.name);
  const pollId = d.keyId || d.key?.id;
  for (const number of cfg.ownerNumbers) { // the poll belongs to whoever's current question it is
    const job = await wa.chat.run({ number }, currentJob);
    if (job?.choice?.pollId === pollId) return wa.chat.run({ number }, () => handleVote(pollId, selected));
  }
  return null;
}

export async function onMessage(data) {
  const k = data?.key || {};
  const number = wa.ownerOf(data);
  if (number) return wa.chat.run({ number }, () => handleMessage(data));
  // log why, so a "nothing happens" problem is visible in the log
  if (!wa.isOwnSend(k.id) && !k.fromMe) {
    console.log(`${ts()} [in] ignored: from ${k.remoteJid} (alt ${k.remoteJidAlt || k.senderPn || '-'}), not in OWNER_NUMBER (${cfg.ownerNumbers.join(', ')})` +
      (cfg.selfChat ? ' (SELF_CHAT=true only accepts your "Message yourself" chat)' : ''));
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Phase 0: does the new motion engine (HyperFrames) render on this machine, and how fast?
async function engineTest() {
  if (await isBusy()) return wa.sendText('A video is being made right now. Send `engine test` again when it is finished.');
  const missing = await engineMissing();
  if (missing) return wa.sendText(`⚠️ I can't run the engine test yet: ${missing}.`);
  return serial(async () => {
    engineBusy = true;
    const p = await startProgress('🧪 Engine test: making a 15-second animated test video…');
    try {
      const id = `engine-test-${Date.now()}`;
      const dir = path.join(cfg.dataDir, 'jobs', id);
      const saved = (await loadPrefs()).voices?.en;
      const voiceId = saved?.id || (await voicePage('en', 0)).voices[0]?.id;
      const r = await runEngineTest(dir, {
        speakFn: voiceId ? (text, out) => speak(text, voiceId, out, 'en') : null,
        onStage: (stage, pct) => p.update({
          voice: '🧪 Engine test: recording the test voice…',
          lint: '🧪 Engine test: checking the composition…',
          render: `🧪 Engine test: rendering${pct != null ? `… ${pct}%` : '…'}`,
        }[stage]),
      });
      if (!r.ok) {
        await p.done('❌ Engine test failed.');
        const doc = await doctor(dir);
        return wa.sendText([
          `Machine: ${r.machine}`,
          `Error:\n${'```'}${(r.error || 'no output').slice(-1200)}${'```'}`,
          `Doctor:\n${'```'}${doc.slice(0, 1500)}${'```'}`,
          'Send me (Claude, in our chat) this message and I will fix it.',
        ].join('\n\n'));
      }
      const speed = r.seconds / r.renderSec;
      await p.done(`✅ Engine test passed (took ${p.elapsed()}).`);
      await wa.sendText([
        '🧪 *Engine test result*',
        `Machine: ${r.machine}`,
        `Render: ${r.seconds.toFixed(1)} s of video in ${r.renderSec.toFixed(0)} s (${speed >= 1 ? `${speed.toFixed(2)}× faster than real time` : `${(1 / speed).toFixed(1)}× slower than real time`})`,
        `A 2-minute video would take about ${Math.ceil((120 / speed) / 60)} min to render.`,
        `File: ${r.mb.toFixed(1)} MB, full HD`,
        r.voiceError ? `Voice: failed (${r.voiceError}), rendered without voice` : `Voice: ${r.words} words, captions synced (${r.voiceSec.toFixed(0)} s)`,
        `Lint: ${r.lintOk ? 'clean' : `warnings\n${r.lint}`}`,
      ].join('\n'));
      await wa.sendVideo(`${cfg.selfUrl}/files/${cfg.secret}/${id}/engine-test.mp4`, 'Engine test (HyperFrames, 15 s, full HD)', true, 'engine-test.mp4');
    } catch (e) {
      await p.done('❌ Engine test failed.');
      await wa.sendText(`Engine test error: ${e.message.slice(0, 1500)}`);
    } finally {
      engineBusy = false;
    }
  });
}

async function handleMessage(data) {
  const msg = wa.parseMessage(data);
  if (!msg) return;

  if (msg.kind === 'poll') return handleVote(msg.pollId, msg.selected);
  if (msg.kind === 'select') return handleSelect(msg.rowId, msg.title);

  console.log(`${ts()} [in ${wa.currentNumber()}] ${msg.kind === 'doc' ? `document ${msg.fileName}` : `text "${msg.text.slice(0, 60)}"`}`);

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
  const lower = text.toLowerCase().trim();
  const job = await currentJob();

  if (lower === 'help' || lower === 'menu') return wa.sendText(HELP);
  if (lower === 'version') return wa.sendText(`Bot version ${await readVersion()}`);
  if (lower === 'engine test' || lower === 'test engine') return engineTest();
  if (lower === 'status') {
    return wa.sendText(job ? `Current video: ${job.id}, state: ${job.state}` : 'No video in progress.');
  }
  if (lower === 'use polls' || lower === 'use lists' || lower === 'use numbers') {
    const prefs = await loadPrefs();
    prefs.choiceStyle = lower === 'use polls' ? 'poll' : lower === 'use lists' ? 'list' : 'text';
    await savePrefs(prefs);
    return wa.sendText(`👍 From now on I'll show choices as ${{ poll: 'polls', list: 'menus (lists)', text: 'numbered text' }[prefs.choiceStyle]}.`);
  }
  if (lower === 'forget voice' || lower === 'reset voice') {
    const prefs = await loadPrefs();
    prefs.voices = {};
    await savePrefs(prefs);
    return wa.sendText('🎙 Saved voice cleared. I will ask you to pick a voice next time.');
  }
  if (lower === 'cancel') {
    if (job) { job.state = 'CANCELLED'; job.choice = null; await saveJob(job); }
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

  if (/^(change )?voices?$/.test(lower) && job.language && job.state !== 'FAILED') {
    return runStep(job, 'voices', { page: 0, after: job.outputs && Object.keys(job.outputs).length ? 'produce' : 'format' });
  }

  if (job.state === 'AWAIT_VOICE') return runStep(job, 'voices', { page: 0, after: 'format' }); // job from an older version

  // a typed answer to the current poll (number or option name)
  if (job.choice) {
    const opt = matchOption(job.choice, text);
    if (opt) return onChoice(job, opt);
    if (job.choice.kind !== 'approve') {
      return wa.sendText(`Please tap an option in the poll above, or reply with its number (1-${job.choice.options.length}).`);
    }
  }

  if (job.state === 'FAILED' && !Object.keys(job.outputs || {}).length) {
    return wa.sendText('The last step failed. Send `retry` to try again, or send a new script.');
  }

  if (job.state === 'AWAIT_APPROVAL' || job.state === 'FAILED') {
    if (APPROVE.test(text)) return runStep(job, 'publish');
    if (lower === 'undo') return undo(job);
    job.choice = null;
    return runStep(job, 'edit', text);
  }

  return wa.sendText(HELP);
}

/** On boot: tell the main owner if the bot was updated, and mark jobs that were mid-step as failed so `retry` works. */
export async function recover() {
  await migrateSingleUser();
  const marker = path.join(cfg.dataDir, 'last-version.txt');
  const now = await readVersion();
  const before = (await fs.readFile(marker, 'utf8').catch(() => '')).trim();
  if (before && before !== now) await wa.sendText(`🔄 Bot updated: ${before} → ${now}`).catch(() => {});
  await fs.writeFile(marker, now).catch(() => {});

  // make sure Evolution also sends poll results (messages.update)
  await wa.ensureWebhook().catch((e) => console.error('webhook update failed', e.message));

  for (const number of cfg.ownerNumbers) {
    await wa.chat.run({ number }, async () => {
      const job = await currentJob();
      if (job && BUSY.has(job.state)) {
        job.failedFrom = job.state;
        job.state = 'FAILED';
        await saveJob(job);
        await wa.sendText('The bot restarted while working. Send `retry` to continue.').catch(() => {});
      }
    });
  }
}

function fmt(sec) {
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

