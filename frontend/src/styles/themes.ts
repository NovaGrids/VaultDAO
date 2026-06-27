import type { Theme } from '../context/themeContextDefinition';

export const THEME_STORAGE_KEY = 'vaultdao_theme_preference';

export const themeStyles = {
  light: {
    background: 'bg-slate-50',
    foreground: 'text-slate-900',
    card: 'bg-white',
    border: 'border-slate-200',
    muted: 'text-slate-500',
    accent: 'text-emerald-700',
    glass:
      'bg-white/80 border border-slate-200/80 backdrop-blur-md shadow-sm contrast-more:bg-white contrast-more:border-slate-900',
  },
  dark: {
    background: 'bg-slate-950',
    foreground: 'text-slate-100',
    card: 'bg-slate-900',
    border: 'border-slate-700',
    muted: 'text-slate-400',
    accent: 'text-emerald-300',
    glass:
      'bg-slate-900/50 border border-slate-700/60 backdrop-blur-md contrast-more:bg-black contrast-more:border-white',
  },
} as const;

export const glassPanel =
  'bg-white/80 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-700/60 backdrop-blur-md shadow-sm dark:shadow-none contrast-more:bg-white contrast-more:border-slate-900';

export const glassCard =
  'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl contrast-more:bg-white contrast-more:border-slate-900';

export const glassModal =
  'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl contrast-more:bg-black contrast-more:border-white';

export function resolveInitialTheme(theme: Theme | null): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function getThemeInitScript(): string {
  return `(() => {
    try {
      const key = '${THEME_STORAGE_KEY}';
      const raw = localStorage.getItem(key);
      const pref = raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(resolved);
      root.style.colorScheme = resolved;
    } catch {
      document.documentElement.classList.add('light');
      document.documentElement.style.colorScheme = 'light';
    }
  })();`;
}

export function applyThemeBeforeMount() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    const pref = raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  } catch {
    document.documentElement.classList.add('light');
    document.documentElement.style.colorScheme = 'light';
  }
}
