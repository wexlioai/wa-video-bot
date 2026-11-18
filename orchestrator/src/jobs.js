import fs from 'node:fs/promises';
import path from 'node:path';
import { cfg } from './config.js';
import { readJson, writeJson, exists } from './util.js';

const jobsDir = () => path.join(cfg.dataDir, 'jobs');
const currentFile = () => path.join(cfg.dataDir, 'current.txt');

export async function createJob() {
  const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dir = path.join(jobsDir(), id);
  await fs.mkdir(dir, { recursive: true });
  const job = { id, dir, state: 'NEW', createdAt: Date.now(), formats: [], outputs: {}, uploads: {} };
  await saveJob(job);
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
