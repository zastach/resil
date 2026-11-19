import { Response } from '@/lib/api/response';
import { Config } from '@/lib/config/validate';
import { useSettingsStore } from '@/lib/client/store/settings';
import { useUserStore } from '@/lib/client/store/user';
import { ZiplineTheme, findTheme, themeComponents } from '@/lib/theme';
import dark_blue from '@/lib/theme/builtins/dark_blue.theme.json' with { type: 'json' };
import { getDayjsLocale } from '@/lib/i18n/languages';
import { currentLanguage } from '@/lib/i18n';
import { MantineProvider, createTheme } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { useColorScheme } from '@mantine/hooks';
import { createContext, useContext } from 'react';
import useSWR from 'swr';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';

const ThemeContext = createContext<{
  themes: ZiplineTheme[];
}>({
  themes: [],
});

export function useThemes() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemes must be used within a ThemeProvider');

  return ctx.themes;
}

export default function ThemeProvider({
  ssrThemes,
  ssrDefaultTheme,
  children,
}: {
  ssrThemes?: ZiplineTheme[];
  ssrDefaultTheme?: Config['website']['theme'];
  children: React.ReactNode;
}) {
  const { data: clientThemes } = useSWR<Response['/api/server/themes']>('/api/server/themes', {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    refreshWhenHidden: false,
    revalidateIfStale: false,
  });

  const themes = ssrThemes ?? clientThemes?.themes;
  const defaultTheme = ssrDefaultTheme ?? clientThemes?.defaultTheme;

  const user = useUserStore((state) => state.user);
  const [userTheme, preferredDark, preferredLight] = useSettingsStore(
    useShallow((state) => [state.settings.theme, state.settings.themeDark, state.settings.themeLight]),
  );
  const systemTheme = useColorScheme();
  const { i18n } = useTranslation();
  const dayjsLocale = i18n.resolvedLanguage ? getDayjsLocale(currentLanguage()) : 'en';
  const currentTheme = user ? userTheme : (defaultTheme?.default ?? 'system');

  let theme = findTheme(currentTheme, themes);

  if (currentTheme === 'system') {
    theme =
      systemTheme === 'dark'
        ? (findTheme(user ? preferredDark : (defaultTheme?.dark ?? ''), themes) ??
          findTheme('builtin:dark_blue', themes))
        : (findTheme(user ? preferredLight : (defaultTheme?.light ?? ''), themes) ??
          findTheme('builtin:light_blue', themes));
  }

  if (!theme) {
    theme = findTheme('builtin:dark_blue') ?? (dark_blue as unknown as ZiplineTheme); // back up theme if all else fails lol
  }

  theme = {
    ...theme,
    colorScheme: 'dark',
    primaryColor: 'empire',
    primaryShade: 7,
    mainBackgroundColor: '#111212',
    fontFamily: 'Archivo, Arial, sans-serif',
    headings: { ...theme.headings, fontFamily: 'Sora, Archivo, Arial, sans-serif', fontWeight: '600' },
    colors: {
      ...theme.colors,
      dark: [
        '#ffffff',
        '#d9dada',
        '#b9bcbc',
        '#969b9b',
        '#626767',
        '#3c4040',
        '#292c2c',
        '#1a1b1b',
        '#151616',
        '#111212',
      ],
      empire: [
        '#fff0ed',
        '#ffdad5',
        '#ffb4ab',
        '#ff8a80',
        '#ff6860',
        '#ff4c4c',
        '#f03d3e',
        '#eb1b0c',
        '#ca190e',
        '#a9160d',
      ],
    },
  };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Sora:wght@600;700&display=swap');
        :root[data-mantine-color-scheme='dark'] { --mantine-color-body: #111212; --mantine-color-text: #ffffff; }
        body { background-color: #111212; background-image: repeating-linear-gradient(135deg, transparent 0 8px, rgba(255,255,255,.012) 8px 9px); color: #fff; }
        body::before { content: ''; position: fixed; inset: 0 0 auto 50%; height: 4px; background: #eb1b0c; z-index: 1000; pointer-events: none; }
        body::after { content: ''; position: fixed; inset: auto 0 0; height: 6px; background: #eb1b0c; z-index: 1000; pointer-events: none; }
        @media(max-width: 960px) { body::before { left: 0; } }
        h1,h2,h3,.mantine-Modal-title { font-family: Sora, Archivo, Arial, sans-serif; text-transform: uppercase; }
        .mantine-Button-root { border-radius: 500px; font-weight: 500; }
        .mantine-Button-root[data-variant='filled']:not(.resil-discord-button):not([data-disabled]):not(:disabled) { --button-bg: #eb1b0c; --button-hover: #ca190e; --button-color: #fff; }
        .mantine-Button-root[data-variant='outline']:not([data-disabled]):not(:disabled) { --button-color: #ff4c4c; --button-bd: 1px solid #eb1b0c; }
        .mantine-AppShell-header,.mantine-AppShell-navbar,.mantine-AppShell-footer { background: #111212; border-color: #3c4040; }
        .mantine-Paper-root,.mantine-Card-root,.mantine-Modal-content,.mantine-Modal-header,.mantine-Menu-dropdown,.mantine-Popover-dropdown { background-color: #1a1b1b; border-color: #3c4040; }
        .mantine-NavLink-root { font-family: Sora, Archivo, Arial, sans-serif; font-weight: 600; }
        .mantine-NavLink-root[data-active] { color: #ff4c4c; box-shadow: inset 2px 0 #eb1b0c; background: rgba(235,27,12,.09); }
        a:not([class*='mantine-']) { color: #ff4c4c; }
      `}</style>

      <ThemeContext.Provider value={{ themes: themes ?? [] }}>
        <MantineProvider
          defaultColorScheme={theme.colorScheme}
          forceColorScheme={theme.colorScheme}
          theme={createTheme({
            ...themeComponents(theme),
          })}
        >
          <DatesProvider settings={{ locale: dayjsLocale }}>{children}</DatesProvider>
        </MantineProvider>
      </ThemeContext.Provider>
    </>
  );
}
