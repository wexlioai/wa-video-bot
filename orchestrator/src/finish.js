// The finishing pass: rendered chunks → one final MP4 with ONE video encode.
//   1. check the chunks match (codec, size, fps, pixel format), re-encode any that don't, join them (copy)
//   2. mix the audio: voice + music ducked under it + sound effects
//   3. measure loudness (pass 1), then the final encode applies it exactly (-14 LUFS, pass 2) while
//      burning in the progress layer and the subtitles (ASS, libass)
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, audioDuration } from './util.js';

const LEVEL = { low: 0.11, medium: 0.18, high: 0.27 };

async function probe(file) {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate', '-of', 'json', file], { allowFail: true });
  try { return JSON.parse(r.stdout).streams?.[0] || null; } catch { return null; }
}

/** Join chunk files; chunks whose video parameters differ from the first are normalised first. */
export async function joinChunks(chunks, out, work) {
  const ref = await probe(chunks[0]);
  const fixed = [];
  for (const [i, c] of chunks.entries()) {
    const p = await probe(c);
    const same = p && ref && ['codec_name', 'width', 'height', 'pix_fmt', 'r_frame_rate'].every((k) => p[k] === ref[k]);
    if (same) { fixed.push(c); continue; }
    const n = path.join(work, `norm-${i}.mp4`);
    const [num, den] = String(ref?.r_frame_rate || '30/1').split('/').map(Number);
    await run('ffmpeg', ['-y', '-i', c, '-vf', `scale=${ref.width}:${ref.height},fps=${num / (den || 1)}`, '-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast', '-pix_fmt', ref.pix_fmt || 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', n], { timeoutMs: 60 * 60_000 });
    fixed.push(n);
  }
  const list = path.join(work, 'chunks.txt');
  await fs.writeFile(list, fixed.map((c) => `file '${c.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', out], { timeoutMs: 60 * 60_000 });
}

/** Voice (from the joined video) + ducked music + sound effects → WAV. events: [{file, t, vol}] */
async function mixAudio(joined, outWav, { music, volume, events = [] }) {
  const D = await audioDuration(joined);
  const args = ['-y', '-i', joined];
  const parts = [];
  let n = 1;
  let duck = null;
  if (music && volume !== 'off') {
    args.push('-stream_loop', '-1', '-i', music);
    parts.push('[0:a]asplit=2[voice][key]');
    parts.push(`[${n}:a]atrim=0:${D.toFixed(2)},asetpts=PTS-STARTPTS,volume=${LEVEL[volume] || LEVEL.low},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, D - 3).toFixed(2)}:d=3[m]`);
    parts.push('[m][key]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=450[duck]');
    duck = '[duck]';
    n++;
  } else parts.push('[0:a]anull[voice]');
  // one input per distinct sound file, split for its uses
  const byFile = new Map();
  for (const e of events) { if (!byFile.has(e.file)) byFile.set(e.file, []); byFile.get(e.file).push(e); }
  const labels = [];
  for (const [file, list] of byFile) {
    args.push('-i', file);
    const k = n++;
    parts.push(`[${k}:a]asplit=${list.length}${list.map((_, i) => `[f${k}_${i}]`).join('')}`);
    list.forEach((e, i) => {
      const ms = Math.max(0, Math.round(e.t * 1000));
      parts.push(`[f${k}_${i}]volume=${(e.vol ?? 0.35).toFixed(2)},adelay=${ms}|${ms}[e${k}_${i}]`);
      labels.push(`[e${k}_${i}]`);
    });
  }
  const ins = ['[voice]', ...(duck ? [duck] : []), ...labels];
  parts.push(`${ins.join('')}amix=inputs=${ins.length}:duration=first:normalize=0[a]`);
  args.push('-filter_complex', parts.join(';'), '-map', '[a]', '-ar', '48000', '-ac', '2', outWav);
  await run('ffmpeg', args, { timeoutMs: 60 * 60_000 });
}

async function measureLoudness(wav) {
  const r = await run('ffmpeg', ['-hide_banner', '-i', wav, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { allowFail: true, timeoutMs: 60 * 60_000 });
  const m = r.stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

/**
 * chunks → out. progress: result of progressLayer() or null. assFile: subtitles or null.
 * fontsDir: folder with the subtitle fonts. events: sound effects [{file, t, vol}].
 */
export async function finishVideo({ chunks, out, work, progress, assFile, fontsDir, music, volume, events, keyframes = [] }) {
  await fs.mkdir(work, { recursive: true });
  const joined = path.join(work, 'joined.mp4');
  await joinChunks(chunks, joined, work);
  const wav = path.join(work, 'mix.wav');
  await mixAudio(joined, wav, { music, volume, events });
  const L = await measureLoudness(wav);
  const loud = L
    ? `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${L.input_i}:measured_TP=${L.input_tp}:measured_LRA=${L.input_lra}:measured_thresh=${L.input_thresh}:offset=${L.target_offset}:linear=true`
    : 'loudnorm=I=-14:TP=-1.5:LRA=11';

  // video chain (relative file names: run inside `work` so Windows paths need no escaping)
  const args = ['-y', '-i', 'joined.mp4', '-i', 'mix.wav'];
  const parts = [];
  let v = '[0:v]';
  if (progress) {
    progress.inputs.forEach((f) => args.push('-i', path.relative(work, f)));
    const c = progress.chain(v, 2);
    parts.push(...c.parts);
    v = c.out;
  }
  if (assFile) {
    const rel = (p) => path.relative(work, p).split(path.sep).join('/');
    parts.push(`${v}subtitles=${rel(assFile)}${fontsDir ? `:fontsdir=${rel(fontsDir)}` : ''}[vsub]`);
    v = '[vsub]';
  }
  parts.push(`[1:a]${loud},aresample=48000[aout]`);
  if (v === '[0:v]') parts.push('[0:v]null[vfinal]'); else parts.push(`${v}null[vfinal]`);
  args.push('-filter_complex', parts.join(';'), '-map', '[vfinal]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p',
    ...(keyframes.length ? ['-force_key_frames', keyframes.map((k) => k.toFixed(3)).join(',')] : []), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.resolve(out));
  await run('ffmpeg', args, { cwd: work, timeoutMs: 6 * 60 * 60_000 });
  await fs.rm(joined, { force: true });
  await fs.rm(wav, { force: true });
}

/** Cut a finished video into parts at the given times (keyframes were forced there, so no re-encode). */
export async function splitAt(file, times, outBase) {
  const bounds = [0, ...times];
  const parts = [];
  for (let i = 0; i < bounds.length; i++) {
    const out = `${outBase}-part${i + 1}.mp4`;
    const args = ['-y', '-ss', bounds[i].toFixed(3), '-i', file];
    if (i + 1 < bounds.length) args.push('-t', (bounds[i + 1] - bounds[i]).toFixed(3));
    args.push('-c', 'copy', '-movflags', '+faststart', out);
    await run('ffmpeg', args, { timeoutMs: 6 * 60 * 60_000 });
    parts.push(out);
  }
  return parts;
}

/** A short highlights preview for long videos: three 40-second excerpts (start, middle, end). */
export async function highlights(file, out, duration) {
  const pts = [Math.min(30, duration * 0.05), duration * 0.5, Math.max(0, duration - 60)];
  const tmp = [];
  for (const [i, t] of pts.entries()) {
    const f = `${out}.h${i}.mp4`;
    await run('ffmpeg', ['-y', '-ss', t.toFixed(2), '-i', file, '-t', '40', '-vf', 'scale=-2:720', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-c:a', 'aac', '-b:a', '128k', f], { timeoutMs: 30 * 60_000 });
    tmp.push(f);
  }
  const list = `${out}.txt`;
  await fs.writeFile(list, tmp.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { timeoutMs: 30 * 60_000 });
  for (const f of [...tmp, list]) await fs.rm(f, { force: true });
  return out;
}
