import { useState, useCallback } from 'react';
import type { Element } from '../../../lib/elements';

interface SelectionBox {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

interface UseSelectionOptions {
  elements: Element[];
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useSelection({ elements, setSelectedIds }: UseSelectionOptions) {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  const handleSelect = useCallback((id: string, addToSelection: boolean) => {
    setSelectedIds((prev) => {
      const newSelection = new Set(addToSelection ? prev : []);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      return newSelection;
    });
  }, [setSelectedIds]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(elements.map((el) => el.id)));
  }, [elements, setSelectedIds]);

  // Compute elements inside the selection box
  const getSelectedFromBox = useCallback((box: SelectionBox): Set<string> => {
    const minX = Math.min(box.start.x, box.end.x);
    const maxX = Math.max(box.start.x, box.end.x);
    const minY = Math.min(box.start.y, box.end.y);
    const maxY = Math.max(box.start.y, box.end.y);

    const ids = new Set<string>();
    for (const el of elements) {
      const bounds = {
        left: el.x,
        right: el.x + (el.width || 100),
        top: el.y,
        bottom: el.y + (el.height || 100),
      };
      if (bounds.left >= minX && bounds.right <= maxX && bounds.top >= minY && bounds.bottom <= maxY) {
        ids.add(el.id);
      }
    }
    return ids;
  }, [elements]);

  return { selectionBox, setSelectionBox, handleSelect, selectAll, getSelectedFromBox };
}
