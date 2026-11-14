import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { adoptBrowserPreference } from './browserPreference';

export type InboxBadgeStyle = 'count' | 'dot' | 'hidden';
export interface Appearance {
  textSize: number;
  inboxBadge: InboxBadgeStyle;
}

const defaultAppearance: Appearance = { textSize: 14, inboxBadge: 'count' };
const preferenceEvent = 'shiori-appearance';
const devicePreferences = new Map<string, string>();

function read(key: string, earlierKey: string) {
  try {
    return devicePreferences.get(key) ?? localStorage.getItem(earlierKey) ?? localStorage.getItem(key) ?? '';
  } catch {
    return devicePreferences.get(key) ?? '';
  }
}

function parse(value: string): Appearance {
  try {
    const preference = JSON.parse(value);
    return {
      textSize: [13, 14, 15, 16, 17].includes(preference.textSize) ? preference.textSize : defaultAppearance.textSize,
      inboxBadge: ['count', 'dot', 'hidden'].includes(preference.inboxBadge) ? preference.inboxBadge : defaultAppearance.inboxBadge,
    };
  } catch {
    return defaultAppearance;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener(preferenceEvent, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(preferenceEvent, listener);
    window.removeEventListener('storage', listener);
  };
}

export function useAppearance(userId?: string) {
  const scope = userId ?? 'guest';
  const key = 'openjam:appearance:' + scope;
  const earlierKey = 'shiori:appearance:' + scope;
  const snapshot = useSyncExternalStore(subscribe, () => read(key, earlierKey));
  const appearance = useMemo(() => parse(snapshot), [snapshot]);

  useEffect(() => {
    try {
      adoptBrowserPreference(localStorage, key, earlierKey);
    } catch {
      // Keep reading any available setting when storage is read-only.
    }
  }, [key, earlierKey]);

  const updateAppearance = useCallback((changes: Partial<Appearance>) => {
    const next = JSON.stringify({ ...parse(read(key, earlierKey)), ...changes });
    try {
      localStorage.setItem(key, next);
      localStorage.removeItem(earlierKey);
      devicePreferences.delete(key);
    } catch {
      devicePreferences.set(key, next);
    }
    window.dispatchEvent(new Event(preferenceEvent));
  }, [key, earlierKey]);

  return { appearance, updateAppearance };
}
