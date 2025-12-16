// Table Widget - Interactive grid-based data table
import { useState, useCallback } from 'react';

interface TableCell {
  id: string;
  content: string;
  backgroundColor?: string;
  rowSpan?: number;
  colSpan?: number;
}

interface TableWidgetProps {
  id: string;
  x: number;
  y: number;
  rows: number;
  cols: number;
  cells: TableCell[][];
  onUpdate: (data: Partial<TableWidgetProps>) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

export default function TableWidget({
  x, y, rows, cols, cells, onUpdate, onDelete, isSelected, onSelect,
}: TableWidgetProps) {
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: number; col: number } | null>(null);

  const handleCellChange = useCallback((row: number, col: number, content: string) => {
    const newCells = cells.map((r, ri) => r.map((c, ci) => ri === row && ci === col ? { ...c, content } : c));
    onUpdate({ cells: newCells });
  }, [cells, onUpdate]);

  const addRow = useCallback((afterIndex: number) => {
    const newRow = Array(cols).fill(null).map((_, i) => ({ id: `cell-${Date.now()}-${i}`, content: '' }));
    const newCells = [...cells.slice(0, afterIndex + 1), newRow, ...cells.slice(afterIndex + 1)];
    onUpdate({ cells: newCells, rows: rows + 1 });
    setContextMenu(null);
  }, [cells, cols, rows, onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, row: number, col: number) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const nextCol = col + 1;
      if (nextCol < cols) {
        setEditingCell({ row, col: nextCol });
      } else if (row + 1 < rows) {
        setEditingCell({ row: row + 1, col: 0 });
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (row + 1 < rows) {
        setEditingCell({ row: row + 1, col });
      } else {
        addRow(rows);
        setTimeout(() => setEditingCell({ row: rows, col }), 0);
      }
    }
  }, [cols, rows, addRow]);

  const addColumn = useCallback((afterIndex: number) => {
    const newCells = cells.map((row) => [
      ...row.slice(0, afterIndex + 1),
      { id: `cell-${Date.now()}-${Math.random()}`, content: '' },
      ...row.slice(afterIndex + 1),
    ]);
    onUpdate({ cells: newCells, cols: cols + 1 });
    setContextMenu(null);
  }, [cells, cols, onUpdate]);

  const deleteRow = useCallback((index: number) => {
    if (rows <= 1) return;
    const newCells = cells.filter((_, i) => i !== index);
    onUpdate({ cells: newCells, rows: rows - 1 });
    setContextMenu(null);
  }, [cells, rows, onUpdate]);

  const deleteColumn = useCallback((index: number) => {
    if (cols <= 1) return;
    const newCells = cells.map((row) => row.filter((_, i) => i !== index));
    onUpdate({ cells: newCells, cols: cols - 1 });
    setContextMenu(null);
  }, [cells, cols, onUpdate]);

  const setCellColor = useCallback((row: number, col: number, color: string) => {
    const newCells = cells.map((r, ri) => r.map((c, ci) => ri === row && ci === col ? { ...c, backgroundColor: color } : c));
    onUpdate({ cells: newCells });
    setContextMenu(null);
  }, [cells, onUpdate]);

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="table">
      <div className={`bg-white rounded-lg shadow-lg border-2 ${isSelected ? 'border-blue-500' : 'border-gray-200'}`}>
        <table className="border-collapse">
          <tbody>
            {cells.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, colIndex) => (
                  <td key={cell.id} className="border border-gray-200 min-w-[80px] min-h-[32px] p-0"
                    style={{ backgroundColor: cell.backgroundColor || 'white' }}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, row: rowIndex, col: colIndex }); }}>
                    {editingCell?.row === rowIndex && editingCell?.col === colIndex ? (
                      <input type="text" value={cell.content} autoFocus
                        onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                        onBlur={() => setEditingCell(null)}
                        onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
                        className="w-full h-full px-2 py-1 text-sm outline-none bg-transparent" />
                    ) : (
                      <div className="px-2 py-1 text-sm min-h-[28px] cursor-text"
                        onClick={() => setEditingCell({ row: rowIndex, col: colIndex })}>
                        {cell.content || '\u00A0'}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => addRow(contextMenu.row - 1)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100">Add row above</button>
          <button onClick={() => addRow(contextMenu.row)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100">Add row below</button>
          <button onClick={() => addColumn(contextMenu.col - 1)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100">Add column left</button>
          <button onClick={() => addColumn(contextMenu.col)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100">Add column right</button>
          <div className="border-t border-gray-100 my-1" />
          <button onClick={() => deleteRow(contextMenu.row)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 text-red-600">Delete row</button>
          <button onClick={() => deleteColumn(contextMenu.col)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 text-red-600">Delete column</button>
          <div className="border-t border-gray-100 my-1" />
          <div className="px-3 py-1.5 text-xs text-gray-500">Cell color</div>
          <div className="px-3 py-1 flex gap-1">
            {['#ffffff', '#FEF3C7', '#DCFCE7', '#DBEAFE', '#F3E8FF', '#FCE7F3'].map((color) => (
              <button key={color} onClick={() => setCellColor(contextMenu.row, contextMenu.col, color)}
                className="w-5 h-5 rounded border border-gray-300" style={{ backgroundColor: color }} />
            ))}
          </div>
        </div>
      )}

      {/* Delete button */}
      {isSelected && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}


