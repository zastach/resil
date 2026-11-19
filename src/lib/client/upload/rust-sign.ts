import { rustSignGroups } from '@/lib/rust-sign-sizes';

type SignPreset = readonly [name: string, width: number, height: number];

export const signOptions = rustSignGroups.map(({ name, sizes }) => ({
  group: name,
  items: sizes.map(([label, width, height]) => ({ value: label, label: `${label} (${width} × ${height})` })),
}));

const presets = rustSignGroups.flatMap<SignPreset>(({ sizes }) => sizes);

export function getSignPreset(name: string | null) {
  return presets.find(([label]) => label === name);
}

export const defaultSignAdjustments = { zoom: 100, x: 0, y: 0, brightness: 100, contrast: 0, sharpness: 0 };

export function isNeonSign(name: string) {
  return name.includes('Neon Sign');
}

async function encodeJpeg(canvas: HTMLCanvasElement, limit: number) {
  for (const quality of [0.92, 0.82, 0.7, 0.55, 0.4, 0.25]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob?.type === 'image/jpeg' && blob.size <= limit) return blob;
  }
  return null;
}

async function decodeImage(file: File) {
  return createImageBitmap(file).catch(() => {
    throw new Error(`Could not read "${file.name}" as an image.`);
  });
}

export async function fitImageToUploadLimit(file: File, limit: number) {
  if (file.size <= limit) return file;
  if (file.type && !file.type.startsWith('image/'))
    throw new Error(`"${file.name}" exceeds the upload limit.`);

  const image = await decodeImage(file);
  try {
    const canvas = document.createElement('canvas');
    for (
      let edge = Math.min(2560, Math.max(image.width, image.height));
      edge >= 32;
      edge = Math.floor(edge * 0.7)
    ) {
      const scale = edge / Math.max(image.width, image.height);
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not prepare the image.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await encodeJpeg(canvas, limit);
      if (blob)
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-optimized.jpeg`, { type: blob.type });
    }
  } finally {
    image.close();
  }
  throw new Error(`Could not fit "${file.name}" under the upload limit.`);
}

function sharpenSign(context: CanvasRenderingContext2D, width: number, height: number, strength: number) {
  const pixels = context.getImageData(0, 0, width, height);
  const source = pixels.data.slice();
  const stride = width * 4;
  const amount = strength / 200;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const pixel = y * stride + x * 4;
      for (let channel = 0; channel < 3; channel++) {
        const i = pixel + channel;
        const neighbors = source[i - 4] + source[i + 4] + source[i - stride] + source[i + stride];
        pixels.data[i] = source[i] + amount * (4 * source[i] - neighbors);
      }
    }
  }

  context.putImageData(pixels, 0, 0);
}

export async function makeSignCopy(
  file: File,
  [name, width, height]: SignPreset,
  limit: number,
  adjustments = defaultSignAdjustments,
) {
  const image = await decodeImage(file);
  const canvas = document.createElement('canvas');
  let clipped: boolean;
  try {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the image.');

    const neon = isNeonSign(name);
    context.fillStyle = neon ? '#000' : '#fff';
    context.fillRect(0, 0, width, height);
    const brightness = neon ? adjustments.brightness : 100;
    if (brightness !== 100 || adjustments.contrast !== 0)
      context.filter = `contrast(${100 + adjustments.contrast}%) brightness(${brightness}%)`;
    context.imageSmoothingQuality = 'high';
    const scale = (Math.min(width / image.width, height / image.height) * adjustments.zoom) / 100;
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const x = (width - drawWidth) / 2 + (width * adjustments.x) / 100;
    const y = (height - drawHeight) / 2 + (height * adjustments.y) / 100;
    clipped = x < -0.5 || y < -0.5 || x + drawWidth > width + 0.5 || y + drawHeight > height + 0.5;
    context.drawImage(image, x, y, drawWidth, drawHeight);
    if (adjustments.sharpness > 0) sharpenSign(context, width, height, adjustments.sharpness);
  } finally {
    image.close();
  }

  const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
  const suffix = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-$/, '');
  const blob = await encodeJpeg(canvas, limit);
  if (blob) return { file: new File([blob], `${stem}-${suffix}.jpeg`, { type: blob.type }), clipped };
  throw new Error(`The sign copy of "${file.name}" exceeds the upload limit.`);
}
