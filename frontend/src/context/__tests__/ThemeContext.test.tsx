import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../ThemeContext';

const listeners: Array<(event: MediaQueryListEvent) => void> = [];

function mockMatchMedia(initialDark = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      matches: initialDark,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => {
        listeners.push(handler);
      },
      removeEventListener: vi.fn(),
    })),
  );
}

const Consumer = () => {
  const { theme, resolvedTheme, toggleTheme, setTheme, isSystem } = useTheme();

  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="is-system">{String(isSystem)}</span>
      <button onClick={toggleTheme}>toggle</button>
      <button onClick={() => setTheme('system')}>set-system</button>
      <button onClick={() => setTheme('dark')}>set-dark</button>
      <button onClick={() => setTheme('light')}>set-light</button>
    </div>
  );
};

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    listeners.length = 0;
    document.documentElement.classList.remove('light', 'dark');
    mockMatchMedia(false);
  });

  it('defaults to system theme and resolves using media query', () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    expect(screen.getByTestId('is-system').textContent).toBe('true');
  });

  it('loads stored preference from localStorage', () => {
    localStorage.setItem('vaultdao_theme_preference', 'dark');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('toggle cycles light -> dark -> system -> light', () => {
    localStorage.setItem('vaultdao_theme_preference', 'light');

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme').textContent).toBe('dark');

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme').textContent).toBe('system');

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('updates resolved theme when system preference changes while in system mode', () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved').textContent).toBe('light');

    // Replace matchMedia to report dark after change event callback.
    mockMatchMedia(true);

    act(() => {
      listeners.forEach((handler) => handler({ matches: true } as MediaQueryListEvent));
    });

    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('ignores system preference updates when user selects explicit theme', () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText('set-light'));
    mockMatchMedia(true);

    act(() => {
      listeners.forEach((handler) => handler({ matches: true } as MediaQueryListEvent));
    });

    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });
});
