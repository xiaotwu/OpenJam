import { useState, useCallback, type RefObject } from 'react';
import type { ElementStore } from '../../../lib/elementStore';

interface UseDragMoveOptions {
  elementStoreRef: RefObject<ElementStore>;
}

export function useDragMove({ elementStoreRef }: UseDragMoveOptions) {
  const [dragMoveStart, setDragMoveStart] = useState<{ x: number; y: number } | null>(null);
  const [dragMoveElementId, setDragMoveElementId] = useState<string | null>(null);
  const [dragMoveInitialPos, setDragMoveInitialPos] = useState<{ x: number; y: number } | null>(null);

  const startDragMove = useCallback((canvasPoint: { x: number; y: number }, elementId: string, elementPos: { x: number; y: number }) => {
    setDragMoveStart(canvasPoint);
    setDragMoveElementId(elementId);
    setDragMoveInitialPos(elementPos);
  }, []);

  const updateDragMove = useCallback((canvasPoint: { x: number; y: number }) => {
    if (!dragMoveStart || !dragMoveElementId || !dragMoveInitialPos) return;
    const dx = canvasPoint.x - dragMoveStart.x;
    const dy = canvasPoint.y - dragMoveStart.y;
    elementStoreRef.current.moveElement(dragMoveElementId, dragMoveInitialPos.x + dx, dragMoveInitialPos.y + dy);
  }, [dragMoveStart, dragMoveElementId, dragMoveInitialPos, elementStoreRef]);

  const endDragMove = useCallback(() => {
    setDragMoveStart(null);
    setDragMoveElementId(null);
    setDragMoveInitialPos(null);
  }, []);

  return { dragMoveStart, startDragMove, updateDragMove, endDragMove };
}
