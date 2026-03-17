import { useState, useCallback, type RefObject } from 'react';
import type { Element } from '../../../lib/elements';
import type { ElementStore } from '../../../lib/elementStore';
import type { ToolType } from '../../BottomToolbar';

interface UseDragCreateOptions {
  elementStoreRef: RefObject<ElementStore>;
  toolOptions: {
    fontSize: number;
    shapeType: string;
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
  };
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  setCurrentTool: React.Dispatch<React.SetStateAction<ToolType>>;
}

export function useDragCreate({ elementStoreRef, toolOptions, setSelectedIds, setEditingId, setCurrentTool }: UseDragCreateOptions) {
  const [dragCreateStart, setDragCreateStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCreateEnd, setDragCreateEnd] = useState<{ x: number; y: number } | null>(null);
  const [dragCreateTool, setDragCreateTool] = useState<string | null>(null);

  const startDragCreate = useCallback((point: { x: number; y: number }, tool: string) => {
    setDragCreateStart(point);
    setDragCreateEnd(point);
    setDragCreateTool(tool);
  }, []);

  const updateDragCreate = useCallback((point: { x: number; y: number }) => {
    setDragCreateEnd(point);
  }, []);

  const endDragCreate = useCallback(() => {
    if (!dragCreateStart || !dragCreateEnd || !dragCreateTool) return;

    const minX = Math.min(dragCreateStart.x, dragCreateEnd.x);
    const minY = Math.min(dragCreateStart.y, dragCreateEnd.y);
    const width = Math.abs(dragCreateEnd.x - dragCreateStart.x);
    const height = Math.abs(dragCreateEnd.y - dragCreateStart.y);
    const isDragged = width > 20 || height > 20;

    let op;

    if (dragCreateTool === 'text') {
      if (isDragged) {
        op = elementStoreRef.current.addElement('text', minX, minY, {
          width: Math.max(100, width),
          height: Math.max(40, height),
          fontSize: toolOptions.fontSize,
        } as Partial<Element>);
      } else {
        op = elementStoreRef.current.addElement('text', dragCreateStart.x, dragCreateStart.y, {
          fontSize: toolOptions.fontSize,
        } as Partial<Element>);
      }
      setSelectedIds(new Set([op.element.id]));
      setEditingId(op.element.id);
    } else if (dragCreateTool === 'sticky') {
      const size = isDragged ? Math.max(100, Math.max(width, height)) : 150;
      op = elementStoreRef.current.addElement('sticky', isDragged ? minX : dragCreateStart.x, isDragged ? minY : dragCreateStart.y, {
        width: size,
        height: size,
      } as Partial<Element>);
      setSelectedIds(new Set([op.element.id]));
      setEditingId(op.element.id);
    } else if (dragCreateTool === 'shape') {
      op = elementStoreRef.current.addElement('shape', isDragged ? minX : dragCreateStart.x, isDragged ? minY : dragCreateStart.y, {
        width: isDragged ? Math.max(50, width) : 100,
        height: isDragged ? Math.max(50, height) : 100,
        shapeType: toolOptions.shapeType,
        fill: toolOptions.fillColor,
        stroke: toolOptions.strokeColor,
        strokeWidth: toolOptions.strokeWidth,
      } as Partial<Element>);
      setSelectedIds(new Set([op.element.id]));
    } else if (dragCreateTool === 'connector') {
      op = elementStoreRef.current.addElement('connector', dragCreateStart.x, dragCreateStart.y, {
        endPoint: { x: isDragged ? dragCreateEnd.x : dragCreateStart.x + 100, y: isDragged ? dragCreateEnd.y : dragCreateStart.y },
      } as Partial<Element>);
      setSelectedIds(new Set([op.element.id]));
    }

    setDragCreateStart(null);
    setDragCreateEnd(null);
    setDragCreateTool(null);
    setCurrentTool('select');
  }, [dragCreateStart, dragCreateEnd, dragCreateTool, elementStoreRef, toolOptions, setSelectedIds, setEditingId, setCurrentTool]);

  return { dragCreateStart, dragCreateEnd, dragCreateTool, startDragCreate, updateDragCreate, endDragCreate };
}
