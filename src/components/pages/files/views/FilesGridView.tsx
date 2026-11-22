import DashboardFile from '@/components/file/DashboardFile';
import { suggestImageName } from '@/lib/image-organization';
import { useFileNavStore } from '@/lib/client/store/fileNav';
import {
  Button,
  Center,
  Group,
  Modal,
  Pagination,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconFilesOff, IconFileUpload } from '@tabler/icons-react';
import { parseAsInteger, useQueryState } from 'nuqs';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { useApiPagination } from '../useApiPagination';

const DashboardFileModal = lazy(() => import('@/components/file/DashboardFile/DashboardFileModal'));

const PER_PAGE_OPTIONS = [9, 12, 15, 30, 45, 60];

export default function Files({ id, folderId }: { id?: string; folderId?: string }) {
  const { t } = useTranslation('files');
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [perpage, setPerpage] = useQueryState('perpage', parseAsInteger.withDefault(15));

  const { data, isLoading } = useApiPagination({
    page,
    perpage,
    id,
    folderId,
    grouped: !id && !folderId,
  });

  const from = data?.page.length ? (page - 1) * perpage + 1 : 0;
  const to = Math.min(page * perpage, data?.total ?? 0);
  const totalRecords = data?.total ?? 0;
  const cachedPages = data?.pages ?? 1;

  const [current, setCurrent, setFiles] = useFileNavStore(
    useShallow((state) => [state.current, state.setCurrent, state.setFiles]),
  );
  const currentFile = current ? (data?.page.find((file) => file.id === current) ?? null) : null;
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const parent = data?.page.find((file) => file.id === openGroup);
  const versions = parent ? [parent, ...(data?.variants?.[parent.id] ?? [])] : [];
  const ids = useMemo(() => (data?.page ?? []).map((file) => file.id), [data?.page]);

  useEffect(() => {
    setFiles(ids);
  }, [ids]);

  return (
    <>
      <DashboardFileModal
        open={!!currentFile}
        setOpen={(open) => {
          if (!open) setCurrent(null);
        }}
        file={currentFile}
        user={id}
        sequenced
      />

      <Modal
        opened={!!parent}
        onClose={() => setOpenGroup(null)}
        title={parent?.organization?.displayName ?? parent?.originalName ?? parent?.name}
        size='lg'
        centered
      >
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {versions.map((version) => (
            <Stack key={version.id} gap='xs' miw={0}>
              <Text size='sm' fw={600}>
                {version.organization?.variant ?? 'Original image'}
              </Text>
              <DashboardFile file={version} />
              <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
                {version.originalName ?? version.name}
              </Text>
            </Stack>
          ))}
        </SimpleGrid>
      </Modal>

      <SimpleGrid
        my='sm'
        cols={{
          base: 1,
          md: 2,
          lg: (data?.page.length ?? 0) > 0 || isLoading ? 3 : 1,
        }}
        spacing='md'
        pos='relative'
      >
        {isLoading ? (
          [...Array(9)].map((_, i) => <Skeleton key={i} height={350} animate />)
        ) : (data?.page?.length ?? 0) > 0 ? (
          data?.page.map((file) => (
            <Suspense fallback={<Skeleton height={350} animate />} key={file.id}>
              <Stack gap='xs' miw={0}>
                <DashboardFile
                  file={file}
                  id={id}
                  onOpen={(fileId) =>
                    data?.variants?.[fileId]?.length ? setOpenGroup(fileId) : setCurrent(fileId)
                  }
                />
                {!id && !folderId && file.type.startsWith('image/') && (
                  <Group justify='space-between' align='flex-start' gap='xs'>
                    <Stack gap={2} miw={0} style={{ overflowWrap: 'anywhere', flex: '1 1 10rem' }}>
                      <Text size='sm' fw={600}>
                        {file.organization?.displayName ?? suggestImageName(file.originalName ?? file.name)}
                      </Text>
                      <Text size='xs' c='dimmed'>
                        {file.organization?.sourceName ?? file.originalName ?? file.name}
                        {file.organization?.variant && ` · ${file.organization.variant}`}
                      </Text>
                    </Stack>
                    {!!data?.variants?.[file.id]?.length && (
                      <Button size='compact-sm' variant='light' onClick={() => setOpenGroup(file.id)}>
                        View sign versions (
                        {data.variants[file.id].length + Number(!!file.organization?.variant)})
                      </Button>
                    )}
                  </Group>
                )}
              </Stack>
            </Suspense>
          ))
        ) : (
          <Paper withBorder p='sm'>
            <Center>
              <Stack>
                <Group>
                  <IconFilesOff size='2rem' />
                  <Title order={2}>{t('views.noFiles')}</Title>
                </Group>
                {!id && (
                  <Button
                    variant='outline'
                    size='compact-sm'
                    leftSection={<IconFileUpload size='1rem' />}
                    component={Link}
                    to='/dashboard/upload/file'
                  >
                    {t('views.uploadFile')}
                  </Button>
                )}
              </Stack>
            </Center>
          </Paper>
        )}
      </SimpleGrid>

      <Group justify='space-between' align='center' mt='md'>
        <Text size='sm'>{t('views.pagination', { from, to, total: totalRecords })}</Text>

        <Group gap='sm'>
          <Select
            value={perpage.toString()}
            data={PER_PAGE_OPTIONS.map((val) => ({ value: val.toString(), label: `${val}` }))}
            onChange={(value) => {
              setPerpage(Number(value));
              setPage(1);
            }}
            w={80}
            size='xs'
            variant='filled'
          />

          <Pagination value={page} onChange={setPage} total={cachedPages} size='sm' withControls withEdges />
        </Group>
      </Group>
    </>
  );
}
