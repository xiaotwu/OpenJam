import { useState, useCallback, useRef, type RefObject } from 'react';
import type { ElementStore } from '../../../lib/elementStore';

interface UseDragMoveOptions {
  elementStoreRef: RefObject<ElementStore>;
}

interface DragInfo {
  elementId: string;
  initialPos: { x: number; y: number };
}

export function useDragMove({ elementStoreRef }: UseDragMoveOptions) {
  const [dragMoveStart, setDragMoveStart] = useState<{ x: number; y: number } | null>(null);
  // Use ref for drag info to avoid stale closure issues during rapid mouse moves
  const dragInfoRef = useRef<DragInfo[]>([]);

  const startDragMove = useCallback((
    canvasPoint: { x: number; y: number },
    elementIds: string[],
    getElementPos: (id: string) => { x: number; y: number } | undefined,
  ) => {
    const infos: DragInfo[] = [];
    for (const id of elementIds) {
      const pos = getElementPos(id);
      if (pos) {
        infos.push({ elementId: id, initialPos: { x: pos.x, y: pos.y } });
      }
    }
    dragInfoRef.current = infos;
    setDragMoveStart(canvasPoint);
  }, []);

  // Legacy single-element API (backward compatible)
  const startDragMoveSingle = useCallback((
    canvasPoint: { x: number; y: number },
    elementId: string,
    elementPos: { x: number; y: number },
  ) => {
    dragInfoRef.current = [{ elementId, initialPos: { ...elementPos } }];
    setDragMoveStart(canvasPoint);
  }, []);

  const updateDragMove = useCallback((canvasPoint: { x: number; y: number }) => {
    if (!dragMoveStart || dragInfoRef.current.length === 0) return;
    const dx = canvasPoint.x - dragMoveStart.x;
    const dy = canvasPoint.y - dragMoveStart.y;
    for (const info of dragInfoRef.current) {
      elementStoreRef.current.moveElement(
        info.elementId,
        info.initialPos.x + dx,
        info.initialPos.y + dy,
      );
    }
  }, [dragMoveStart, elementStoreRef]);

  const endDragMove = useCallback(() => {
    dragInfoRef.current = [];
    setDragMoveStart(null);
  }, []);

  return { dragMoveStart, startDragMove, startDragMoveSingle, updateDragMove, endDragMove };
}
