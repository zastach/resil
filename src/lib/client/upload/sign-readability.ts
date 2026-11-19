import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import { createWorker, PSM } from 'tesseract.js';

function words(text: string) {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
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
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const { data: source } = await worker.recognize(original);
    const { data: output } = await worker.recognize(sign);
    const sourceWords = words(source.text);
    const outputWords = words(output.text);
    if (!sourceWords.length && !outputWords.length) return null;
    let retention = 1;
    if (sourceWords.length) {
      const counts = new Map<string, number>();
      for (const word of outputWords) counts.set(word, (counts.get(word) ?? 0) + 1);
      let matched = 0;
      for (const word of sourceWords) {
        const count = counts.get(word) ?? 0;
        if (!count) continue;
        matched++;
        counts.set(word, count - 1);
      }
      retention = matched / sourceWords.length;
    }
    return Math.round(Math.min(100, Math.max(0, output.confidence || 0)) * retention);
  } finally {
    await worker.terminate();
  }
}
