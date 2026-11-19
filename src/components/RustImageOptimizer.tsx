import { useConfig } from '@/components/ConfigProvider';
import { bytes } from '@/lib/bytes';
import { copyRustImage, rustImageCommand } from '@/lib/client/copyRustImage';
import { defaultEphemeralOptions, defaultUploadOptions } from '@/lib/client/store/uploadOptions';
import { uploadFiles } from '@/lib/client/upload/files';
import { RESIL_MAX_FILE_BYTES } from '@/lib/resil-upload-limits';
import { rustSignGroups } from '@/lib/rust-sign-sizes';
import { Alert, Button, FileInput, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { useState } from 'react';

const presets = rustSignGroups.flatMap<readonly [string, number, number]>(({ sizes }) => sizes);
const signOptions = rustSignGroups.map(({ name, sizes }) => ({
  group: name,
  items: sizes.map(([label, width, height]) => ({
    value: label,
    label: `${label} (${width} × ${height})`,
  })),
}));

async function encode(canvas: HTMLCanvasElement, format: string, limit: number) {
  const qualities = format === 'image/jpeg' ? [0.92, 0.82, 0.7, 0.55, 0.4, 0.25] : [1];
  for (const quality of qualities) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, quality));
    if (blob?.type === format && blob.size <= limit) return blob;
  }

  throw new Error(
    format === 'image/png'
      ? 'This PNG is too large for /sil. Try JPEG, which fills transparent areas with white.'
      : 'This JPEG is still too large for the current upload limit.',
  );
}

export default function RustImageOptimizer() {
  const config = useConfig();
  const clipboard = useClipboard();
  const [file, setFile] = useState<File | null>(null);
  const [sign, setSign] = useState<string | null>(null);
  const [fit, setFit] = useState('fill');
  const [format, setFormat] = useState('image/png');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ name: string; width: number; height: number; size: number }>();
  const preset = presets.find(([name]) => name === sign);

  async function optimize() {
    if (!file || !preset || busy) return;
    const [, width, height] = preset;
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const image = await createImageBitmap(file).catch(() => {
        throw new Error('Could not open this image. Try a PNG, JPEG, or WebP file.');
      });
      const canvas = document.createElement('canvas');
      try {
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser could not prepare the image.');

        if (format === 'image/jpeg') {
          context.fillStyle = '#fff';
          context.fillRect(0, 0, width, height);
        }
        const scale = (fit === 'fill' ? Math.max : Math.min)(width / image.width, height / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      } finally {
        image.close();
      }

      const limit = Math.min(bytes(config.files.maxFileSize), RESIL_MAX_FILE_BYTES);
      const blob = await encode(canvas, format, limit);
      const extension = format === 'image/jpeg' ? 'jpg' : 'png';
      const stem = file.name.replace(/\.[^.]+$/, '');
      const optimized = new File([blob], `${stem}-${width}x${height}.${extension}`, { type: blob.type });
      const uploaded = await uploadFiles([optimized], {
        options: defaultUploadOptions,
        ephemeral: defaultEphemeralOptions,
        clipboard,
        setProgress: () => {},
        setFiles: () => {},
        clearEphemeral: () => {},
        showResult: false,
      });
      const stored = uploaded?.files[0];
      if (!stored) throw new Error('Upload failed. Check the upload notification for details.');
      if (stored.pending)
        throw new Error('The upload is still processing. Find it in My Images when it’s ready.');
      if (stored.type !== format || (stored.size ?? blob.size) > limit) {
        throw new Error('Resil changed the uploaded format or size. Check the result in My Images.');
      }
      setResult({ name: stored.name, width, height, size: stored.size ?? blob.size });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not optimize and upload this image.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack mt='lg'>
      <Title order={2}>Rust Image Optimizer</Title>
      <FileInput
        label='Image'
        accept='image/png,image/jpeg,image/webp'
        value={file}
        onChange={setFile}
        clearable
        disabled={busy}
      />
      <Select
        label='Rust sign or frame'
        data={signOptions}
        value={sign}
        onChange={setSign}
        searchable
        disabled={busy}
      />
      <Select
        label='Fit'
        value={fit}
        onChange={(value) => value && setFit(value)}
        data={[
          { value: 'fill', label: 'Fill the sign (center crop)' },
          { value: 'contain', label: 'Fit the whole image (add margins)' },
        ]}
        allowDeselect={false}
        disabled={busy}
      />
      <Select
        label='Output format'
        value={format}
        onChange={(value) => value && setFormat(value)}
        data={[
          { value: 'image/png', label: 'PNG (keeps transparency)' },
          { value: 'image/jpeg', label: 'JPEG (smaller files)' },
        ]}
        allowDeselect={false}
        disabled={busy}
      />
      <Text size='sm' c='dimmed'>
        Uploading creates an image link that anyone with the link can open.
      </Text>
      {error && (
        <Alert color='red' role='alert'>
          {error}
        </Alert>
      )}
      <Button onClick={optimize} loading={busy} disabled={!file || !preset}>
        Upload and generate /sil command
      </Button>
      {result && (
        <>
          <Text size='sm'>
            {result.width} × {result.height} px · {result.size.toLocaleString()} bytes
          </Text>
          <TextInput label='Rust command' value={rustImageCommand(result.name)} readOnly />
          <Button variant='light' onClick={() => copyRustImage(result.name, clipboard)}>
            Copy /sil command
          </Button>
        </>
      )}
    </Stack>
  );
}
