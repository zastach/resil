import { formatRootUrl } from '@/lib/url';
import { useFolders } from '@/lib/client/hooks/useFolders';
import type { Folder } from '@/lib/db/models/folder';
import { fetchApi } from '@/lib/fetchApi';
import { buildFolderHierarchy } from '@/lib/folderHierarchy';
import { useDebouncedValue } from '@mantine/hooks';
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
  Container,
  Grid,
  Group,
  Kbd,
  Image,
  Modal,
  SimpleGrid,
  Slider,
  Switch,
  Paper,
  Progress,
  Popover,
  UnstyledButton,
  Radio,
  Text,
  Title,
  Tooltip,
  TextInput,
  rem,
  useMantineTheme,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useColorScheme } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import { IconFiles, IconTrashFilled, IconUpload, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import {
  defaultSignAdjustments,
  fitImageToUploadLimit,
  getSignPreset,
  isNeonSign,
  makeSignCopy,
  signOptions,
} from '@/lib/client/upload/rust-sign';
import DropzoneFile from './DropzoneFile';
import SignReadability from './SignReadability';
type SignCopy = Awaited<ReturnType<typeof makeSignCopy>>;

const initialVisible = 24;

function PreviewBitmap({
  file,
  height,
  actualSize,
}: {
  file: File;
  height: number | string;
  actualSize?: boolean;
}) {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const preview = URL.createObjectURL(file);
    image.src = preview;
    return () => URL.revokeObjectURL(preview);
  }, [file]);

  return (
    <Image
      ref={imageRef}
      alt={file.name}
      fit='contain'
      h={actualSize ? 'auto' : height}
      w={actualSize ? 'auto' : '100%'}
      style={actualSize ? { maxWidth: 'none' } : undefined}
    />
  );
}

function PreviewImage({
  file,
  label,
  actualSize,
  magnify,
}: {
  file: File;
  label: string;
  actualSize?: boolean;
  magnify?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const bitmap = <PreviewBitmap file={file} height={260} actualSize={actualSize} />;

  return (
    <Stack gap='xs'>
      <Group justify='space-between' gap='xs'>
        <Text size='sm' fw={600}>
          {label}
        </Text>
        {magnify && (
          <Text size='xs' c='dimmed'>
            Hover or tap to enlarge
          </Text>
        )}
      </Group>
      <div>
        {magnify ? (
          <Popover
            opened={opened}
            onChange={setOpened}
            position='top'
            width='min(640px, calc(100vw - 2rem))'
            withArrow
            shadow='lg'
            withinPortal={false}
          >
            <Popover.Target>
              <UnstyledButton
                w={actualSize ? undefined : '100%'}
                style={{
                  cursor: 'zoom-in',
                  maxWidth: '100%',
                  ...(actualSize && { overflow: 'auto', maxHeight: 320 }),
                }}
                aria-label='Enlarge sign copy'
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setOpened(true);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse') setOpened(false);
                }}
                onClick={() => setOpened(true)}
              >
                {bitmap}
              </UnstyledButton>
            </Popover.Target>
            <Popover.Dropdown p='xs'>
              <PreviewBitmap file={file} height='min(55vh, 440px)' />
            </Popover.Dropdown>
          </Popover>
        ) : (
          bitmap
        )}
      </div>
      <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
        {file.name} · {bytes(file.size)}
      </Text>
    </Stack>
  );
}

