import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'ar', 'zh', 'zh-TW'] as const;

// Chinese variants that should resolve to Traditional Chinese rather than 'zh'.
const TRADITIONAL_CHINESE = /^zh[-_](hant|tw|hk|mo)\b/i;

/**
 * Map a detected language tag to one of SUPPORTED_LANGUAGES.
 * Supported regional locales (e.g. zh-TW) are kept intact; other region
 * codes fall back to their base language (en-US -> en).
 */
export function normalizeLanguage(lng: string): string {
  const exact = SUPPORTED_LANGUAGES.find((l) => l.toLowerCase() === lng.replace('_', '-').toLowerCase());
  if (exact) return exact;
  if (TRADITIONAL_CHINESE.test(lng)) return 'zh-TW';
  return lng.split(/[-_]/)[0];
export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'ar', 'zh', 'zh-TW'];

/**
 * Map a detected language tag to a supported one. Region-specific locales we
 * ship (e.g. zh-TW) are kept as-is; anything else falls back to its base
 * language (en-US -> en).
 */
export function normalizeDetectedLanguage(lng: string): string {
  if (SUPPORTED_LANGUAGES.includes(lng)) return lng;
  return lng.split('-')[0];
}

// Configure i18next to lazily load translations from /locales/{{lng}}/{{ns}}.json
i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    supportedLngs: SUPPORTED_LANGUAGES,
    ns: ['translation'],
    defaultNS: 'translation',
    debug: false,
    backend: {
      // files served from public/locales/{lng}/{ns}.json
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: true,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
      convertDetectedLanguage: normalizeLanguage,
      convertDetectedLanguage: normalizeDetectedLanguage,
    },
  });

export default i18n;
