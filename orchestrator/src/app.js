import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg, ROOT } from './config.js';
import { onMessage, onPollUpdate, recover, isBusy } from './bot.js';
import { sendText } from './whatsapp.js';

await fs.mkdir(path.join(cfg.dataDir, 'jobs'), { recursive: true });

async function version() {
  return (await fs.readFile(path.join(ROOT, 'VERSION'), 'utf8').catch(() => 'dev')).trim();
}

const app = express();
app.use(express.json({ limit: '60mb' })); // webhook base64 media can be large

// Evolution API posts every event here. Respond fast, work in the background.
app.post(`/webhook/${cfg.secret}`, (req, res) => {
  res.sendStatus(200);
  const body = req.body || {};
  const event = String(body.event || '').toLowerCase().replace(/_/g, '.');
  if (event === 'messages.update') {
    // aggregated poll results (second way Evolution reports a vote)
    const items = Array.isArray(body.data) ? body.data : [body.data];
    for (const d of items) if (d?.pollUpdates) onPollUpdate(d).catch((e) => console.error('poll update error', e));
    return;
  }
  if (event !== 'messages.upsert') return;
  const items = Array.isArray(body.data) ? body.data : [body.data];
  for (const data of items) {
    onMessage(data).catch(async (e) => {
      console.error('onMessage error', e);
      await sendText(`❌ ${String(e.message).slice(0, 400)}`).catch(() => {});
    });
  }
});

// Job files (voice samples, previews) so Evolution can fetch them by URL.
// Secret in the path; keep this port closed to the internet (OCI blocks it by default).
app.use(`/files/${cfg.secret}`, express.static(path.join(cfg.dataDir, 'jobs'), { dotfiles: 'deny', index: false }));

// Cached voice samples (same secret).
app.use(`/samples/${cfg.secret}`, express.static(path.join(cfg.dataDir, 'voice-samples'), { dotfiles: 'deny', index: false }));

app.get('/health', async (_req, res) => res.json({ ok: true, busy: await isBusy().catch(() => false) }));

app.listen(cfg.port, '0.0.0.0', async () => {
  console.log(`${new Date().toISOString().replace('T', ' ').slice(0, 19)} wa-video-bot ${await version()} listening on :${cfg.port}`);
  await recover().catch((e) => console.error('recover failed', e));
});
