import React, { useState, useEffect, useCallback } from 'react';
import { ThemeContext, type Theme } from './themeContextDefinition';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, _setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('vaultdao_theme') as Theme;
      if (saved && ['light', 'dark', 'high-contrast'].includes(saved)) return saved;
      
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark'; // Default to dark
  });

  const applyTheme = useCallback((targetTheme: Theme) => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark', 'high-contrast');
    root.classList.add(targetTheme);
    root.style.colorScheme = targetTheme === 'light' ? 'light' : 'dark';
    localStorage.setItem('vaultdao_theme', targetTheme);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  const setTheme = (newTheme: Theme) => {
    _setTheme(newTheme);
  };

  const toggleTheme = () => {
    _setTheme(prev => {
      if (prev === 'dark') return 'light';
      if (prev === 'light') return 'high-contrast';
      return 'dark';
    });
  };

  // Listen for system changes if no preference is set
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('vaultdao_theme')) {
        _setTheme(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};