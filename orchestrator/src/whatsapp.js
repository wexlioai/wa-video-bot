import { AsyncLocalStorage } from 'node:async_hooks';
import { cfg } from './config.js';

/** The person this piece of work is for. Everything sent inside chat.run({number}) goes to them. */
export const chat = new AsyncLocalStorage();
export const currentNumber = () => chat.getStore()?.number || cfg.ownerNumbers[0];

// IDs of messages the bot sent, so in self-chat mode we never react to our own replies.
const sentIds = new Set();
export const isOwnSend = (id) => sentIds.has(id);

// ---------------------------------------------------------------------------------------
// Mirror of the chat in the terminal / log file: everything the bot sends to WhatsApp is also
// printed, so the log shows the whole conversation (incoming messages are logged by bot.js).
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const fileOf = (url) => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { return 'file'; } };
const indent = (t) => String(t ?? '').replace(/^🤖 /, '').split('\n').join('\n      ');
let lastEdit = '';
function describe(pathName, b = {}) {
  const kind = pathName.split('/')[2] || pathName;
  switch (kind) {
    case 'sendText': return `💬 ${indent(b.text)}`;
    case 'sendWhatsAppAudio': return `🎧 audio: ${fileOf(b.audio)}`;
    case 'sendMedia': return `${b.mediatype === 'image' ? '🖼 image' : b.mediatype === 'document' ? '📄 file' : '🎬 video'}: ${fileOf(b.media)}${b.caption ? `\n      ${indent(b.caption)}` : ''}`;
    case 'sendPoll': return `📊 poll${b.selectableCount > 1 ? ' (tick several)' : ''}: ${b.name}\n      ${(b.values || []).join('\n      ')}`;
    case 'sendList': return `📋 menu: ${b.title}\n      ${(b.sections?.[0]?.rows || []).map((r) => r.title).join('\n      ')}`;
    case 'updateMessage': {
      const t = indent(b.text);
      if (t === lastEdit) return null; // progress edits repeat; log only changes
      lastEdit = t;
      return `✏️ (updated) ${t}`;
    }
    default: return null; // presence, webhook setup, etc.
  }
}
function mirror(pathName, body, error) {
  if (!pathName.startsWith('/message/') && !pathName.startsWith('/chat/updateMessage')) return;
  const d = describe(pathName, body);
  if (!d) return;
  const who = body?.number || '';
  console.log(`${ts()} [out ${who}] ${d}${error ? `\n      ❌ NOT SENT: ${String(error).slice(0, 200)}` : ''}`);
}

async function evo(method, pathName, body) {
  try {
    const data = await evoRaw(method, pathName, body);
    mirror(pathName, body);
    return data;
  } catch (e) {
    mirror(pathName, body, e.message);
    throw e;
  }
}

