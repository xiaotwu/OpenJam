interface EraserCursorProps {
  x: number;
  y: number;
  size: number;
  isErasing: boolean;
}

export default function EraserCursor({ x, y, size, isErasing }: EraserCursorProps) {
  return (
    <div
      className="absolute pointer-events-none rounded-full border-2 border-gray-500"
      style={{
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        backgroundColor: isErasing ? 'rgba(239, 68, 68, 0.2)' : 'rgba(156, 163, 175, 0.2)',
        borderColor: isErasing ? '#EF4444' : '#6B7280',
      }}
    />
  );
}
