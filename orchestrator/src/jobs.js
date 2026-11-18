import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg } from './config.js';
import { currentNumber } from './whatsapp.js';
import { readJson, writeJson, exists } from './util.js';

const jobsDir = () => path.join(cfg.dataDir, 'jobs');
export const userDir = (n = currentNumber()) => path.join(cfg.dataDir, 'users', n);
const currentFile = () => path.join(userDir(), 'current.txt');

// one-time move of single-user data (data/current.txt, data/prefs.json) to the main owner
export async function migrateSingleUser() {
  const dir = userDir(cfg.ownerNumber);
  await fs.mkdir(dir, { recursive: true });
  for (const f of ['current.txt', 'prefs.json']) {
    const old = path.join(cfg.dataDir, f);
    if ((await exists(old)) && !(await exists(path.join(dir, f)))) await fs.rename(old, path.join(dir, f));
  }
}

export async function createJob() {
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${currentNumber().slice(-4)}`;
  const dir = path.join(jobsDir(), id);
  await fs.mkdir(dir, { recursive: true });
  const job = { id, dir, owner: currentNumber(), state: 'NEW', createdAt: Date.now(), formats: [], outputs: {}, uploads: {} };
  await saveJob(job);
  await fs.mkdir(userDir(), { recursive: true });
  await fs.writeFile(currentFile(), id);
  return job;
}

export const saveJob = (job) => writeJson(path.join(job.dir, 'job.json'), job);

export async function currentJob() {
  if (!(await exists(currentFile()))) return null;
  const id = (await fs.readFile(currentFile(), 'utf8')).trim();
  const f = path.join(jobsDir(), id, 'job.json');
  return (await exists(f)) ? readJson(f) : null;
}

export const loadPlan = (job) => readJson(path.join(job.dir, 'plan.json'));
