import type { ConnectorStyle, ArrowHead } from '../../lib/elements';

interface ConnectorPropertiesProps {
  style: ConnectorStyle;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  stroke: string;
  strokeWidth: number;
  onUpdate: (changes: {
    style?: ConnectorStyle;
    startArrow?: ArrowHead;
    endArrow?: ArrowHead;
    stroke?: string;
    strokeWidth?: number;
  }) => void;
}

const CONNECTOR_STYLES: { value: ConnectorStyle; label: string }[] = [
  { value: 'straight', label: 'Straight' },
  { value: 'elbow', label: 'Elbow' },
  { value: 'curved', label: 'Curved' },
];

const ARROW_HEADS: { value: ArrowHead; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'circle', label: 'Dot' },
  { value: 'diamond', label: 'Diamond' },
];

export default function ConnectorProperties({
  style,
  startArrow,
  endArrow,
  stroke,
  strokeWidth,
  onUpdate,
}: ConnectorPropertiesProps) {
  const labelClass = 'text-xs text-[var(--text-tertiary)] mb-1';
  const selectClass =
    'w-full px-2 py-1 text-sm rounded bg-white/10 border border-[var(--glass-border-strong)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors';

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        Connector
      </h3>

      {/* Style selector */}
      <div>
        <label className={labelClass}>Style</label>
        <div className="flex gap-1">
          {CONNECTOR_STYLES.map((s) => (
            <button
              key={s.value}
              className={`flex-1 px-2 py-1.5 text-xs rounded border transition-all ${
                style === s.value
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'bg-white/10 text-[var(--text-secondary)] border-[var(--glass-border-strong)] hover:border-[var(--accent)]'
              }`}
              onClick={() => onUpdate({ style: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Color */}
      <div>
        <label className={labelClass}>Color</label>
        <input
          type="color"
          className="w-8 h-8 rounded cursor-pointer border border-[var(--glass-border-strong)]"
          value={stroke}
          onChange={(e) => onUpdate({ stroke: e.target.value })}
        />
      </div>

      {/* Width */}
      <div>
        <label className={labelClass}>Width</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={strokeWidth}
            onChange={(e) => onUpdate({ strokeWidth: parseFloat(e.target.value) })}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="text-xs text-[var(--text-secondary)] w-8 text-right">{strokeWidth}px</span>
        </div>
      </div>

      {/* Start arrow */}
      <div>
        <label className={labelClass}>Start</label>
        <select
          className={selectClass}
          value={startArrow}
          onChange={(e) => onUpdate({ startArrow: e.target.value as ArrowHead })}
        >
          {ARROW_HEADS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {/* End arrow */}
      <div>
        <label className={labelClass}>End</label>
        <select
          className={selectClass}
          value={endArrow}
          onChange={(e) => onUpdate({ endArrow: e.target.value as ArrowHead })}
        >
          {ARROW_HEADS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
