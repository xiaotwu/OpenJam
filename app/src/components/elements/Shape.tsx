// Shape Component
import { useMemo } from 'react';
import type { ShapeElement, ShapeType } from '../../lib/elements';

interface ShapeProps {
  element: ShapeElement;
  isSelected: boolean;
  isEditing: boolean;
  scale: number;
  onSelect: (id: string, addToSelection: boolean) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
  onUpdate: (id: string, changes: Partial<ShapeElement>) => void;
}

export default function Shape({
  element,
  isSelected,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isEditing: _isEditing,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scale: _scale,
  onSelect,
  onStartEdit,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onEndEdit: _onEndEdit,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onUpdate: _onUpdate,
}: ShapeProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(element.id, e.shiftKey);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!element.locked && element.text !== undefined) {
      onStartEdit(element.id);
    }
  };

  // Generate SVG path for different shapes
  const shapePath = useMemo(() => {
    const { width, height, shapeType } = element;
    return getShapePath(shapeType, width, height);
  }, [element]);

  return (
    <div
      className="absolute cursor-move select-none"
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        transform: `rotate(${element.rotation}deg)`,
        opacity: element.opacity,
        zIndex: element.zIndex,
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={element.width}
        height={element.height}
        viewBox={`0 0 ${element.width} ${element.height}`}
        className="overflow-visible"
      >
        <path
          d={shapePath}
          fill={element.fill}
          stroke={isSelected ? '#3B82F6' : element.stroke}
          strokeWidth={isSelected ? element.strokeWidth + 1 : element.strokeWidth}
        />
      </svg>

      {/* Text inside shape */}
      {element.text && (
        <div
          className="absolute inset-0 flex items-center justify-center p-2 overflow-hidden"
          style={{
            fontSize: element.fontSize || 14,
            color: getContrastColor(element.fill),
            textAlign: 'center',
            wordBreak: 'break-word',
          }}
        >
          {element.text}
        </div>
      )}

      {/* Selection outline */}
      {isSelected && (
        <>
          {/* Resize handles */}
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-nw-resize" />
          <div className="absolute -top-1 -right-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-ne-resize" />
          <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-sw-resize" />
          <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-se-resize" />
          {/* Mid-point handles */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-n-resize" />
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-s-resize" />
          <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-w-resize" />
          <div className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-e-resize" />
        </>
      )}

      {/* Lock indicator */}
      {element.locked && (
        <div className="absolute top-1 left-1 text-xs opacity-50">
          🔒
        </div>
      )}
    </div>
  );
}

// Generate SVG path for different shape types
function getShapePath(shapeType: ShapeType, width: number, height: number): string {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;

  switch (shapeType) {
    case 'rectangle':
      return `M 0 0 H ${width} V ${height} H 0 Z`;

    case 'rounded-rectangle': {
      const r = Math.min(width, height) * 0.1;
      return `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r} Q ${width} ${height} ${width - r} ${height} H ${r} Q 0 ${height} 0 ${height - r} V ${r} Q 0 0 ${r} 0`;
    }

    case 'circle':
    case 'ellipse':
      return `M ${cx} 0 A ${rx} ${ry} 0 1 1 ${cx} ${height} A ${rx} ${ry} 0 1 1 ${cx} 0`;

    case 'diamond':
      return `M ${cx} 0 L ${width} ${cy} L ${cx} ${height} L 0 ${cy} Z`;

    case 'triangle':
      return `M ${cx} 0 L ${width} ${height} L 0 ${height} Z`;

    case 'star': {
      const points = 5;
      const outerR = Math.min(rx, ry);
      const innerR = outerR * 0.4;
      let path = '';
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / points) * i - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        path += (i === 0 ? 'M' : 'L') + ` ${x} ${y} `;
      }
      return path + 'Z';
    }

    case 'hexagon': {
      const hexR = Math.min(rx, ry);
      let hexPath = '';
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + hexR * Math.cos(angle);
        const y = cy + hexR * Math.sin(angle);
        hexPath += (i === 0 ? 'M' : 'L') + ` ${x} ${y} `;
      }
      return hexPath + 'Z';
    }

    default:
      return `M 0 0 H ${width} V ${height} H 0 Z`;
  }
}

// Get contrasting text color
function getContrastColor(hexColor: string): string {
  if (hexColor === 'transparent' || !hexColor) return '#1F2937';
  
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  
  return brightness > 128 ? '#1F2937' : '#FFFFFF';
}

// Shape picker component
interface ShapePickerProps {
  currentShape: ShapeType;
  onShapeChange: (shape: ShapeType) => void;
}

export function ShapePicker({ currentShape, onShapeChange }: ShapePickerProps) {
  const shapes: { type: ShapeType; icon: string; label: string }[] = [
    { type: 'rectangle', icon: '▢', label: 'Rectangle' },
    { type: 'rounded-rectangle', icon: '▢', label: 'Rounded' },
    { type: 'circle', icon: '○', label: 'Circle' },
    { type: 'diamond', icon: '◇', label: 'Diamond' },
    { type: 'triangle', icon: '△', label: 'Triangle' },
    { type: 'star', icon: '☆', label: 'Star' },
    { type: 'hexagon', icon: '⬡', label: 'Hexagon' },
  ];

  return (
    <div className="grid grid-cols-4 gap-1 p-2 bg-white rounded-lg shadow-lg border">
      {shapes.map(({ type, icon, label }) => (
        <button
          key={type}
          onClick={() => onShapeChange(type)}
          className={`w-10 h-10 flex items-center justify-center rounded text-xl transition-colors ${
            currentShape === type 
              ? 'bg-blue-100 text-blue-600' 
              : 'hover:bg-gray-100'
          }`}
          title={label}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
