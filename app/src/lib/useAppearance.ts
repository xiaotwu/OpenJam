import { useCallback, useMemo, useSyncExternalStore } from 'react';

export type InboxBadgeStyle = 'count' | 'dot' | 'hidden';
export interface Appearance {
  textSize: number;
  inboxBadge: InboxBadgeStyle;
}

const defaultAppearance: Appearance = { textSize: 14, inboxBadge: 'count' };
const preferenceEvent = 'openjam-appearance';
const devicePreferences = new Map<string, string>();

function read(key: string) {
  try {
    return localStorage.getItem(key) ?? devicePreferences.get(key) ?? '';
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
  const key = 'openjam:appearance:' + (userId ?? 'guest');
  const snapshot = useSyncExternalStore(subscribe, () => read(key));
  const appearance = useMemo(() => parse(snapshot), [snapshot]);

  const updateAppearance = useCallback((changes: Partial<Appearance>) => {
    const next = JSON.stringify({ ...parse(read(key)), ...changes });
    devicePreferences.set(key, next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Keep the preference for this tab when browser storage is unavailable.
    }
    window.dispatchEvent(new Event(preferenceEvent));
  }, [key]);

  return { appearance, updateAppearance };
}
