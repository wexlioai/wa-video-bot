# WhatsApp script → YouTube video bot

Send a script (PDF / DOCX / DOC / TXT, English or Urdu) on WhatsApp and get back voice samples. Pick a voice and a format, then get a finished motion-graphics video with captions. Reply `ok` to upload it to YouTube, or type a change.

```
WhatsApp ─► Evolution API (Docker) ─► orchestrator (Node, host) ─┬─► Claude Code headless (your Claude plan)
                                                                 ├─► Microsoft Edge neural voices, free (or ElevenLabs)
                                                                 ├─► Remotion (renders 16:9 / 9:16)
                                                                 └─► YouTube Studio (headless Chromium)
```

**What Claude does:** reads the script (including Urdu PDFs that don't extract cleanly), splits it into scenes, picks a visual and on-screen text for each scene, picks colours, and writes the YouTube title, description and tags. It also applies your change requests. Everything else (downloading, TTS, rendering, uploading) is plain code, so your Claude limit only goes on thinking work.

**How the video is built:** Claude writes `plan.json` (data only) and a fixed Remotion template renders it. There are 7 scene types: title, statement, bullets, big number, quote, compare and bar chart. The template also has an animated background, word-by-word highlighted captions and a progress bar, and Urdu is laid out right-to-left in Noto Nastaliq. Because the plan is data rather than code, renders don't break and edits are small.

---

## Setup: one file, one command

There's a single installer file for each machine. Each one contains the whole project, installs everything, then runs a wizard that **asks only for your credentials and explains where to get each one**. Both are safe to run again later to update the bot or change settings.

### Oracle Cloud server: `setup-oracle.sh`
Use an **Ubuntu 22.04/24.04** image; both ARM (Ampere) and x86 work.
```bash
scp setup-oracle.sh ubuntu@YOUR_SERVER_IP:~/
ssh ubuntu@YOUR_SERVER_IP
bash setup-oracle.sh
```

### Windows 10/11 desktop: `setup-windows.ps1`
Open **Terminal / PowerShell** in the folder with the file and run:
```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
```
It asks for administrator rights (to install Docker Desktop and add a firewall rule). If Docker Desktop is newly installed and Windows asks for a restart, restart and run the same command again. The bot runs in the background whenever you're logged in, and only while the PC is on and awake.

### What the wizard asks
| Step | What you need | Where to get it |
|---|---|---|
| WhatsApp | your number (e.g. `923001234567`), and whether to use self chat or a second number | — |
| Voice | **Free Microsoft voices** (no key), **OpenSpeaker** (one key for ElevenLabs, MiniMax, Fish Audio, Edge, Kokoro, Vbee voices) or **ElevenLabs** | OpenSpeaker: log in at openspeaker.ai/app → open **API Document** → **API Key** at the top. ElevenLabs: elevenlabs.io → profile → **API Keys** |
| Claude | a long-lived login token (about 1 year) from your Pro/Max account | the wizard runs `claude setup-token`: sign in in the browser, click Authorize, paste the `sk-ant-oat01-…` token |
| YouTube | sign in to your channel's Google account | Windows: a browser window opens. Server: import Chrome cookies, or copy `data\yt-session.json` from your Windows setup |
| WhatsApp link | your phone | scan the QR **shown in the terminal**, or type the 8-letter pairing code (WhatsApp → Linked devices) |

At the end you get a WhatsApp message saying *"Setup complete!"*.

### Afterwards
| | Oracle | Windows |
|---|---|---|
| Logs | `tail -f ~/wa-video-bot/data/logs/bot-$(date -u +%F).log` | `Get-Content (ls $HOME\wa-video-bot\data\logs\*.log \| sort LastWriteTime \| select -Last 1) -Wait -Encoding UTF8` |
| Change settings | `cd ~/wa-video-bot/orchestrator && node scripts/wizard.js && sudo systemctl restart wa-video-bot` | `cd $HOME\wa-video-bot\orchestrator; node scripts\wizard.js`, then restart task *wa-video-bot* in Task Scheduler |
| Update the bot | automatic from GitHub (see below) | same |

### Automatic updates
The bot runs under a small **supervisor** that keeps it running and up to date:
- **From GitHub.** Every 10 minutes it checks the bot's private GitHub repo. A new version is installed by itself and the bot restarts, and you get a WhatsApp notice "🔄 Bot updated: old → new". The wizard's *Automatic updates* step connects the repo with a read-only token.
- **Never touches your data.** `.env`, `data/` (jobs, WhatsApp files, YouTube login), `node_modules/` and `.venv/` aren't in git, so updates never touch them.
- **Never interrupts a video.** If one is being made, the restart waits until it finishes.
- **Settings changes apply by themselves.** Editing `.env` (or re-running the wizard) restarts the bot automatically, and a changed `package.json` runs `npm install` first.
- **Prompts and video design** (`prompts/`, `video/src/`) apply to the next video without a restart.

Send `version` to the bot to see which version it's on.

> Run the bot on **one machine at a time**. Both linked to the same WhatsApp would both answer.

**YouTube upload notes:** uploads go through YouTube Studio in a headless browser. If an upload fails, the bot sends you a screenshot of what the browser saw, usually because the login expired (re-run the wizard's YouTube step). To use the official API instead, set `YT_METHOD=api` and run `npm run setup:youtube`.

---

## Using it

Every choice is a **tap-to-choose menu** (interactive list). If your Evolution version can't send lists, the bot automatically uses **polls** instead; send `use polls` / `use lists` to switch. Replying with the option number always works.

While it works, the bot shows *typing…* and keeps one status message up to date (planning → voice samples 3/6 → recording scene 2/5 → rendering 40% → ✅ ready), adding "still working…" if a step takes long.

| You send / tap | Bot does |
|---|---|
| a PDF / DOCX / TXT, or a long pasted text | reads it (Claude plans the scenes) |
| **Voice poll** | sends 6 voices as ~5-second samples, best English narrators first; *More voices* shows the next 6. Samples are made once and stored, so they're instant afterwards |
| **"Use this voice next time?"** | *Yes, always*: future videos skip the voice step. *Ask me every time*: you pick each time |
| **Format poll** | Long 16:9 / YouTube Short 9:16 / Both (with the estimated length) |
| **"What next?" poll** after the preview | Upload to YouTube / Change something (then type it, e.g. "make scene 3 shorter") / Change voice / Undo / Cancel |
| `change voice` | pick a different voice (re-renders if a preview exists) |
| `change look` | see 3 new designed looks for this video (re-renders if a preview exists) |
| `forget style` | stop using your saved style; show 3 looks for every video |
| `forget voice` | clear the saved voice |
| `use lists` / `use polls` / `use numbers` | how choices are shown |
| `retry` / `status` / `cancel` / `version` | as the names say |
| `engine test` | renders a 15-second test with the new motion engine (HyperFrames) and reports how fast this machine renders |

If your Claude usage limit runs out mid-job, the bot tells you and retries every 30 minutes until the limit resets. Voice audio is cached per scene, so an edit only re-voices the scenes whose spoken words changed.

## Costs and limits
- **Voice:** free with the Microsoft voices. This uses Edge's read-aloud service unofficially, so it could change without notice; if it ever stops working, re-run the wizard and switch to ElevenLabs. With ElevenLabs, samples cost about 4 × 260 characters and the full voiceover about the script's length.
- **Claude:** a typical run is 1 planning call plus 1 short call per edit. `CLAUDE_MODEL=sonnet` stretches your plan limit; switch to `opus` if you want better scene choices.
- **Render time** on 4 OCI cores: very roughly 1–2× real time for 1080p, so a 5-minute video takes about 5–10 minutes. `RENDER_CONCURRENCY` can go up to 4.

## The motion engine (after `engine test` passes)

1. **Plan**: Claude splits your script into scenes (your words, unchanged).
2. **Art direction**: Claude writes a creative brief and designs 3 looks (style, colours, fonts, motion) from the script. You see one designed frame per look and pick one, or save a style for next time. Styles: Flat Explainer, Paper Cutout, Editorial, Isometric, Sketchnote, Living Halftone, Technical Drawing, Soft Clay, Documentary Collage, Kinetic Type (`styles/`). Neon, cyberpunk, terminal, glitch, HUD and game-style looks are blocked.
3. **Voice**, then **format**.
4. **Motion design**: Claude writes every scene as its own animation, timed to the spoken words. Automatic checks plus a reviewer (Claude Sonnet) score each scene; weak ones are redone.
5. **Storyboard**: one frame per scene. Render it, type a change, or pick another look.
6. **Render** scene by scene (cached), music ducked under the voice, soft transitions, loudness -14 LUFS.
7. **Preview** with: Upload, Quick tweaks (subtitles, voice speed, music, motion), Change something (your words; scene numbers, times like 0:42 or quoted words work), review Suggestions, Change voice/look, Undo (versions).
8. **Upload**: pick one of 3 designed thumbnails; chapters are added to the description.

**Long texts and books**: above 15 minutes of narration the bot first tells you the size (pages, words, hours), splits it into episodes, estimates render time and voice credits, and asks: a series (every word, episode by episode), one ~8-minute summary video, or only the episodes you pick. Every video (and episode 1 of a series) starts with a ~10-second demo in your chosen look and voice; nothing full is rendered until you approve it. A new look or voice gets a new demo. Series commands: `episodes`, `episode 3`, `upload all`, `stop series`.

Commands: `change music`, `change look`, `forget style`, `engine test`. Settings in `.env`: `MOTION_ENGINE`, `CRITIC_MODEL`, `MUSIC_GENERATE`.

## Project layout
```
docker-compose.yml        Evolution API + Postgres + Redis
.env.example              all settings
orchestrator/src/         server.js (webhook) · bot.js (conversation + steps) · claude.js · tts.js · render.js · youtube.js
prompts/                  what Claude is told: plan.md, edit.md, fix.md, schema.md
video/src/                Remotion template (Long 1920×1080, Short 1080×1920)
data/jobs/<id>/           everything for one video: source, plan.json, audio/, previews, final mp4s
```
