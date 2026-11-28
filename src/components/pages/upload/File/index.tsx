import { suggestImageName, type ImageOrganization } from '@/lib/image-organization';
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
import { useEffect, useEffectEvent, useRef, useState } from 'react';
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
type UploadVersion = 'both' | 'original' | 'sign';
type SignCopy = Awaited<ReturnType<typeof makeSignCopy>>;

const initialVisible = 24;
const directUpload = 'direct-upload';
const uploadOptions = [{ value: directUpload, label: "I'll do it myself, just upload it" }, ...signOptions];

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
      signSource?: {
        id: string;
        name: string;
        originalName?: string | null;
        folderId?: string | null;
        organization?: ImageOrganization | null;
      };
    } | null
  )?.signSource;
  const [editSource, setEditSource] = useState<File>();
  const [displayNames, setDisplayNames] = useState<ReadonlyMap<File, string>>(new Map());
  const groupIds = useRef(new WeakMap<File, string>());
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
    pairs: { original: File; copy: SignCopy }[];
  } | null>(null);
  const [uploadVersion, setUploadVersion] = useState<UploadVersion>('both');
  const [previewUploadError, setPreviewUploadError] = useState('');
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
  const uploadImmediately = purpose === 'sign' && sign === directUpload;
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

  function organizationFor(file: File, variant: string | null): ImageOrganization {
    if (edit && file === editSource) {
      const sourceName = edit.organization?.sourceName ?? file.name;
      return {
        groupId: edit.organization?.groupId ?? edit.id,
        displayName: edit.organization?.displayName ?? suggestImageName(sourceName),
        sourceName,
        variant,
      };
    }
    let groupId = groupIds.current.get(file);
    if (!groupId) {
      groupId = crypto.randomUUID();
      groupIds.current.set(file, groupId);
    }
    return {
      groupId,
      displayName: displayNames.get(file)?.trim() || suggestImageName(file.name),
      sourceName: file.name.slice(0, 512),
      variant,
    };
  }

  async function uploadSelection(batchFiles = files, selectedSign = sign) {
    const selectedPreset = getSignPreset(selectedSign);
    if (
      !config ||
      busy ||
      creatingFolder ||
      !batchFiles.length ||
      (purpose === 'sign' && selectedSign !== directUpload && !selectedPreset)
    )
      return;
    setPreparing(true);
    setError('');
    try {
      const limit = bytes(config.files.maxFileSize);
      if (purpose === 'sign' && selectedPreset) {
        const pairs: NonNullable<typeof preview>['pairs'] = [];
        for (const original of batchFiles) {
          const copy = await makeSignCopy(original, selectedPreset, limit);
          pairs.push({ original, copy });
        }
        setUploadVersion(pairs.every(({ original }) => original === editSource) ? 'sign' : 'both');
        setPreviewUploadError('');
        setShowAdjustments(false);
        setAdjustments(defaultSignAdjustments);
        setAdjusted(null);
        setActualSize(false);
        setPreview({ preset: selectedPreset, limit, pairs });
      } else {
        const replacements = new Map<File, File>();
        const organization = new Map<File, ImageOrganization>();
        const batch: File[] = [];
        for (const file of batchFiles) {
          const saved = await fitImageToUploadLimit(file, limit);
          if (saved !== file) replacements.set(file, saved);
          if (saved.type.startsWith('image/')) organization.set(saved, organizationFor(file, null));
          batch.push(saved);
        }
        if (replacements.size) {
          showNotification({ message: 'Large images were compressed to fit the upload limit.' });
        }
        await upload(
          batch,
          replacements,
          destinationId,
          undefined,
          organization.size ? organization : undefined,
        );
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not prepare the upload.');
    } finally {
      setPreparing(false);
    }
  }

  const uploadPastedFiles = useEffectEvent((pasted: File[]) => {
    if (uploadImmediately) void uploadSelection([...files, ...pasted], directUpload);
  });

  useEffect(() => {
    if (busy || preview || creatingFolder) return;
    const handlePaste = (event: ClipboardEvent) => {
      const files = getPastedContent(event)?.files.filter((file) => file.type.startsWith('image/')) ?? [];
      if (files.length === 0) return;

      event.preventDefault();
      setFiles((prev) => [...prev, ...files]);
      setVisibleCount(initialVisible);
      uploadPastedFiles(files);
      for (const file of files) {
        showNotification({
          message: t('file.notifications.pasted.message', { name: file.name }),
          color: 'blue',
        });
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [busy, creatingFolder, preview, setFiles, t]);

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

  const allSourcesSaved = preview?.pairs.every(({ original }) => original === editSource);
  const needsSignCopy = uploadVersion !== 'original';

  async function uploadPreview(version: UploadVersion) {
    if (!preview || busy || (version !== 'original' && (adjusting || currentAdjustment?.error))) return;
    setPreparing(true);
    setPreviewUploadError('');
    try {
      const replacements = new Map<File, File>();
      const labels = new Map<File, string>();
      const organization = new Map<File, ImageOrganization>();
      const batch: File[] = [];

      for (const [index, { original, copy }] of preview.pairs.entries()) {
        const source =
          version !== 'sign' && original !== editSource
            ? await fitImageToUploadLimit(original, preview.limit)
            : undefined;
        const signFile =
          version !== 'original' ? (currentAdjustment?.copies?.[index] ?? copy).file : undefined;
        const submitted = source ?? signFile;
        if (submitted) replacements.set(original, submitted);
        if (source) {
          batch.push(source);
          labels.set(source, source === original ? 'Original' : 'Compressed original');
          organization.set(source, organizationFor(original, null));
        }
        if (signFile) {
          batch.push(signFile);
          labels.set(signFile, '/sil-ready copy');
          organization.set(signFile, organizationFor(original, preview.preset[0]));
        }
      }

      setPreview(null);
      await upload(batch, replacements, destinationId, labels, organization);
    } catch (error) {
      setPreviewUploadError(error instanceof Error ? error.message : 'Could not prepare the upload.');
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <Modal
        opened={preview !== null}
        onClose={() => {
          if (!busy) setPreview(null);
        }}
        title='Preview sign copies'
        size='min(1040px, calc(100vw - 2rem))'
        centered
      >
        {preview && (
          <Stack>
            {preview.pairs.some(({ original }) => original === editSource) && (
              <Text size='sm'>Your original is already saved. You can add a new /sil-ready copy.</Text>
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
              The /sil-ready preview shows how your image is expected to look on the selected sign in Rust.
              Your server’s rendering may vary.
            </Text>
            {isNeonSign(preview.preset[0]) && (
              <Alert color='yellow' title='Neon sign brightness'>
                <Stack gap='xs'>
                  <Text size='sm'>
                    Neon signs can glow much brighter in Rust and wash out fine details. We recommend
                    50% brightness for better readability.
                  </Text>
                  <Group gap='xs'>
                    <Button
                      size='sm'
                      color='yellow'
                      disabled={busy || adjustments.brightness === 50}
                      onClick={() => setAdjustments((previous) => ({ ...previous, brightness: 50 }))}
                    >
                      {adjustments.brightness === 50 ? '50% brightness applied' : 'Apply 50% brightness'}
                    </Button>
                    <Text size='sm' fw={600}>
                      Current: {adjustments.brightness}%
                    </Text>
                    {adjustments.brightness !== 100 && (
                      <Button
                        size='compact-xs'
                        variant='subtle'
                        disabled={busy}
                        onClick={() => setAdjustments((previous) => ({ ...previous, brightness: 100 }))}
                      >
                        Restore 100%
                      </Button>
                    )}
                  </Group>
                </Stack>
              </Alert>
            )}
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
            {preview.pairs.map(({ original, copy }, index) => (
              <Paper key={index} withBorder p='sm'>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <PreviewImage file={original} label='Original' />
                  <Stack gap='xs'>
                    <PreviewImage
                      file={(currentAdjustment?.copies?.[index] ?? copy).file}
                      label='/sil-ready preview'
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
                {original !== editSource && original.size > preview.limit && (
                  <Text size='sm' mt='xs' c='dimmed'>
                    If you upload the original, Resil will compress it to fit the upload limit.
                  </Text>
                )}
              </Paper>
            ))}
            {!allSourcesSaved && (
              <Radio.Group
                label='What would you like to upload?'
                value={uploadVersion}
                onChange={(value) => setUploadVersion(value as UploadVersion)}
              >
                <Group gap='sm' mt='xs'>
                  <Radio value='both' label='Original and /sil-ready copy' disabled={busy} />
                  <Radio value='original' label='Original only' disabled={busy} />
                  <Radio value='sign' label='/sil-ready copy only' disabled={busy} />
                </Group>
              </Radio.Group>
            )}
            {previewUploadError && <Alert color='red'>{previewUploadError}</Alert>}
            <Group justify='flex-end'>
              <Button variant='default' disabled={busy} onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button
                loading={busy || (needsSignCopy && adjusting)}
                disabled={busy || (needsSignCopy && (!!currentAdjustment?.error || adjusting))}
                onClick={() => void uploadPreview(allSourcesSaved ? 'sign' : uploadVersion)}
              >
                {allSourcesSaved ? 'Save /sil-ready copy' : 'Upload selected versions'}
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
                  data={uploadOptions}
                  value={sign}
                  onChange={(value) => {
                    setSign(value);
                    if (value === directUpload) void uploadSelection(files, value);
                  }}
                  disabled={busy}
                  required
                  searchable
                />
                <Text size='sm' c='dimmed'>
                  {uploadImmediately
                    ? 'Images upload as soon as you add them. Choose the folder first.'
                    : 'Preview how it fits before uploading.'}{' '}
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
            if (uploadImmediately) void uploadSelection([...f, ...files], directUpload);
          }}
          my='sm'
          loading={busy}
          disabled={busy || creatingFolder}
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

        {destinationId &&
          !uploadImmediately &&
          files.some((file) => file !== editSource && file.type.startsWith('image/')) && (
            <Paper withBorder p='sm' my='sm'>
              <Stack gap='xs'>
                <Text fw={600}>
                  Name your images{' '}
                  <Text component='span' size='sm' c='dimmed'>
                    (optional)
                  </Text>
                </Text>
                {files
                  .filter((file) => file !== editSource && file.type.startsWith('image/'))
                  .map((file, index) => (
                    <TextInput
                      key={index}
                      label={file.name}
                      value={displayNames.get(file) ?? suggestImageName(file.name)}
                      maxLength={120}
                      disabled={busy}
                      onChange={(event) => {
                        const name = event.currentTarget.value;
                        setDisplayNames((current) => new Map(current).set(file, name));
                      }}
                    />
                  ))}
              </Stack>
            </Paper>
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
            disabled={
              files.length === 0 || creatingFolder || (purpose === 'sign' && !uploadImmediately && !preset)
            }
            loading={busy}
            onClick={() => void uploadSelection()}
          >
            {purpose === 'sign' && !uploadImmediately
              ? 'Preview sign copies'
              : t('actions.upload', { count: files.length, size: bytes(aggSize) })}
          </Button>
        </Group>
      </Container>
    </>
  );
}
