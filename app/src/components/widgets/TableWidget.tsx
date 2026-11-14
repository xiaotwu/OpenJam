import { useMemo, useState } from 'react';
import {
  insertTableColumn, insertTableRow, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, normalizeTable,
  removeTableColumn, removeTableRow, updateTableCell, type TableData, type WidgetData,
} from '../../lib/workshopWidgets';
import WidgetTextInput, { type EditDirection } from './WidgetTextInput';

interface TableWidgetProps {
  x: number;
  y: number;
  data: WidgetData;
  editable: boolean;
  onUpdate: (data: TableData, expected?: WidgetData) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

interface EditingCell {
  id: string;
  value: string;
  data: WidgetData;
  table: TableData;
}

const CELL_COLORS = [
  ['White', '#ffffff'], ['Yellow', '#FEF3C7'], ['Green', '#DCFCE7'],
  ['Blue', '#DBEAFE'], ['Purple', '#F3E8FF'], ['Pink', '#FCE7F3'],
] as const;
const actionClass = 'rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40';

export default function TableWidget({ x, y, data, editable, onUpdate, onDelete, isSelected, onSelect }: TableWidgetProps) {
  const table = useMemo(() => normalizeTable(data), [data]);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [focusedCell, setFocusedCell] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRow = table.cells.findIndex(row => row.some(cell => cell.id === focusedCell));
  const row = Math.max(0, menuRow);
  const col = Math.max(0, table.cells[row].findIndex(cell => cell.id === focusedCell));

  function changeStructure(next: TableData) {
    if (next !== table) onUpdate(next);
    setMenuOpen(false);
  }

  function neighbor(ri: number, ci: number, direction?: EditDirection) {
    if (direction === 'down') return table.cells[ri + 1]?.[ci];
    if (direction === 'next') return table.cells[ri][ci + 1] ?? table.cells[ri + 1]?.[0];
    if (direction === 'previous') return table.cells[ri][ci - 1] ?? table.cells[ri - 1]?.[table.cols - 1];
  }

  function commitCell(entry: EditingCell, value: string, ri: number, ci: number, direction?: EditDirection) {
    if (value !== entry.value) {
      const latestCell = table.cells[ri][ci];
      const unchanged = latestCell.id === entry.id && latestCell.content === entry.value;
      onUpdate(updateTableCell(unchanged ? table : entry.table, entry.id, { content: value }), unchanged ? undefined : entry.data);
    }
    const next = neighbor(ri, ci, direction);
    setEditing(next ? { id: next.id, value: next.content, table, data } : null);
    if (next) setFocusedCell(next.id);
  }

  return (
    <div className="absolute text-gray-900" style={{ left: x, top: y }} onClick={onSelect} data-widget="table">
      <div className={`rounded-lg border-2 canvas-widget-surface shadow-lg ${isSelected ? 'border-blue-500' : 'border-gray-200'}`}>
        <table aria-label="Workshop table" className="border-collapse">
          <tbody>
            {table.cells.map((cells, ri) => (
              <tr key={table.rowIds[ri]}>
                {cells.map((cell, ci) => (
                  <td
                    key={cell.id}
                    className="min-w-[80px] max-w-[320px] border border-gray-200 p-0"
                    style={{ backgroundColor: cell.backgroundColor || 'white' }}
                    onContextMenu={event => {
                      if (!editable) return;
                      event.preventDefault();
                      event.stopPropagation();
                      onSelect();
                      setFocusedCell(cell.id);
                      setMenuOpen(true);
                    }}
                  >
                    {editable && editing?.id === cell.id ? (
                      <WidgetTextInput
                        label={`Edit row ${ri + 1}, column ${ci + 1}`}
                        value={editing.value}
                        maxLength={2000}
                        className="h-8 w-full bg-transparent px-2 text-sm outline-2 outline-blue-500"
                        canTraverse={direction => Boolean(neighbor(ri, ci, direction))}
                        onCommit={(value, direction) => commitCell(editing, value, ri, ci, direction)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : editable ? (
                      <button
                        type="button"
                        aria-label={`Row ${ri + 1}, column ${ci + 1}${cell.content ? `, ${cell.content}` : ''}`}
                        className="min-h-8 w-full cursor-text whitespace-pre-wrap break-words px-2 py-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-blue-500"
                        onFocus={() => setFocusedCell(cell.id)}
                        onClick={() => {
                          setFocusedCell(cell.id);
                          setEditing({ id: cell.id, value: cell.content, table, data });
                          setMenuOpen(false);
                        }}
                      >{cell.content || '\u00A0'}</button>
                    ) : <div className="min-h-8 whitespace-pre-wrap break-words px-2 py-1 text-sm">{cell.content || '\u00A0'}</div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {editable && isSelected && (
          <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
            <button type="button" className={actionClass} disabled={table.rows >= MAX_TABLE_ROWS} onClick={() => changeStructure(insertTableRow(table, table.rows))}>Add row</button>
            <button type="button" className={actionClass} disabled={table.cols >= MAX_TABLE_COLUMNS} onClick={() => changeStructure(insertTableColumn(table, table.cols))}>Add column</button>
            <button type="button" className={actionClass} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>Cell actions</button>
          </div>
        )}
      </div>

      {editable && isSelected && menuOpen && (
        <div aria-label="Table cell actions" className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-gray-200 bg-white p-2 shadow-xl"
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setMenuOpen(false); } }}>
          <div className="mb-1 px-1 text-xs text-gray-500">Row {row + 1}, column {col + 1}</div>
          <div className="grid grid-cols-1 gap-1">
            <button type="button" className={actionClass} disabled={table.rows >= MAX_TABLE_ROWS} onClick={() => changeStructure(insertTableRow(table, row))}>Add row above</button>
            <button type="button" className={actionClass} disabled={table.rows >= MAX_TABLE_ROWS} onClick={() => changeStructure(insertTableRow(table, row + 1))}>Add row below</button>
            <button type="button" className={actionClass} disabled={table.cols >= MAX_TABLE_COLUMNS} onClick={() => changeStructure(insertTableColumn(table, col))}>Add column left</button>
            <button type="button" className={actionClass} disabled={table.cols >= MAX_TABLE_COLUMNS} onClick={() => changeStructure(insertTableColumn(table, col + 1))}>Add column right</button>
            <button type="button" className={actionClass} disabled={table.rows <= 1} onClick={() => changeStructure(removeTableRow(table, row))}>Delete row</button>
            <button type="button" className={actionClass} disabled={table.cols <= 1} onClick={() => changeStructure(removeTableColumn(table, col))}>Delete column</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            {CELL_COLORS.map(([label, color]) => (
              <button key={color} type="button" aria-label={`Set cell color to ${label.toLowerCase()}`}
                onClick={() => changeStructure(updateTableCell(table, table.cells[row][col].id, { backgroundColor: color }))}
                className="h-5 w-5 rounded border border-gray-300" style={{ backgroundColor: color }} />
            ))}
          </div>
        </div>
      )}
      {editable && isSelected && (
        <button type="button" aria-label="Delete table" onClick={event => { event.stopPropagation(); onDelete(); }}
          className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-red-600 text-xs text-white hover:bg-red-700">✕</button>
      )}
    </div>
  );
}
