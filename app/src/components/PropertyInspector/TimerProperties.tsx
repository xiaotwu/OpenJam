interface TimerPropertiesProps {
  widgetData: { minutes?: number };
  onUpdateWidget: (data: Record<string, unknown>) => void;
}

const PRESETS = [1, 3, 5, 10, 15, 30];

export default function TimerProperties({ widgetData, onUpdateWidget }: TimerPropertiesProps) {
  const minutes = widgetData.minutes ?? 5;
  const labelClass = 'text-xs text-[var(--text-tertiary)] mb-1';
  const inputClass =
    'w-full px-2 py-1 text-sm rounded bg-white/10 border border-[var(--glass-border-strong)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors';

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        Timer
      </h3>

      {/* Duration input */}
      <div>
        <label className={labelClass}>Duration (minutes)</label>
        <input
          type="number"
          className={inputClass}
          value={minutes}
          min={1}
          max={180}
          onChange={(e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val) && val >= 1 && val <= 180) {
              onUpdateWidget({ minutes: val });
            }
          }}
        />
      </div>

      {/* Presets */}
      <div>
        <label className={labelClass}>Presets</label>
        <div className="flex gap-1 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p}
              className={`px-2.5 py-1 text-xs rounded border transition-all ${
                minutes === p
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'bg-white/10 text-[var(--text-secondary)] border-[var(--glass-border-strong)] hover:border-[var(--accent)]'
              }`}
              onClick={() => onUpdateWidget({ minutes: p })}
            >
              {p}m
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
