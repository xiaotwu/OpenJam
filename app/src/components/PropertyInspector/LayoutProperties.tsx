import { useCallback } from 'react';

interface LayoutPropertiesProps {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  onUpdate: (changes: { x?: number; y?: number; width?: number; height?: number; rotation?: number; opacity?: number }) => void;
}

export default function LayoutProperties({
  x,
  y,
  width,
  height,
  rotation,
  opacity,
  onUpdate,
}: LayoutPropertiesProps) {
  const handleNumberChange = useCallback(
    (field: string, value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        onUpdate({ [field]: num });
      }
    },
    [onUpdate]
  );

  const inputClass =
    'w-full px-2 py-1 text-sm rounded bg-white/10 border border-[var(--glass-border-strong)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors';
  const labelClass = 'text-xs text-[var(--text-tertiary)] mb-1';

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        Layout
      </h3>

      {/* Position */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>X</label>
          <input
            type="number"
            className={inputClass}
            value={Math.round(x)}
            onChange={(e) => handleNumberChange('x', e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Y</label>
          <input
            type="number"
            className={inputClass}
            value={Math.round(y)}
            onChange={(e) => handleNumberChange('y', e.target.value)}
          />
        </div>
      </div>

      {/* Size */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>W</label>
          <input
            type="number"
            className={inputClass}
            value={Math.round(width)}
            min={1}
            onChange={(e) => handleNumberChange('width', e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>H</label>
          <input
            type="number"
            className={inputClass}
            value={Math.round(height)}
            min={1}
            onChange={(e) => handleNumberChange('height', e.target.value)}
          />
        </div>
      </div>

      {/* Rotation */}
      <div>
        <label className={labelClass}>Rotation</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={360}
            value={rotation}
            onChange={(e) => handleNumberChange('rotation', e.target.value)}
            className="flex-1 accent-[var(--accent)]"
          />
          <input
            type="number"
            className={`${inputClass} w-16`}
            value={Math.round(rotation)}
            min={0}
            max={360}
            onChange={(e) => handleNumberChange('rotation', e.target.value)}
          />
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label className={labelClass}>Opacity</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(e) => handleNumberChange('opacity', e.target.value)}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="text-xs text-[var(--text-secondary)] w-10 text-right">
            {Math.round(opacity * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
