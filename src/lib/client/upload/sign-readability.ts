import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import { createWorker, PSM } from 'tesseract.js';

import { gradeSignReadability } from './sign-readability-grade';

export type SignTextRegion = { x: number; y: number; width: number; height: number };

async function prepareForRecognition(file: File, region?: SignTextRegion) {
  const bitmap = await createImageBitmap(file);
  try {
    const x = region ? Math.min(bitmap.width - 1, Math.floor(region.x * bitmap.width)) : 0;
    const y = region ? Math.min(bitmap.height - 1, Math.floor(region.y * bitmap.height)) : 0;
    const right = region ? Math.ceil((region.x + region.width) * bitmap.width) : bitmap.width;
    const bottom = region ? Math.ceil((region.y + region.height) * bitmap.height) : bitmap.height;
    const width = Math.max(1, Math.min(bitmap.width, right) - x);
    const height = Math.max(1, Math.min(bitmap.height, bottom) - y);
    const largestEdge = Math.max(width, height);
    const scale = Math.min(region ? 6 : 4, Math.max(768, Math.min(largestEdge, 1800)) / largestEdge);
    const padding = region ? 12 : 0;
    const canvas = document.createElement('canvas');
    const scaledWidth = Math.max(1, Math.round(width * scale));
    const scaledHeight = Math.max(1, Math.round(height * scale));
    canvas.width = scaledWidth + 2 * padding;
    canvas.height = scaledHeight + 2 * padding;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the text preview.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, x, y, width, height, padding, padding, scaledWidth, scaledHeight);
    return { canvas, scale };
  } finally {
    bitmap.close();
  }
}

export async function checkSignReadability(original: File, sign: File, region?: SignTextRegion) {
  const worker = await createWorker('eng', 1, {
    workerPath,
    corePath,
    langPath: new URL('/api/sign-readability-model', window.location.origin).href,
    workerBlobURL: false,
    errorHandler: () => {},
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: region ? PSM.SINGLE_BLOCK : PSM.AUTO });
    const source = region
      ? { text: '', confidence: 0 }
      : (await worker.recognize((await prepareForRecognition(original)).canvas)).data;
    const { canvas: signCanvas, scale } = await prepareForRecognition(sign, region);
    const { data: output } = await worker.recognize(signCanvas, {}, { blocks: true });
    const wordHeights = (output.blocks ?? [])
      .flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .flatMap((line) => line.words)
      .filter((word) => /[a-z0-9]{2}/i.test(word.text))
      .map(({ bbox }) => (bbox.y1 - bbox.y0) / scale)
      .sort((a, b) => a - b);
    const typicalWordHeight = wordHeights[Math.floor(wordHeights.length / 2)];
    return gradeSignReadability(source, output, typicalWordHeight);
  } finally {
    await worker.terminate();
  }
}
