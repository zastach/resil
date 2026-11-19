import type { File } from '@/lib/db/models/file';
import { Button, Card } from '@mantine/core';
import { copyRustImage } from '@/lib/client/copyRustImage';
import { useClipboard } from '@mantine/hooks';
import { useState } from 'react';
import DashboardFileType from '../DashboardFileType';
import FileContextMenu from '../FileContextMenu';
import DashboardFileModal from './DashboardFileModal';

import styles from './index.module.css';

export default function DashboardFile({
  file,
  reduce,
  id,
  onOpen,
}: {
  file: File;
  reduce?: boolean;
  id?: string;
  onOpen?: (fileId: string) => void;
}) {
  const clipboard = useClipboard();
  const [open, setOpen] = useState(false);

  const handleView = () => (onOpen ? onOpen(file.id) : setOpen(true));

  return (
    <>
      {!onOpen && <DashboardFileModal open={open} setOpen={setOpen} file={file} reduce={reduce} user={id} />}

      <FileContextMenu file={file} reduce={reduce} user={id} onView={handleView}>
        <Card shadow='md' radius='md' p={0} onClick={handleView} className={styles.file}>
          <DashboardFileType key={file.id} file={file} />
          {file.type.startsWith('image/') && (
            <Button
              fullWidth
              size='xs'
              disabled={file.size > 1000000 || !['image/png', 'image/jpeg'].includes(file.type)}
              onClick={(event) => {
                event.stopPropagation();
                copyRustImage(file.name, clipboard);
              }}
            >
              {file.size > 1000000
                ? 'Optimization required'
                : !['image/png', 'image/jpeg'].includes(file.type)
                  ? 'Format not verified'
                  : 'Copy /sil'}
            </Button>
          )}
        </Card>
      </FileContextMenu>
    </>
  );
}
