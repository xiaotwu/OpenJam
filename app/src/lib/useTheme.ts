import { useLayoutEffect, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark' | 'system';
const themeKey = 'shiori-theme';
const previousThemeKey = 'openjam-theme';
const preference = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
let deviceTheme: Theme | undefined;

function readTheme(): Theme {
  if (deviceTheme !== undefined) return deviceTheme;
  try {
    const stored = localStorage.getItem(themeKey) ?? localStorage.getItem(previousThemeKey);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Use the OS setting when browser storage is unavailable.
  }
  return 'system';
}

function notify() {
  listeners.forEach(listener => listener());
}

function storageChanged(event: StorageEvent) {
  if (event.key !== null && event.key !== themeKey && event.key !== previousThemeKey) return;
  deviceTheme = undefined;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    preference.addEventListener('change', notify);
    window.addEventListener('storage', storageChanged);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      preference.removeEventListener('change', notify);
      window.removeEventListener('storage', storageChanged);
    }
  };
}

function setTheme(theme: Theme) {
  try {
    localStorage.setItem(themeKey, theme);
    deviceTheme = undefined;
  } catch {
    deviceTheme = theme;
  }
  notify();
}

function themeSnapshot() {
  const theme = readTheme();
  return theme === 'system' ? (preference.matches ? 'system-dark' : 'system-light') : theme;
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, themeSnapshot);
  const theme = snapshot === 'light' || snapshot === 'dark' ? snapshot : 'system';
  const isDark = snapshot === 'dark' || snapshot === 'system-dark';

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.getElementById('shiori-favicon')?.setAttribute(
      'href', isDark ? '/icons/favicon-dark.png' : '/icons/favicon-light.png',
    );
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content', isDark ? '#1e1922' : '#f8f6f9',
    );
  }, [isDark]);

  return { theme, setTheme, isDark } as const;
}
