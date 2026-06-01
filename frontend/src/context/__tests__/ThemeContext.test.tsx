import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeProvider } from '../ThemeContext';
import { useTheme } from '../useTheme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A simple consumer component that renders theme state and exposes controls. */
const ThemeConsumer: React.FC = () => {
  const { theme, setTheme, toggleTheme, isSystemTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="is-system">{String(isSystemTheme)}</span>
      <button onClick={() => setTheme('light')}>set-light</button>
      <button onClick={() => setTheme('dark')}>set-dark</button>
      <button onClick={() => setTheme('high-contrast')}>set-hc</button>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
};

const renderWithProvider = () =>
  render(
    <ThemeProvider>
      <ThemeConsumer />
    </ThemeProvider>,
  );

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ThemeContext', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;
  let mediaQueryListeners: Array<(e: MediaQueryListEvent) => void>;

  beforeEach(() => {
    // Reset localStorage
    localStorage.clear();
    // Reset html classes
    document.documentElement.classList.remove('light', 'dark', 'high-contrast');

    mediaQueryListeners = [];

    matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? false : false,
      media: query,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        mediaQueryListeners.push(cb);
      },
      removeEventListener: vi.fn(),
    }));

    vi.stubGlobal('matchMedia', matchMediaMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark', 'high-contrast');
  });

  // ── System preference detection ──────────────────────────────────────────

  it('detects OS dark preference on first load when no stored theme', () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        mediaQueryListeners.push(cb);
      },
      removeEventListener: vi.fn(),
    }));

    renderWithProvider();

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('is-system').textContent).toBe('true');
  });

  it('detects OS light preference on first load when no stored theme', () => {
    // matchMedia returns false for dark → light
    renderWithProvider();

    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('is-system').textContent).toBe('true');
  });

  it('applies the stored theme from localStorage and marks isSystemTheme=false', () => {
    localStorage.setItem('vaultdao_theme', 'high-contrast');

    renderWithProvider();

    expect(screen.getByTestId('theme').textContent).toBe('high-contrast');
    expect(screen.getByTestId('is-system').textContent).toBe('false');
  });

  // ── Manual override ───────────────────────────────────────────────────────

  it('persists manual theme choice to localStorage and clears isSystemTheme', () => {
    renderWithProvider();

    act(() => {
      fireEvent.click(screen.getByText('set-dark'));
    });

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('is-system').textContent).toBe('false');
    expect(localStorage.getItem('vaultdao_theme')).toBe('dark');
  });

  it('adds the theme class to document.documentElement', () => {
    renderWithProvider();

    act(() => {
      fireEvent.click(screen.getByText('set-light'));
    });

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  // ── Toggle ────────────────────────────────────────────────────────────────

  it('toggleTheme cycles dark → light → high-contrast → dark', () => {
    localStorage.setItem('vaultdao_theme', 'dark');

    renderWithProvider();
    expect(screen.getByTestId('theme').textContent).toBe('dark');

    act(() => { fireEvent.click(screen.getByText('toggle')); });
    expect(screen.getByTestId('theme').textContent).toBe('light');

    act(() => { fireEvent.click(screen.getByText('toggle')); });
    expect(screen.getByTestId('theme').textContent).toBe('high-contrast');

    act(() => { fireEvent.click(screen.getByText('toggle')); });
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('toggleTheme persists each step to localStorage', () => {
    localStorage.setItem('vaultdao_theme', 'dark');
    renderWithProvider();

    act(() => { fireEvent.click(screen.getByText('toggle')); });
    expect(localStorage.getItem('vaultdao_theme')).toBe('light');

    act(() => { fireEvent.click(screen.getByText('toggle')); });
    expect(localStorage.getItem('vaultdao_theme')).toBe('high-contrast');
  });

  // ── OS change listener ────────────────────────────────────────────────────

  it('updates theme when OS preference changes and no manual override exists', () => {
    // Start with light OS preference, no stored theme
    renderWithProvider();
    expect(screen.getByTestId('theme').textContent).toBe('light');

    // Simulate OS switching to dark
    act(() => {
      mediaQueryListeners.forEach((cb) =>
        cb({ matches: true } as MediaQueryListEvent),
      );
    });

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('is-system').textContent).toBe('true');
  });

  it('does NOT update theme when OS preference changes after manual override', () => {
    renderWithProvider();

    // User manually picks light
    act(() => { fireEvent.click(screen.getByText('set-light')); });
    expect(localStorage.getItem('vaultdao_theme')).toBe('light');

    // OS switches to dark — should be ignored
    act(() => {
      mediaQueryListeners.forEach((cb) =>
        cb({ matches: true } as MediaQueryListEvent),
      );
    });

    // Theme should remain 'light' because user has an explicit preference
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });
});
