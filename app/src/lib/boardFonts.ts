import { useEffect } from 'react';

export const boardFonts = [
  { label: 'IBM Plex Sans', family: 'IBM Plex Sans Variable' },
  { label: 'Inter', family: 'Inter Variable', load: () => import('@fontsource-variable/inter') },
  { label: 'DM Sans', family: 'DM Sans Variable', load: () => import('@fontsource-variable/dm-sans') },
  { label: 'Roboto', family: 'Roboto Variable', load: () => import('@fontsource-variable/roboto') },
  { label: 'Lora', family: 'Lora Variable', load: () => import('@fontsource-variable/lora') },
  { label: 'Space Mono', family: 'Space Mono', load: () => import('@fontsource/space-mono/latin-400.css') },
  { label: 'Geist', family: 'Geist Variable', load: () => import('@fontsource-variable/geist') },
] as const;

export function boardFontOption(value?: string) {
  const family = value?.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  return boardFonts.find(font => family === font.family.toLowerCase() || family === font.label.toLowerCase());
}

export function useBoardFont(value?: string) {
  const font = boardFontOption(value);
  useEffect(() => {
    if (font && 'load' in font) void font.load().catch(() => {});
  }, [font]);
  return font ? `"${font.family}", var(--font-ui)` : value || 'var(--font-ui)';
}
