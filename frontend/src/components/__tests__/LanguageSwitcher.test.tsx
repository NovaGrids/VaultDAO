import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import LanguageSwitcher from '../LanguageSwitcher';
import { normalizeDetectedLanguage } from '../../i18n';
import enTranslation from '../../../public/locales/en/translation.json';

// The global test setup stubs react-i18next; this suite exercises the real one.
vi.unmock('react-i18next');

// Self-contained instance: the app's instance loads locale files over HTTP.
const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en', 'es', 'fr', 'ar', 'zh', 'zh-TW'],
  resources: { en: { translation: enTranslation } },
  react: { useSuspense: false },
});

function renderSwitcher() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LanguageSwitcher />
    </I18nextProvider>
  );
}

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders language switcher button', () => {
    renderSwitcher();
    expect(screen.getByLabelText(/select language/i)).toBeInTheDocument();
  });

  it('opens dropdown when button is clicked', () => {
    renderSwitcher();
    fireEvent.click(screen.getByLabelText(/select language/i));
    expect(screen.getByText('Español')).toBeInTheDocument();
  });

  it('loads zh-TW locale correctly', async () => {
    renderSwitcher();

    fireEvent.click(screen.getByLabelText(/select language/i));
    fireEvent.click(screen.getByText('繁體中文'));

    await waitFor(() => {
      expect(i18n.language).toBe('zh-TW');
    });

    expect(screen.getByText('繁體中文')).toBeInTheDocument();
  });

  it('displays checkmark for active language', async () => {
    renderSwitcher();

    fireEvent.click(screen.getByLabelText(/select language/i));
    await waitFor(() => {
      const englishButton = screen.getByRole('menuitem', { name: /English/i });
      expect(englishButton).toHaveTextContent('✓');
    });
  });
});

describe('normalizeDetectedLanguage', () => {
  it('keeps supported region-specific locales such as zh-TW', () => {
    expect(normalizeDetectedLanguage('zh-TW')).toBe('zh-TW');
  });

  it('falls back to the base language for unsupported regions', () => {
    expect(normalizeDetectedLanguage('en-US')).toBe('en');
    expect(normalizeDetectedLanguage('zh-CN')).toBe('zh');
  });
});