async function evoRaw(method, pathName, body) {
  const res = await fetch(`${cfg.evo.url}${pathName}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: cfg.evo.apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`Evolution ${pathName} ${res.status}: ${text.slice(0, 300)}`);
  const id = data?.key?.id;
  if (id) {
    sentIds.add(id);
    if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value);
  }
  return data;
}

const to = () => currentNumber();
const inst = () => encodeURIComponent(cfg.evo.instance);

export const BOT_TAG = '🤖';

export function sendText(text) {
  return evo('POST', `/message/sendText/${inst()}`, { number: to(), text: `${BOT_TAG} ${text}` });
}

// fileUrl must be reachable from the Evolution container (we serve job files ourselves)
export function sendAudio(fileUrl) {
  return evo('POST', `/message/sendWhatsAppAudio/${inst()}`, { number: to(), audio: fileUrl });
}

export function sendVideo(fileUrl, caption, asDocument = false, fileName = 'video.mp4') {
  return evo('POST', `/message/sendMedia/${inst()}`, {
    number: to(),
    mediatype: asDocument ? 'document' : 'video',
    mimetype: 'video/mp4',
    caption: `${BOT_TAG} ${caption}`,
    media: fileUrl,
    fileName,
  });
}

/** Subscribe the webhook to message upserts AND updates (poll results arrive as updates too). */
export function ensureWebhook() {
  return evo('POST', `/webhook/set/${inst()}`, {
    webhook: {
      enabled: true, url: `${cfg.selfUrl}/webhook/${cfg.secret}`, byEvents: false, base64: true,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
    },
  });
}

/**
 * Interactive list ("View options" button that opens a menu). rows: [{title, description, rowId}]
 * Returns the message id. Throws if Evolution rejects it (caller falls back to a poll).
 */
export async function sendList(title, description, buttonText, rows) {
  const r = await evo('POST', `/message/sendList/${inst()}`, {
    number: to(),
    title: title.slice(0, 60),
    description: description.slice(0, 1000),
    buttonText: buttonText.slice(0, 20),
    footerText: 'Tap the button to choose',
    sections: [{ title: 'Options', rows: rows.map((x) => ({ title: x.title.slice(0, 24), description: (x.description || '').slice(0, 72), rowId: x.rowId })) }],
  });
  return r?.key?.id;
}

/** Edit a text message the bot sent earlier (used for live progress). */
export async function editText(id, text) {
  return evo('POST', `/chat/updateMessage/${inst()}`, {
    number: to(),
    key: { remoteJid: `${to()}@s.whatsapp.net`, fromMe: true, id },
    text: `${BOT_TAG} ${text}`,
  });
}

/** Show "typing…" in the chat for a few seconds. */
export function typing(ms = 12000) {
  return evo('POST', `/chat/sendPresence/${inst()}`, { number: to(), delay: ms, presence: 'composing' });
}

/** Tap-to-choose poll (WhatsApp Web can't show buttons/lists). Returns the poll message id. */
export async function sendPoll(question, options, selectableCount = 1) {
  const r = await evo('POST', `/message/sendPoll/${inst()}`, {
    number: to(), name: question.slice(0, 250), selectableCount, values: options.map((o) => o.slice(0, 100)),
  });
  return r?.key?.id;
}

export function sendImage(fileUrl, caption) {
  return evo('POST', `/message/sendMedia/${inst()}`, {
    number: to(), mediatype: 'image', mimetype: 'image/png', caption: `${BOT_TAG} ${caption}`, media: fileUrl, fileName: 'screen.png',
  });
}

// Download media of a received message. Uses webhook base64 if present, else asks Evolution.
export async function downloadMedia(data) {
  const inline = data?.message?.base64;
  if (inline) return Buffer.from(inline, 'base64');
  const r = await evo('POST', `/chat/getBase64FromMediaMessage/${inst()}`, {
    message: { key: { id: data.key.id } },
    convertToMp4: false,
  });
  if (!r?.base64) throw new Error('Evolution returned no media');
  return Buffer.from(r.base64, 'base64');
}

// --- helpers to read the webhook payload -------------------------------------------------

const digits = (jid) => (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

/** Which allowed number sent this message? null = not for us (or our own reply). */
export function ownerOf(data) {
  const k = data?.key || {};
  if (!k.id || isOwnSend(k.id)) return null;
  if ((k.remoteJid || '').endsWith('@g.us')) return null; // ignore groups
  const jids = [k.remoteJid, k.remoteJidAlt, k.senderPn, k.participant, data.sender].map(digits);
  if (cfg.selfChat) {
    // Your own "Message yourself" chat: messages are fromMe and the chat is your own number.
    // (Newer WhatsApp may use an @lid jid for self chat; then remoteJidAlt carries the number.)
    const isSelfLid = (k.remoteJid || '').endsWith('@lid') && k.fromMe;
    return k.fromMe === true && (jids.includes(cfg.ownerNumber) || isSelfLid) ? cfg.ownerNumber : null;
  }
  if (k.fromMe === true) return null;
  return cfg.ownerNumbers.find((n) => jids.includes(n)) || null;
}
export const isFromOwner = (data) => !!ownerOf(data);

/** Returns {kind:'text'} | {kind:'doc'} | {kind:'poll', pollId, selected[]} | {kind:'select', rowId, title} | null */
export function parseMessage(data) {
  const m = data?.message || {};
  // a tap on an interactive list / button
  const lr = m.listResponseMessage;
  const ir = m.interactiveResponseMessage?.nativeFlowResponseMessage;
  const br = m.buttonsResponseMessage;
  if (lr || ir || br) {
    let rowId = lr?.singleSelectReply?.selectedRowId || br?.selectedButtonId;
    if (!rowId && ir?.paramsJson) { try { rowId = JSON.parse(ir.paramsJson).id; } catch {} }
    return { kind: 'select', rowId, title: lr?.title || br?.selectedDisplayText || '' };
  }
  const pu = m.pollUpdateMessage;
  if (pu || data?.messageType === 'pollUpdateMessage') {
    // Evolution decrypts the vote and puts the chosen option names in vote.selectedOptions,
    // plus pollUpdates: [{name, voters[]}]
    let selected = (pu?.vote?.selectedOptions || []).filter((x) => typeof x === 'string');
    if (!selected.length && Array.isArray(data.pollUpdates)) {
      selected = data.pollUpdates.filter((o) => (o.voters || []).length).map((o) => o.name);
    }
    return { kind: 'poll', pollId: pu?.pollCreationMessageKey?.id, selected };
  }
  const doc = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
  if (doc) {
    return { kind: 'doc', fileName: doc.fileName || 'script', mimetype: doc.mimetype || '', caption: doc.caption || '' };
  }
  const text = m.conversation || m.extendedTextMessage?.text;
  if (typeof text === 'string') {
    if (text.startsWith(BOT_TAG)) return null; // our own message echoed back
    return { kind: 'text', text: text.trim() };
  }
  return null;
}
