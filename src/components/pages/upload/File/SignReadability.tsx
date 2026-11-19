import { Button, Stack, Text } from '@mantine/core';
import { useState } from 'react';

export default function SignReadability({ original, copy }: { original: File; copy: File }) {
  const [result, setResult] = useState<{ copy: File; score: number | null }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const score = result?.copy === copy ? result.score : undefined;

  async function check() {
    setBusy(true);
    setError('');
    try {
      const { checkSignReadability } = await import('@/lib/client/upload/sign-readability');
      setResult({ copy, score: await checkSignReadability(original, copy) });
    } catch {
      setError('The text check could not run. Review the sign copy at actual pixel size.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap='xs' align='flex-start' mt='sm'>
      <Button size='compact-sm' variant='light' onClick={check} loading={busy}>
        Check text readability
      </Button>
      {error && (
        <Text size='sm' c='red' role='alert'>
          {error}
        </Text>
      )}
      {score === null && (
        <Text size='sm'>No English text detected. If your sign has lettering, try larger, bolder text.</Text>
      )}
      {typeof score === 'number' && (
        <Text size='sm' aria-live='polite'>
          <strong>Estimated readability: {score}/100.</strong>{' '}
          {score < 70
            ? 'Try a larger, bolder font, stronger contrast, or a larger sign. Then check again.'
            : 'Check how the lettering looks in Rust before relying on this estimate.'}
        </Text>
      )}
    </Stack>
  );
}
