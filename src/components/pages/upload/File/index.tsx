import { formatResilFileLimit } from '@/lib/resil-upload-limits';
import { useConfig } from '@/components/ConfigProvider';
import SafeTrans from '@/components/SafeTrans';
import { useFileUpload } from '@/components/upload/FileUploadProvider';
import { bytes } from '@/lib/bytes';
import { getPastedContent } from '@/lib/client/upload/paste';
import { humanizeDuration } from '@/lib/relativeTime';
import {
  Alert,
  Anchor,
  Select,
  Stack,
  Button,
  Collapse,
  Grid,
  Group,
  Kbd,
  Paper,
  Progress,
  Text,
  Title,
  Tooltip,
  rem,
  useMantineTheme,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useColorScheme } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import { IconFiles, IconTrashFilled, IconUpload, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { getSignPreset, makeSignCopy, signOptions } from '@/lib/client/upload/rust-sign';
import DropzoneFile from './DropzoneFile';

const initialVisible = 24;

export default function UploadFile({ title, folder }: { title?: string; folder?: string }) {
  const { t } = useTranslation('upload');
  const theme = useMantineTheme();
  const colorScheme = useColorScheme();
  const config = useConfig();
  const { files, setFiles, progress, loading, upload } = useFileUpload();
  const [searchParams] = useSearchParams();
  const [purpose, setPurpose] = useState<string | null>(
    searchParams.get('purpose') === 'sign' ? 'sign' : null,
  );
  const [sign, setSign] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const preset = getSignPreset(sign);
  const busy = loading || preparing;
  const [visibleCount, setVisibleCount] = useState(initialVisible);

  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');

  const visibleFiles = files.slice(0, visibleCount);
  const hiddenFiles = Math.max(0, files.length - visibleFiles.length);

  const aggSize = files.reduce((acc, file) => acc + file.size, 0);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = getPastedContent(event)?.files.filter((file) => file.type.startsWith('image/')) ?? [];
      if (files.length === 0) return;

      event.preventDefault();
      setFiles((prev) => [...prev, ...files]);
      setVisibleCount(initialVisible);
      for (const file of files) {
        showNotification({
          message: t('file.notifications.pasted.message', { name: file.name }),
          color: 'blue',
        });
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [setFiles, t]);

  if (!config) return null;

  async function uploadSelection() {
    if (!purpose || busy || !files.length || (purpose === 'sign' && !preset)) return;
    setPreparing(true);
    setError('');
    try {
      const limit = bytes(config.files.maxFileSize);
      const oversized = files.find((file) => file.size > limit);
      if (oversized)
        throw new Error(
          `"${oversized.name}" exceeds the ${formatResilFileLimit(limit, bytes(limit))} file limit.`,
        );
      const batch: File[] = [];
      for (const file of files) {
        batch.push(file);
        if (purpose === 'sign' && preset) batch.push(await makeSignCopy(file, preset, limit));
      }
      await upload(batch);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not prepare the upload.');
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <Group gap='sm'>
        <Title order={1}>{title ?? t('file.title')}</Title>

        {!folder && (
          <Button
            variant='outline'
            size='compact-sm'
            component={Link}
            to='/dashboard/files'
            leftSection={<IconFiles size='1rem' />}
          >
            {t('actions.goToFiles')}
          </Button>
        )}
      </Group>

      <Dropzone
        onDrop={(f) => {
          setFiles((prev) => [...f, ...prev]);
          setVisibleCount(initialVisible);
        }}
        my='sm'
        loading={busy}
        disabled={busy}
        style={{ zIndex: 1 }}
      >
        <Group justify='center' gap='xl' style={{ minHeight: rem(220), pointerEvents: 'none' }}>
          <Dropzone.Accept>
            <IconUpload
              size='3.2rem'
              stroke={1.5}
              color={theme.colors[theme.primaryColor][colorScheme === 'dark' ? 4 : 6]}
            />
          </Dropzone.Accept>
          <Dropzone.Reject>
            <IconX size='3.2rem' stroke={1.5} color={theme.colors.red[colorScheme === 'dark' ? 4 : 6]} />
          </Dropzone.Reject>
          <Dropzone.Idle>
            <IconFiles size='3.2rem' stroke={1.5} />
          </Dropzone.Idle>

          <div>
            <Text size='xl' inline>
              {t('file.dropzone.title')}
            </Text>
            <Text size='sm' inline mt='xs'>
              <SafeTrans
                t={t}
                i18nKey='file.dropzone.paste'
                values={{ mod: isMac ? '⌘' : 'Ctrl' }}
                components={{ kbd: <Kbd size='xs' /> }}
              />
            </Text>
            <Text size='sm' c='dimmed' inline mt={7}>
              {t('file.dropzone.description')}
            </Text>
            <Text size='sm' c='dimmed' mt={7}>
              <SafeTrans
                t={t}
                i18nKey='file.dropzone.limit'
                values={{
                  size: formatResilFileLimit(
                    bytes(config.files.maxFileSize),
                    bytes(bytes(config.files.maxFileSize)),
                  ),
                }}
                components={{ b: <b /> }}
              />
            </Text>
          </div>
        </Group>
      </Dropzone>
      <Stack gap='sm' mt='md'>
        <Select
          label='What will you use this image for?'
          placeholder='Choose a use'
          value={purpose}
          onChange={setPurpose}
          disabled={busy}
          data={[
            { value: 'general', label: 'General image or link' },
            { value: 'sign', label: 'Rust sign or frame (/sil)' },
          ]}
        />
        {purpose === 'sign' && (
          <>
            <Select
              label='Rust sign or frame'
              placeholder='Choose the sign or frame'
              data={signOptions}
              value={sign}
              onChange={setSign}
              disabled={busy}
              searchable
            />
            <Text size='sm' c='dimmed'>
              Resil saves the original and a separate JPEG cropped to fit the selected sign.{' '}
              <Anchor component={Link} to='/auth/image-guide' target='_blank' rel='noopener noreferrer'>
                View sign dimensions
              </Anchor>
            </Text>
          </>
        )}
        {error && (
          <Alert color='red' role='alert'>
            {error}
          </Alert>
        )}
      </Stack>

      <Collapse expanded={progress.percent > 0 && progress.percent < 100}>
        {progress.percent > 0 && progress.percent < 100 && (
          <Progress.Root my='sm' size='xl'>
            <Progress.Section value={progress.percent} animated>
              <Progress.Label>{Math.floor(progress.percent)}%</Progress.Label>
            </Progress.Section>
          </Progress.Root>
        )}
      </Collapse>

      <Collapse expanded={progress.speed > 0 && progress.remaining > 0}>
        <Paper withBorder p='xs'>
          <Text ta='center' size='sm'>
            {t('file.progress.speed', {
              speed: bytes(progress.speed),
              remaining: humanizeDuration(progress.remaining),
            })}
          </Text>
        </Paper>
      </Collapse>

      <Collapse expanded={progress.percent === 100}>
        <Paper withBorder p='xs'>
          <Text ta='center' size='sm' c='yellow' fw={500}>
            {t('file.progress.finalizing')}
          </Text>
        </Paper>
      </Collapse>

      <Grid grow my='sm'>
        {visibleFiles.map((file, i) => (
          <Grid.Col span={3} key={i}>
            <DropzoneFile
              loading={busy}
              file={file}
              onDelete={() => setFiles((prev) => prev.filter((_, j) => i !== j))}
            />
          </Grid.Col>
        ))}
      </Grid>

      {hiddenFiles > 0 && (
        <Group justify='center' gap='xs' my='xs'>
          <Text size='sm' c='dimmed'>
            {t('file.hidden', { count: hiddenFiles })}{' '}
          </Text>
          <Button
            size='compact-sm'
            variant='light'
            disabled={loading}
            onClick={() => setVisibleCount((prev) => Math.min(files.length, prev + initialVisible))}
          >
            {t('file.showMore')}
          </Button>
          <Tooltip label={t('file.showAllTooltip')} hidden={loading}>
            <Button
              size='compact-sm'
              variant='subtle'
              disabled={loading}
              onClick={() => setVisibleCount(files.length)}
            >
              {t('file.showAll')}
            </Button>
          </Tooltip>
        </Group>
      )}

      <Group justify='right' gap='sm' my='md'>
        <Button
          variant='outline'
          color='red'
          leftSection={<IconTrashFilled size='1rem' />}
          disabled={files.length === 0 || busy}
          onClick={() => {
            setFiles([]);
            setVisibleCount(initialVisible);
          }}
        >
          {t('actions.clearAll')}
        </Button>
        <Button
          variant='outline'
          leftSection={<IconUpload size='1rem' />}
          disabled={files.length === 0 || !purpose || (purpose === 'sign' && !preset)}
          loading={busy}
          onClick={() => void uploadSelection()}
        >
          {t('actions.upload', { count: files.length, size: bytes(aggSize) })}
        </Button>
      </Group>
    </>
  );
}
