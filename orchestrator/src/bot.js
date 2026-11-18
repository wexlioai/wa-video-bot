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
import { engineMissing, runEngineTest, doctor, motionEngine, renderProject, markEngineOk, gsapPath } from './motion.js';
import { initSettings, snapshotVersion, restoreVersion, loadSettings, saveSettings, applyTweaks, parseTweaks, TWEAKS, normalizeSettings } from './project.js';
import { styleLibrary, bannedIssues } from './look.js';
import { pathToFileURL } from 'node:url';
import { prepareRefs, loadDirections, shootFrames, applyLook, savedText, tasteText, loadLook } from './look.js';
import { designScenes, storyboard, acceptEditedScenes, reviewScenes } from './designer.js';
import { pickMusic, whoosh } from './music.js';
import { speak } from './tts.js';

const toUrl = (p) => p.split(path.sep).join('/');
const fileUrl = (job, rel) => `${cfg.selfUrl}/files/${cfg.secret}/${job.id}/${toUrl(rel)}`;
const sampleUrl = (rel) => `${cfg.selfUrl}/samples/${cfg.secret}/${toUrl(path.relative('voice-samples', rel))}`;
const BUSY = new Set(['PLANNING', 'DIRECTING', 'SAMPLING', 'PRODUCING', 'EDITING', 'UPLOADING']);
// whole message must be an approval word, so "ok, but make the title bigger" is an edit
const APPROVE = /^\s*(ok|okay|yes|approve|approved|publish|upload|haan|han|theek|theek hai|ٹھیک|ٹھیک ہے|ہاں|done)[\s.!👍✅]*$/i;
const LIMIT_RETRY_MIN = 30;

const HELP = [
  'Send me a script as a *PDF, DOCX or TXT* (or paste a long text) and I will make a video.',
  'I ask you everything with tap-to-choose menus (you can also reply with the option number).',
  'Commands: `status`, `retry`, `undo`, `change voice`, `change look`, `forget voice`, `forget style`, `use lists` / `use polls`, `cancel`, `version`, `engine test`.',
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

const BUTTON = { voice: 'Choose voice', keepVoice: 'Choose', look: 'Choose look', keepLook: 'Choose', format: 'Choose format', approve: 'Options' };

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
  if (extra.multi && style === 'list') style = 'poll';
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
      pollId = extra.multi
        ? await wa.sendPoll(`${question} (tick all you want, then tick the last option; or reply e.g. 1 3)`, labels, options.length)
        : await wa.sendPoll(`${question} (tap one, or reply 1-${options.length})`, labels);
    } catch (e) {
      console.error('poll failed, falling back to text', e.message);
      style = 'text';
    }
  }
  if (style === 'text') await wa.sendText(`${question}\n${labels.join('\n')}\n\nReply with the number${extra.multi ? 's (e.g. 1 3)' : ''}.`);
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
    case 'look': {
      const d = job.directions.find((x) => x.n === (v === 'surprise' ? job.recommended : v)) || job.directions[0];
      await applyLook(job.dir, d, job.brief);
      const prefs = await loadPrefs();
      prefs.taste ||= { picks: [] };
      prefs.taste.picks = [...(prefs.taste.picks || []), { name: d.name, style: d.style, styleName: d.styleName, motion: d.motion, at: new Date().toISOString() }].slice(-20);
      await savePrefs(prefs);
      await wa.sendText(`🎨 *${d.name}* it is.`);
      if (!prefs.look) {
        return ask(job, 'keepLook', `Use the *${d.styleName}* style for your next videos too? (Colours will still be chosen for each script.)`, [
          { label: `Yes, always ${d.styleName}`, value: 'always' },
          { label: 'No, show me 3 looks each time', value: 'ask' },
        ], { after: choice.after, direction: d });
      }
      return afterLook(job, choice.after);
    }
    case 'keepLook': {
      const prefs = await loadPrefs();
      const d = choice.direction;
      prefs.look = { mode: v, style: d.style, styleName: d.styleName, fonts: { heading: d.fonts.heading.family, body: d.fonts.body.family } };
      await savePrefs(prefs);
      await wa.sendText(v === 'always'
        ? `👍 Next videos will use the *${d.styleName}* style. Send \`change look\` on any video to see other looks, or \`forget style\` to stop.`
        : '👍 I will show you 3 looks for every video.');
      return afterLook(job, choice.after);
    }
    case 'saveDefault': {
      const prefs = await loadPrefs();
      if (v === 'yes') {
        prefs.defaultSettings = normalizeSettings({ ...(prefs.defaultSettings || {}), ...job.pendingDefault.patch });
        await wa.sendText('👍 Saved as your default for new videos.');
      } else {
        prefs.declinedDefaults = [...new Set([...(prefs.declinedDefaults || []), job.pendingDefault.key])];
      }
      await savePrefs(prefs);
      job.pendingDefault = null;
      await saveJob(job);
      return askApproval(job);
    }
    case 'thumb':
      await fs.copyFile(v === 'frame' ? path.join(job.dir, 'frame.png') : path.join(job.dir, 'thumbs', `t${v}.png`), path.join(job.dir, 'thumb.png')).catch(() => {});
      job.thumbChosen = true;
      await saveJob(job);
      return runStep(job, 'publish');
    case 'storyboard':
      if (v === 'go') { job.storyboardOk = true; return runStep(job, 'produce'); }
      if (v === 'look') { job.forceLookChoice = true; return runStep(job, 'direct', { after: 'produce' }); }
      job.choice = { ...choice, options: choice.options }; // keep waiting on the storyboard
      job.state = 'AWAIT_CHOICE';
      await saveJob(job);
      return wa.sendText('✏️ Type what to change, for example:\n• "scene 3: show a map instead of the chart"\n• "make the title bigger"\n• "warmer colours"');
    case 'format':
      job.formats = v === 'both' ? ['long', 'short'] : [v];
      return runStep(job, 'produce');
    case 'approve':
      if (v === 'upload') return startUpload(job);
      if (v === 'voice') return runStep(job, 'voices', { page: 0, after: 'produce' });
      if (v === 'look') { job.forceLookChoice = true; return runStep(job, 'direct', { after: 'produce' }); }
      if (v === 'undo') return undo(job);
      if (v === 'tweaks') return askTweaks(job);
      if (v === 'suggest') return askSuggestions(job);
      if (v === 'cancel') { job.state = 'CANCELLED'; await saveJob(job); return wa.sendText('🗑 Cancelled. Send a new script whenever you like.'); }
      if (v === 'edit') {
        job.state = 'AWAIT_APPROVAL';
        await saveJob(job);
        return wa.sendText('✏️ Type what to change in your own words, for example:\n• "at 0:42 show a map instead of the chart"\n• "scene 3: warmer colours"\n• "bigger subtitles at the top"\n• "change the title to …"\nTimes, scene numbers or quoting the words all work.');
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
  if (job.pendingDefault) return askSaveDefault(job);
  const opts = [
    { label: '✅ Upload to YouTube', value: 'upload' },
    { label: '⚡ Quick tweaks (subtitles, voice speed…)', value: 'tweaks' },
    { label: '✏️ Change something (type it)', value: 'edit' },
  ];
  if (job.suggestions?.length) opts.push({ label: `💡 ${job.suggestions.length} suggestion${job.suggestions.length > 1 ? 's' : ''} from the review`, value: 'suggest' });
  opts.push({ label: '🎙 Change voice', value: 'voice' }, { label: '🎨 Change look', value: 'look' });
  if ((job.version || 0) > 1 || (await exists(path.join(job.dir, 'plan.prev.json')))) opts.push({ label: '↩️ Undo last change', value: 'undo' });
  opts.push({ label: '🗑 Cancel this video', value: 'cancel' });
  return ask(job, 'approve', 'What next?', opts);
}

