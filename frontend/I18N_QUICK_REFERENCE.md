# I18N Quick Reference

A quick reference for using i18n in VaultDAO components.

## 1️⃣ Add Translation Import

```tsx
import { useTranslation } from 'react-i18next';
```

## 2️⃣ Get Translation Function

```tsx
const { t } = useTranslation();
```

## 3️⃣ Use Translation Keys

```tsx
// Simple translation
<h1>{t('dashboard.treasuryOverview')}</h1>

// Button text
<button>{t('common.save')}</button>

// With interpolation
<p>{t('dashboard.usedNTimes', { count: 5 })}</p>
```

## 4️⃣ Format Numbers/Dates/Currency

```tsx
import { 
  formatDate, 
  formatCurrency, 
  formatNumber,
  formatPercent,
  isRTL 
} from '../../utils/localeFormatter';

// Locale-aware formatting
<p>{formatCurrency(1234.56)}</p>  // $1,234.56 or 1.234,56 €
<p>{formatDate(new Date(), 'long')}</p>  // February 26, 2026
<p>{formatNumber(1000.5)}</p>  // 1,000.5
<p>{formatPercent(0.25)}</p>  // 25%
```

## 5️⃣ Check RTL Language

```tsx
import { isRTL } from '../../utils/localeFormatter';

const className = isRTL() ? 'flex-row-reverse' : 'flex-row';
```

## 📍 Common Translation Keys

### Common UI
- `common.save` - Save
- `common.cancel` - Cancel
- `common.delete` - Delete
- `common.edit` - Edit
- `common.loading` - Loading
- `common.retry` - Retry

### Dashboard
- `dashboard.treasuryOverview` - Treasury Overview
- `dashboard.totalBalance` - Total Balance
- `dashboard.tokenBalances` - Token Balances
- `dashboard.quickActions` - Quick Actions
- `dashboard.addToken` - Add Token

### Navigation
- `navigation.dashboard` - Dashboard
- `navigation.proposals` - Proposals
- `navigation.analytics` - Analytics
- `navigation.settings` - Settings

### Language
- `language.selectLanguage` - Select Language

## 🔧 Adding New Translations

1. Add to `src/translations/en.json`:
```json
{
  "myFeature": {
    "title": "My Feature",
    "description": "A description"
  }
}
```

2. Add to all other language files (`es.json`, `fr.json`, `ar.json`, `zh.json`)

3. Use in component:
```tsx
const { t } = useTranslation();
<h1>{t('myFeature.title')}</h1>
```

## 📋 Component Conversion Checklist

- [ ] Import `useTranslation` from 'react-i18next'
- [ ] Call `const { t } = useTranslation()` in component
- [ ] Replace all hardcoded text with `t('key')`
- [ ] Add new keys to all 5 translation files
- [ ] Test with LanguageSwitcher
- [ ] Verify RTL layout with Arabic

## 🌐 Language Codes

- `en` - English
- `es` - Spanish (Español)
- `fr` - French (Français)
- `ar` - Arabic (العربية)
- `zh` - Chinese Simplified (中文)

## ⚙️ Common Patterns

### Button with Icon + Text
```tsx
<button>
  <SaveIcon size={20} />
  {t('common.save')}
</button>
```

### List with Dynamic Content
```tsx
<div>
  <h3>{t('dashboard.tokenBalances')}</h3>
  {tokens.map(token => (
    <div key={token.id}>
      <span>{token.name}</span>
      <span>{formatCurrency(token.value)}</span>
    </div>
  ))}
</div>
```

### Form with Validation
```tsx
<form>
  <label>{t('forms.email')}</label>
  <input type="email" />
  <button>{t('forms.submit')}</button>
</form>
```

### Conditional Text
```tsx
<p>
  {proposals.length > 0 
    ? t('dashboard.activeProposals')
    : t('dashboard.noProposalsFound')}
</p>
```

### Modal with i18n
```tsx
<div className="modal">
  <h2>{t('dashboard.addCustomToken')}</h2>
  <input placeholder={t('forms.required')} />
  <button>{t('common.cancel')}</button>
  <button>{t('common.save')}</button>
</div>
```

## 🧪 Testing

1. **Language Switch**: Click language selector in header
2. **Text Updates**: Verify text changes instantly
3. **Formatting**: Check dates/numbers in different locales
4. **RTL**: Switch to Arabic and check layout
5. **Mobile**: Test language selector on mobile sizes

## 📚 Files to Know

- **Config**: `src/i18n.ts`
- **Translations**: `src/translations/*.json`
- **Component**: `src/components/LanguageSwitcher.tsx`
- **Utilities**: `src/utils/localeFormatter.ts`
- **Guide**: `I18N_IMPLEMENTATION_GUIDE.md`
- **CSS**: See `html[dir="rtl"]` in `src/index.css`

## ⚡ Quick Build

```bash
cd frontend
npm run build
```

## 🐛 Troubleshooting

**Text not changing?**
- Check `useTranslation()` is imported and used
- Verify key exists in all translation files
- Check for typos in key name

**RTL not working?**
- Verify language is set to Arabic
- Check `document.documentElement.dir` in DevTools
- Look for RTL CSS rules in index.css

**Formatting wrong?**
- Check current locale with `i18n.language`
- Verify correct formatter function is used
- Check locale mapping in `localeFormatter.ts`

**Missing warning in console?**
- Key missing from translation file
- Add key to all language files (all 5)
- Format: `section.key` with consistent sections

## 🎯 Performance Tips

- Translations are cached in browser
- Language change is instant (no page reload needed)
- Lazy loading supported but not required
- RTL CSS handled efficiently

## 🚀 Next Steps

1. Review `I18N_IMPLEMENTATION_GUIDE.md` for details
2. Check `src/app/dashboard/Overview.tsx` for example
3. Convert other components using this reference
4. Test all languages & screen sizes
5. Deploy with confidence!

---

For detailed documentation, see `I18N_IMPLEMENTATION_GUIDE.md`
