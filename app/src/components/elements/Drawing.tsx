// Drawing/Path Component
import { useMemo } from 'react';
import type { DrawingElement } from '../../lib/elements';

interface DrawingProps {
  element: DrawingElement;
  isSelected: boolean;
  scale: number;
  onSelect: (id: string, addToSelection: boolean) => void;
}

export default function Drawing({
  element,
  isSelected,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scale: _scale,
  onSelect,
}: DrawingProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(element.id, e.shiftKey);
  };

  // Calculate bounding box from points (points are relative to element.x, element.y)
  const bounds = useMemo(() => {
    if (element.points.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const xs = element.points.map(p => p.x);
    const ys = element.points.map(p => p.y);
    
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    
    const padding = element.strokeWidth / 2 + 2;
    
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }, [element.points, element.strokeWidth]);

  // Generate smooth path from points
  const pathD = useMemo(() => {
    const points = element.points;
    if (points.length === 0) return '';
    if (points.length === 1) {
      const p = points[0];
      return `M ${p.x - bounds.x} ${p.y - bounds.y} L ${p.x - bounds.x + 0.1} ${p.y - bounds.y + 0.1}`;
    }

    // Use quadratic bezier curves for smooth lines
    let path = `M ${points[0].x - bounds.x} ${points[0].y - bounds.y}`;
    
    for (let i = 1; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      
      const midX = (p1.x + p2.x) / 2 - bounds.x;
      const midY = (p1.y + p2.y) / 2 - bounds.y;
      
      path += ` Q ${p1.x - bounds.x} ${p1.y - bounds.y} ${midX} ${midY}`;
    }
    
    // Last point
    const last = points[points.length - 1];
    path += ` L ${last.x - bounds.x} ${last.y - bounds.y}`;
    
    return path;
  }, [element.points, bounds]);

  if (element.points.length === 0) return null;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: element.x + bounds.x,
        top: element.y + bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: element.zIndex,
        opacity: element.opacity,
      }}
    >
      <svg
        width={bounds.width}
        height={bounds.height}
        className="overflow-visible pointer-events-auto"
        onClick={handleClick}
      >
        {/* Selection highlight */}
        {isSelected && (
          <path
            d={pathD}
            stroke="#3B82F6"
            strokeWidth={element.strokeWidth + 4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.3}
          />
        )}

        {/* Main path */}
        <path
          d={pathD}
          stroke={element.isEraser ? 'white' : element.stroke}
          strokeWidth={element.strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={element.isEraser ? { mixBlendMode: 'difference' } : undefined}
        />

        {/* Selection bounding box */}
        {isSelected && (
          <rect
            x={0}
            y={0}
            width={bounds.width}
            height={bounds.height}
            fill="none"
            stroke="#3B82F6"
            strokeWidth={1}
            strokeDasharray="4 2"
          />
        )}
      </svg>
    </div>
  );
}

// Pen settings panel
interface PenSettingsProps {
  currentColor: string;
  currentWidth: number;
  isEraser: boolean;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onEraserToggle: (isEraser: boolean) => void;
}

export function PenSettings({
  currentColor,
  currentWidth,
  isEraser,
  onColorChange,
  onWidthChange,
  onEraserToggle,
}: PenSettingsProps) {
  const colors = [
    '#1F2937', // dark gray
    '#EF4444', // red
    '#F97316', // orange
    '#EAB308', // yellow
    '#22C55E', // green
    '#06B6D4', // cyan
    '#3B82F6', // blue
    '#8B5CF6', // violet
    '#EC4899', // pink
  ];

  const widths = [2, 4, 6, 8, 12, 16];

  return (
    <div className="flex flex-col gap-2 p-2 bg-white rounded-lg shadow-lg border">
      {/* Pen/Eraser toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => onEraserToggle(false)}
          className={`flex-1 py-1 px-2 rounded text-sm ${
            !isEraser ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'
          }`}
        >
          ✏️ Pen
        </button>
        <button
          onClick={() => onEraserToggle(true)}
          className={`flex-1 py-1 px-2 rounded text-sm ${
            isEraser ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'
          }`}
        >
          🧹 Eraser
        </button>
      </div>

      <div className="h-px bg-gray-200" />

      {/* Colors */}
      {!isEraser && (
        <>
          <div className="flex gap-1 flex-wrap">
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => onColorChange(color)}
                className="w-6 h-6 rounded transition-transform hover:scale-110"
                style={{
                  backgroundColor: color,
                  border: currentColor === color ? '2px solid #3B82F6' : '1px solid #E5E7EB',
                }}
              />
            ))}
          </div>

          <div className="h-px bg-gray-200" />
        </>
      )}

      {/* Width */}
      <div className="flex gap-1 items-center">
        {widths.map((width) => (
          <button
            key={width}
            onClick={() => onWidthChange(width)}
            className={`w-8 h-8 flex items-center justify-center rounded ${
              currentWidth === width ? 'bg-blue-100' : 'hover:bg-gray-100'
            }`}
            title={`${width}px`}
          >
            <div
              className="rounded-full bg-current"
              style={{
                width: Math.min(width * 1.5, 20),
                height: Math.min(width * 1.5, 20),
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
