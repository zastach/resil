import type { Response } from '@/lib/api/response';
import { useUserStore } from '@/lib/client/store/user';
import { showNotification } from '@mantine/notifications';
import { IconLogout } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { mutate } from 'swr';

export function useLogout() {
  const setUser = useUserStore((state) => state.setUser);
  const { t } = useTranslation('layout');

  const logout = async () => {
    showNotification({
      message: t('userMenu.loggingOut'),
      icon: <IconLogout size='1rem' />,
      autoClose: 700,
    });

    try {
    const res = await fetch('/api/auth/logout', { cache: 'no-store' });
    if (res.ok) {
      const data: Response['/api/auth/logout'] = await res.json();
      setUser(null);
      await mutate('/api/user', null, false);
      if (data.redirectUrl) window.location.href = data.redirectUrl;
      else window.location.replace('/auth/login?logged_out=true');
    } else {
      throw new Error(`Logout failed (HTTP ${res.status})`);
    }
    } catch (error) {
      showNotification({ color: 'red', message: error instanceof Error ? error.message : 'Logout failed' });
    }
  };

  return logout;
}
