import { useState } from 'react';

interface TableCreationDialogProps {
  onConfirm: (rows: number, cols: number) => void;
  onCancel: () => void;
}

export default function TableCreationDialog({ onConfirm, onCancel }: TableCreationDialogProps) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);

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
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Create Table</h2>

        <div className="space-y-4">
          <div>
            <label className={labelClass}>Rows</label>
            <input
              type="number"
              className={inputClass}
              value={rows}
              min={1}
              max={20}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val >= 1 && val <= 20) setRows(val);
              }}
            />
          </div>

          <div>
            <label className={labelClass}>Columns</label>
            <input
              type="number"
              className={inputClass}
              value={cols}
              min={1}
              max={10}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val >= 1 && val <= 10) setCols(val);
              }}
            />
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
            onClick={() => onConfirm(rows, cols)}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
