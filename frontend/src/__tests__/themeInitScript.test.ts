import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_STORAGE_KEY } from '../context/ThemeContext';

/**
 * The inline <script> in index.html applies the theme class to <html> before
 * React mounts, to avoid a flash of the wrong theme. It must read the same
 * localStorage key and understand the same value set ('light' | 'dark' |
 * 'system') as ThemeContext — otherwise it silently ignores the user's
 * stored preference and always falls back to the OS setting.
 */
function extractInitScript(): string {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
  const match = html.match(/<script>\s*\(function \(\) \{[\s\S]*?\}\)\(\);\s*<\/script>/);
  if (!match) throw new Error('theme init script not found in index.html');
  return match[0].replace(/<\/?script>/g, '');
}

function runInitScript(): void {
  new Function(extractInitScript())();
}

describe('index.html theme init script', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the same localStorage key ThemeContext writes to', () => {
    expect(extractInitScript()).toContain(THEME_STORAGE_KEY);
  });

  it('applies an explicit stored dark preference regardless of OS setting', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));

    runInitScript();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('applies an explicit stored light preference regardless of OS setting', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));

    runInitScript();

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('falls back to the OS preference when nothing is stored', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));

    runInitScript();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('falls back to the OS preference when the stored value is "system"', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));

    runInitScript();

    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
});
