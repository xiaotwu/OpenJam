import { useState } from 'react';

interface TimerCreationDialogProps {
  onConfirm: (minutes: number) => void;
  onCancel: () => void;
}

const PRESETS = [1, 3, 5, 10, 15, 30];

export default function TimerCreationDialog({ onConfirm, onCancel }: TimerCreationDialogProps) {
  const [minutes, setMinutes] = useState(5);

  const inputClass =
    'w-full px-3 py-2 text-sm rounded-lg bg-white/10 border border-[var(--glass-border-strong)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors';
  const labelClass = 'text-sm text-[var(--text-secondary)] mb-1';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="glass-elevated relative z-10 w-80 rounded-2xl p-6 space-y-5 glass-panel-enter">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Create Timer</h2>

        <div className="space-y-4">
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
                if (!isNaN(val) && val >= 1 && val <= 180) setMinutes(val);
              }}
            />
          </div>

          {/* Presets */}
          <div>
            <label className={labelClass}>Quick presets</label>
            <div className="flex gap-1.5 flex-wrap">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                    minutes === p
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'bg-white/10 text-[var(--text-secondary)] border-[var(--glass-border-strong)] hover:border-[var(--accent)]'
                  }`}
                  onClick={() => setMinutes(p)}
                >
                  {p}m
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            className="px-4 py-2 text-sm rounded-lg text-[var(--text-secondary)] hover:bg-white/10 transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="glass-btn px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 transition-opacity"
            onClick={() => onConfirm(minutes)}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
