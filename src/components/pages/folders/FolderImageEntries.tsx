import { copyRustImage } from '@/lib/client/copyRustImage';
import type { Tag } from '@/lib/db/models/tag';
import { fetchApi } from '@/lib/fetchApi';
import { suggestImageName, type ImageOrganization } from '@/lib/image-organization';
import { RESIL_MAX_FILE_BYTES } from '@/lib/resil-upload-limits';
import { formatRootUrl } from '@/lib/url';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Menu,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { useState } from 'react';
import useSWR from 'swr';

type ImageFile = {
  id: string;
  name: string;
  originalName: string | null;
  organization: ImageOrganization | null;
  type: string;
  size: number;
  password: boolean;
  tags: { id: string }[];
};

type Entry = { id: string; displayName: string; sourceName: string; files: ImageFile[] };
type FolderImages = { order: string[] | null; files: ImageFile[] };

function groupImages(files: ImageFile[]) {
  const entries = new Map<string, Entry>();
  for (const file of files) {
    const id = file.organization?.groupId ?? file.id;
    const sourceName = file.organization?.sourceName ?? file.originalName ?? file.name;
    const displayName = file.organization?.displayName ?? suggestImageName(sourceName);
    const entry = entries.get(id) ?? { id, sourceName, displayName, files: [] };
    if (!file.organization?.variant) {
      entry.sourceName = sourceName;
      entry.displayName = displayName;
    }
    entry.files.push(file);
    entries.set(id, entry);
  }
  return [...entries.values()];
}

function supportsSil(file: ImageFile) {
  return (
    !file.password && file.size <= RESIL_MAX_FILE_BYTES && ['image/png', 'image/jpeg'].includes(file.type)
  );
}

