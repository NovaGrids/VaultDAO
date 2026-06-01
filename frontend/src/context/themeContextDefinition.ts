import { createContext } from 'react';

export type Theme = 'light' | 'dark' | 'high-contrast';

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** True when the current theme is following the OS preference (no manual override) */
  isSystemTheme: boolean;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
