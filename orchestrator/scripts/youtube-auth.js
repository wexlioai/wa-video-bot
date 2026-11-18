// One-time: get a YouTube refresh token for your channel.
// 1. Google Cloud Console > create project > enable "YouTube Data API v3"
// 2. OAuth consent screen: External, add yourself as a Test user
//    (then click "Publish app" so the token doesn't expire after 7 days — fine for personal use)
// 3. Credentials > Create OAuth client ID > type "Desktop app" > copy ID + secret into .env
// 4. Run: npm run setup:youtube   (from your PC, or via SSH with port 53682 forwarded:
//    ssh -L 53682:127.0.0.1:53682 user@server)
import http from 'node:http';
import { google } from 'googleapis';
import { cfg } from '../src/config.js';

const PORT = 53682;
const redirect = `http://127.0.0.1:${PORT}`;
const auth = new google.auth.OAuth2(cfg.yt.clientId, cfg.yt.clientSecret, redirect);
const url = auth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube'],
});
console.log('\nOpen this URL, sign in with the channel account and allow access:\n\n' + url + '\n');

http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get('code');
  if (!code) return res.end('No code');
  const { tokens } = await auth.getToken(code);
  res.end('Done. You can close this tab.');
  console.log('\nAdd this line to .env:\n\nYT_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
  process.exit(0);
}).listen(PORT, '127.0.0.1');
