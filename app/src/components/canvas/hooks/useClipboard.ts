import { useState, useCallback } from 'react';
import { generateElementId, type Element } from '../../../lib/elements';
import type { Stamp } from '../../StampTool';
import { copyBoardElements, movementSelection, resolveConnector } from '../boardObjects';

interface ClipboardContent { elements: Element[]; stamps: Stamp[] }

interface UseClipboardOptions {
  elements: Element[];
  stamps: Stamp[];
  selectedIds: Set<string>;
  currentPageId?: string;
  userId: string;
  insertCopies: (elements: Element[], stamps: Stamp[]) => void;
  onDelete: () => void;
}

export function useClipboard({ elements, stamps, selectedIds, currentPageId, userId, insertCopies, onDelete }: UseClipboardOptions) {
  const [clipboard, setClipboard] = useState<ClipboardContent>({ elements: [], stamps: [] });

  const getSelection = useCallback((): ClipboardContent => {
    const byId = new Map(elements.map(element => [element.id, element]));
    return {
      elements: movementSelection(elements, selectedIds).map(element => resolveConnector(element, byId)),
      stamps: stamps.filter(stamp => selectedIds.has(stamp.id)),
    };
  }, [elements, selectedIds, stamps]);

  const paste = useCallback((content: ClipboardContent) => {
    const offset = 24;
    const topLayer = elements.reduce((max, element) => Math.max(max, element.zIndex || 0), 0);
    const copies = copyBoardElements(content.elements, { userId, pageId: currentPageId, offset, firstZIndex: topLayer + 1 });
    const copiedStamps = content.stamps.map(stamp => ({
      ...stamp, id: generateElementId(), x: stamp.x + offset, y: stamp.y + offset,
      userId, createdAt: Date.now(), ...(currentPageId ? { pageId: currentPageId } : {}),
    }));
    insertCopies(copies, copiedStamps);
  }, [currentPageId, elements, insertCopies, userId]);

  const duplicateSelected = useCallback(() => paste(getSelection()), [getSelection, paste]);
  const copySelected = useCallback(() => setClipboard(getSelection()), [getSelection]);
  const cutSelected = useCallback(() => { setClipboard(getSelection()); onDelete(); }, [getSelection, onDelete]);
  const pasteElements = useCallback(() => paste(clipboard), [clipboard, paste]);

  return { hasClipboard: clipboard.elements.length > 0 || clipboard.stamps.length > 0, duplicateSelected, copySelected, cutSelected, pasteElements };
}
