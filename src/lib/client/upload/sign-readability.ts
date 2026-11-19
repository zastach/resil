import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import { createWorker, PSM } from 'tesseract.js';

import { gradeSignReadability } from './sign-readability-grade';

async function prepareForRecognition(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const largestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(4, Math.max(768, Math.min(largestEdge, 1800)) / largestEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the text preview.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { canvas, scale };
  } finally {
    bitmap.close();
  }
}

export async function checkSignReadability(original: File, sign: File) {
  const worker = await createWorker('eng', 1, {
    workerPath,
    corePath,
    langPath: new URL('/api/sign-readability-model', window.location.origin).href,
    workerBlobURL: false,
    errorHandler: () => {},
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const { canvas: sourceCanvas } = await prepareForRecognition(original);
    const { data: source } = await worker.recognize(sourceCanvas);
    const { canvas: signCanvas, scale } = await prepareForRecognition(sign);
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
