import { hasAcceptedResilPolicy } from '@/lib/resil-policy';
import ResilBrand from './ResilBrand';
import type { Response } from '@/lib/api/response';
import useAvatar from '@/lib/client/hooks/useAvatar';
import useLogin from '@/lib/client/hooks/useLogin';
import { useLogout } from '@/lib/client/hooks/useLogout';
import type { SafeConfig } from '@/lib/config/safe';
import { isAdministrator } from '@/lib/role';
import {
  Anchor,
  AppShell,
  Avatar,
  Box,
  Burger,
  Button,
  Divider,
  Container,
  Loader,
  Center,
  Group,
  Menu,
  NavLink,
  Paper,
  ScrollArea,
  useMantineColorScheme,
  useMantineTheme,
} from '@mantine/core';
import {
  IconAdjustments,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconFileText,
  IconFiles,
  IconFolder,
  IconGraph,
  IconHome,
  IconLink,
  IconLogout,
  IconSettingsFilled,
  IconShieldLockFilled,
  IconStopwatch,
  IconTags,
  IconUpload,
  IconUsersGroup,
} from '@tabler/icons-react';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavigateFunction, Outlet, useLoaderData, useLocation, useNavigate } from 'react-router-dom';
import type { dashboardLoader } from '../client/routes';
import ConfigProvider from './ConfigProvider';
import LanguageSelect from './LanguageSelect';
import ResilPolicyNotice from './ResilPolicyNotice';
import VersionBadge from './VersionBadge';
import DashboardUpload from './upload/DashboardUpload';
import { SETTINGS_EXTERNAL_LINKS } from './pages/serverSettings';

type NavLinks = {
  label: string;
  icon: React.ReactNode;
  active: (path: string) => boolean;
  href?: string;
  links?: NavLinks[];
  if?: (user: Response['/api/user']['user'], config: SafeConfig) => boolean;
};

// built at render time so labels follow the active language
const buildNavLinks = (t: TFunction<['layout', 'common', 'serverSettings']>): NavLinks[] => [
  {
    label: 'Upload Images',
    icon: <IconUpload size='1rem' />,
    active: (path) => path === '/dashboard/upload/file',
    href: '/dashboard/upload/file',
  },
  {
    label: 'Dashboard',
    icon: <IconHome size='1rem' />,
    active: (path: string) => path === '/dashboard',
    href: '/dashboard',
  },
  {
    label: 'Statistics',
    icon: <IconGraph size='1rem' />,
    active: (path: string) => path === '/dashboard/metrics',
    href: '/dashboard/metrics',
    if: (user, config) =>
      config.features.metrics.enabled &&
      (config.features.metrics.adminOnly ? isAdministrator(user?.role) : true),
  },
  {
    label: 'My Images',
    icon: <IconFiles size='1rem' />,
    active: (path: string) => path === '/dashboard/files',
    href: '/dashboard/files',
  },
  {
    label: 'My Folders',
    icon: <IconFolder size='1rem' />,
    active: (path: string) => path === '/dashboard/folders',
    href: '/dashboard/folders',
  },
  {
    label: 'Account Settings',
    icon: <IconSettingsFilled size='1rem' />,
    active: (path) => path === '/dashboard/settings',
    href: '/dashboard/settings',
  },
  {
    label: 'Advanced',
    icon: <IconAdjustments size='1rem' />,
    active: (path) => path === '/dashboard/upload/text' || path.startsWith('/dashboard/urls'),
    links: [
      {
        label: t('nav.uploadText'),
        icon: <IconFileText size='1rem' />,
        active: (path) => path === '/dashboard/upload/text',
        href: '/dashboard/upload/text',
      },
      {
        label: t('nav.urls'),
        icon: <IconLink size='1rem' />,
        active: (path) => path === '/dashboard/urls',
        href: '/dashboard/urls',
      },
    ],
  },
  {
    label: t('nav.administrator'),
    icon: <IconShieldLockFilled size='1rem' />,
    if: (user) => isAdministrator(user?.role),
    active: (path: string) => path.startsWith('/dashboard/admin') || path.startsWith('/devtools'),
    links: [
      {
        label: 'Developer Tools',
        icon: <IconAdjustments size='1rem' />,
        active: (path: string) => path.startsWith('/devtools'),
        href: '/devtools',
        if: (user) => user?.role === 'SUPERADMIN',
        links: [
          {
            label: 'NPC Studio',
            icon: <IconUsersGroup size='1rem' />,
            active: (path: string) => path.startsWith('/devtools/npcstudio'),
            href: '/devtools/npcstudio',
          },
        ],
      },
      {
        label: t('nav.adminDashboard'),
        icon: <IconHome size='1rem' />,
        active: (path: string) => path === '/dashboard/admin',
        href: '/dashboard/admin',
      },
      {
        label: t('nav.serverSettings'),
        icon: <IconAdjustments size='1rem' />,
        active: (path: string) => path.startsWith('/dashboard/admin/settings'),
        if: (user) => user?.role === 'SUPERADMIN',
        href: '/dashboard/admin/settings',
        links: SETTINGS_EXTERNAL_LINKS.map(({ labelKey, href, icon: Icon }) => ({
          label: t(labelKey, { ns: 'serverSettings' }),
          icon: <Icon size='1rem' />,
          active: (path: string) => path === href,
          href,
        })),
      },
      {
        label: t('nav.serverActions'),
        icon: <IconStopwatch size='1rem' />,
        active: (path: string) => path === '/dashboard/admin/actions',
        href: '/dashboard/admin/actions',
      },
      {
        label: t('nav.users'),
        icon: <IconUsersGroup size='1rem' />,
        active: (path: string) => path === '/dashboard/admin/users',
        href: '/dashboard/admin/users',
      },
      {
        label: t('nav.invites'),
        icon: <IconTags size='1rem' />,
        active: (path: string) => path === '/dashboard/admin/invites',
        href: '/dashboard/admin/invites',
        if: (_, config) => config.invites.enabled,
      },
    ],
  },
];

