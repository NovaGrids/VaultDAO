import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import LanguageSwitcher from '../LanguageSwitcher';

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    vi.clearAllMocks();
  });

  it('renders language switcher button', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>
    );
    expect(screen.getByLabelText(/select language/i)).toBeInTheDocument();
  });

  it('opens dropdown when button is clicked', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>
    );
    fireEvent.click(screen.getByLabelText(/select language/i));
    expect(screen.getByText('Español')).toBeInTheDocument();
  });

  it('loads zh-TW locale correctly', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>
    );

    fireEvent.click(screen.getByLabelText(/select language/i));
    fireEvent.click(screen.getByText('繁體中文'));

    await waitFor(() => {
      expect(i18n.language).toBe('zh-TW');
    });

    expect(screen.getByText('繁體中文')).toBeInTheDocument();
  });

  it('displays checkmark for active language', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>
    );

    fireEvent.click(screen.getByLabelText(/select language/i));
    await waitFor(() => {
      const englishButton = screen.getByRole('menuitem', { name: /English/i });
      expect(englishButton).toHaveTextContent('✓');
    });
  });
});
