import { useState, useCallback, type RefObject } from 'react';
import { createDefaultElement, type ConnectorElement, type Element } from '../../../lib/elements';
import type { ElementStore } from '../../../lib/elementStore';
import type { StickyColor, ToolType } from '../../BottomToolbar';
import type { Bounds, Point } from '../boardObjects';

interface UseDragCreateOptions {
  elementStoreRef: RefObject<ElementStore>;
  toolOptions: {
    fontSize: number;
    stickyColor: StickyColor;
    stickyShape: 'square' | 'rounded' | 'circle';
    shapeType: string;
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
    connectorStyle: string;
    arrowStart: string;
    arrowEnd: string;
  };
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  setCurrentTool: React.Dispatch<React.SetStateAction<ToolType>>;
}

interface CreationContext {
  getAnchor: (point: Point) => { id: string; name: NonNullable<ConnectorElement['startAnchor']>; point: Point } | undefined;
  getFrameChildren: (bounds: Bounds) => string[];
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

  const cancelDragCreate = useCallback(() => {
    setDragCreateStart(null);
    setDragCreateEnd(null);
    setDragCreateTool(null);
  }, []);

  const endDragCreate = useCallback(({ getAnchor, getFrameChildren }: CreationContext) => {
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
        color: toolOptions.stickyColor,
        stickyShape: toolOptions.stickyShape,
      } as Partial<Element>);
      setSelectedIds(new Set([op.element.id]));
      setEditingId(op.element.id);
    } else if (dragCreateTool === 'shape') {
      let shapeW = isDragged ? Math.max(50, width) : 100;
      let shapeH = isDragged ? Math.max(50, height) : 100;

      // Circle enforces 1:1 aspect ratio
      if (toolOptions.shapeType === 'circle') {
        const size = Math.max(shapeW, shapeH);
        shapeW = size;
        shapeH = size;
      }

      op = elementStoreRef.current.addElement('shape', isDragged ? minX : dragCreateStart.x, isDragged ? minY : dragCreateStart.y, {
        width: shapeW,
        height: shapeH,
        shapeType: toolOptions.shapeType,
        fill: toolOptions.fillColor,
        stroke: toolOptions.strokeColor,
        strokeWidth: toolOptions.strokeWidth,
      } as Partial<Element>);
      setSelectedIds(new Set([op.element.id]));
    } else if (dragCreateTool === 'connector') {
      const start = getAnchor(dragCreateStart);
      const finish = isDragged ? getAnchor(dragCreateEnd) : undefined;
      const end = finish?.id !== start?.id ? finish : undefined;
      op = elementStoreRef.current.addElement('connector', dragCreateStart.x, dragCreateStart.y, {
        startPoint: start?.point ?? dragCreateStart,
        endPoint: end?.point ?? (isDragged ? dragCreateEnd : { x: dragCreateStart.x + 100, y: dragCreateStart.y }),
        startElementId: start?.id,
        startAnchor: start?.name,
        endElementId: end?.id,
        endAnchor: end?.name,
        style: toolOptions.connectorStyle || 'straight',
        startArrow: toolOptions.arrowStart || 'none',
        endArrow: toolOptions.arrowEnd === 'dot' ? 'circle' : toolOptions.arrowEnd || 'arrow',
        stroke: toolOptions.strokeColor,
        strokeWidth: toolOptions.strokeWidth,
      } as Partial<Element>);
      setSelectedIds(new Set([op.element.id]));
    } else if (dragCreateTool === 'frame') {
      const left = isDragged ? minX : dragCreateStart.x;
      const top = isDragged ? minY : dragCreateStart.y;
      const frameWidth = isDragged ? Math.max(100, width) : 420;
      const frameHeight = isDragged ? Math.max(80, height) : 280;
      const store = elementStoreRef.current;
      const zIndex = store.getElements().reduce((min, element) => Math.min(min, element.zIndex || 0), 0) - 1;
      op = store.addElement({
        ...createDefaultElement('frame', left, top, store.getUserId()),
        type: 'frame', width: frameWidth, height: frameHeight, zIndex,
        name: 'Untitled section', backgroundColor: 'transparent', showName: true,
        childIds: isDragged ? getFrameChildren({ left, top, right: left + frameWidth, bottom: top + frameHeight }) : [],
      });
      setSelectedIds(new Set([op.element.id]));
    }

    cancelDragCreate();
    setCurrentTool('select');
  }, [dragCreateStart, dragCreateEnd, dragCreateTool, elementStoreRef, toolOptions, setSelectedIds, setEditingId, setCurrentTool, cancelDragCreate]);

  return { dragCreateStart, dragCreateEnd, dragCreateTool, startDragCreate, updateDragCreate, endDragCreate, cancelDragCreate };
}