const renderLinks = (
  links: NavLinks[],
  pathname: string,
  user: Response['/api/user']['user'],
  config: SafeConfig,
  navigate: NavigateFunction,
) => {
  const visible = (link: NavLinks) => !link.if || link.if(user as Response['/api/user']['user'], config);

  const active = (link: NavLinks): boolean => {
    if (!visible(link)) return false;
    if (link.active(pathname)) return true;

    return (link.links || []).some((child) => active(child));
  };

  return links.map((link) => {
    if (visible(link)) {
      const sublinks = link.links;
      const isActive = link.active(pathname);

      if (!sublinks) {
        return (
          <NavLink
            key={link.href ?? link.label}
            label={link.label}
            leftSection={link.icon}
            variant='light'
            rightSection={<IconChevronRight size='0.7rem' />}
            active={isActive}
            component={Link}
            to={link.href || ''}
            prefetch='intent'
          />
        );
      } else {
        return (
          <NavLink
            key={link.href ?? link.label}
            label={link.label}
            leftSection={link.icon}
            variant='light'
            rightSection={<IconChevronRight size='0.7rem' />}
            active={isActive && !sublinks.some((child) => active(child))}
            defaultOpened={isActive || sublinks.some((child) => active(child))}
            onClick={(event) => {
              if (!link.href) return;
              event.preventDefault();
              navigate(link.href);
            }}
          >
            {renderLinks(sublinks, pathname, user as Response['/api/user']['user'], config, navigate)}
          </NavLink>
        );
      }
    }
    return null;
  });
};

