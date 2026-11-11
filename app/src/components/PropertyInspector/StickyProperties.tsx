import type { StickyColor } from '../../lib/elements';

const STICKY_COLORS: { value: StickyColor; bg: string; label: string }[] = [
  { value: 'yellow', bg: '#FEF3C7', label: 'Yellow' },
  { value: 'orange', bg: '#FFEDD5', label: 'Orange' },
  { value: 'pink', bg: '#FCE7F3', label: 'Pink' },
  { value: 'purple', bg: '#EDE9FE', label: 'Purple' },
  { value: 'blue', bg: '#DBEAFE', label: 'Blue' },
  { value: 'green', bg: '#D1FAE5', label: 'Green' },
  { value: 'gray', bg: '#F3F4F6', label: 'Gray' },
];

interface StickyPropertiesProps {
  color: StickyColor;
  fontSize: number;
  onUpdate: (changes: { color?: StickyColor; fontSize?: number }) => void;
}

export default function StickyProperties({ color, fontSize, onUpdate }: StickyPropertiesProps) {
  const labelClass = 'text-xs text-[var(--text-tertiary)] mb-1';

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        Sticky Note
      </h3>

      {/* Color picker */}
      <div>
        <label className={labelClass}>Color</label>
        <div className="flex gap-1.5 flex-wrap">
          {STICKY_COLORS.map((c) => (
            <button
              key={c.value}
              className={`w-7 h-7 rounded-full border-2 transition-all ${
                color === c.value
                  ? 'border-[var(--accent)] scale-110'
                  : 'border-transparent hover:border-[var(--glass-border-strong)]'
              }`}
              style={{ backgroundColor: c.bg }}
              title={c.label}
              onClick={() => onUpdate({ color: c.value })}
            />
          ))}
        </div>
      </div>

      {/* Font size slider */}
      <div>
        <label className={labelClass}>Font Size</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={10}
            max={32}
            value={fontSize}
            onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="text-xs text-[var(--text-secondary)] w-8 text-right">{fontSize}px</span>
        </div>
      </div>
    </div>
  );
}
