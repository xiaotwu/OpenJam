interface DragCreatePreviewProps {
  start: { x: number; y: number };
  end: { x: number; y: number };
  tool: string;
  shapeType?: string;
}

export default function DragCreatePreview({ start, end, tool, shapeType }: DragCreatePreviewProps) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  let width = Math.abs(end.x - start.x);
  let height = Math.abs(end.y - start.y);

  // Circle enforces 1:1 aspect ratio
  if (tool === 'shape' && shapeType === 'circle') {
    const size = Math.max(width, height);
    width = size;
    height = size;
  }

  // Connector: draw a line preview, no bounding box
  if (tool === 'connector') {
    const svgLeft = Math.min(start.x, end.x) - 5;
    const svgTop = Math.min(start.y, end.y) - 5;
    const svgWidth = Math.abs(end.x - start.x) + 10;
    const svgHeight = Math.abs(end.y - start.y) + 10;

    return (
      <svg
        className="absolute pointer-events-none"
        style={{ left: svgLeft, top: svgTop, width: svgWidth, height: svgHeight }}
      >
        <line
          x1={start.x - svgLeft}
          y1={start.y - svgTop}
          x2={end.x - svgLeft}
          y2={end.y - svgTop}
          stroke="#3B82F6"
          strokeWidth={2}
          strokeDasharray="6,4"
        />
        {/* End dot */}
        <circle cx={end.x - svgLeft} cy={end.y - svgTop} r={4} fill="#3B82F6" />
      </svg>
    );
  }

  // Shape: draw the actual shape outline
  if (tool === 'shape' && width > 2 && height > 2) {
    return (
      <svg
        className="absolute pointer-events-none"
        style={{ left, top, width, height, overflow: 'visible' }}
      >
        {renderShapePreview(shapeType || 'rectangle', width, height)}
      </svg>
    );
  }

  // Sticky: show a colored shadow of the note
  if (tool === 'sticky') {
    const size = Math.max(width, height, 20);
    return (
      <div
        className="absolute pointer-events-none rounded-lg"
        style={{
          left,
          top,
          width: size,
          height: size,
          background: 'rgba(252, 211, 77, 0.2)',
          border: '2px dashed #FCD34D',
        }}
      />
    );
  }

  // Text: show text area outline
  if (tool === 'text') {
    return (
      <div
        className="absolute pointer-events-none"
        style={{
          left,
          top,
          width: Math.max(width, 20),
          height: Math.max(height, 20),
          border: '2px dashed #3B82F6',
          borderRadius: 4,
          background: 'rgba(59, 130, 246, 0.05)',
        }}
      />
    );
  }

  // Frame: dashed rectangle
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left,
        top,
        width: Math.max(width, 20),
        height: Math.max(height, 20),
        border: '2px dashed #6B7280',
        borderRadius: 8,
        background: 'rgba(107, 114, 128, 0.05)',
      }}
    />
  );
}

function renderShapePreview(shapeType: string, w: number, h: number) {
  const strokeProps = {
    fill: 'rgba(107, 114, 128, 0.08)',
    stroke: '#6B7280',
    strokeWidth: 2,
    strokeDasharray: '6,4',
  };

  switch (shapeType) {
    case 'circle':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} {...strokeProps} />;
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} {...strokeProps} />;
    case 'rounded-rectangle':
      return <rect x={1} y={1} width={w - 2} height={h - 2} rx={12} {...strokeProps} />;
    case 'diamond':
      return <polygon points={`${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`} {...strokeProps} />;
    case 'triangle':
      return <polygon points={`${w / 2},1 ${w - 1},${h - 1} 1,${h - 1}`} {...strokeProps} />;
    case 'hexagon': {
      const cx = w / 2, cy = h / 2;
      const rx = w / 2 - 1, ry = h / 2 - 1;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        return `${cx + rx * Math.cos(angle)},${cy + ry * Math.sin(angle)}`;
      }).join(' ');
      return <polygon points={pts} {...strokeProps} />;
    }
    case 'star': {
      const cx = w / 2, cy = h / 2;
      const outerR = Math.min(w, h) / 2 - 1;
      const innerR = outerR * 0.4;
      const pts = Array.from({ length: 10 }, (_, i) => {
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
      }).join(' ');
      return <polygon points={pts} {...strokeProps} />;
    }
    case 'parallelogram': {
      const offset = w * 0.2;
      return <polygon points={`${offset},1 ${w - 1},1 ${w - offset},${h - 1} 1,${h - 1}`} {...strokeProps} />;
    }
    case 'rectangle':
    default:
      return <rect x={1} y={1} width={w - 2} height={h - 2} {...strokeProps} />;
  }
}
