interface DrawingPreviewProps {
  drawingPath: { x: number; y: number }[];
  isMarker: boolean;
  strokeWidth: number;
  strokeColor: string;
}

export default function DrawingPreview({ drawingPath, isMarker, strokeWidth, strokeColor }: DrawingPreviewProps) {
  const previewStrokeWidth = isMarker ? Math.max(strokeWidth * 3, 12) : strokeWidth;
  const previewStrokeColor = isMarker ? strokeColor + '80' : strokeColor;

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
        d={drawingPath.reduce((path, point, i) => {
          if (i === 0) return `M ${point.x} ${point.y}`;
          return `${path} L ${point.x} ${point.y}`;
        }, '')}
        fill="none"
        stroke={previewStrokeColor}
        strokeWidth={previewStrokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
