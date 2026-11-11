import { useState, useCallback, useRef, type RefObject } from 'react';
import { generateElementId, type Element } from '../../../lib/elements';
import type { ElementStore } from '../../../lib/elementStore';

type Point = { x: number; y: number };

function splitStrokeByKeptPoints(points: Point[], keepPoint: boolean[]): Point[][] {
  const segments: Point[][] = [];
  let currentSegment: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keepPoint[i]) {
      currentSegment.push(points[i]);
    } else {
      if (currentSegment.length) {
        segments.push(currentSegment);
      }
      currentSegment = [];
    }
  }

  if (currentSegment.length) {
    segments.push(currentSegment);
  }

  return segments;
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared ? ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared : 0;
  const ratio = Math.max(0, Math.min(1, projection));
  return Math.hypot(point.x - (from.x + ratio * dx), point.y - (from.y + ratio * dy));
}

function sampleStroke(points: Point[], step: number): Point[] {
  if (points.length < 2) return points;
  const result = [points[0]];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const divisions = Math.min(128, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
    for (let sample = 1; sample < divisions && result.length < 20_000 - (points.length - index); sample++) {
      const ratio = sample / divisions;
      result.push({ x: from.x + ratio * (to.x - from.x), y: from.y + ratio * (to.y - from.y) });
    }
    result.push(to);
  }
  return result;
}

interface UseEraserOptions {
  elementStoreRef: RefObject<ElementStore>;
  editStroke: (edit: () => void) => void;
  toolOptions: {
    eraserMode: 'stroke' | 'pixel';
    eraserSize: number;
  };
}

export function useEraser({ elementStoreRef, toolOptions, editStroke }: UseEraserOptions) {
  const [isErasing, setIsErasing] = useState(false);
  const [eraserPosition, setEraserPosition] = useState<Point | null>(null);
  const previousPoint = useRef<Point | null>(null);

  const eraseAlong = useCallback((path: Point[], elements: Element[]) => {
    const eraserRadius = toolOptions.eraserSize / 2;
    const store = elementStoreRef.current;
    const left = Math.min(...path.map(point => point.x));
    const right = Math.max(...path.map(point => point.x));
    const top = Math.min(...path.map(point => point.y));
    const bottom = Math.max(...path.map(point => point.y));
    for (const element of elements) {
      const drawing = store.getElementById(element.id);
      if (drawing?.type !== 'drawing' || drawing.locked || !drawing.points.length) continue;
      const radius = eraserRadius + drawing.strokeWidth / 2;
      const touches = (point: Point) => {
        const world = { x: drawing.x + point.x, y: drawing.y + point.y };
        if (world.x < left - radius || world.x > right + radius || world.y < top - radius || world.y > bottom + radius) return false;
        return path.some((to, index) => distanceToSegment(world, path[Math.max(0, index - 1)], to) <= radius);
      };
      const points = sampleStroke(drawing.points, Math.max(1, radius / 2));
      if (toolOptions.eraserMode === 'stroke') {
        if (points.some(touches)) store.deleteElement(drawing.id);
        continue;
      }
      const keep = points.map(point => !touches(point));
      if (keep.every(Boolean)) continue;
      const segments = splitStrokeByKeptPoints(points, keep);
      editStroke(() => {
        if (!store.deleteElement(drawing.id)) return;
        const now = Date.now();
        for (const fragment of segments) {
          store.addElement({ ...drawing, id: generateElementId(), points: fragment, createdBy: store.getUserId(), createdAt: now, updatedAt: now });
        }
      });
    }
  }, [toolOptions.eraserMode, toolOptions.eraserSize, elementStoreRef, editStroke]);

  const startErasing = useCallback((point: Point, elements: Element[]) => {
    previousPoint.current = point;
    setEraserPosition(point);
    setIsErasing(true);
    eraseAlong([point], elements);
  }, [eraseAlong]);

  const continueErasing = useCallback((points: Point[], elements: Element[]) => {
    if (!previousPoint.current || !points.length) return;
    eraseAlong([previousPoint.current, ...points], elements);
    previousPoint.current = points[points.length - 1];
  }, [eraseAlong]);

  const endErasing = useCallback(() => {
    previousPoint.current = null;
    setIsErasing(false);
  }, []);

  return { isErasing, eraserPosition, setEraserPosition, startErasing, continueErasing, endErasing };
}
