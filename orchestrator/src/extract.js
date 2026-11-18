import path from 'node:path';
import fs from 'node:fs/promises';
import { run, exists } from './util.js';

/**
 * Turn the uploaded file into script.txt (best effort).
 * For PDFs we also keep the original: Urdu PDFs often extract as garbage
 * (InPage exports, reversed glyphs), so Claude is told to read the PDF itself if needed.
 */
export async function extractText(jobDir, srcFile) {
  const ext = path.extname(srcFile).toLowerCase();
  const out = path.join(jobDir, 'script.txt');
  let text = '';
  if (ext === '.pdf') {
    // if pdftotext is missing or fails, Claude reads the PDF itself
    await run('pdftotext', ['-enc', 'UTF-8', srcFile, out], { allowFail: true }).catch(() => {});
    text = (await exists(out)) ? await fs.readFile(out, 'utf8') : '';
  } else if (ext === '.docx' || ext === '.odt' || ext === '.rtf') {
    const r = await run('pandoc', [srcFile, '-t', 'plain', '--wrap=none']);
    text = r.stdout;
  } else if (ext === '.doc') {
    // old Word format: convert with LibreOffice first
    const soffice = process.platform === 'win32' ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : 'soffice';
    await run(soffice, ['--headless', '--convert-to', 'docx', '--outdir', jobDir, srcFile], { timeoutMs: 120_000 }).catch(() => {
      throw new Error('Old .doc files need LibreOffice installed. Save the file as .docx or PDF instead.');
    });
    const docx = path.join(jobDir, path.basename(srcFile, ext) + '.docx');
    text = (await run('pandoc', [docx, '-t', 'plain', '--wrap=none'])).stdout;
  } else if (ext === '.txt' || ext === '.md') {
    text = await fs.readFile(srcFile, 'utf8');
  } else {
    throw new Error(`Unsupported file type ${ext}. Send PDF, DOCX, DOC or TXT.`);
  }
  text = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  await fs.writeFile(out, text);
  return text;
}

export function detectLanguage(text) {
  const urdu = (text.match(/[؀-ۿ]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return urdu > latin ? 'ur' : 'en';
}
