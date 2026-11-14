export interface BoardViewport {
  pageId: string;
  x: number;
  y: number;
  scale: number;
}

export type PresentationMessage = { active: true } & BoardViewport | { active: false };

export interface PresenterViewport extends BoardViewport {
  userId: string;
  lastUpdate: number;
}

export const PRESENTATION_TTL_MS = 6500;

export function readBoardViewport(value: Record<string, unknown>): BoardViewport | undefined {
  const { pageId, x, y, scale } = value;
  if (typeof pageId !== 'string' || pageId.trim() === '' || pageId.includes('\0') || pageId.length > 1024
    || typeof x !== 'number' || !(Math.abs(x) <= 1e8) || typeof y !== 'number' || !(Math.abs(y) <= 1e8)
    || typeof scale !== 'number' || !(scale >= 0.1 && scale <= 5)) return;
  return { pageId, x, y, scale };
}