export default function Layout() {
  const { t } = useTranslation(['layout', 'common', 'serverSettings']);
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const [opened, setOpened] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();

  const loaderData = useLoaderData<typeof dashboardLoader>();
  const config = loaderData.config;

  const { user, mutate } = useLogin();
  const { avatar } = useAvatar();

  const [prev, setPrev] = useState(location.pathname);
  if (prev !== location.pathname) {
    setPrev(location.pathname);
    setOpened(false);
  }

  if (!user)
    return (
      <Center mih='100dvh'>
        <Loader aria-label='Loading account' />
      </Center>
    );

  if (!hasAcceptedResilPolicy(user)) {
    return (
      <Container component='main' size='sm' py='xl'>
        <ResilBrand large />
        <ResilPolicyNotice key={user.id} refreshUser={mutate} logout={logout} />
      </Container>
    );
  }

  return (
    <ConfigProvider data={loaderData}>
      <DashboardUpload>
        <AppShell
          navbar={{ breakpoint: 'sm', width: { sm: 200, lg: 230 }, collapsed: { mobile: !opened } }}
          header={{ height: 60 }}
          footer={{ height: { base: 0.1 } }}
        >
          <AppShell.Header px='md'>
            <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <Burger
                opened={opened}
                onClick={() => setOpened((o) => !o)}
                size='sm'
                color={theme.colors.gray[6]}
                mr='xl'
                hiddenFrom='sm'
                bdrs='md'
              />

              <ResilBrand />

              <Group gap='xs' wrap='nowrap' style={{ marginLeft: 'auto' }}>
                <LanguageSelect />

                <Menu shadow='md' width={200}>
                  <Menu.Target>
                    <Button
                      variant='transparent'
                      color={colorScheme === 'dark' ? 'white' : 'black'}
                      leftSection={
                        avatar ? (
                          <Avatar
                            src={avatar}
                            radius='sm'
                            size='sm'
                            alt={user?.username ?? t('header.avatarAlt')}
                          />
                        ) : (
                          <IconSettingsFilled size='1rem' />
                        )
                      }
                      rightSection={<IconChevronDown size='0.7rem' />}
                      size='sm'
                    >
                      {user?.username}
                    </Button>
                  </Menu.Target>

                  <Menu.Dropdown>
                    <Menu.Label>
                      {isAdministrator(user?.role)
                        ? t('userMenu.administratorLabel', { username: user?.username })
                        : user?.username}
                    </Menu.Label>

                    <Menu.Item
                      leftSection={<IconSettingsFilled size='1rem' />}
                      component={Link}
                      to='/dashboard/settings'
                      prefetch='intent'
                    >
                      {t('userMenu.settings')}
                    </Menu.Item>

                    {user?.role === 'SUPERADMIN' && (
                      <Menu.Item
                        leftSection={<IconAdjustments size='1rem' />}
                        component={Link}
                        to='/dashboard/admin/settings'
                        prefetch='intent'
                      >
                        {t('userMenu.serverSettings')}
                      </Menu.Item>
                    )}

                    <Menu.Divider />
                    <Menu.Item color='red' leftSection={<IconLogout size='1rem' />} onClick={logout}>
                      {t('userMenu.logout')}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </div>
          </AppShell.Header>

          <AppShell.Navbar hidden={!opened} zIndex={90}>
            <ScrollArea mah='calc(100vh - 200px)'>
              {renderLinks(
                buildNavLinks(t),
                location.pathname,
                user as Response['/api/user']['user'],
                config,
                navigate,
              )}
            </ScrollArea>

            <div style={{ marginTop: 'auto' }}>
              {isAdministrator(user?.role) && <VersionBadge />}

              <Divider />

              <ScrollArea mah='auto'>
                <Box>
                  <NavLink
                    label='Upload for a Rust Sign'
                    component={Link}
                    to='/dashboard/image-optimizer'
                    leftSection={<IconExternalLink size='1rem' />}
                  />
                  <NavLink
                    label='Rust Image Guide'
                    component={Link}
                    to='/auth/image-guide'
                    leftSection={<IconExternalLink size='1rem' />}
                  />
                  <NavLink label='Sign Out' onClick={logout} leftSection={<IconLogout size='1rem' />} />
                  {config.website.externalLinks
                    .filter(
                      ({ url }) =>
                        ![
                          'https://rustempires.com',
                          '/auth/terms',
                          '/auth/privacy',
                          '/auth/contact',
                        ].includes(url.replace(/\/$/, '')),
                    )
                    .map(({ name, url }, i) => (
                      <NavLink
                        key={i}
                        label={name}
                        leftSection={<IconExternalLink size='1rem' />}
                        variant='light'
                        component={Link}
                        to={url}
                        target='_blank'
                      />
                    ))}
                </Box>
              </ScrollArea>
            </div>
          </AppShell.Navbar>

          <AppShell.Main>
            <Paper withBorder m='md' p='xs' radius='md'>
              <Outlet />
            </Paper>
            <Group component='footer' gap='sm' px='md' py='xs' justify='center'>
              <Anchor component={Link} size='xs' c='dimmed' to='/roadmap'>
                Roadmap
              </Anchor>
              <Anchor component={Link} size='xs' c='dimmed' to='/auth/terms'>
                Terms of Service
              </Anchor>
              <Anchor component={Link} size='xs' c='dimmed' to='/auth/privacy'>
                Privacy Policy
              </Anchor>
              <Anchor component={Link} size='xs' c='dimmed' to='/auth/contact'>
                Contact Us
              </Anchor>
              <Anchor
                size='xs'
                c='dimmed'
                href='https://rustempires.com/'
                target='_blank'
                rel='noopener noreferrer'
              >
                Rust Empires
              </Anchor>
            </Group>
          </AppShell.Main>
        </AppShell>
      </DashboardUpload>
    </ConfigProvider>
  );
}
