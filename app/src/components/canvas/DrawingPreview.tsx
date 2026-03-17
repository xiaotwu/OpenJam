import { useMemo } from 'react';
import { getStrokePath, getPenOptions, getMarkerOptions } from '../../lib/strokeUtils';

interface DrawingPreviewProps {
  drawingPath: { x: number; y: number }[];
  isMarker: boolean;
  strokeWidth: number;
  strokeColor: string;
}

export default function DrawingPreview({ drawingPath, isMarker, strokeWidth, strokeColor }: DrawingPreviewProps) {
  const previewColor = isMarker ? strokeColor + '80' : strokeColor;

  const pathD = useMemo(() => {
    const options = isMarker ? getMarkerOptions(strokeWidth) : getPenOptions(strokeWidth);
    return getStrokePath(drawingPath, options);
  }, [drawingPath, isMarker, strokeWidth]);

  if (!pathD) return null;

  return (
    <svg
      className="absolute pointer-events-none"
      style={{
        left: 0,
        top: 0,
        width: '10000px',
        height: '10000px',
        overflow: 'visible',
      }}
    >
      <path
        d={pathD}
        fill={previewColor}
        stroke="none"
      />
    </svg>
  );
}
