// Connector/Arrow Component
import { useMemo } from 'react';
import type { ConnectorElement, ArrowHead } from '../../lib/elements';

interface ConnectorProps {
  element: ConnectorElement;
  isSelected: boolean;
  scale: number;
  onSelect: (id: string, addToSelection: boolean) => void;
  onUpdate: (id: string, changes: Partial<ConnectorElement>) => void;
}

export default function Connector({
  element,
  isSelected,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scale: _scale,
  onSelect,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onUpdate: _onUpdate,
}: ConnectorProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(element.id, e.shiftKey);
  };

  // Calculate SVG bounds
  const bounds = useMemo(() => {
    const { startPoint, endPoint, controlPoints } = element;
    const points = [startPoint, endPoint, ...(controlPoints || [])];
    
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    
    const minX = Math.min(...xs) - 20;
    const minY = Math.min(...ys) - 20;
    const maxX = Math.max(...xs) + 20;
    const maxY = Math.max(...ys) + 20;
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [element]);

  // Generate path based on connector style
  const pathD = useMemo(() => {
    const { startPoint, endPoint, style, controlPoints } = element;
    const start = { x: startPoint.x - bounds.x, y: startPoint.y - bounds.y };
    const end = { x: endPoint.x - bounds.x, y: endPoint.y - bounds.y };

    switch (style) {
      case 'straight':
        return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
      
      case 'elbow': {
        const midX = (start.x + end.x) / 2;
        return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
      }
      
      case 'curved': {
        if (controlPoints && controlPoints.length > 0) {
          const cp = controlPoints.map(p => ({ x: p.x - bounds.x, y: p.y - bounds.y }));
          if (cp.length === 1) {
            return `M ${start.x} ${start.y} Q ${cp[0].x} ${cp[0].y} ${end.x} ${end.y}`;
          } else {
            return `M ${start.x} ${start.y} C ${cp[0].x} ${cp[0].y} ${cp[1]?.x || cp[0].x} ${cp[1]?.y || cp[0].y} ${end.x} ${end.y}`;
          }
        } else {
          // Auto-generate control point
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const cpX = midX - dy * 0.3;
          const cpY = midY + dx * 0.3;
          return `M ${start.x} ${start.y} Q ${cpX} ${cpY} ${end.x} ${end.y}`;
        }
      }
      
      default:
        return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    }
  }, [element, bounds]);

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: element.zIndex,
        opacity: element.opacity,
      }}
    >
      <svg
        width={bounds.width}
        height={bounds.height}
        className="overflow-visible pointer-events-auto cursor-pointer"
        onClick={handleClick}
      >
        {/* Arrow head markers */}
        <defs>
          <marker
            id={`arrow-${element.id}`}
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L9,3 z" fill={element.stroke} />
          </marker>
          <marker
            id={`circle-${element.id}`}
            markerWidth="8"
            markerHeight="8"
            refX="4"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <circle cx="4" cy="4" r="3" fill={element.stroke} />
          </marker>
          <marker
            id={`diamond-${element.id}`}
            markerWidth="10"
            markerHeight="10"
            refX="5"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,5 L5,0 L10,5 L5,10 z" fill={element.stroke} />
          </marker>
        </defs>

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

        {/* Main line */}
        <path
          d={pathD}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          markerStart={getMarkerUrl(element.startArrow, element.id)}
          markerEnd={getMarkerUrl(element.endArrow, element.id)}
        />

        {/* Selection handles */}
        {isSelected && (
          <>
            <circle
              cx={element.startPoint.x - bounds.x}
              cy={element.startPoint.y - bounds.y}
              r={6}
              fill="white"
              stroke="#3B82F6"
              strokeWidth={2}
              className="cursor-move"
            />
            <circle
              cx={element.endPoint.x - bounds.x}
              cy={element.endPoint.y - bounds.y}
              r={6}
              fill="white"
              stroke="#3B82F6"
              strokeWidth={2}
              className="cursor-move"
            />
          </>
        )}
      </svg>
    </div>
  );
}

function getMarkerUrl(arrowHead: ArrowHead, elementId: string): string {
  switch (arrowHead) {
    case 'arrow':
      return `url(#arrow-${elementId})`;
    case 'circle':
      return `url(#circle-${elementId})`;
    case 'diamond':
      return `url(#diamond-${elementId})`;
    default:
      return '';
  }
}

// Connector style picker
interface ConnectorStylePickerProps {
  currentStyle: ConnectorElement['style'];
  currentStartArrow: ArrowHead;
  currentEndArrow: ArrowHead;
  onStyleChange: (style: ConnectorElement['style']) => void;
  onStartArrowChange: (arrow: ArrowHead) => void;
  onEndArrowChange: (arrow: ArrowHead) => void;
}

export function ConnectorStylePicker({
  currentStyle,
  currentStartArrow,
  currentEndArrow,
  onStyleChange,
  onStartArrowChange,
  onEndArrowChange,
}: ConnectorStylePickerProps) {
  const styles: { value: ConnectorElement['style']; label: string; icon: string }[] = [
    { value: 'straight', label: 'Straight', icon: '—' },
    { value: 'elbow', label: 'Elbow', icon: '⌐' },
    { value: 'curved', label: 'Curved', icon: '~' },
  ];

  const arrows: { value: ArrowHead; label: string; icon: string }[] = [
    { value: 'none', label: 'None', icon: '—' },
    { value: 'arrow', label: 'Arrow', icon: '→' },
    { value: 'circle', label: 'Circle', icon: '●' },
    { value: 'diamond', label: 'Diamond', icon: '◆' },
  ];

  return (
    <div className="flex flex-col gap-2 p-2 bg-white rounded-lg shadow-lg border">
      {/* Line style */}
      <div className="flex gap-1">
        {styles.map(({ value, label, icon }) => (
          <button
            key={value}
            onClick={() => onStyleChange(value)}
            className={`w-10 h-8 flex items-center justify-center rounded text-lg ${
              currentStyle === value ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'
            }`}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className="h-px bg-gray-200" />

      {/* Start arrow */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 w-10">Start:</span>
        <div className="flex gap-1">
          {arrows.map(({ value, label, icon }) => (
            <button
              key={value}
              onClick={() => onStartArrowChange(value)}
              className={`w-8 h-6 flex items-center justify-center rounded text-sm ${
                currentStartArrow === value ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'
              }`}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* End arrow */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 w-10">End:</span>
        <div className="flex gap-1">
          {arrows.map(({ value, label, icon }) => (
            <button
              key={value}
              onClick={() => onEndArrowChange(value)}
              className={`w-8 h-6 flex items-center justify-center rounded text-sm ${
                currentEndArrow === value ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'
              }`}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
