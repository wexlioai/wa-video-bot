import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';

/** Upload a video; returns the watch URL. YT_METHOD=browser (default) or api. */
export async function uploadVideo(opts) {
  const title = (opts.isShort && !/#shorts/i.test(opts.title) ? `${opts.title} #Shorts` : opts.title).slice(0, 100);
  if (cfg.yt.method === 'api') return uploadViaApi({ ...opts, title });
  const { uploadViaBrowser } = await import('./youtube-browser.js');
  return uploadViaBrowser({ ...opts, title, debugDir: opts.debugDir || path.dirname(opts.file) });
}

async function uploadViaApi({ file, title, description, tags, language, thumb }) {
  if (!cfg.yt.refreshToken) throw new Error('YouTube API not set up: run `npm run setup:youtube` and put YT_REFRESH_TOKEN in .env');
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2(cfg.yt.clientId, cfg.yt.clientSecret);
  auth.setCredentials({ refresh_token: cfg.yt.refreshToken });
  const yt = google.youtube({ version: 'v3', auth });
  const res = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description: (description || '').slice(0, 4900),
        tags: (tags || []).slice(0, 15),
        categoryId: cfg.yt.categoryId,
        defaultLanguage: language,
        defaultAudioLanguage: language,
      },
      status: { privacyStatus: cfg.yt.privacy, selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(file) },
  });
  const id = res.data.id;
  if (thumb && fs.existsSync(thumb)) {
    // custom thumbnails need a phone-verified channel; ignore if not allowed
    await yt.thumbnails.set({ videoId: id, media: { body: fs.createReadStream(thumb) } }).catch(() => {});
  }
  return `https://youtu.be/${id}`;
}