export default function UploadFile({ title, folder }: { title?: string; folder?: string }) {
  const { t } = useTranslation('upload');
  const theme = useMantineTheme();
  const colorScheme = useColorScheme();
  const config = useConfig();
  const { files, setFiles, progress, loading, upload } = useFileUpload();
  const { data: folders, error: foldersError, mutate: refreshFolders } = useFolders(undefined, !folder);
  const location = useLocation();
  const edit = (
    location.state as {
      signSource?: { name: string; originalName?: string | null; folderId?: string | null };
    } | null
  )?.signSource;
  const [editSource, setEditSource] = useState<File>();
  const [destination, setDestination] = useState(edit?.folderId ?? 'root');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const folderOptions = buildFolderHierarchy(folders ?? []).map(({ id, path }) => ({
    value: id,
    label: path,
  }));
  const destinationId = folder ?? (destination === 'root' ? undefined : destination);
  const destinationLabel =
    folderOptions.find((option) => option.value === destination)?.label ?? 'My Images (no folder)';
  const [purpose, setPurpose] = useState('sign');
  const [sign, setSign] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{
    preset: NonNullable<ReturnType<typeof getSignPreset>>;
    limit: number;
    pairs: { original: File; saved: File | null; copy: SignCopy }[];
  } | null>(null);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [adjustments, setAdjustments] = useState(defaultSignAdjustments);
  const [debouncedAdjustments] = useDebouncedValue(adjustments, 150);
  const [adjusted, setAdjusted] = useState<{
    preview: NonNullable<typeof preview>;
    adjustments: typeof defaultSignAdjustments;
    copies?: SignCopy[];
    error?: string;
  } | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const currentAdjustment =
    adjusted?.preview === preview && adjusted?.adjustments === adjustments ? adjusted : null;
  const adjusting = adjustments !== defaultSignAdjustments && !currentAdjustment;
  const preset = getSignPreset(sign);
  const busy = loading || preparing;
  const [visibleCount, setVisibleCount] = useState(initialVisible);

  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');

  const visibleFiles = files.slice(0, visibleCount);
  const hiddenFiles = Math.max(0, files.length - visibleFiles.length);

  const aggSize = files.reduce((acc, file) => acc + file.size, 0);

  useEffect(() => {
    if (!edit) return;
    const controller = new AbortController();
    async function loadSource() {
      if (!edit) return;
      try {
        const response = await fetch(formatRootUrl('/raw', edit.name), { signal: controller.signal });
        if (!response.ok) throw new Error('Could not open the saved image.');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (!blob.type.startsWith('image/')) throw new Error('The saved file is no longer an image.');
        const file = new File([blob], edit.originalName || edit.name, { type: blob.type });
        setEditSource(file);
        setFiles((previous) => [file, ...previous]);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Could not open the saved image.');
      }
    }
    void loadSource();
    return () => controller.abort();
  }, [edit, setFiles]);

  useEffect(() => {
    if (busy || preview) return;
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
  }, [busy, preview, setFiles, t]);

  useEffect(() => {
    if (!preview || debouncedAdjustments === defaultSignAdjustments) return;
    let active = true;
    async function render() {
      if (!preview) return;
      try {
        const copies: SignCopy[] = [];
        for (const { original } of preview.pairs) {
          if (!active) return;
          copies.push(await makeSignCopy(original, preview.preset, preview.limit, debouncedAdjustments));
        }
        if (active) setAdjusted({ preview, adjustments: debouncedAdjustments, copies });
      } catch (error) {
        if (active)
          setAdjusted({
            preview,
            adjustments: debouncedAdjustments,
            error: error instanceof Error ? error.message : 'Could not update the preview.',
          });
      }
    }
    void render();
    return () => {
      active = false;
    };
  }, [preview, debouncedAdjustments]);

  if (!config) return null;

  async function createFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name || savingFolder) return;
    setSavingFolder(true);
    setFolderError('');
    try {
      const { data, error } = await fetchApi<Folder>('/api/user/folders', 'POST', { name, isPublic: false });
      if (error || !data) throw new Error(error?.error ?? 'Could not create the folder.');
      await refreshFolders(
        (current) => [...(current ?? []).filter((folder) => folder.id !== data.id), data],
        { revalidate: false },
      );
      setDestination(data.id);
      setCreatingFolder(false);
      setFolderName('');
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : 'Could not create the folder.');
    } finally {
      setSavingFolder(false);
    }
  }

  async function uploadSelection() {
    if (busy || !files.length || (purpose === 'sign' && !preset)) return;
    setPreparing(true);
    setError('');
    try {
      const limit = bytes(config.files.maxFileSize);
      if (purpose === 'sign' && preset) {
        const pairs: NonNullable<typeof preview>['pairs'] = [];
        for (const original of files) {
          const copy = await makeSignCopy(original, preset, limit);
          const saved = original === editSource ? null : await fitImageToUploadLimit(original, limit);
          pairs.push({ original, saved, copy });
        }
        setShowAdjustments(false);
        setAdjustments(defaultSignAdjustments);
        setAdjusted(null);
        setActualSize(false);
        setPreview({ preset, limit, pairs });
      } else {
        const replacements = new Map<File, File>();
        const batch: File[] = [];
        for (const file of files) {
          const saved = await fitImageToUploadLimit(file, limit);
          if (saved !== file) replacements.set(file, saved);
          batch.push(saved);
        }
        if (replacements.size) {
          showNotification({ message: 'Large images were compressed to fit the upload limit.' });
        }
        await upload(batch, replacements, destinationId);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not prepare the upload.');
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <Modal
        opened={preview !== null}
        onClose={() => setPreview(null)}
        title='Preview sign copies'
        size='min(1040px, calc(100vw - 2rem))'
        centered
      >
        {preview && (
          <Stack>
            {preview.pairs.some(({ saved }) => !saved) && (
              <Text size='sm'>The saved source stays in My Images. This creates a new sign copy.</Text>
            )}
            <Text size='sm'>
              {preview.preset[0]} · {preview.preset[1]} × {preview.preset[2]} pixels. Changes apply to all
              sign copies.
            </Text>
            {!folder && (
              <Text size='sm'>
                Save to <strong>{destinationLabel}</strong>
              </Text>
            )}
            <Text size='sm' c='dimmed'>
              The default preview estimates how /sil stretches the whole image to fill this sign. The server's
              actual rendering can vary.
            </Text>
            <Group gap='sm'>
              <Button
                size='compact-sm'
                variant='light'
                onClick={() => setShowAdjustments((show) => !show)}
                aria-expanded={showAdjustments}
              >
                {showAdjustments ? 'Hide adjustments' : 'Adjust sign image'}
              </Button>
            </Group>
            <Collapse expanded={showAdjustments}>
              <Stack gap='md'>
                <Switch
                  label='Preserve proportions'
                  description='Fit the entire image with margins when needed.'
                  checked={adjustments.preserveProportions}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setAdjustments((previous) => ({ ...previous, preserveProportions: checked }));
                  }}
                />
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='lg'>
                  {(
                    [
                      ['zoom', 'Zoom', 50, 200],
                      ['x', 'Move left or right', -50, 50],
                      ['y', 'Move up or down', -50, 50],
                      ['sharpness', 'Sharpness', 0, 100],
                      ['contrast', 'Contrast', -30, 50],
                      ...(isNeonSign(preview.preset[0])
                        ? [['brightness', 'Brightness', 10, 100] as const]
                        : []),
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <div key={key}>
                      <Group justify='space-between' gap='xs' mb={4}>
                        <Text size='sm' fw={600}>
                          {label} · {adjustments[key]}%
                        </Text>
                        <Button
                          variant='subtle'
                          size='compact-xs'
                          aria-label={`Reset ${label.toLowerCase()} to default`}
                          disabled={adjustments[key] === defaultSignAdjustments[key]}
                          onClick={() =>
                            setAdjustments((previous) => ({
                              ...previous,
                              [key]: defaultSignAdjustments[key],
                            }))
                          }
                        >
                          Reset to default
                        </Button>
                      </Group>
                      <Slider
                        aria-label={label}
                        min={min}
                        max={max}
                        value={adjustments[key]}
                        marks={key === 'brightness' ? [{ value: 50, label: 'Recommended · 50%' }] : undefined}
                        mb={key === 'brightness' ? 'md' : undefined}
                        label={(value) => `${value}%`}
                        onChange={(value) => setAdjustments((previous) => ({ ...previous, [key]: value }))}
                      />
                    </div>
                  ))}
                </SimpleGrid>
              </Stack>
            </Collapse>
            <Group justify='space-between'>
              <Switch
                label='Show sign copy at actual pixel size'
                checked={actualSize}
                onChange={(event) => setActualSize(event.currentTarget.checked)}
              />
              <Button variant='subtle' size='xs' onClick={() => setAdjustments(defaultSignAdjustments)}>
                Reset all to default
              </Button>
            </Group>
            <Text size='sm' c='dimmed'>
              If text is hard to read at actual size, use larger lettering, move the image closer with Zoom,
              or choose a larger sign.
            </Text>
            {isNeonSign(preview.preset[0]) && (
              <Text size='sm' c='dimmed'>
                Lower brightness if your neon sign looks too bright in-game.
              </Text>
            )}
            {currentAdjustment?.error && (
              <Alert color='red' role='alert'>
                {currentAdjustment.error}
              </Alert>
            )}
            {!adjusting &&
              preview.pairs.some(
                ({ copy }, index) => (currentAdjustment?.copies?.[index] ?? copy).clipped,
              ) && (
                <Alert color='yellow' title='Part of the image is outside the sign'>
                  <Button
                    size='compact-sm'
                    variant='light'
                    onClick={() =>
                      setAdjustments((previous) => ({
                        ...previous,
                        preserveProportions: true,
                        zoom: 100,
                        x: 0,
                        y: 0,
                      }))
                    }
                  >
                    Fit whole image
                  </Button>
                </Alert>
              )}
            {preview.pairs.map(({ original, saved, copy }, index) => (
              <Paper key={index} withBorder p='sm'>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <PreviewImage file={original} label='Original' />
                  <Stack gap='xs'>
                    <PreviewImage
                      file={(currentAdjustment?.copies?.[index] ?? copy).file}
                      label='Sign copy'
                      magnify
                      actualSize={actualSize}
                    />
                    {!adjusting && !currentAdjustment?.error && (
                      <SignReadability
                        original={original}
                        copy={(currentAdjustment?.copies?.[index] ?? copy).file}
                      />
                    )}
                  </Stack>
                </SimpleGrid>
                {saved && saved !== original && (
                  <Text size='sm' mt='xs' c='dimmed'>
                    The source image is over the upload limit. Resil will save a compressed source copy and
                    the sign copy.
                  </Text>
                )}
              </Paper>
            ))}
            <Group justify='flex-end'>
              <Button variant='default' onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button
                loading={adjusting}
                disabled={adjusting || !!currentAdjustment?.error}
                onClick={() => {
                  const replacements = new Map<File, File>();
                  const batch = preview.pairs.flatMap(({ original, saved, copy }, index) => {
                    const signFile = (currentAdjustment?.copies?.[index] ?? copy).file;
                    replacements.set(original, saved ?? signFile);
                    return saved ? [saved, signFile] : [signFile];
                  });
                  setPreview(null);
                  void upload(batch, replacements, destinationId);
                }}
              >
                {preview.pairs.every(({ saved }) => !saved)
                  ? 'Save new sign copy'
                  : 'Upload images and sign copies'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Container size={820} px={{ base: 0, sm: 'sm' }} py='sm'>
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

        <Paper
          withBorder
          p='md'
          my='md'
          style={{ borderInlineStart: '3px solid var(--mantine-primary-color-filled)' }}
        >
          <Stack gap='sm'>
            <Radio.Group
              label='What will you use this image for?'
              value={purpose}
              onChange={setPurpose}
              required
              styles={{ label: { fontSize: 'var(--mantine-font-size-lg)', fontWeight: 700 } }}
            >
              <Group mt='sm' gap='lg'>
                <Radio value='sign' label='Rust sign, frame, or canvas (/sil)' disabled={busy} />
                <Radio value='general' label='General image or link' disabled={busy} />
              </Group>
            </Radio.Group>
            {purpose === 'sign' && (
              <>
                <Select
                  label='Choose the in-game item'
                  placeholder='Search signs, frames, and canvases'
                  data={signOptions}
                  value={sign}
                  onChange={setSign}
                  disabled={busy}
                  required
                  searchable
                />
                <Text size='sm' c='dimmed'>
                  Preview how it fits before uploading.{' '}
                  <Anchor component={Link} to='/auth/image-guide' target='_blank' rel='noopener noreferrer'>
                    View sign dimensions
                  </Anchor>
                </Text>
              </>
            )}
            {!folder && (
              <>
                <Group align='flex-end' gap='sm'>
                  <Select
                    label='Save to folder'
                    data={[{ value: 'root', label: 'My Images (no folder)' }, ...folderOptions]}
                    value={destination}
                    onChange={(value) => setDestination(value ?? 'root')}
                    allowDeselect={false}
                    searchable
                    disabled={busy || creatingFolder}
                    style={{ flex: '1 1 14rem' }}
                  />
                  {!creatingFolder && (
                    <Button variant='light' disabled={busy} onClick={() => setCreatingFolder(true)}>
                      New folder
                    </Button>
                  )}
                </Group>
                {foldersError && (
                  <Text size='sm' c='red'>
                    Could not load your folders.
                  </Text>
                )}
                {creatingFolder && (
                  <form onSubmit={createFolder}>
                    <Group align='flex-end' gap='sm'>
                      <TextInput
                        label='New folder name'
                        value={folderName}
                        onChange={(event) => setFolderName(event.currentTarget.value)}
                        error={folderError || undefined}
                        disabled={savingFolder}
                        required
                        style={{ flex: '1 1 14rem' }}
                      />
                      <Button type='submit' loading={savingFolder} disabled={!folderName.trim()}>
                        Create and select
                      </Button>
                      <Button
                        variant='subtle'
                        disabled={savingFolder}
                        onClick={() => {
                          setCreatingFolder(false);
                          setFolderName('');
                          setFolderError('');
                        }}
                      >
                        Cancel
                      </Button>
                    </Group>
                  </form>
                )}
              </>
            )}
            {error && (
              <Alert color='red' role='alert'>
                {error}
              </Alert>
            )}
          </Stack>
        </Paper>

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
          <Group justify='center' gap='md' style={{ minHeight: rem(108), pointerEvents: 'none' }}>
            <Dropzone.Accept>
              <IconUpload
                size='2.2rem'
                stroke={1.5}
                color={theme.colors[theme.primaryColor][colorScheme === 'dark' ? 4 : 6]}
              />
            </Dropzone.Accept>
            <Dropzone.Reject>
              <IconX size='2.2rem' stroke={1.5} color={theme.colors.red[colorScheme === 'dark' ? 4 : 6]} />
            </Dropzone.Reject>
            <Dropzone.Idle>
              <IconFiles size='2.2rem' stroke={1.5} />
            </Dropzone.Idle>

            <div>
              <Text size='md' fw={600} inline>
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
              <Text size='xs' c='dimmed' mt={7}>
                Large images are resized to fit the{' '}
                {formatResilFileLimit(
                  bytes(config.files.maxFileSize),
                  bytes(bytes(config.files.maxFileSize)),
                )}{' '}
                upload limit.
              </Text>
            </div>
          </Group>
        </Dropzone>
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
            variant='filled'
            leftSection={<IconUpload size='1rem' />}
            disabled={files.length === 0 || creatingFolder || (purpose === 'sign' && !preset)}
            loading={busy}
            onClick={() => void uploadSelection()}
          >
            {purpose === 'sign'
              ? 'Preview sign copies'
              : t('actions.upload', { count: files.length, size: bytes(aggSize) })}
          </Button>
        </Group>
      </Container>
    </>
  );
}
