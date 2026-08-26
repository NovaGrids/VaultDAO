# I18N Implementation Guide

This document provides guidance on implementing internationalization (i18n) and localization throughout the VaultDAO application.

## Overview

The application uses **react-i18next** for translation management with support for:
- 5 languages: English (EN), Spanish (ES), French (FR), Arabic (AR), Chinese (ZH)
- Locale-specific formatting (dates, numbers, currency)
- RTL (Right-to-Left) layout support for Arabic
- Automatic language detection with localStorage persistence
- Mobile-responsive language switcher

## Installation & Setup

The i18n setup is already configured in the project:

1. **Dependencies installed**: `react-i18next`, `i18next`, `i18next-browser-languagedetector`
2. **Configuration file**: `src/i18n.ts` - Initializes i18n with all translation files
3. **Provider**: Wrapped in `main.tsx` with `I18nextProvider`
4. **LanguageSwitcher**: Available as `LanguageSwitcher` component in the header

## Basic Usage in Components

### 1. Import and Use Translation Hook

```tsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t('dashboard.treasuryOverview')}</h1>
      <button>{t('common.save')}</button>
    </div>
  );
}
```

### 2. Translation Namespace Structure

Translations are organized by functionality in `src/translations/*.json`:

```json
{
  "common": { "save": "Save", "cancel": "Cancel" },
  "dashboard": { "treasuryOverview": "Treasury Overview" },
  "navigation": { "dashboard": "Dashboard" },
  "wallet": { "connect": "Connect Wallet" }
}
```

Access translations using dot notation: `t('section.key')`

### 3. Adding New Translation Keys

When adding new strings:

1. **Add to all language files** in `src/translations/`:
   - `en.json` (English)
   - `es.json` (Spanish)
   - `fr.json` (French)
   - `ar.json` (Arabic)
   - `zh.json` (Chinese)

2. **Maintain consistent structure** across all files
3. **Use descriptive key names** that indicate context

Example:
```json
// en.json
{
  "myFeature": {
    "title": "My Feature",
    "description": "This is my feature"
  }
}

// es.json
{
  "myFeature": {
    "title": "Mi Función",
    "description": "Esta es mi función"
  }
}
```

## Locale-Specific Formatting

Use the `localeFormatter` utility for locale-aware formatting:

```tsx
import { 
  formatDate, 
  formatCurrency, 
  formatNumber,
  formatPercent,
  formatDateTime
} from '../../utils/localeFormatter';

// Format date according to current locale
const formatted = formatDate(new Date(), 'long'); 
// Output: "February 26, 2026" (EN) or "26 février 2026" (FR)

// Format currency
const price = formatCurrency(1234.56, 'USD');
// Output: "$1,234.56" (EN) or "1 234,56 $" (FR)

// Format numbers
const num = formatNumber(1000.5);
// Output: "1,000.5" (EN) or "1.000,5" (DE)

// Format percentages
const percent = formatPercent(0.25);
// Output: "25%" (EN) or "25 %" (FR)
```

### Available Formatters

- `formatDate(date, format)` - 'short', 'long', 'full'
- `formatTime(date, includeSeconds)` - Time formatting
- `formatDateTime(date)` - Combined date and time
- `formatNumber(value, options)` - General number formatting
- `formatCurrency(amount, currency)` - Currency formatting
- `formatPercent(value, fractionDigits)` - Percentage formatting
- `formatCompactNumber(value)` - Abbreviated numbers (1.5K, 2.3M)
- `getTextDirection()` - Returns 'ltr' or 'rtl'
- `isRTL()` - Returns true if RTL language

## RTL Support (Arabic)

The application automatically handles RTL layouts when Arabic is selected:

### CSS RTL Support

RTL-specific CSS rules are in `src/index.css`:
- Direction automatically flips for RTL languages
- Margins and padding swap left/right
- Flexbox items reverse direction
- Animations adjust for RTL flow

### HTML Attributes

The `LanguageSwitcher` component automatically sets:
```tsx
document.documentElement.dir = selectedLang.direction; // 'rtl' or 'ltr'
document.documentElement.lang = langCode;
```

### Component-Level RTL Handling

When needed, check RTL status in components:

```tsx
import { isRTL } from '../../utils/localeFormatter';

function MyComponent() {
  const rtl = isRTL();
  
  return (
    <div className={rtl ? 'flex-row-reverse' : 'flex-row'}>
      // Content
    </div>
  );
}
```

## Practical Examples

### Example 1: Simple Component Translation

```tsx
import { useTranslation } from 'react-i18next';
import { Save, X } from 'lucide-react';

function SettingsModal() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h2>{t('dashboard.settings')}</h2>
      <button>
        <Save size={20} />
        {t('common.save')}
      </button>
      <button>
        <X size={20} />
        {t('common.cancel')}
      </button>
    </div>
  );
}
```

### Example 2: Dynamic Content with Formatting

