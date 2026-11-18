import { cfg } from './config.js';

// IDs of messages the bot sent, so in self-chat mode we never react to our own replies.
const sentIds = new Set();
export const isOwnSend = (id) => sentIds.has(id);

async function evo(method, pathName, body) {
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

const to = () => cfg.ownerNumber;
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

/** Tap-to-choose poll (WhatsApp Web can't show buttons/lists). Returns the poll message id. */
export async function sendPoll(question, options) {
  const r = await evo('POST', `/message/sendPoll/${inst()}`, {
    number: to(), name: question.slice(0, 250), selectableCount: 1, values: options.map((o) => o.slice(0, 100)),
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

/** Is this message one we should handle (from the owner, not our own reply)? */
export function isFromOwner(data) {
  const k = data?.key || {};
  if (!k.id || isOwnSend(k.id)) return false;
  const jids = [k.remoteJid, k.remoteJidAlt, k.senderPn, k.participant, data.sender].map(digits);
  const ownerChat = jids.includes(cfg.ownerNumber);
  if ((k.remoteJid || '').endsWith('@g.us')) return false; // ignore groups
  if (cfg.selfChat) {
    // Your own "Message yourself" chat: messages are fromMe and the chat is your own number.
    // (Newer WhatsApp may use an @lid jid for self chat; then remoteJidAlt carries the number.)
    const isSelfLid = (k.remoteJid || '').endsWith('@lid') && k.fromMe;
    return k.fromMe === true && (ownerChat || isSelfLid);
  }
  return k.fromMe !== true && ownerChat;
}

/** Returns {kind:'text', text} | {kind:'doc', fileName, mimetype} | {kind:'poll', pollId, selected[]} | null */
export function parseMessage(data) {
  const m = data?.message || {};
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
