// Safe test: can this WhatsApp show interactive LIST menus from Evolution v2.3.6?
//
//   cd orchestrator && node scripts/test-lists.js
//
// 1. Starts a throwaway Evolution v2.3.6 (own database, port 8081). Your bot keeps running.
// 2. You scan a QR with the BOT's phone (it is added as one more linked device).
// 3. It sends a test menu to your number; you say in the terminal whether you saw it.
// 4. It unlinks the test device and deletes the test containers and data.
// If the menu showed, it can switch the real bot to v2.3.6 (needs one more QR scan).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
const KEY = env.EVO_API_KEY;
const OWNER = (env.OWNER_NUMBER || '').split(',')[0];
const URL_T = 'http://127.0.0.1:8081';
const NAME = 'listtest';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`  ? ${q} `)).trim();
  rl.close();
  return a;
}
function docker() {
  if (spawnSync('docker', ['info']).status === 0) return ['docker'];
  if (process.platform !== 'win32' && spawnSync('sudo', ['-n', 'docker', 'info']).status === 0) return ['sudo', 'docker'];
  console.error('Docker is not running. Start Docker Desktop and try again.');
  process.exit(1);
}
const D = docker();
const compose = (args) => new Promise((res) => {
  const p = spawn(D[0], [...D.slice(1), 'compose', '-f', 'docker-compose.lists-test.yml', ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, EVO_API_KEY: KEY } });
  p.on('close', res);
});
async function evo(method, p, body) {
  const r = await fetch(`${URL_T}${p}`, { method, headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function cleanup() {
  say('Cleaning up the test (unlinking the test device, deleting test containers)…');
  await evo('DELETE', `/instance/logout/${NAME}`).catch(() => {});
  await compose(['down', '-v']);
}

async function main() {
  say('Starting a throwaway Evolution v2.3.6 (first time downloads ~500 MB)…');
  if ((await compose(['up', '-d'])) !== 0) process.exit(1);
  for (let i = 0; ; i++) {
    const ok = await fetch(`${URL_T}/`).then((r) => r.status < 500).catch(() => false);
    if (ok) break;
    if (i > 90) { console.error('Test Evolution did not start.'); await cleanup(); process.exit(1); }
    await sleep(2000);
  }
  await evo('POST', '/instance/create', { instanceName: NAME, integration: 'WHATSAPP-BAILEYS', qrcode: true });

  say(`Scan this QR with the BOT's phone${env.BOT_NUMBER ? ` (+${env.BOT_NUMBER})` : ''}: WhatsApp → Settings → Linked devices → Link a device.`);
  console.log('  (It is only added as an extra linked device; your bot stays connected.)');
  const { default: qrcode } = await import('qrcode-terminal');
  let linked = false;
  for (let round = 0; round < 8 && !linked; round++) {
    const c = await evo('GET', `/instance/connect/${NAME}`);
    if (c.body?.code) qrcode.generate(c.body.code, { small: true });
    for (let i = 0; i < 20 && !linked; i++) {
      await sleep(2000);
      linked = (await evo('GET', `/instance/connectionState/${NAME}`)).body?.instance?.state === 'open';
    }
  }
  if (!linked) { console.error('Not linked. Run the test again.'); await cleanup(); process.exit(1); }
  await sleep(4000);

  say(`Sending a test menu to +${OWNER}…`);
  const r = await evo('POST', `/message/sendList/${NAME}`, {
    number: OWNER,
    title: 'Menu test',
    description: 'If you can see a button below, interactive lists work.',
    buttonText: 'Choose voice',
    footerText: 'wa-video-bot list test',
    sections: [{ title: 'Voices', rows: [
      { title: '1. Mart', description: 'Euro-Brit, easy listening', rowId: 't:0' },
      { title: '2. George', description: 'warm British storyteller', rowId: 't:1' },
    ] }],
  });
  console.log(`  Evolution answered: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  await evo('POST', `/message/sendText/${NAME}`, { number: OWNER, text: '👆 List test: do you see a "Choose voice" button above? Answer in the terminal.' });

  const seen = /^y/i.test(await ask('On your phone, do you see a message with a "Choose voice" button that opens a menu? (y/n)'));
  await cleanup();

  if (!seen) {
    say('Result: menus do NOT show on this WhatsApp. Keep using polls (no change needed).');
    return;
  }
  say('Result: menus DO show with Evolution v2.3.6.');
  console.log('  Switching the real bot means: Evolution v2.3.6 with a FRESH database, so you scan the QR once more.');
  console.log('  Downsides: older WhatsApp library (fewer fixes than 2.3.7), and WhatsApp may stop showing menus in future.');
  if (!/^y/i.test(await ask('Switch the real bot to v2.3.6 now? (y/n)'))) return;
  const envPath = path.join(ROOT, '.env');
  let text = fs.readFileSync(envPath, 'utf8');
  text = /^EVO_IMAGE=/m.test(text) ? text.replace(/^EVO_IMAGE=.*$/m, 'EVO_IMAGE=evoapicloud/evolution-api:v2.3.6') : `${text.trimEnd()}\nEVO_IMAGE=evoapicloud/evolution-api:v2.3.6\n`;
  fs.writeFileSync(envPath, text);
  say('Removing the old WhatsApp server data and starting v2.3.6…');
  spawnSync(D[0], [...D.slice(1), 'compose', 'down', '-v'], { cwd: ROOT, stdio: 'inherit' });
  say('Now run the setup wizard to link WhatsApp again:  node scripts/wizard.js  (press Enter through the other steps)');
}

process.on('SIGINT', async () => { await cleanup(); process.exit(1); });
main().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
