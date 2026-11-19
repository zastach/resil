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

export async function makeSignCopy(file: File, [name, width, height]: SignPreset, limit: number) {
  const image = await createImageBitmap(file).catch(() => {
    throw new Error(`Could not read "${file.name}" as an image.`);
  });
  const canvas = document.createElement('canvas');
  try {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the image.');

    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } finally {
    image.close();
  }

  const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
  const suffix = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-$/, '');
  for (const quality of [0.92, 0.82, 0.7, 0.55, 0.4, 0.25]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob?.type === 'image/jpeg' && blob.size <= limit)
      return new File([blob], `${stem}-${suffix}.jpeg`, { type: blob.type });
  }
  throw new Error(`The sign copy of "${file.name}" exceeds the upload limit.`);
}
