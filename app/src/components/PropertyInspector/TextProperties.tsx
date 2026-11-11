interface TextPropertiesProps {
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  color: string;
  onUpdate: (changes: {
    fontSize?: number;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    textAlign?: 'left' | 'center' | 'right';
    color?: string;
  }) => void;
}

export default function TextProperties({
  fontSize,
  fontWeight,
  fontStyle,
  textAlign,
  color,
  onUpdate,
}: TextPropertiesProps) {
  const labelClass = 'text-xs text-[var(--text-tertiary)] mb-1';
  const inputClass =
    'w-full px-2 py-1 text-sm rounded bg-white/10 border border-[var(--glass-border-strong)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors';
  const toggleBtnClass = (active: boolean) =>
    `px-3 py-1.5 text-sm rounded border transition-all ${
      active
        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
        : 'bg-white/10 text-[var(--text-secondary)] border-[var(--glass-border-strong)] hover:border-[var(--accent)]'
    }`;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        Text
      </h3>

      {/* Font size */}
      <div>
        <label className={labelClass}>Font Size</label>
        <input
          type="number"
          className={inputClass}
          value={fontSize}
          min={8}
          max={120}
          onChange={(e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val)) onUpdate({ fontSize: val });
          }}
        />
      </div>

      {/* Bold / Italic */}
      <div>
        <label className={labelClass}>Style</label>
        <div className="flex gap-1">
          <button
            className={toggleBtnClass(fontWeight === 'bold')}
            onClick={() => onUpdate({ fontWeight: fontWeight === 'bold' ? 'normal' : 'bold' })}
          >
            <strong>B</strong>
          </button>
          <button
            className={toggleBtnClass(fontStyle === 'italic')}
            onClick={() => onUpdate({ fontStyle: fontStyle === 'italic' ? 'normal' : 'italic' })}
          >
            <em>I</em>
          </button>
        </div>
      </div>

      {/* Text alignment */}
      <div>
        <label className={labelClass}>Alignment</label>
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              className={toggleBtnClass(textAlign === align)}
              onClick={() => onUpdate({ textAlign: align })}
            >
              {align === 'left' && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <rect x="1" y="2" width="12" height="1.5" />
                  <rect x="1" y="5.5" width="8" height="1.5" />
                  <rect x="1" y="9" width="12" height="1.5" />
                </svg>
              )}
              {align === 'center' && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <rect x="1" y="2" width="12" height="1.5" />
                  <rect x="3" y="5.5" width="8" height="1.5" />
                  <rect x="1" y="9" width="12" height="1.5" />
                </svg>
              )}
              {align === 'right' && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <rect x="1" y="2" width="12" height="1.5" />
                  <rect x="5" y="5.5" width="8" height="1.5" />
                  <rect x="1" y="9" width="12" height="1.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Text color */}
      <div>
        <label className={labelClass}>Color</label>
        <input
          type="color"
          className="w-8 h-8 rounded cursor-pointer border border-[var(--glass-border-strong)]"
          value={color}
          onChange={(e) => onUpdate({ color: e.target.value })}
        />
      </div>
    </div>
  );
}
