import { Alert, Button, FileInput, Group, NumberInput, Select, Stack, Title } from '@mantine/core';
import { useState } from 'react';

export default function RustImageOptimizer() {
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState<number | string>(1024);
  const [height, setHeight] = useState<number | string>(1024);
  const [format, setFormat] = useState('image/png');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validSize = [width, height].every(
    (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4096,
  );

  async function optimize() {
    if (!file || !validSize) return;
    setBusy(true);
    setError('');
    try {
      const image = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      try {
        const scale = Math.min(Number(width) / image.width, Number(height) / image.height, 1);
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');

        if (format === 'image/jpeg') {
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally {
        image.close();
      }

      const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, 0.9));
      if (!result) throw new Error('Image export failed');

      const url = URL.createObjectURL(result);
      const download = document.createElement('a');
      download.href = url;
      const extension = format === 'image/jpeg' ? 'jpg' : 'png';
      download.download = `${file.name.replace(/\.[^.]+$/, '')}-rust.${extension}`;
      download.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Could not open or export this image. Try a PNG, JPEG, or WebP file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack mt='lg'>
      <Title order={2}>Rust Image Optimizer</Title>
      <FileInput
        label='Image'
        description='Resize an image in your browser before uploading it.'
        accept='image/png,image/jpeg,image/webp'
        value={file}
        onChange={setFile}
        clearable
      />
      <Group grow align='flex-end'>
        <NumberInput
          label='Max width (px)'
          value={width}
          onChange={setWidth}
          min={1}
          max={4096}
          allowDecimal={false}
        />
        <NumberInput
          label='Max height (px)'
          value={height}
          onChange={setHeight}
          min={1}
          max={4096}
          allowDecimal={false}
        />
      </Group>
      <Select
        label='Output format'
        value={format}
        onChange={(value) => {
          if (value) setFormat(value);
        }}
        allowDeselect={false}
        data={[
          { value: 'image/png', label: 'PNG' },
          { value: 'image/jpeg', label: 'JPEG' },
        ]}
      />
      {error && (
        <Alert color='red' role='alert'>
          {error}
        </Alert>
      )}
      <Button onClick={optimize} loading={busy} disabled={!file || !validSize}>
        Download optimized image
      </Button>
    </Stack>
  );
}
