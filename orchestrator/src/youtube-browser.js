// Upload to YouTube through YouTube Studio in a headless Chromium, logged in with your saved session.
// No Google Cloud project needed, and videos can go public directly.
// Session file comes from `npm run yt:login` (run on your PC) or `npm run yt:cookies`.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { cfg } from './config.js';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const VIS = { public: 'PUBLIC', unlisted: 'UNLISTED', private: 'PRIVATE' };

export async function uploadViaBrowser({ file, title, description, tags, thumb, debugDir }) {
  if (!fs.existsSync(cfg.yt.sessionFile)) {
    throw new Error(`YouTube browser session not found (${cfg.yt.sessionFile}). Run \`npm run yt:login\` on your PC and copy the file to the server.`);
  }
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const context = await browser.newContext({
    storageState: cfg.yt.sessionFile,
    userAgent: UA,
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const step = async (name, fn) => {
    try { return await fn(); } catch (e) {
      const shot = path.join(debugDir, `yt-error-${name}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const err = new Error(`YouTube upload failed at "${name}": ${e.message.split('\n')[0]}`);
      err.screenshot = shot;
      throw err;
    }
  };

  try {
    await step('open studio', async () => {
      await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });
      if (/accounts\.google\.com/.test(page.url())) throw new Error('session expired, log in again with `npm run yt:login`');
      await page.locator('#create-icon, ytcp-button#create-icon').first().waitFor();
    });

    await step('choose file', async () => {
      await page.locator('#create-icon, ytcp-button#create-icon').first().click();
      await page.locator('#text-item-0, tp-yt-paper-item:has-text("Upload videos")').first().click();
      await page.locator('input[type="file"]').first().setInputFiles(file);
      await page.locator('#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea #textbox').first().waitFor({ timeout: 120_000 });
    });

    await step('details', async () => {
      const titleBox = page.locator('#title-textarea #textbox').first();
      await titleBox.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await titleBox.pressSequentially(title.slice(0, 100), { delay: 5 });

      const desc = page.locator('#description-textarea #textbox').first();
      await desc.click();
      await desc.pressSequentially((description || '').slice(0, 4900), { delay: 1 });

      if (thumb && fs.existsSync(thumb)) {
        // only works on phone-verified channels; ignore otherwise
        await page.locator('input#file-loader').first().setInputFiles(thumb, { timeout: 5000 }).catch(() => {});
      }
      await page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').first().click();

      if (tags?.length) {
        await page.locator('#toggle-button:has-text("Show more"), ytcp-button#toggle-button').first().click().catch(() => {});
        const tagInput = page.locator('#tags-container #text-input, ytcp-form-input-container#tags-container input').first();
        if (await tagInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await tagInput.fill(tags.slice(0, 15).join(',').slice(0, 480) + ',');
        }
      }
    });

    await step('next pages', async () => {
      for (let i = 0; i < 3; i++) {
        await page.locator('#next-button').first().click();
        await page.waitForTimeout(1500);
      }
    });

    await step('visibility', async () => {
      const v = VIS[cfg.yt.privacy] || 'PRIVATE';
      await page.locator(`tp-yt-paper-radio-button[name="${v}"]`).first().click();
    });

    const url = await step('read link', async () => {
      const a = page.locator('.video-url-fadeable a, a.ytcp-video-info').first();
      await a.waitFor();
      return (await a.getAttribute('href')) || (await a.innerText());
    });

    await step('wait for upload', async () => {
      // the Save/Publish button stays disabled until the file has been uploaded
      await page.waitForFunction(() => {
        const b = document.querySelector('#done-button');
        return b && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true';
      }, null, { timeout: 60 * 60_000, polling: 3000 });
      const progress = page.locator('ytcp-video-upload-progress .progress-label, .progress-label');
      for (let i = 0; i < 1200; i++) {
        const t = (await progress.first().innerText().catch(() => '')) || '';
        if (!/uploading/i.test(t)) break;
        await page.waitForTimeout(3000);
      }
    });

    await step('publish', async () => {
      await page.locator('#done-button').first().click();
      await page.locator('ytcp-uploads-still-processing-dialog, ytcp-video-share-dialog, #close-button').first()
        .waitFor({ timeout: 120_000 }).catch(() => {});
    });

    // keep the session fresh (Google rotates cookies)
    await context.storageState({ path: cfg.yt.sessionFile }).catch(() => {});
    return url.startsWith('http') ? url : `https://${url}`;
  } finally {
    await browser.close();
  }
}
