import type { SignReadabilityGrade } from '@/lib/client/upload/sign-readability-grade';
import { Button, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useState } from 'react';

export default function SignReadability({ original, copy }: { original: File; copy: File }) {
  const [result, setResult] = useState<{ copy: File; grade: SignReadabilityGrade }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const grade = result?.copy === copy ? result.grade : undefined;

  async function check() {
    setBusy(true);
    setError('');
    try {
      const { checkSignReadability } = await import('@/lib/client/upload/sign-readability');
      setResult({ copy, grade: await checkSignReadability(original, copy) });
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
      {grade === null && (
        <Text size='sm'>No English text detected. If your sign has lettering, try larger, bolder text.</Text>
      )}
      {grade && (
        <Text size='sm' aria-live='polite'>
          <strong>Estimated readability</strong>{' '}
          <Tooltip label={`${grade.score}/100`} events={{ hover: true, focus: true, touch: true }}>
            <UnstyledButton
              fw={700}
              component='button'
              type='button'
              style={{ textDecoration: 'underline dotted' }}
            >
              {grade.grade}
            </UnstyledButton>
          </Tooltip>{' '}
          {grade.grade === 'VERY LOW' || grade.grade === 'LOW'
            ? 'Try a larger, bolder font, stronger contrast, or a larger sign. Then check again.'
            : 'Check how the lettering looks in Rust before relying on this estimate.'}
        </Text>
      )}
    </Stack>
  );
}
