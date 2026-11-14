import { useState, useCallback, useRef, type RefObject } from 'react';
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

type Point = { x: number; y: number };
const MAX_POINTS = 20_000;

function appendPoints(path: Point[], points: Point[]) {
  for (const point of points) {
    const last = path.at(-1);
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.6) continue;
    if (path.length >= MAX_POINTS) {
      let kept = 1;
      for (let index = 2; index < path.length; index += 2) path[kept++] = path[index];
      path.length = kept;
    }
    path.push(point);
  }
}

export function useDrawing({ elementStoreRef, currentTool, toolOptions }: UseDrawingOptions) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPath, setDrawingPath] = useState<Point[]>([]);
  const activePath = useRef<Point[] | null>(null);

  const startDrawing = useCallback((point: Point) => {
    activePath.current = [point];
    setIsDrawing(true);
    setDrawingPath([point]);
  }, []);

  const continueDrawing = useCallback((points: Point[]) => {
    const path = activePath.current;
    if (!path) return;
    appendPoints(path, points);
    setDrawingPath([...path]);
  }, []);

  const cancelDrawing = useCallback(() => {
    activePath.current = null;
    setIsDrawing(false);
    setDrawingPath([]);
  }, []);

  const endDrawing = useCallback((point?: Point) => {
    const path = activePath.current;
    if (path?.length) {
      if (point) appendPoints(path, [point]);
      const origin = path[0];
      const isMarker = currentTool === 'marker';
      const strokeWidth = isMarker ? Math.max(toolOptions.strokeWidth * 3, 12) : toolOptions.strokeWidth;
      const strokeColor = isMarker ? toolOptions.strokeColor + '80' : toolOptions.strokeColor;

      elementStoreRef.current.addElement('drawing', origin.x, origin.y, {
        points: path.map((p) => ({ x: Math.round((p.x - origin.x) * 100) / 100, y: Math.round((p.y - origin.y) * 100) / 100 })),
        stroke: strokeColor,
        strokeWidth: strokeWidth,
      } as Partial<Element>);
    }
    cancelDrawing();
  }, [currentTool, toolOptions.strokeWidth, toolOptions.strokeColor, elementStoreRef, cancelDrawing]);

  return { isDrawing, drawingPath, startDrawing, continueDrawing, endDrawing, cancelDrawing };
}
