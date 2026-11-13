import { useCallback, useMemo, useSyncExternalStore } from 'react';

export type InboxBadgeStyle = 'count' | 'dot' | 'hidden';
export interface Appearance {
  textSize: number;
  inboxBadge: InboxBadgeStyle;
}

const defaultAppearance: Appearance = { textSize: 14, inboxBadge: 'count' };
const preferenceEvent = 'shiori-appearance';
const devicePreferences = new Map<string, string>();

function read(key: string, previousKey: string) {
  try {
    return devicePreferences.get(key) ?? localStorage.getItem(key) ?? localStorage.getItem(previousKey) ?? '';
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
  const key = 'shiori:appearance:' + scope;
  const previousKey = 'openjam:appearance:' + scope;
  const snapshot = useSyncExternalStore(subscribe, () => read(key, previousKey));
  const appearance = useMemo(() => parse(snapshot), [snapshot]);

  const updateAppearance = useCallback((changes: Partial<Appearance>) => {
    const next = JSON.stringify({ ...parse(read(key, previousKey)), ...changes });
    try {
      localStorage.setItem(key, next);
      devicePreferences.delete(key);
    } catch {
      devicePreferences.set(key, next);
    }
    window.dispatchEvent(new Event(preferenceEvent));
  }, [key, previousKey]);

  return { appearance, updateAppearance };
}
