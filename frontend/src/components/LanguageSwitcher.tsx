import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown } from 'lucide-react';

interface Language {
  code: string;
  name: string;
  direction: 'ltr' | 'rtl';
}

const languages: Language[] = [
  { code: 'en', name: 'English', direction: 'ltr' },
  { code: 'es', name: 'Español', direction: 'ltr' },
  { code: 'fr', name: 'Français', direction: 'ltr' },
  { code: 'ar', name: 'العربية', direction: 'rtl' },
  { code: 'zh', name: '中文', direction: 'ltr' },
];

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const currentLang = languages.find((lang) => lang.code === i18n.language) || languages[0];

  const handleLanguageChange = (langCode: string) => {
    const selectedLang = languages.find((lang) => lang.code === langCode);
    if (selectedLang) {
      i18n.changeLanguage(langCode); // detector caches to localStorage automatically
      setIsOpen(false);
    }
  };

  // Apply dir/lang attributes on mount and whenever the active language changes
  React.useEffect(() => {
    const lang = languages.find((l) => l.code === i18n.language) || languages[0];
    document.documentElement.dir = lang.direction;
    document.documentElement.lang = lang.code;
  }, [i18n.language]);

  return (
    <div className="relative inline-block">
      {/* Language Selector Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="
          flex items-center gap-2 px-3 py-2 rounded-lg
          bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600
          hover:bg-gray-50 dark:hover:bg-gray-700
          focus:outline-none focus:ring-2 focus:ring-blue-500
          transition-all duration-200
          text-sm font-medium text-gray-700 dark:text-gray-200
        "
        aria-label={t('language.selectLanguage')}
        title={t('language.selectLanguage')}
      >
        <Globe size={18} />
        <span className="hidden sm:inline">{currentLang.name}</span>
        <ChevronDown
          size={16}
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="
            absolute top-full mt-2 bg-white dark:bg-gray-800
            border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg
            z-50 min-w-[150px]
            left-0 sm:left-auto sm:right-0
          "
          role="menu"
        >
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              className={`
                w-full text-left px-4 py-2 text-sm
                hover:bg-blue-50 dark:hover:bg-gray-700
                transition-colors duration-150
                flex items-center gap-2
                ${
                  i18n.language === lang.code
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 font-semibold'
                    : 'text-gray-700 dark:text-gray-200'
                }
                first:rounded-t-lg last:rounded-b-lg
              `}
              role="menuitem"
              title={lang.name}
            >
              {lang.code === 'ar' && <span className="text-lg">🇸🇦</span>}
              {lang.code === 'zh' && <span className="text-lg">🇨🇳</span>}
              {lang.code === 'en' && <span className="text-lg">🇺🇸</span>}
              {lang.code === 'es' && <span className="text-lg">🇪🇸</span>}
              {lang.code === 'fr' && <span className="text-lg">🇫🇷</span>}
              {lang.name}
              {i18n.language === lang.code && (
                <span className="ml-auto">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LanguageSwitcher;
