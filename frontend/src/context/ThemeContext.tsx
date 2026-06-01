import React, { useState, useEffect, useCallback } from 'react';
import { ThemeContext, type Theme } from './themeContextDefinition';

const STORAGE_KEY = 'vaultdao_theme';
const VALID_THEMES: Theme[] = ['light', 'dark', 'high-contrast'];

/** Read the persisted user preference, or null if none has been set. */
function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID_THEMES as string[]).includes(raw)) return raw as Theme;
  } catch { /* SSR / private browsing */ }
  return null;
}

/** Detect the OS-level colour scheme preference. */
function getSystemTheme(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // isSystemTheme = true means no explicit user override; we follow the OS.
  const [isSystemTheme, setIsSystemTheme] = useState<boolean>(() => getStoredTheme() === null);

  const [theme, _setTheme] = useState<Theme>(() => {
    const stored = getStoredTheme();
    return stored ?? getSystemTheme();
  });

  /** Apply the theme class to <html> and persist when it's a manual choice. */
  const applyTheme = useCallback((targetTheme: Theme, persist: boolean) => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark', 'high-contrast');
    root.classList.add(targetTheme);
    root.style.colorScheme = targetTheme === 'light' ? 'light' : 'dark';
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, targetTheme); } catch { /* ignore */ }
    }
  }, []);

  // Apply on mount and whenever theme changes.
  useEffect(() => {
    applyTheme(theme, !isSystemTheme);
  }, [theme, isSystemTheme, applyTheme]);

  /** Explicit user choice — persists to localStorage and clears system-follow flag. */
  const setTheme = useCallback((newTheme: Theme) => {
    setIsSystemTheme(false);
    _setTheme(newTheme);
    applyTheme(newTheme, true);
  }, [applyTheme]);

  /** Cycle: dark → light → high-contrast → dark */
  const toggleTheme = useCallback(() => {
    _setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : prev === 'light' ? 'high-contrast' : 'dark';
      setIsSystemTheme(false);
      applyTheme(next, true);
      return next;
    });
  }, [applyTheme]);

  // Listen for OS preference changes and update only when the user has NOT
  // made an explicit choice (isSystemTheme === true).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (getStoredTheme() === null) {
        const next: Theme = e.matches ? 'dark' : 'light';
        setIsSystemTheme(true);
        _setTheme(next);
        applyTheme(next, false);
      }
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isSystemTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