```tsx
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatDate } from '../../utils/localeFormatter';

function TransactionDetails({ amount, date }) {
  const { t } = useTranslation();
  
  return (
    <div>
      <p>{t('transactions.amount')}: {formatCurrency(amount)}</p>
      <p>{t('transactions.date')}: {formatDate(date, 'long')}</p>
    </div>
  );
}
```

### Example 3: Conditional Translation (Pluralization)

For simple pluralization, you can use interpolation:

```tsx
import { useTranslation } from 'react-i18next';

function ProposalCount({ count }) {
  const { t } = useTranslation();
  
  return (
    <p>
      {t('dashboard.usedNTimes', { count })}
    </p>
  );
}
// Translation: "usedNTimes": "Used {{count}} times"
// Output: "Used 3 times"
```

### Example 4: Complex Lists with RTL

```tsx
import { useTranslation } from 'react-i18next';
import { isRTL } from '../../utils/localeFormatter';

function ProposalList({ proposals }) {
  const { t } = useTranslation();
  const rtl = isRTL();
  
  return (
    <div>
      <h3>{t('proposals.title')}</h3>
      <ul className={rtl ? 'text-right' : 'text-left'}>
        {proposals.map(p => (
          <li key={p.id}>
            <span>{p.name}</span>
            <span>{t(`proposals.${p.status.toLowerCase()}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Step-by-Step: Converting a Component

Here's how to convert a component with hardcoded text to use i18n:

### Before:
```tsx
function Dashboard() {
  return (
    <div>
      <h1>Treasury Overview</h1>
      <p>Total Balance: $1,234.56</p>
      <button>Save Changes</button>
      <button>Cancel</button>
    </div>
  );
}
```

### After:
```tsx
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/localeFormatter';

function Dashboard() {
  const { t } = useTranslation();
  const balance = 1234.56;
  
  return (
    <div>
      <h1>{t('dashboard.treasuryOverview')}</h1>
      <p>{t('dashboard.totalBalance')}: {formatCurrency(balance)}</p>
      <button>{t('common.save')}</button>
      <button>{t('common.cancel')}</button>
    </div>
  );
}
```

### Add Translation Keys:

In `translations/en.json` (and other language files):
```json
{
  "dashboard": {
    "treasuryOverview": "Treasury Overview",
    "totalBalance": "Total Balance"
  },
  "common": {
    "save": "Save",
    "cancel": "Cancel"
  }
}
```

## Best Practices

1. **Keep keys organized** - Group related translations by feature/page
2. **Use descriptive key names** - Clear naming makes maintenance easier
3. **Avoid hardcoded strings** - Always use `t()` for user-visible text
4. **Test all languages** - Especially check RTL languages for layout issues
5. **Use formatter utilities** - For dates, numbers, and currency
6. **Persist language choice** - Done automatically in `LanguageSwitcher`
7. **Handle loading states** - Use `t('common.loading')` for consistency

## File Structure

```
frontend/src/
├── i18n.ts                (i18n configuration)
├── translations/          (translation files)
│   ├── en.json
│   ├── es.json
│   ├── fr.json
│   ├── ar.json
│   └── zh.json
├── components/
│   └── LanguageSwitcher.tsx
├── utils/
│   └── localeFormatter.ts (formatting utilities)
└── index.css             (RTL support CSS)
```

## Testing Across Languages

1. **Use Language Switcher** - Click the language button in the header
2. **Check RTL Layout** - Switch to Arabic and verify:
   - Layout direction
   - Text alignment
   - Button/icon positioning
3. **Verify Formatting** - Check date/currency formats for each locale
4. **Inspect Console** - Look for missing translation warnings

## Troubleshooting

### Missing Translation Warning
```
[i18n] :: missingKey 'en' 'some.key'
```
**Solution**: Add the key to all language files

### Text Not Updating
```
// Wrong - using string directly
<h1>Treasury Overview</h1>

// Correct - using translation key
<h1>{t('dashboard.treasuryOverview')}</h1>
```

### RTL Layout Issues
```
// Check current direction
import { isRTL } from '../../utils/localeFormatter';
const rtl = isRTL();

// Apply conditional classes
<div className={rtl ? 'flex-row-reverse' : 'flex-row'}>
```

## Resources

- [react-i18next Documentation](https://react.i18next.com/)
- [i18next Documentation](https://www.i18next.com/)
- [MDN: Internationalization (i18n)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization)
- [Intl API Documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)

## Implementation Checklist

- [ ] Import `useTranslation` hook in component
- [ ] Replace hardcoded text with `t('key')`
- [ ] Add new keys to all 5 translation files
- [ ] Use `localeFormatter` for dates/numbers/currency
- [ ] Test with all languages via LanguageSwitcher
- [ ] Verify RTL layout for Arabic
- [ ] Check mobile responsiveness
- [ ] Run build and test production behavior

---

**Last Updated**: February 26, 2026
**Version**: 1.0
**Status**: Active
