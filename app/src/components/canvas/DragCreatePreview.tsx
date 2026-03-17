interface DragCreatePreviewProps {
  start: { x: number; y: number };
  end: { x: number; y: number };
  tool: string;
}

export default function DragCreatePreview({ start, end, tool }: DragCreatePreviewProps) {
  return (
    <div
      className={`absolute border-2 border-dashed pointer-events-none flex items-center justify-center ${
        tool === 'connector' ? 'bg-transparent' : 'bg-purple-500/10'
      }`}
      style={{
        left: Math.min(start.x, end.x),
        top: Math.min(start.y, end.y),
        width: Math.max(Math.abs(end.x - start.x), tool === 'connector' ? 0 : 20),
        height: Math.max(Math.abs(end.y - start.y), tool === 'connector' ? 0 : 20),
        borderColor: tool === 'sticky' ? '#FCD34D' : tool === 'shape' ? '#6B7280' : tool === 'connector' ? '#3B82F6' : '#A855F7',
      }}
    >
      {tool === 'connector' && (
        <svg className="absolute inset-0 overflow-visible" style={{ width: '100%', height: '100%' }}>
          <line
            x1={start.x < end.x ? 0 : Math.abs(end.x - start.x)}
            y1={start.y < end.y ? 0 : Math.abs(end.y - start.y)}
            x2={start.x < end.x ? Math.abs(end.x - start.x) : 0}
            y2={start.y < end.y ? Math.abs(end.y - start.y) : 0}
            stroke="#3B82F6"
            strokeWidth={2}
            strokeDasharray="5,5"
          />
        </svg>
      )}
      {tool !== 'connector' && (
        <span className="text-sm font-medium" style={{ color: tool === 'sticky' ? '#D97706' : tool === 'shape' ? '#374151' : '#7C3AED' }}>
          {tool === 'sticky' ? 'Sticky Note' : tool === 'shape' ? 'Shape' : 'Text Box'}
        </span>
      )}
    </div>
  );
}
