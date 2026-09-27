import { describe, expect, it } from 'vitest';
import { normalizeLanguage } from '../i18n';

describe('normalizeLanguage', () => {
  it('keeps supported regional locales intact', () => {
    expect(normalizeLanguage('zh-TW')).toBe('zh-TW');
    expect(normalizeLanguage('zh-tw')).toBe('zh-TW');
    expect(normalizeLanguage('zh_TW')).toBe('zh-TW');
  });

  it('maps Traditional Chinese variants to zh-TW', () => {
    expect(normalizeLanguage('zh-Hant')).toBe('zh-TW');
    expect(normalizeLanguage('zh-Hant-TW')).toBe('zh-TW');
    expect(normalizeLanguage('zh-HK')).toBe('zh-TW');
  });

  it('strips region codes for locales without a regional translation', () => {
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('fr-CA')).toBe('fr');
    expect(normalizeLanguage('zh-CN')).toBe('zh');
    expect(normalizeLanguage('es')).toBe('es');
  });
});