async function undo(job) {
  if ((job.version || 0) > 1) {
    const back = job.version - 1;
    await restoreVersion(job, back);
    job.changeNote = `undo (back to v${back})`;
    await saveJob(job);
    await wa.sendText(`↩️ Going back to version ${back}…`);
    return runStep(job, 'produce');
  }
  const prev = path.join(job.dir, 'plan.prev.json');
  if (!(await exists(prev))) return wa.sendText('Nothing to undo.');
  await fs.copyFile(prev, path.join(job.dir, 'plan.json'));
  await fs.rm(prev, { force: true });
  return runStep(job, 'produce');
}

// ---------------------------------------------------------------------------------------
// Steps. Each one is retryable: its name is stored in job.lastStep before it runs.

// ---------------------------------------------------------------------------------------
// Changes after the preview: quick tweaks (no Claude), review suggestions, typed changes.

const TWEAK_MENU = ['subs-bigger', 'subs-smaller', 'subs-top', 'subs-bottom', 'subs-off', 'voice-slower', 'voice-faster', 'music-quieter', 'music-louder', 'music-off', 'motion-livelier'];

async function askTweaks(job) {
  const s = await loadSettings(job);
  const now = `Now: subtitles ${s.captions.position === 'off' ? 'off' : `${s.captions.size}, ${s.captions.position}, ${s.captions.style}`}; voice ${s.voice.speed.toFixed(2)}×; music ${s.music.volume}; motion ${s.motion.energy}.\n(Type "next subtitle style", "calmer motion" or "change music" for more.)`;
  await wa.sendText(`⚡ ${now}`);
  return ask(job, 'tweaks', 'Quick tweaks', [
    ...TWEAK_MENU.map((k) => ({ label: TWEAKS[k].label, value: k })),
    { label: '✅ Apply the ticked tweaks', value: 'apply' },
  ], { multi: true });
}

