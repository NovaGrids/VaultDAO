import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const RTL_LANGUAGES = ['ar'];

export function useDirection() {
  const { i18n } = useTranslation();
  const direction = RTL_LANGUAGES.includes(i18n.language) ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = i18n.language;
  }, [i18n.language, direction]);

  return direction;
}
