#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const { values } = parseArgs({ options: { input: { type: 'string' }, pages: { type: 'string' }, output: { type: 'string' } } });
if (!values.input || !values.pages || !values.output) throw new Error('Usage: --input source.pdf --pages 411,443,525 --output /tmp/source-pages');
const pages = values.pages.split(',').map(Number);
const task = getDocument({ data: new Uint8Array(await fs.readFile(values.input)), verbosity: 0 });
try {
  const document = await task.promise;
  if (pages.some(n => !Number.isInteger(n) || n < 1 || n > document.numPages)) throw new Error('Invalid source page');
  await fs.mkdir(values.output, { recursive: true });
  for (const n of pages) {
    const page = await document.getPage(n), viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    await fs.writeFile(path.join(values.output, `page-${n}.png`), canvas.toBuffer('image/png'));
    page.cleanup();
  }
} finally {
  await task.destroy();
}
