import { formatRootUrl } from '@/lib/url';
import type { useClipboard } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';

export function copyRustImage(name: string, clipboard: ReturnType<typeof useClipboard>) {
  const url = new URL(formatRootUrl('/raw', name), window.location.origin).href;
  clipboard.copy('/sil ' + url);
  notifications.show({ title: 'Copy /sil', message: 'Rust command copied to clipboard.', color: 'green' });
}
