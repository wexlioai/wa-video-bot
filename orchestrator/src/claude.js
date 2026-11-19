import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg } from './config.js';
import { run } from './util.js';

export class ClaudeLimitError extends Error {}

/**
 * Run Claude Code headless inside the job folder, using the subscription you
 * logged into with `claude` (no API key — make sure ANTHROPIC_API_KEY is NOT set).
 * Claude may only Read/Write/Edit files in the job folder.
 */
export async function askClaude(jobDir, promptName, vars = {}, { maxTurns = 25, model } = {}) {
  let prompt = await fs.readFile(path.join(cfg.promptsDir, `${promptName}.md`), 'utf8');
  vars = { SCHEMA: await fs.readFile(path.join(cfg.promptsDir, 'schema.md'), 'utf8'), ...vars };
  for (const [k, v] of Object.entries(vars)) prompt = prompt.replaceAll(`{{${k}}}`, String(v));
  prompt = prompt.replace(/\{\{RULES\}\}/g, ''); // no niche rules for this call

  const args = [
    '-p', // prompt is piped on stdin
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read', 'Write', 'Edit',
    '--disallowedTools', 'Bash', 'WebFetch', 'WebSearch',
    '--max-turns', String(maxTurns),
  ];
  if (model || cfg.claude.model) args.push('--model', model || cfg.claude.model);

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force subscription login, never API billing

  const { stdout, stderr } = await run(cfg.claude.bin, args, {
    cwd: jobDir, timeoutMs: cfg.claude.timeoutMs, allowFail: true, env, input: prompt,
  });

  let result;
  try { result = JSON.parse(stdout); } catch { result = { is_error: true, result: stdout || stderr }; }
  const msg = String(result.result || stderr || '');
  if (/usage limit|rate limit|limit reached|resets? at/i.test(msg) && result.is_error !== false) {
    throw new ClaudeLimitError(msg.slice(0, 300));
  }
  if (/authenticat|oauth|log ?in|invalid api key|401/i.test(msg) && result.is_error !== false) {
    throw new Error('Claude login expired or invalid. Re-run the setup wizard (Claude step) to create a new token, then send `retry`.');
  }
  if (result.is_error) throw new Error(`Claude failed: ${msg.slice(0, 500)}`);
  return msg;
}
