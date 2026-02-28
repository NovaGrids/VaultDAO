/**
 * Locale-specific formatting utilities
 * Formats dates, numbers, and currency according to the current language/locale
 */

import i18n from '../i18n';

// Locale mappings for Intl API
const localeMap: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  ar: 'ar-SA',
  zh: 'zh-CN',
};

/**
 * Get the current locale for Intl API
 */
const getCurrentLocale = (): string => {
  const langCode = i18n.language || 'en';
  return localeMap[langCode] || 'en-US';
};

/**
 * Format a date according to the current locale
 * @param date - Date to format
 * @param format - 'short' | 'long' | 'full' (defaults to 'long')
 * @returns Formatted date string
 */
export const formatDate = (
  date: Date | string | number,
  format: 'short' | 'long' | 'full' = 'long'
): string => {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const locale = getCurrentLocale();

  const options: Intl.DateTimeFormatOptions =
    format === 'short'
      ? { year: 'numeric', month: '2-digit', day: '2-digit' }
      : format === 'long'
        ? { year: 'numeric', month: 'long', day: 'numeric' }
        : { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

  return new Intl.DateTimeFormat(locale, options).format(dateObj);
};

/**
 * Format a time according to the current locale
 * @param date - Date to format
 * @param includeSeconds - Include seconds (defaults to true)
 * @returns Formatted time string
 */
export const formatTime = (date: Date | string | number, includeSeconds = true): string => {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const locale = getCurrentLocale();

  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds && { second: '2-digit' }),
  };

  return new Intl.DateTimeFormat(locale, options).format(dateObj);
};

/**
 * Format a date and time together
 * @param date - Date to format
 * @returns Formatted date and time string
 */
export const formatDateTime = (date: Date | string | number): string => {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const locale = getCurrentLocale();

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };

  return new Intl.DateTimeFormat(locale, options).format(dateObj);
};

/**
 * Format a number according to the current locale
 * @param value - Number to format
 * @param options - Intl.NumberFormat options
 * @returns Formatted number string
 */
export const formatNumber = (
  value: number,
  options?: Intl.NumberFormatOptions
): string => {
  const locale = getCurrentLocale();
  return new Intl.NumberFormat(locale, options).format(value);
};

/**
 * Format a currency amount according to the current locale
 * @param amount - Amount to format
 * @param currency - Currency code (e.g., 'USD', 'EUR', 'SAR', 'CNY')
 * @returns Formatted currency string
 */
export const formatCurrency = (amount: number, currency = 'USD'): string => {
  const locale = getCurrentLocale();
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };
  return new Intl.NumberFormat(locale, options).format(amount);
};

/**
 * Format a number as percentage according to the current locale
 * @param value - Value as decimal (e.g., 0.25 for 25%)
 * @param fractionDigits - Number of fraction digits to display
 * @returns Formatted percentage string
 */
export const formatPercent = (value: number, fractionDigits = 2): string => {
  const locale = getCurrentLocale();
  const options: Intl.NumberFormatOptions = {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  };
  return new Intl.NumberFormat(locale, options).format(value);
};

/**
 * Format a large number with abbreviation (e.g., 1.5K, 2.3M)
 * @param value - Number to format
 * @returns Abbreviated number string
 */
export const formatCompactNumber = (value: number): string => {
  const locale = getCurrentLocale();
  const options: Intl.NumberFormatOptions = {
    notation: 'compact',
    compactDisplay: 'short',
  };
  return new Intl.NumberFormat(locale, options).format(value);
};

/**
 * Get the current text direction (LTR or RTL)
 * @returns 'ltr' or 'rtl'
 */
export const getTextDirection = (): 'ltr' | 'rtl' => {
  const langCode = i18n.language || 'en';
  return langCode === 'ar' ? 'rtl' : 'ltr';
};

/**
 * Check if the current language is RTL
 * @returns true if RTL language
 */
export const isRTL = (): boolean => {
  return getTextDirection() === 'rtl';
};

export default {
  formatDate,
  formatTime,
  formatDateTime,
  formatNumber,
  formatCurrency,
  formatPercent,
  formatCompactNumber,
  getTextDirection,
  isRTL,
};
