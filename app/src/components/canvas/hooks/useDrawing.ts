import { useState, useCallback, type RefObject } from 'react';
import type { Element } from '../../../lib/elements';
import type { ElementStore } from '../../../lib/elementStore';

interface UseDrawingOptions {
  elementStoreRef: RefObject<ElementStore>;
  currentTool: string;
  toolOptions: {
    strokeColor: string;
    strokeWidth: number;
  };
}

export function useDrawing({ elementStoreRef, currentTool, toolOptions }: UseDrawingOptions) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPath, setDrawingPath] = useState<{ x: number; y: number }[]>([]);

  const startDrawing = useCallback((point: { x: number; y: number }) => {
    setIsDrawing(true);
    setDrawingPath([point]);
  }, []);

  const continueDrawing = useCallback((point: { x: number; y: number }) => {
    setDrawingPath((prev) => [...prev, point]);
  }, []);

  const endDrawing = useCallback(() => {
    if (drawingPath.length > 1) {
      const isMarker = currentTool === 'marker';
      const strokeWidth = isMarker ? Math.max(toolOptions.strokeWidth * 3, 12) : toolOptions.strokeWidth;
      const strokeColor = isMarker ? toolOptions.strokeColor + '80' : toolOptions.strokeColor;

      elementStoreRef.current.addElement('drawing', drawingPath[0].x, drawingPath[0].y, {
        points: drawingPath.map((p) => ({ x: p.x - drawingPath[0].x, y: p.y - drawingPath[0].y })),
        stroke: strokeColor,
        strokeWidth: strokeWidth,
      } as Partial<Element>);
    }
    setIsDrawing(false);
    setDrawingPath([]);
  }, [drawingPath, currentTool, toolOptions.strokeWidth, toolOptions.strokeColor, elementStoreRef]);

  return { isDrawing, drawingPath, startDrawing, continueDrawing, endDrawing };
}