function ImageEntry({
  entry,
  tags,
  onSave,
  manualOrder,
  first,
  last,
  move,
  saving,
}: {
  entry: Entry;
  tags: Tag[];
  onSave: (patch: { entryId: string; displayName: string; tagIds?: string[] }) => Promise<boolean>;
  manualOrder: boolean;
  first: boolean;
  last: boolean;
  move: (offset: number) => void;
  saving: boolean;
}) {
  const clipboard = useClipboard();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagsChanged, setTagsChanged] = useState(false);
  const currentTags = [...new Set(entry.files.flatMap((file) => file.tags.map(({ id }) => id)))];
  const signs = entry.files.filter((file) => file.organization?.variant && supportsSil(file));
  const variants = entry.files.filter((file) => file.organization?.variant).length;

  return (
    <Paper withBorder p='sm'>
      <Stack gap='xs'>
        <Group justify='space-between' align='flex-start'>
          <div style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
            <Text fw={700}>{entry.displayName}</Text>
            <Text size='xs' c='dimmed'>
              {entry.sourceName}
            </Text>
          </div>
          <Group gap='xs'>
            {signs.length === 1 && (
              <Button size='compact-sm' onClick={() => copyRustImage(signs[0].name, clipboard)}>
                Copy sign /sil
              </Button>
            )}
            {signs.length > 1 && (
              <Menu>
                <Menu.Target>
                  <Button size='compact-sm'>Copy sign /sil</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {signs.map((sign) => (
                    <Menu.Item key={sign.id} onClick={() => copyRustImage(sign.name, clipboard)}>
                      {sign.organization?.variant} · {sign.originalName ?? sign.name}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            )}
            <Button
              size='compact-sm'
              variant='light'
              onClick={() => {
                setName(entry.displayName);
                setTagIds(currentTags);
                setTagsChanged(false);
                setEditing(true);
              }}
            >
              Edit name or tags
            </Button>
          </Group>
        </Group>
        {currentTags.length > 0 && (
          <Group gap='xs'>
            {tags
              .filter(({ id }) => currentTags.includes(id))
              .map((tag) => (
                <Badge key={tag.id} variant='light' color={tag.color}>
                  {tag.name}
                </Badge>
              ))}
          </Group>
        )}
        {editing && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await onSave({ entryId: entry.id, displayName: name.trim(), ...(tagsChanged && { tagIds }) })
              )
                setEditing(false);
            }}
          >
            <Stack gap='sm'>
              <TextInput
                label='Display name'
                value={name}
                maxLength={120}
                required
                onChange={(event) => setName(event.currentTarget.value)}
              />
              {tags.length > 0 && (
                <MultiSelect
                  label='Tags (optional)'
                  value={tagIds}
                  data={tags.map(({ id, name }) => ({ value: id, label: name }))}
                  onChange={(value) => {
                    setTagIds(value);
                    setTagsChanged(true);
                  }}
                  searchable
                />
              )}
              <Group gap='xs'>
                <Button type='submit' size='compact-sm' disabled={!name.trim()} loading={saving}>
                  Save
                </Button>
                <Button
                  variant='subtle'
                  size='compact-sm'
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          </form>
        )}
        <details>
          <Text component='summary' size='sm' style={{ cursor: 'pointer' }}>
            {variants ? `Files and sign copies (${entry.files.length})` : 'View image'}
          </Text>
          <Stack mt='xs' gap='xs'>
            {[...entry.files]
              .sort((a, b) => Number(!!a.organization?.variant) - Number(!!b.organization?.variant))
              .map((file) => (
                <Group key={file.id} justify='space-between' gap='xs'>
                  <Stack gap={2} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Text size='xs' fw={600}>
                      {file.organization?.variant ?? 'Source image'}
                    </Text>
                    <Anchor
                      href={formatRootUrl('/view', file.name)}
                      target='_blank'
                      rel='noopener noreferrer'
                      size='sm'
                    >
                      {file.originalName ?? file.name}
                    </Anchor>
                  </Stack>
                  {supportsSil(file) && (
                    <Button
                      size='compact-sm'
                      variant='light'
                      onClick={() => copyRustImage(file.name, clipboard)}
                    >
                      Copy /sil
                    </Button>
                  )}
                </Group>
              ))}
          </Stack>
        </details>
        {manualOrder && (
          <Group gap='xs'>
            <Button
              variant='subtle'
              size='compact-xs'
              aria-label={`Move ${entry.displayName} up`}
              disabled={first || saving}
              onClick={() => move(-1)}
            >
              Move up
            </Button>
            <Button
              variant='subtle'
              size='compact-xs'
              aria-label={`Move ${entry.displayName} down`}
              disabled={last || saving}
              onClick={() => move(1)}
            >
              Move down
            </Button>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

export default function FolderImageEntries({ folderId }: { folderId: string }) {
  const url = `/api/user/folders/${folderId}/images`;
  const { data, error, mutate } = useSWR<FolderImages>(url);
  const { data: tags } = useSWR<Tag[]>('/api/user/tags');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  if (error) return <Alert color='red'>Could not load this folder’s images.</Alert>;
  if (!data) return <Loader size='sm' />;

  const manualOrder = data.order !== null;
  const positions = new Map((data.order ?? []).map((id, index) => [id, index]));
  const entries = groupImages(data.files).sort(
    (a, b) =>
      (manualOrder ? (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) : 0) ||
      a.displayName.localeCompare(b.displayName, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id),
  );
  const entryIds = entries.map(({ id }) => id);

  async function save(
    patch: { order: string[] | null } | { entryId: string; displayName: string; tagIds?: string[] },
  ) {
    setSaving(true);
    setErrorMessage('');
    try {
      const { error } = await fetchApi(url, 'PATCH', patch);
      if (error) throw new Error(error.error);
      await mutate();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save folder changes.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap='sm'>
      <Select
        label='Image order'
        allowDeselect={false}
        value={manualOrder ? 'manual' : 'name'}
        data={[
          { value: 'name', label: 'Display name' },
          { value: 'manual', label: 'Manual order' },
        ]}
        disabled={saving}
        maw={220}
        onChange={(value) => void save({ order: value === 'manual' ? entryIds : null })}
      />
      {errorMessage && (
        <Alert color='red' role='alert'>
          {errorMessage}
        </Alert>
      )}
      {!entries.length && (
        <Text size='sm' c='dimmed'>
          No images in this folder yet.
        </Text>
      )}
      {entries.map((entry, index) => (
        <ImageEntry
          key={entry.id}
          entry={entry}
          tags={tags ?? []}
          onSave={save}
          manualOrder={manualOrder}
          first={index === 0}
          last={index === entries.length - 1}
          saving={saving}
          move={(offset) => {
            const order = [...entryIds];
            const target = index + offset;
            [order[index], order[target]] = [order[target], order[index]];
            void save({ order });
          }}
        />
      ))}
    </Stack>
  );
}
