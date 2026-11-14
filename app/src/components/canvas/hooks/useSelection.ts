import { useState, useCallback } from 'react';
import type { Element } from '../../../lib/elements';
import type { Stamp } from '../../StampTool';
import { selectionGroup, withinBounds, type Bounds } from '../boardObjects';

interface SelectionBox {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

interface UseSelectionOptions {
  elements: Element[];
  stamps: Stamp[];
  objectBounds: ReadonlyMap<string, Bounds>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useSelection({ elements, stamps, objectBounds, setSelectedIds }: UseSelectionOptions) {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  const handleSelect = useCallback((id: string, addToSelection: boolean) => {
    setSelectedIds((prev) => {
      const group = selectionGroup(elements, id);
      if (!addToSelection && group.every(member => prev.has(member))) return prev;
      const newSelection = new Set(addToSelection ? prev : []);
      const remove = addToSelection && newSelection.has(id);
      group.forEach(member => { if (remove) newSelection.delete(member); else newSelection.add(member); });
      return newSelection;
    });
  }, [elements, setSelectedIds]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set([...elements, ...stamps].map(item => item.id)));
  }, [elements, stamps, setSelectedIds]);

  // Compute elements inside the selection box
  const getSelectedFromBox = useCallback((box: SelectionBox): Set<string> => {
    const minX = Math.min(box.start.x, box.end.x);
    const maxX = Math.max(box.start.x, box.end.x);
    const minY = Math.min(box.start.y, box.end.y);
    const maxY = Math.max(box.start.y, box.end.y);

    const outer = { left: minX, right: maxX, top: minY, bottom: maxY };
    const ids = new Set<string>();
    const groups = new Set<string>();
    for (const el of elements) {
      const bounds = objectBounds.get(el.id);
      if (!bounds || !withinBounds(outer, bounds)) continue;
      ids.add(el.id);
      if (el.groupId) groups.add(el.groupId);
    }
    if (groups.size) elements.forEach(element => { if (element.groupId && groups.has(element.groupId)) ids.add(element.id); });
    stamps.forEach(stamp => { if (stamp.x >= minX && stamp.x <= maxX && stamp.y >= minY && stamp.y <= maxY) ids.add(stamp.id); });
    return ids;
  }, [elements, objectBounds, stamps]);

  return { selectionBox, setSelectionBox, handleSelect, selectAll, getSelectedFromBox };
}
