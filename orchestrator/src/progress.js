// Keeps you informed while the bot works, so it never looks stuck:
// - shows "typing…" in the chat the whole time
// - one status message that is edited in place as work moves on (falls back to new messages
//   if this WhatsApp can't edit)
// - if nothing changes for a while, adds "still working… 1m 30s"
import * as wa from './whatsapp.js';

const fmt = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

let canEdit = true; // switched off after the first failed edit

export async function startProgress(firstText) {
  const t0 = Date.now();
  let id = null;
  let text = firstText;
  let lastShown = Date.now();
  let lastNewMsg = Date.now();
  let stopped = false;

  const sendNew = async (t) => {
    const r = await wa.sendText(t).catch(() => null);
    id = r?.key?.id || id;
    lastNewMsg = Date.now();
  };
  const show = async (t) => {
    lastShown = Date.now();
    if (canEdit && id) {
      try { await wa.editText(id, t); return; } catch { canEdit = false; }
    }
    // without edits, only post a new message for real milestones / every 90 s
    if (Date.now() - lastNewMsg > 20_000) await sendNew(t);
  };

  await sendNew(firstText);
  wa.typing().catch(() => {});
  const beat = setInterval(async () => {
    if (stopped) return;
    wa.typing().catch(() => {});
    const quiet = Date.now() - lastShown;
    if (quiet > (canEdit ? 40_000 : 90_000)) {
      await show(`${text}\n⏳ still working… ${fmt(Date.now() - t0)}`);
    }
  }, 10_000);

  let lastUpdate = 0;
  return {
    /** Change the status text. Updates are throttled to one every 5 s unless force=true. */
    async update(t, force = false) {
      text = t;
      if (!force && Date.now() - lastUpdate < 5000) return;
      lastUpdate = Date.now();
      await show(t);
    },
    async done(finalText) {
      stopped = true;
      clearInterval(beat);
      if (finalText) await show(finalText);
    },
    elapsed: () => fmt(Date.now() - t0),
  };
}
