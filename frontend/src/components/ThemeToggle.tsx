import React from 'react';
import { Laptop2, Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 contrast-more:border-slate-900"
      aria-label={`Theme preference: ${theme}`}
      title={`Theme preference: ${theme}`}
      data-testid="theme-toggle"
    >
      {theme === 'light' && <Sun size={15} aria-hidden="true" />}
      {theme === 'dark' && <Moon size={15} aria-hidden="true" />}
      {theme === 'system' && <Laptop2 size={15} aria-hidden="true" />}
      <span className="hidden sm:inline">{theme}</span>
    </button>
  );
};

export default ThemeToggle;
