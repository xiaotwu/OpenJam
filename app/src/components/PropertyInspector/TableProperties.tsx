interface TablePropertiesProps {
  widgetData: {
    rows: number;
    cols: number;
    cells: { content: string; backgroundColor: string }[][];
  };
  onUpdateWidget: (data: Record<string, unknown>) => void;
}

export default function TableProperties({ widgetData, onUpdateWidget }: TablePropertiesProps) {
  const { rows, cols, cells } = widgetData;
  const labelClass = 'text-xs text-[var(--text-tertiary)] mb-1';
  const btnClass =
    'w-7 h-7 flex items-center justify-center rounded bg-white/10 border border-[var(--glass-border-strong)] text-[var(--text-primary)] hover:bg-white/20 transition-colors text-sm';

  const addRow = () => {
    const newCells = [...cells, Array(cols).fill(null).map(() => ({ content: '', backgroundColor: '#ffffff' }))];
    onUpdateWidget({ rows: rows + 1, cells: newCells });
  };

  const removeRow = () => {
    if (rows <= 1) return;
    const newCells = cells.slice(0, -1);
    onUpdateWidget({ rows: rows - 1, cells: newCells });
  };

  const addCol = () => {
    const newCells = cells.map((row) => [...row, { content: '', backgroundColor: '#ffffff' }]);
    onUpdateWidget({ cols: cols + 1, cells: newCells });
  };

  const removeCol = () => {
    if (cols <= 1) return;
    const newCells = cells.map((row) => row.slice(0, -1));
    onUpdateWidget({ cols: cols - 1, cells: newCells });
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        Table
      </h3>

      {/* Rows */}
      <div>
        <label className={labelClass}>Rows</label>
        <div className="flex items-center gap-2">
          <button className={btnClass} onClick={removeRow} disabled={rows <= 1}>
            -
          </button>
          <span className="text-sm text-[var(--text-primary)] w-8 text-center">{rows}</span>
          <button className={btnClass} onClick={addRow} disabled={rows >= 20}>
            +
          </button>
        </div>
      </div>

      {/* Columns */}
      <div>
        <label className={labelClass}>Columns</label>
        <div className="flex items-center gap-2">
          <button className={btnClass} onClick={removeCol} disabled={cols <= 1}>
            -
          </button>
          <span className="text-sm text-[var(--text-primary)] w-8 text-center">{cols}</span>
          <button className={btnClass} onClick={addCol} disabled={cols >= 10}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}
