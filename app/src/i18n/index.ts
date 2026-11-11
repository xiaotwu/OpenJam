import { createContext, useContext } from 'react';
import { agent } from './agent';
import { agentIdentity } from './agentIdentity';
import { board } from './board';
import { files } from './files';
import { images } from './images';
import { review } from './review';
import { versions } from './versions';
import { workbench } from './workbench';

const english = { agent, agentIdentity, board, files, images, review, versions, workbench };
export type MessageCatalog = typeof english;

const catalogs = { en: english } satisfies Record<string, MessageCatalog>;
export type Locale = keyof typeof catalogs;
export const DEFAULT_LOCALE: Locale = 'en';

type DateStyle = 'date' | 'dateTime' | 'compact';

function createLocale(locale: Locale) {
  const dates: Record<DateStyle, Intl.DateTimeFormat> = {
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    dateTime: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    compact: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  };
  const numbers = new Intl.NumberFormat(locale);
  return {
    locale,
    messages: catalogs[locale] as MessageCatalog,
    formatDate(value: string | Date | number, style: DateStyle = 'dateTime') {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? '' : dates[style].format(date);
    },
    formatNumber(value: number) {
      return numbers.format(value);
    },
  };
}

export const localeValues = Object.fromEntries(
  (Object.keys(catalogs) as Locale[]).map(locale => [locale, createLocale(locale)]),
) as Record<Locale, ReturnType<typeof createLocale>>;

export const I18nContext = createContext(localeValues[DEFAULT_LOCALE]);

export function useI18n() {
  return useContext(I18nContext);
}
