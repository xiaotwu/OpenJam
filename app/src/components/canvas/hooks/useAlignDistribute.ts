import { useCallback, type RefObject } from 'react';
import type { Element } from '../../../lib/elements';
import type { ElementStore } from '../../../lib/elementStore';

interface UseAlignDistributeOptions {
  elements: Element[];
  selectedIds: Set<string>;
  elementStoreRef: RefObject<ElementStore>;
  runElementBatch: (edit: () => void) => void;
}

export function useAlignDistribute({ elements, selectedIds, elementStoreRef, runElementBatch }: UseAlignDistributeOptions) {
  const getSelectedElements = useCallback(() => {
    return elements.filter(el => selectedIds.has(el.id) && !el.locked);
  }, [elements, selectedIds]);

  const alignLeft = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const minX = Math.min(...selected.map((el) => el.x));
    runElementBatch(() => selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, minX, el.y);
    }));
  }, [getSelectedElements, elementStoreRef, runElementBatch]);

  const alignCenter = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const minX = Math.min(...selected.map((el) => el.x));
    const maxX = Math.max(...selected.map((el) => el.x + el.width));
    const centerX = (minX + maxX) / 2;
    runElementBatch(() => selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, centerX - el.width / 2, el.y);
    }));
  }, [getSelectedElements, elementStoreRef, runElementBatch]);

  const alignRight = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const maxX = Math.max(...selected.map((el) => el.x + el.width));
    runElementBatch(() => selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, maxX - el.width, el.y);
    }));
  }, [getSelectedElements, elementStoreRef, runElementBatch]);

  const alignTop = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const minY = Math.min(...selected.map((el) => el.y));
    runElementBatch(() => selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, el.x, minY);
    }));
  }, [getSelectedElements, elementStoreRef, runElementBatch]);

  const alignMiddle = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const minY = Math.min(...selected.map((el) => el.y));
    const maxY = Math.max(...selected.map((el) => el.y + el.height));
    const centerY = (minY + maxY) / 2;
    runElementBatch(() => selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, el.x, centerY - el.height / 2);
    }));
  }, [getSelectedElements, elementStoreRef, runElementBatch]);

  const alignBottom = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const maxY = Math.max(...selected.map((el) => el.y + el.height));
    runElementBatch(() => selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, el.x, maxY - el.height);
    }));
  }, [getSelectedElements, elementStoreRef, runElementBatch]);

  const distributeHorizontally = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 3) return;
    const sorted = [...selected].sort((a, b) => a.x - b.x);
    const totalWidth = sorted.reduce((sum, el) => sum + el.width, 0);
    const minX = sorted[0].x;
    const maxX = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
    const spacing = (maxX - minX - totalWidth) / (sorted.length - 1);
    let currentX = minX;
    runElementBatch(() => sorted.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, currentX, el.y);
      currentX += el.width + spacing;
    }));
  }, [getSelectedElements, elementStoreRef, runElementBatch]);

  const distributeVertically = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 3) return;
    const sorted = [...selected].sort((a, b) => a.y - b.y);
    const totalHeight = sorted.reduce((sum, el) => sum + el.height, 0);
    const minY = sorted[0].y;
    const maxY = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
    const spacing = (maxY - minY - totalHeight) / (sorted.length - 1);
    let currentY = minY;
    runElementBatch(() => sorted.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, el.x, currentY);
      currentY += el.height + spacing;
    }));
  }, [getSelectedElements, elementStoreRef, runElementBatch]);

  return {
    getSelectedElements,
    alignLeft,
    alignCenter,
    alignRight,
    alignTop,
    alignMiddle,
    alignBottom,
    distributeHorizontally,
    distributeVertically,
  };
}
