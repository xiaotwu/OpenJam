export interface LiveCursor {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

interface LiveCursorLayerProps {
  cursors: LiveCursor[];
  scale: number;
  offset: { x: number; y: number };
}

export default function LiveCursorLayer({ cursors, scale, offset }: LiveCursorLayerProps) {
  if (cursors.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-hidden="true">
      {cursors.map((cursor) => (
        <div
          key={cursor.userId}
          className="absolute"
          style={{
            left: offset.x + cursor.x * scale,
            top: offset.y + cursor.y * scale,
            transform: 'translate(2px, 2px)',
          }}
        >
          <svg className="h-6 w-6 drop-shadow" viewBox="0 0 24 24" fill={cursor.color}>
            <path d="M3 2l14 9-6 1.2L8 19 3 2z" />
          </svg>
          <span
            className="ml-4 rounded-full px-2 py-0.5 text-xs font-semibold text-white shadow"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.name}
          </span>
        </div>
      ))}
    </div>
  );
}
