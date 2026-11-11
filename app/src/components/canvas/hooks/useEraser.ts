import { useState, useCallback, type RefObject } from 'react';
import type { Element, DrawingElement } from '../../../lib/elements';
import type { ElementStore } from '../../../lib/elementStore';

// Helper: splits a stroke into segments based on which points to keep
function splitStrokeByKeptPoints(
  points: { x: number; y: number }[],
  keepPoint: boolean[]
): { x: number; y: number }[][] {
  const segments: { x: number; y: number }[][] = [];
  let currentSegment: { x: number; y: number }[] = [];

  for (let i = 0; i < points.length; i++) {
    if (keepPoint[i]) {
      currentSegment.push(points[i]);
    } else {
      if (currentSegment.length >= 2) {
        segments.push(currentSegment);
      }
      currentSegment = [];
    }
  }

  if (currentSegment.length >= 2) {
    segments.push(currentSegment);
  }

  return segments;
}

interface UseEraserOptions {
  elementStoreRef: RefObject<ElementStore>;
  toolOptions: {
    eraserMode: 'stroke' | 'pixel';
    eraserSize: number;
  };
}

export function useEraser({ elementStoreRef, toolOptions }: UseEraserOptions) {
  const [isErasing, setIsErasing] = useState(false);
  const [eraserPosition, setEraserPosition] = useState<{ x: number; y: number } | null>(null);

  const eraseAtPoint = useCallback((canvasPoint: { x: number; y: number }, elements: Element[]) => {
    const eraserRadius = toolOptions.eraserSize / 2;

    if (toolOptions.eraserMode === 'stroke') {
      // Stroke mode: Delete entire drawing strokes when touched
      elements.forEach((el) => {
        if (el.type === 'drawing') {
          const drawing = el as DrawingElement;
          const isNearPath = drawing.points.some((point) => {
            const absX = drawing.x + point.x;
            const absY = drawing.y + point.y;
            const distance = Math.sqrt(
              Math.pow(canvasPoint.x - absX, 2) + Math.pow(canvasPoint.y - absY, 2)
            );
            return distance <= eraserRadius + drawing.strokeWidth / 2;
          });

          if (isNearPath) {
            elementStoreRef.current.deleteElement(el.id);
          }
        }
      });
    } else {
      // Pixel mode: Remove points from drawings that are touched
      elements.forEach((el) => {
        if (el.type === 'drawing') {
          const drawing = el as DrawingElement;
          const keepPoint = drawing.points.map((point) => {
            const absX = drawing.x + point.x;
            const absY = drawing.y + point.y;
            const distance = Math.sqrt(
              Math.pow(canvasPoint.x - absX, 2) + Math.pow(canvasPoint.y - absY, 2)
            );
            return distance > eraserRadius + drawing.strokeWidth / 2;
          });

          const keptCount = keepPoint.filter(Boolean).length;

          if (keptCount === 0) {
            elementStoreRef.current.deleteElement(el.id);
          } else if (keptCount !== drawing.points.length) {
            const segments = splitStrokeByKeptPoints(drawing.points, keepPoint);
            elementStoreRef.current.deleteElement(el.id);
            segments.forEach((segmentPoints) => {
              if (segmentPoints.length >= 2) {
                elementStoreRef.current.addElement('drawing', drawing.x, drawing.y, {
                  points: segmentPoints,
                  stroke: drawing.stroke,
                  strokeWidth: drawing.strokeWidth,
                  isEraser: drawing.isEraser,
                } as Partial<Element>);
              }
            });
          }
        }
      });
    }
  }, [toolOptions.eraserMode, toolOptions.eraserSize, elementStoreRef]);

  const startErasing = useCallback((canvasPoint: { x: number; y: number }, elements: Element[]) => {
    setIsErasing(true);
    eraseAtPoint(canvasPoint, elements);
  }, [eraseAtPoint]);

  const continueErasing = useCallback((canvasPoint: { x: number; y: number }, elements: Element[]) => {
    eraseAtPoint(canvasPoint, elements);
  }, [eraseAtPoint]);

  const endErasing = useCallback(() => {
    setIsErasing(false);
  }, []);

  return { isErasing, eraserPosition, setEraserPosition, startErasing, continueErasing, endErasing };
}
