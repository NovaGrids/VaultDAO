import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext, type ResolvedTheme, type Theme } from './themeContextDefinition';

export const THEME_STORAGE_KEY = 'vaultdao_theme_preference';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const THEME_CYCLE: Theme[] = ['light', 'dark', 'system'];

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getStoredThemePreference(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(raw)) return raw;
  } catch {
    // ignore unavailable storage
  }
  return 'system';
}

function getSystemResolvedTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && window.matchMedia(SYSTEM_QUERY).matches) {
    return 'dark';
  }
  return 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemResolvedTheme() : theme;
}

function applyResolvedTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => getStoredThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(getStoredThemePreference()));

  const isSystem = theme === 'system';

  useEffect(() => {
    const nextResolved = resolveTheme(theme);
    setResolvedTheme(nextResolved);
    applyResolvedTheme(nextResolved);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage failures
    }
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia(SYSTEM_QUERY);
    const onChange = () => {
      let pref: Theme = theme;
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (isTheme(stored)) pref = stored;
      } catch {
        // ignore storage failures
      }

      if (pref !== 'system') return;
      const next = getSystemResolvedTheme();
      setResolvedTheme(next);
      applyResolvedTheme(next);
    };

    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const idx = THEME_CYCLE.indexOf(prev);
      const nextIdx = (idx + 1) % THEME_CYCLE.length;
      return THEME_CYCLE[nextIdx];
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
      isSystem,
    }),
    [isSystem, resolvedTheme, setTheme, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
