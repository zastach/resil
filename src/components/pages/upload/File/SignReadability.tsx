import type { SignTextRegion } from '@/lib/client/upload/sign-readability';
import type { SignReadabilityGrade } from '@/lib/client/upload/sign-readability-grade';
import { Button, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useEffect, useRef, useState, type PointerEvent } from 'react';

type Point = { x: number; y: number };

function getPoint(event: PointerEvent<HTMLDivElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width),
    y: clamp((event.clientY - bounds.top) / bounds.height),
  };
}

function getRegion(start: Point, end: Point): SignTextRegion {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  };
}

export default function SignReadability({ original, copy }: { original: File; copy: File }) {
  const [result, setResult] = useState<{
    copy: File;
    grade: SignReadabilityGrade;
    region?: SignTextRegion;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<SignTextRegion>();
  const image = useRef<HTMLImageElement>(null);
  const startPoint = useRef<Point | null>(null);
  const grade = result?.copy === copy ? result.grade : undefined;

  useEffect(() => {
    if (!selecting || !image.current) return;
    const url = URL.createObjectURL(copy);
    image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [copy, selecting]);

  async function check(region?: SignTextRegion) {
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const { checkSignReadability } = await import('@/lib/client/upload/sign-readability');
      setResult({ copy, grade: await checkSignReadability(original, copy, region), region });
    } catch {
      setError('The text check could not run. Review the sign copy at actual pixel size.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap='xs' align='flex-start' mt='sm'>
      <Group gap='xs'>
        <Button
          size='compact-sm'
          variant='light'
          disabled={busy}
          onClick={() => {
            setSelecting(!selecting);
            setSelection(undefined);
          }}
        >
          {selecting ? 'Close text selection' : 'Select text to check'}
        </Button>
        <Button
          size='compact-sm'
          variant='subtle'
          disabled={busy}
          onClick={() => {
            setSelection(undefined);
            void check();
          }}
        >
          Check whole sign
        </Button>
      </Group>
      {selecting && (
        <>
          <Text size='xs' c='dimmed'>
            Draw a box around the lettering, leaving a little space at the edges. The check starts when you
            let go.
          </Text>
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 560,
              cursor: busy ? 'wait' : 'crosshair',
              touchAction: 'none',
              userSelect: 'none',
            }}
            onPointerDown={(event) => {
              if (busy || !event.isPrimary || event.button !== 0 || !image.current?.naturalWidth) return;
              const point = getPoint(event);
              startPoint.current = point;
              event.currentTarget.setPointerCapture(event.pointerId);
              setSelection(getRegion(point, point));
              setResult(undefined);
              setError('');
            }}
            onPointerMove={(event) => {
              if (startPoint.current && event.currentTarget.hasPointerCapture(event.pointerId))
                setSelection(getRegion(startPoint.current, getPoint(event)));
            }}
            onPointerUp={(event) => {
              if (!startPoint.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const region = getRegion(startPoint.current, getPoint(event));
              startPoint.current = null;
              if (region.width < 0.01 || region.height < 0.01) {
                setSelection(undefined);
                setError('Draw a box around the text you want to check.');
                return;
              }
              setSelection(region);
              void check(region);
            }}
            onPointerCancel={() => {
              startPoint.current = null;
              setSelection(undefined);
            }}
          >
            <img
              ref={image}
              alt='Sign copy for selecting text'
              draggable={false}
              style={{ display: 'block', width: '100%', height: 'auto' }}
            />
            {selection && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  pointerEvents: 'none',
                  left: `${selection.x * 100}%`,
                  top: `${selection.y * 100}%`,
                  width: `${selection.width * 100}%`,
                  height: `${selection.height * 100}%`,
                  border: '2px solid white',
                  boxShadow: '0 0 0 1px #000',
                }}
              />
            )}
          </div>
        </>
      )}
      {busy && (
        <Text component='output' size='sm'>
          Checking text…
        </Text>
      )}
      {error && (
        <Text size='sm' c='red' role='alert'>
          {error}
        </Text>
      )}
      {grade === null && (
        <Text size='sm'>
          {result?.region ? 'No English text detected in that area.' : 'No English text detected.'} If you can
          see lettering, try a larger, bolder font or a larger sign.
        </Text>
      )}
      {grade && (
        <Text size='sm' aria-live='polite'>
          <strong>{result?.region ? 'Selected text readability' : 'Whole sign readability'}</strong>{' '}
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
