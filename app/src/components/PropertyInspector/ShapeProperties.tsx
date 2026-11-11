import { SHAPE_COLORS } from '../../lib/elements';

interface ShapePropertiesProps {
  fill: string;
  stroke: string;
  strokeWidth: number;
  onUpdate: (changes: { fill?: string; stroke?: string; strokeWidth?: number }) => void;
}

export default function ShapeProperties({ fill, stroke, strokeWidth, onUpdate }: ShapePropertiesProps) {
  const labelClass = 'text-xs text-[var(--text-tertiary)] mb-1';

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        Shape
      </h3>

      {/* Fill color */}
      <div>
        <label className={labelClass}>Fill</label>
        <div className="flex gap-1.5 flex-wrap">
          {SHAPE_COLORS.map((c) => (
            <button
              key={c}
              className={`w-6 h-6 rounded border-2 transition-all ${
                fill === c
                  ? 'border-[var(--accent)] scale-110'
                  : 'border-transparent hover:border-[var(--glass-border-strong)]'
              }`}
              style={{
                backgroundColor: c === 'transparent' ? undefined : c,
                backgroundImage:
                  c === 'transparent'
                    ? 'repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%)'
                    : undefined,
                backgroundSize: c === 'transparent' ? '8px 8px' : undefined,
              }}
              onClick={() => onUpdate({ fill: c })}
            />
          ))}
        </div>
      </div>

      {/* Stroke color */}
      <div>
        <label className={labelClass}>Stroke</label>
        <div className="flex gap-1.5 flex-wrap">
          {SHAPE_COLORS.filter((c) => c !== 'transparent').map((c) => (
            <button
              key={c}
              className={`w-6 h-6 rounded border-2 transition-all ${
                stroke === c
                  ? 'border-[var(--accent)] scale-110'
                  : 'border-transparent hover:border-[var(--glass-border-strong)]'
              }`}
              style={{ backgroundColor: c }}
              onClick={() => onUpdate({ stroke: c })}
            />
          ))}
        </div>
      </div>

      {/* Stroke width */}
      <div>
        <label className={labelClass}>Stroke Width</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={strokeWidth}
            onChange={(e) => onUpdate({ strokeWidth: parseFloat(e.target.value) })}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="text-xs text-[var(--text-secondary)] w-8 text-right">{strokeWidth}px</span>
        </div>
      </div>
    </div>
  );
}