async function askSuggestions(job) {
  const list = job.suggestions || [];
  if (!list.length) return askApproval(job);
  await wa.sendText(`💡 Suggestions from the review:\n${list.map((x, i) => `${i + 1}. ${x.text}`).join('\n')}`);
  return ask(job, 'suggest', 'Which should I do?', [
    ...list.map((x, i) => ({ label: x.text.slice(0, 90), value: i })),
    { label: '✅ Apply the ticked ones', value: 'apply' },
  ], { multi: true });
}

/** A multi-select poll was confirmed (or numbers typed). */
async function onMulti(job, picked) {
  const kind = job.choice?.kind;
  job.choice = null;
  await saveJob(job);
  if (!picked.length) { await wa.sendText('Nothing ticked, so nothing changed.'); return askApproval(job); }
  if (kind === 'tweaks') return applyTweakKeys(job, picked.map((o) => o.value));
  if (kind === 'suggest') {
    const chosen = picked.map((o) => job.suggestions[o.value]).filter(Boolean);
    job.suggestions = job.suggestions.filter((x) => !chosen.includes(x));
    await saveJob(job);
    return runStep(job, 'edit', `Please do these improvements: ${chosen.map((x) => `${x.text}${x.scenes?.length ? ` (scenes ${x.scenes.join(', ')})` : ''}`).join(' | ')}`);
  }
  return askApproval(job);
}

/** Apply settings tweaks and re-render (Claude is not needed). */
async function applyTweakKeys(job, keys) {
  const before = await loadSettings(job);
  const { settings, changes } = applyTweaks(before, keys);
  if (!changes.length) { await wa.sendText('That is already how it is set.'); return askApproval(job); }
  await saveSettings(job, settings);
  job.changeNote = changes.join('; ').slice(0, 120);
  // learn: the same tweak twice → offer to make it the default
  const prefs = await loadPrefs();
  prefs.tweakCounts ||= {};
  for (const k of keys) prefs.tweakCounts[k] = (prefs.tweakCounts[k] || 0) + 1;
  await savePrefs(prefs);
  const repeat = keys.find((k) => prefs.tweakCounts[k] >= 2 && !(prefs.declinedDefaults || []).includes(k));
  if (repeat) {
    const patch = repeat.startsWith('subs') ? { captions: settings.captions } : repeat.startsWith('voice') ? { voice: settings.voice } : repeat.startsWith('music') ? { music: settings.music } : { motion: settings.motion };
    const differs = JSON.stringify(normalizeSettings({ ...(prefs.defaultSettings || {}), ...patch })) !== JSON.stringify(normalizeSettings(prefs.defaultSettings || {}));
    if (differs) job.pendingDefault = { key: repeat, label: TWEAKS[repeat].label, patch };
  }
  await saveJob(job);
  await wa.sendText(`⚡ Changing: ${changes.join('; ')}. Re-rendering (no new design needed)…`);
  return runStep(job, 'produce');
}

async function askSaveDefault(job) {
  const d = job.pendingDefault;
  const what = Object.entries(d.patch).map(([k, v]) => `${k}: ${Object.values(v).join(', ')}`).join('; ');
  return ask(job, 'saveDefault', `You've used "${d.label}" more than once. Make it the default for new videos (${what})?`, [
    { label: 'Yes, make it my default', value: 'yes' },
    { label: 'No, just this video', value: 'no' },
  ]);
}

/** scene timeline for the change prompt (what is at 0:42?) */
async function writeTimeline(job, plan) {
  const props = await readJson(path.join(job.dir, 'props.json')).catch(() => null);
  if (!props) return;
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  let t = 0;
  const scenes = props.scenes.map((s, i) => {
    const d = s.durationInFrames / (props.fps || 30);
    const row = { n: i + 1, id: s.id, from: mmss(t), to: mmss(t + d), narration: plan.scenes.find((x) => x.id === s.id)?.narration };
    t += d;
    return row;
  });
  await writeJson(path.join(job.dir, 'timeline.json'), { scenes });
}

