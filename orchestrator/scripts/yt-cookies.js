// Fallback if Google blocks the Playwright sign-in:
// 1. In your normal Chrome, open studio.youtube.com (signed in).
// 2. Use the "Cookie-Editor" extension → Export → JSON, on youtube.com AND on google.com,
//    and save both exports into one file each.
// 3. On the server: npm run yt:cookies -- youtube.json google.json
// It writes data/yt-session.json in the format the uploader uses.
import fs from 'node:fs';
import { cfg } from '../src/config.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.log('Usage: npm run yt:cookies -- youtube-cookies.json [google-cookies.json]');
  process.exit(1);
}
const sameSite = (s) => ({ no_restriction: 'None', lax: 'Lax', strict: 'Strict' }[String(s).toLowerCase()] || 'Lax');
const cookies = files.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))).map((c) => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path || '/',
  expires: c.expirationDate ? Math.floor(c.expirationDate) : -1,
  httpOnly: !!c.httpOnly,
  secure: !!c.secure,
  sameSite: sameSite(c.sameSite),
}));
fs.writeFileSync(cfg.yt.sessionFile, JSON.stringify({ cookies, origins: [] }, null, 2));
console.log(`Wrote ${cookies.length} cookies to ${cfg.yt.sessionFile}`);
