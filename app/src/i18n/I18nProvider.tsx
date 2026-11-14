import { useEffect, type ReactNode } from 'react';
import { DEFAULT_LOCALE, I18nContext, localeValues, type Locale } from './index';

export default function I18nProvider({ children, locale = DEFAULT_LOCALE }: { children: ReactNode; locale?: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <I18nContext.Provider value={localeValues[locale]}>{children}</I18nContext.Provider>;
}