/** A typed change on the new engine: Claude edits scenes / palette / settings / words, then re-render. */
async function changeVideo(job, request) {
  const plan = await loadPlan(job);
  const look = await loadLook(job.dir);
  const style = (await styleLibrary()).find((x) => x.id === look?.style);
  await writeTimeline(job, plan);
  await prepareRefs(job.dir);
  await fs.rm(path.join(job.dir, 'change.json'), { force: true });
  const p = await startProgress('✏️ Claude is making your change…');
  let reply;
  try {
    reply = (await askClaude(job.dir, 'change', { REQUEST: request.replace(/"""/g, '"'), STYLE_FILE: style?.file || 'flat-explainer.md' }, { maxTurns: 40 })).trim();
  } catch (e) {
    await p.done();
    await restoreVersion(job, job.version).catch(() => {});
    throw e;
  }
  await p.done();
  if (/^CANNOT:/i.test(reply)) {
    await restoreVersion(job, job.version).catch(() => {});
    job.state = 'AWAIT_APPROVAL';
    await saveJob(job);
    await wa.sendText(`🤔 ${reply.replace(/^CANNOT:\s*/i, '')}`);
    return askApproval(job);
  }
  const newPlan = await loadPlan(job).catch(() => null);
  const errs = validatePlan(newPlan);
  if (errs.length) {
    await restoreVersion(job, job.version).catch(() => {});
    throw new Error(`The change broke the plan, so I undid it: ${errs[0]}`);
  }
  const ch = await readJson(path.join(job.dir, 'change.json')).catch(() => ({}));
  const newLook = await loadLook(job.dir);
  if (newLook?.palette) {
    const pp = newLook.palette;
    newPlan.theme = { bg: pp.bg, bg2: pp.bg2, primary: pp.primary, accent: pp.accent, text: pp.ink };
    await writeJson(path.join(job.dir, 'plan.json'), newPlan);
  }
  const bad = await acceptEditedScenes(job, { plan: newPlan, look: newLook || look, formats: job.formats });
  for (const line of bad) { // an edited scene that fails its checks goes back to the previous version
    const id = line.split(':')[0];
    await fs.copyFile(path.join(job.dir, 'versions', `v${job.version}`, 'scenes', `${id}.html`), path.join(job.dir, 'scenes', `${id}.html`)).catch(() => {});
  }
  if (bad.length) console.log(`${ts()} [${job.id}] edited scenes reverted after failed checks: ${bad.join(' | ').slice(0, 400)}`);
  await wa.sendText(`✏️ ${String(ch.summary || reply.split('\n').pop()).slice(0, 300)}${ch.narration?.length ? '\n🎙 New words will be re-recorded.' : ''}`);
  job.changeNote = request.slice(0, 120);
  await saveJob(job);
  return steps.produce(job);
}

/** YouTube chapters from the scenes: at least 3, each 10 s or longer, first at 0:00. */
async function chaptersText(job, plan) {
  const props = await readJson(path.join(job.dir, 'props.json')).catch(() => null);
  if (!props) return '';
  const name = (v = {}, narration = '') => {
    const t = v.heading || v.label || v.text || v.left?.title || narration;
    return String(t).replace(/\s+/g, ' ').split(' ').slice(0, 7).join(' ').replace(/[.,:;!?]+$/, '').slice(0, 60);
  };
  const raw = [];
  let t = 0;
  for (const s of props.scenes) {
    const ps = plan.scenes.find((x) => x.id === s.id) || {};
    raw.push({ t, title: name(ps.visual, ps.narration) });
    t += s.durationInFrames / (props.fps || 30);
  }
  const total = t;
  const ch = [];
  for (const c of raw) {
    if (!ch.length) { ch.push({ ...c, t: 0, title: plan.title.slice(0, 60) }); continue; }
    if (c.t - ch[ch.length - 1].t >= 10 && total - c.t >= 10) ch.push(c);
  }
  if (ch.length < 3 || total < 60) return '';
  const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  return `\n\n${plan.language === 'ur' ? 'ابواب' : 'Chapters'}:\n${ch.slice(0, 20).map((c) => `${mmss(c.t)} ${c.title}`).join('\n')}`;
}

/** Upload: for long videos with a designed look, first pick a thumbnail. */
async function startUpload(job) {
  const look = await loadLook(job.dir);
  if (look) { // remember which looks made it to YouTube (taste for the art director)
    const prefs = await loadPrefs();
    const pick = [...(prefs.taste?.picks || [])].reverse().find((x) => x.name === look.name);
    if (pick && !pick.uploaded) { pick.uploaded = true; await savePrefs(prefs); }
  }
  if (job.formats.includes('long') && !job.thumbChosen && (await loadLook(job.dir))) return runStep(job, 'thumbs');
  return runStep(job, 'publish');
}

/** Continue after the look is set. inStep = we are already inside a running step (serial). */
function afterLook(job, after, inStep) {
  if (inStep) return after === 'produce' ? steps.produce(job) : steps.voiceStart(job);
  return runStep(job, after === 'produce' ? 'produce' : 'voiceStart');
}

/** Screenshot thumbs/t1-3.html at 1280×720 (after the banned-look check). Returns the numbers that worked. */
async function shootThumbs(dir) {
  const { chromium } = await import('playwright');
  const ok = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    for (const n of [1, 2, 3]) {
      const f = path.join(dir, 'thumbs', `t${n}.html`);
      const html = await fs.readFile(f, 'utf8').catch(() => null);
      if (!html) continue;
      const issues = bannedIssues(html, { html: true });
      if (issues.length) { console.log(`thumbnail ${n} rejected: ${issues.join(', ')}`); continue; }
      await page.goto(pathToFileURL(f).href, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(dir, 'thumbs', `t${n}.png`), clip: { x: 0, y: 0, width: 1280, height: 720 } });
      ok.push(n);
    }
  } finally {
    await browser.close();
  }
  return ok;
}

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
    return steps.direct(job, { after: 'voice' });
  },

  // Art direction: brief + 3 designed looks (or 1 in the saved style), then the voice / render.
  async direct(job, { after = 'voice' } = {}) {
    job.state = 'DIRECTING';
    await saveJob(job);
    const prefs = await loadPrefs();
    const saved = prefs.look?.mode === 'always' && !job.forceLookChoice ? prefs.look : null;
    job.forceLookChoice = false;
    job.storyboardOk = false;
    const p = await startProgress(saved
      ? `🎨 Designing the look in your saved style (${saved.styleName})…`
      : '🎨 Claude is designing 3 looks for your video… (about 2-3 minutes)');
    let res = null;
    try {
      await fs.rm(path.join(job.dir, 'look'), { recursive: true, force: true });
      await prepareRefs(job.dir);
      await askClaude(job.dir, 'direct', {
        SAVED: savedText(saved),
        TASTE: tasteText(prefs.taste?.picks),
        COUNT: saved ? 'exactly 1 direction' : 'exactly 3 directions',
      });
      res = await loadDirections(job.dir, job.language);
      if (res.directions.length) {
        await p.update('🎨 Taking a picture of each look…', true);
        await shootFrames(res.directions);
      }
    } catch (e) {
      if (e instanceof ClaudeLimitError) throw e;
      console.log(`${ts()} [${job.id}] art direction failed: ${e.message}`);
      res = null;
    } finally {
      await p.done();
    }
    if (res?.dropped.length) console.log(`${ts()} [${job.id}] look checks: ${res.dropped.join('; ')}`);
    if (!res?.directions.length) {
      await wa.sendText('🎨 I could not design custom looks this time, so I will use the standard design. Send `change look` later to try again.');
      return afterLook(job, after, true);
    }
    job.brief = res.brief;
    job.recommended = res.recommended;
    job.directions = res.directions.map(({ n, name, style, styleName, why, palette, fonts, motion, image }) => ({ n, name, style, styleName, why, palette, fonts, motion, image }));
    await saveJob(job);
    if (job.directions.length === 1) {
      const d = job.directions[0];
      await applyLook(job.dir, d, job.brief);
      await wa.sendImage(fileUrl(job, path.relative(job.dir, d.image)), `🎨 *${d.name}* (${d.styleName})\n${d.why}\nSend \`change look\` to see other options.`);
      return afterLook(job, after, true);
    }
    await wa.sendText(`🎨 Here are ${job.directions.length} looks designed for this script. Each picture is how the video will open.`);
    for (const d of job.directions) {
      await wa.sendImage(fileUrl(job, path.relative(job.dir, d.image)), `*${d.n}. ${d.name}*\n${d.styleName} · ${d.motion} motion${d.n === job.recommended ? ' · ⭐ my pick' : ''}\n${d.why}`);
    }
    return ask(job, 'look', 'Which look do you like?', [
      ...job.directions.map((d) => ({ label: `${d.name} (${d.styleName})`, value: d.n })),
      { label: '🎲 Surprise me', value: 'surprise' },
    ], { after });
  },

  // Saved voice → straight to the format question; otherwise voice samples.
  async voiceStart(job) {
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
    const settings = await initSettings(job, (await loadPrefs()).defaultSettings);
    const p = await startProgress(`🎙 Recording the voiceover with ${job.voice.name}…`);
    try {
      const { seconds } = await buildProps(job, plan, (i, n) => p.update(`🎙 Recording the voiceover with ${job.voice.name}: scene ${i}/${n}`), { speed: settings.voice.speed });
      job.seconds = seconds;
      let engine = await motionEngine();
      let designs = {};
      if (engine === 'hyperframes') {
        const look = await loadLook(job.dir);
        if (look) {
          const props = await readJson(path.join(job.dir, 'props.json'));
          await p.update('🎬 Claude is designing and animating each scene… (a few minutes)', true);
          try {
            const r = await designScenes(job, {
              plan, props, look, formats: job.formats,
              onProgress: (d, n) => n && p.update(`🎬 Claude is designing and animating the scenes… ${d}/${n}`),
            });
            designs = r.designs;
            if (r.designed > 0 && Object.keys(designs).length) {
              const rv = await reviewScenes(job, {
                plan, props, look, settings, formats: job.formats, gsapFile: gsapPath(), designs,
                model: process.env.CRITIC_MODEL || 'sonnet',
                onProgress: (t) => p.update(t, true),
              });
              designs = rv.designs;
              job.suggestions = (rv.review.suggestions || []).slice(0, 3);
              if (rv.fixed.length) await p.update(`🛠 Improved ${rv.fixed.length} scene${rv.fixed.length > 1 ? 's' : ''} after review.`, true);
            }
            if (r.failed.length) {
              console.log(`${ts()} [${job.id}] scenes using the basic style: ${r.failed.join(', ')}`);
              await wa.sendText(`ℹ️ ${r.failed.length} scene${r.failed.length > 1 ? 's' : ''} did not pass the design checks and will use the simple style.`);
            }
          } catch (e) {
            if (e instanceof ClaudeLimitError) throw e;
            console.log(`${ts()} [${job.id}] scene design failed: ${e.message}`);
            await wa.sendText('⚠️ Scene design failed, so this video uses the simple animated style.');
          }
          if (!job.storyboardOk) {
            await p.update('🖼 Making the storyboard…', true);
            const sb = await storyboard(job, { props, designs, look, settings, format: job.formats.includes('long') ? 'long' : 'short', gsapFile: gsapPath() });
            if (sb.issues.length) console.log(`${ts()} [${job.id}] storyboard checks: ${sb.issues.join(' | ').slice(0, 800)}`);
            await p.done(`🖼 Storyboard ready (took ${p.elapsed()}).`);
            job.state = 'AWAIT_CHOICE';
            await saveJob(job);
            await wa.sendImage(fileUrl(job, path.relative(job.dir, sb.image)), `🖼 Storyboard: one frame from each of the ${sb.scenes} scenes. Check it before the full render.`);
            return ask(job, 'storyboard', 'Render the full video?', [
              { label: '▶️ Looks good, render it', value: 'go' },
              { label: '✏️ Change something', value: 'edit' },
              { label: '🎨 Different look', value: 'look' },
            ]);
          }
        }
      }
      for (const [k, f] of job.formats.entries()) {
        const label = f === 'short' ? 'Short (9:16)' : 'long video (16:9)';
        const part = job.formats.length > 1 ? ` (${k + 1}/${job.formats.length})` : '';
        await p.update(`🎬 Rendering the ${label}${part}… 0%`, true);
        let lastPct = 0;
        const onPct = (pct) => {
          if (pct >= lastPct + 10) { lastPct = pct - (pct % 10); p.update(`🎬 Rendering the ${label}${part}… ${lastPct}%`); }
        };
        if (engine === 'hyperframes') {
          try {
            const props = await readJson(path.join(job.dir, 'props.json'));
            if (job.music === undefined && settings.music.volume !== 'off') {
              const look = await loadLook(job.dir);
              const m = look ? await pickMusic(look.brief?.mood || look.motion, { onStatus: (t) => p.update(t, true) }).catch(() => null) : null;
              job.music = m ? path.relative(cfg.dataDir, m.file) : null;
              await saveJob(job);
            }
            const sfx = await whoosh().catch(() => null);
            const music = job.music ? path.join(cfg.dataDir, job.music) : null;
            job.outputs[f] = await renderProject(job, f, { props, settings, designs, onPercent: onPct, music, sfx });
          } catch (e) {
            console.log(`${ts()} hyperframes render failed, falling back to remotion: ${e.message}`);
            await wa.sendText(`⚠️ The new motion engine failed on this video, so I'm using the classic one.\n${e.message.slice(0, 300)}`);
            engine = 'remotion';
            lastPct = 0;
          }
        }
        if (engine === 'remotion') job.outputs[f] = await renderVideo(job, f, onPct);
      }
      job.engine = engine;
      job.qc = job.formats.flatMap((f) => (job.outputs[f]?.qc || []).map((w) => `${f === 'short' ? 'Short' : 'Long'}: ${w}`));
      if (job.qc.length) console.log(`${ts()} [${job.id}] video checks: ${job.qc.join('; ')}`);
      job.version = await snapshotVersion(job, job.changeNote || 'first version');
      job.changeNote = null;
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
        `${plan.title} (${label}, ${fmt(seconds)}${out.hd ? `, full HD, ${mb} MB` : ', 720p preview'}${job.version ? `, v${job.version}` : ''})`,
        out.hd || size > 15 * 1024 * 1024, name);
    }
    if (job.formats.includes('short') && seconds > 180) {
      await wa.sendText('⚠️ The Short is over 3 minutes, so YouTube will treat it as a normal vertical video.');
    }
    if (job.qc?.length) await wa.sendText(`🔎 Quality check found something to look at:\n• ${job.qc.join('\n• ')}`);
    return askApproval(job);
  },

  async edit(job, request) {
    job.state = 'EDITING';
    await saveJob(job);
    if ((await loadLook(job.dir)) && job.version && (await motionEngine()) === 'hyperframes') return changeVideo(job, request);
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
    job.changeNote = request.slice(0, 120);
    return steps.produce(job);
  },

  // A change asked for at the storyboard: Claude edits the scene files, then a new storyboard.
  async redesign(job, { request }) {
    job.state = 'EDITING';
    await saveJob(job);
    const plan = await loadPlan(job);
    const look = await loadLook(job.dir);
    const style = (await styleLibrary()).find((x) => x.id === look?.style);
    const backup = path.join(job.dir, 'scenes.prev');
    await fs.rm(backup, { recursive: true, force: true });
    await fs.cp(path.join(job.dir, 'scenes'), backup, { recursive: true });
    await fs.copyFile(path.join(job.dir, 'look.json'), path.join(backup, 'look.json'));
    const p = await startProgress('✏️ Claude is changing the scenes…');
    let reply;
    try {
      await prepareRefs(job.dir);
      reply = (await askClaude(job.dir, 'redesign', { REQUEST: request.replace(/"""/g, '"'), STYLE_FILE: style?.file || 'flat-explainer.md' }, { maxTurns: 40 })).trim();
    } finally {
      await p.done();
    }
    if (/^CANNOT:/i.test(reply)) {
      await wa.sendText(`I can't do that at this stage: ${reply.replace(/^CANNOT:\s*/i, '')}\nYou can change the words after the preview with ✏️ Change something.`);
      job.storyboardOk = false;
      return steps.produce(job);
    }
    // palette changed in look.json? keep plan.theme in step
    const newLook = await loadLook(job.dir);
    if (newLook?.palette) {
      const pl = await loadPlan(job);
      const pp = newLook.palette;
      pl.theme = { bg: pp.bg, bg2: pp.bg2, primary: pp.primary, accent: pp.accent, text: pp.ink };
      await writeJson(path.join(job.dir, 'plan.json'), pl);
    }
    const bad = await acceptEditedScenes(job, { plan, look: newLook || look, formats: job.formats });
    if (bad.length) console.log(`${ts()} [${job.id}] edited scenes with problems (they will be redesigned): ${bad.join(' | ').slice(0, 500)}`);
    await wa.sendText(`✏️ ${reply.split('\n').pop().slice(0, 300)}`);
    job.storyboardOk = false;
    job.changeNote = request.slice(0, 120);
    return steps.produce(job);
  },

  // 3 designed thumbnails to choose from (long videos)
  async thumbs(job) {
    job.state = 'DIRECTING';
    await saveJob(job);
    const look = await loadLook(job.dir);
    const style = (await styleLibrary()).find((x) => x.id === look?.style);
    const p = await startProgress('🖼 Claude is designing 3 thumbnails…');
    let shots = [];
    try {
      await prepareRefs(job.dir);
      await fs.rm(path.join(job.dir, 'thumbs'), { recursive: true, force: true });
      await fs.mkdir(path.join(job.dir, 'thumbs'), { recursive: true });
      await askClaude(job.dir, 'thumbs', { STYLE_FILE: style?.file || 'flat-explainer.md' }, { maxTurns: 25 });
      shots = await shootThumbs(job.dir);
    } catch (e) {
      if (e instanceof ClaudeLimitError) throw e;
      console.log(`${ts()} [${job.id}] thumbnails failed: ${e.message}`);
    } finally {
      await p.done();
    }
    if (!shots.length) {
      job.thumbChosen = true;
      await saveJob(job);
      await wa.sendText('🖼 Thumbnail design did not work this time; using a frame from the video.');
      return steps.publish(job);
    }
    for (const n of shots) await wa.sendImage(fileUrl(job, `thumbs/t${n}.png`), `Thumbnail ${n}`);
    const hasFrame = await exists(path.join(job.dir, 'frame.png'));
    if (hasFrame) await wa.sendImage(fileUrl(job, 'frame.png'), 'Or: a frame from the video');
    return ask(job, 'thumb', 'Which thumbnail?', [
      ...shots.map((n) => ({ label: `Thumbnail ${n}`, value: n })),
      ...(hasFrame ? [{ label: 'The video frame', value: 'frame' }] : []),
    ]);
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
        description: f === 'long' ? `${plan.description}${await chaptersText(job, plan)}` : plan.description,
        tags: plan.tags,
        language: plan.language,
        thumb: f === 'long' ? ((await exists(path.join(job.dir, 'thumb.png'))) ? path.join(job.dir, 'thumb.png') : path.join(job.dir, 'frame.png')) : null,
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
  if (job.choice.multi) {
    // multi-select: act once the last option ("✅ Apply…") is ticked
    const picked = selected.map((x) => matchOption(job.choice, x, true)).filter(Boolean);
    if (!picked.some((o) => o.value === 'apply')) return null;
    console.log(`${ts()} [in] poll multi-vote ${selected.join(' | ')}`);
    return onMulti(job, picked.filter((o) => o.value !== 'apply'));
  }
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
      await markEngineOk({ machine: r.machine, renderSec: r.renderSec, seconds: r.seconds });
      await p.done(`✅ Engine test passed (took ${p.elapsed()}).`);
      await wa.sendText([
        '🧪 *Engine test result*',
        `Machine: ${r.machine}`,
        `Render: ${r.seconds.toFixed(1)} s of video in ${r.renderSec.toFixed(0)} s (${speed >= 1 ? `${speed.toFixed(2)}× faster than real time` : `${(1 / speed).toFixed(1)}× slower than real time`})`,
        `A 2-minute video would take about ${Math.ceil((120 / speed) / 60)} min to render.`,
        `File: ${r.mb.toFixed(1)} MB, full HD`,
        r.voiceError ? `Voice: failed (${r.voiceError}), rendered without voice` : `Voice: ${r.words} words, captions synced (${r.voiceSec.toFixed(0)} s)`,
        `Lint: ${r.lintOk ? 'clean' : `warnings\n${r.lint}`}`,
        process.env.MOTION_ENGINE === 'remotion' ? 'New videos still use the classic engine (MOTION_ENGINE=remotion in .env).' : '✅ New videos will now use the new motion engine.',
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

  console.log(`${ts()} [in ${wa.currentNumber()}] ${msg.kind === 'doc' ? `document ${msg.fileName}` : `💬 ${msg.text.slice(0, 1000).split("\n").join("\n      ")}`}`);

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
  if (lower === 'forget style' || lower === 'forget look') {
    const prefs = await loadPrefs();
    prefs.look = null;
    await savePrefs(prefs);
    return wa.sendText('🎨 Saved style cleared. I will show you 3 looks for the next video.');
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

  if (/^(change|new|different) (music|song|track)$/.test(lower) && job.outputs && Object.keys(job.outputs).length) {
    const look = await loadLook(job.dir);
    const current = job.music ? path.basename(job.music) : null;
    const m = await pickMusic(look?.brief?.mood || 'calm', { exclude: current, onStatus: (t) => wa.sendText(t) }).catch(() => null);
    if (!m) return wa.sendText('No other music available right now.');
    job.music = path.relative(cfg.dataDir, m.file);
    const st = await loadSettings(job);
    if (st.music.volume === 'off') { st.music.volume = 'low'; await saveSettings(job, st); }
    job.changeNote = 'different music';
    await saveJob(job);
    await wa.sendText('🎵 Trying different music…');
    return runStep(job, 'produce');
  }

  if (/^change (look|style)s?$/.test(lower) && job.language && job.state !== 'FAILED') {
    job.forceLookChoice = true;
    return runStep(job, 'direct', { after: job.outputs && Object.keys(job.outputs).length ? 'produce' : 'voice' });
  }

  if (/^(change )?voices?$/.test(lower) && job.language && job.state !== 'FAILED') {
    return runStep(job, 'voices', { page: 0, after: job.outputs && Object.keys(job.outputs).length ? 'produce' : 'format' });
  }

  if (job.state === 'AWAIT_VOICE') return runStep(job, 'voices', { page: 0, after: 'format' }); // job from an older version

  // a typed answer to the current poll (number or option name)
  if (job.choice?.multi) {
    const nums = text.match(/^\s*\d{1,2}(\s*[, ]\s*\d{1,2})*\s*$/) ? text.match(/\d{1,2}/g).map(Number) : null;
    if (nums) {
      const picked = nums.map((n) => job.choice.options[n - 1]).filter((o) => o && o.value !== 'apply');
      return onMulti(job, picked);
    }
    // typed words instead of ticking: treat it as a normal change request
    job.choice = null;
    job.state = 'AWAIT_APPROVAL';
    await saveJob(job);
  }
  if (job.choice) {
    const opt = matchOption(job.choice, text);
    if (opt) return onChoice(job, opt);
    if (job.choice.kind === 'storyboard' && text.trim().length > 2) {
      job.choice = null;
      await saveJob(job);
      return runStep(job, 'redesign', { request: text });
    }
    if (job.choice.kind !== 'approve') {
      return wa.sendText(`Please tap an option in the poll above, or reply with its number (1-${job.choice.options.length}).`);
    }
  }

  if (job.state === 'FAILED' && !Object.keys(job.outputs || {}).length) {
    return wa.sendText('The last step failed. Send `retry` to try again, or send a new script.');
  }

  if (job.state === 'AWAIT_APPROVAL' || job.state === 'FAILED') {
    if (APPROVE.test(text)) return startUpload(job);
    if (lower === 'undo') return undo(job);
    job.choice = null;
    const tweaks = (await loadLook(job.dir)) ? parseTweaks(text) : null;
    if (tweaks?.length) return applyTweakKeys(job, tweaks);
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

