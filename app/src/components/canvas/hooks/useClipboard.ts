import { useState, useCallback, type RefObject } from 'react';
import type { Element } from '../../../lib/elements';
import type { ElementStore } from '../../../lib/elementStore';

interface UseClipboardOptions {
  elements: Element[];
  selectedIds: Set<string>;
  elementStoreRef: RefObject<ElementStore>;
  setSelectedIds: (ids: Set<string>) => void;
  onDelete: () => void;
}

export function useClipboard({ elements, selectedIds, elementStoreRef, setSelectedIds, onDelete }: UseClipboardOptions) {
  const [clipboard, setClipboard] = useState<Element[]>([]);

  const duplicateSelected = useCallback(() => {
    const newIds: string[] = [];
    selectedIds.forEach((id) => {
      const op = elementStoreRef.current.duplicateElement(id);
      if (op) {
        newIds.push(op.element.id);
      }
    });
    setSelectedIds(new Set(newIds));
  }, [selectedIds, elementStoreRef, setSelectedIds]);

  const copySelected = useCallback(() => {
    const selectedElements = elements.filter((el) => selectedIds.has(el.id));
    setClipboard(selectedElements);
  }, [elements, selectedIds]);

  const cutSelected = useCallback(() => {
    const selectedElements = elements.filter((el) => selectedIds.has(el.id));
    setClipboard(selectedElements);
    onDelete();
  }, [elements, selectedIds, onDelete]);

  const pasteElements = useCallback(() => {
    const newIds: string[] = [];
    clipboard.forEach((el) => {
      const op = elementStoreRef.current.addElement(el.type, el.x + 20, el.y + 20, el);
      newIds.push(op.element.id);
    });
    setSelectedIds(new Set(newIds));
  }, [clipboard, elementStoreRef, setSelectedIds]);

  return { clipboard, duplicateSelected, copySelected, cutSelected, pasteElements };
}
