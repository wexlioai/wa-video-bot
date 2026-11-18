// Run on YOUR PC (Windows/Mac/Linux), not the server:
//   cd orchestrator && npm install && npx playwright install chromium && npm run yt:login
// A Chrome window opens: sign in to the Google account that owns the channel and wait until
// YouTube Studio loads. The session is saved to yt-session.json. Copy it to the server:
//   scp yt-session.json ubuntu@YOUR_SERVER:~/wa-video-bot/data/yt-session.json
import { chromium } from 'playwright';

const out = process.argv[2] || 'yt-session.json';
let browser;
try {
  // Prefer your installed Chrome: Google is less likely to block the sign-in
  browser = await chromium.launch({ headless: false, channel: 'chrome', ignoreDefaultArgs: ['--enable-automation'] });
} catch {
  browser = await chromium.launch({ headless: false, ignoreDefaultArgs: ['--enable-automation'] });
}
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto('https://studio.youtube.com');
console.log('Sign in in the opened window. Waiting for YouTube Studio to load…');
await page.waitForURL(/studio\.youtube\.com\/channel\//, { timeout: 10 * 60_000 });
await page.waitForTimeout(3000);
await context.storageState({ path: out });
console.log(`Saved ${out}. Copy it to the server as data/yt-session.json`);
await browser.close();
