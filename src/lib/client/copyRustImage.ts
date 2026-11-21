import { formatRootUrl } from '@/lib/url';
import type { useClipboard } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';

export function rustImageCommand(name: string) {
  const url = new URL(formatRootUrl('/raw', name), window.location.origin).href;
  return '/sil ' + url;
}

export function copyRustImage(name: string, clipboard: ReturnType<typeof useClipboard>) {
  clipboard.copy(rustImageCommand(name));
  notifications.show({ title: 'Copy /sil', message: 'Rust command copied to clipboard.', color: 'green' });
}
