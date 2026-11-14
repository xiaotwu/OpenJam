import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react';
import {
  cellAddress, columnLabel, nextCell, parseCellAddress, sheetColumns, sheetRows, visibleCellValue, type CellPosition, type SheetCell,
} from '../../lib/sheets';

const rowHeight = 31;
const columnWidth = 118;
const rowHeader = 45;
const columns = Array.from({ length: sheetColumns }, (_, col) => col);
const formulaErrors = new Set(['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NUM!', '#NULL!', '#CYCLE!', '#LIMIT!']);

function positionAt(target: EventTarget | null) {
  const cell = target instanceof HTMLElement ? target.closest<HTMLElement>('td[data-cell]') : null;
  return parseCellAddress(cell?.dataset.cell ?? null);
}

interface SheetGridProps {
  name: string;
  cells: ReadonlyMap<string, SheetCell>;
  selection: CellPosition;
  gridRef?: RefObject<HTMLDivElement | null>;
  source?: boolean;
  onSelect: (position: CellPosition) => void;
  onEdit?: (position: CellPosition, input?: string) => void;
  onClear?: () => void;
  onPaste?: (text: string) => void;
}

export default function SheetGrid({ name, cells, selection, gridRef, source, onSelect, onEdit, onClear, onPaste }: SheetGridProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const viewport = gridRef ?? ownRef;
  const id = useId();
  const [height, setHeight] = useState(620);
  const [scrollTop, setScrollTop] = useState(0);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const end = Math.min(sheetRows, first + Math.ceil(height / rowHeight) + 12);
  const selected = cellAddress(selection);
  const { row: selectedRow, col: selectedColumn } = selection;
  const rows = useMemo(() => Array.from({ length: end - first }, (_, index) => {
    const row = first + index;
    return <tr key={row} role="row" aria-rowindex={row + 2}>
      <th role="rowheader" aria-colindex={1} data-current={row === selectedRow}>{row + 1}</th>
      {columns.map(col => {
        const address = cellAddress({ row, col });
        const cell = cells.get(address);
        const display = visibleCellValue(cell);
        const active = selectedRow === row && selectedColumn === col;
        return <td id={id + '-' + address} key={col} role="gridcell" aria-colindex={col + 2}
          aria-selected={active} aria-label={display ? address + ': ' + display : address}
          className="sheet-cell" data-cell={address} data-type={cell?.valueType}
          data-formula-error={cell?.valueType === 'formula' && formulaErrors.has(display) || undefined}
          data-source={active && source || undefined} title={display || undefined}>
          <span>{display}</span>
        </td>;
      })}
    </tr>;
  }), [cells, end, first, id, selectedColumn, selectedRow, source]);

  useEffect(() => {
    const area = viewport.current;
    if (!area) return;
    const observer = new ResizeObserver(() => setHeight(area.clientHeight));
    observer.observe(area);
    return () => observer.disconnect();
  }, [viewport]);

  useLayoutEffect(() => {
    const area = viewport.current;
    if (!area) return;
    const top = (selection.row + 1) * rowHeight;
    const left = rowHeader + selection.col * columnWidth;
    if (top < area.scrollTop + rowHeight) area.scrollTop = top - rowHeight;
    else if (top + rowHeight > area.scrollTop + area.clientHeight) area.scrollTop = top + rowHeight - area.clientHeight;
    if (left < area.scrollLeft + rowHeader) area.scrollLeft = left - rowHeader;
    else if (left + columnWidth > area.scrollLeft + area.clientWidth) area.scrollLeft = left + columnWidth - area.clientWidth;
    setScrollTop(area.scrollTop);
  }, [name, selection.col, selection.row, source, viewport]);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    const page = Math.max(1, Math.floor(height / rowHeight) - 1);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
      PageUp: [-page, 0], PageDown: [page, 0],
    };
    const movement = moves[event.key];
    if (movement) {
      event.preventDefault();
      onSelect(nextCell(selection, ...movement));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const end = event.key === 'End';
      onSelect({ row: event.ctrlKey || event.metaKey ? (end ? sheetRows - 1 : 0) : selection.row,
        col: end ? sheetColumns - 1 : 0 });
      return;
    }
    if (onEdit && (event.key === 'Enter' || event.key === 'F2')) {
      event.preventDefault();
      onEdit(selection);
    } else if (onClear && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      onClear();
    } else if (onEdit && Array.from(event.key).length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onEdit(selection, event.key);
    }
  }

  function copy(event: ClipboardEvent<HTMLDivElement>) {
    const cell = cells.get(selected);
    if (!cell) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', cell.input);
  }

  return <div ref={viewport} className="sheet-grid" role="grid" aria-label={name + ' Grid'}
    aria-rowcount={sheetRows + 1} aria-colcount={sheetColumns + 1} aria-readonly={!onEdit}
    aria-activedescendant={selection.row >= first && selection.row < end ? id + '-' + selected : undefined}
    tabIndex={0} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} onKeyDown={keyDown} onCopy={copy}
    onClick={event => {
      const position = positionAt(event.target);
      if (!position) return;
      viewport.current?.focus({ preventScroll: true });
      onSelect(position);
    }}
    onDoubleClick={event => {
      const position = positionAt(event.target);
      if (position) onEdit?.(position);
    }}
    onPaste={event => {
      if (!onPaste) return;
      const text = event.clipboardData.getData('text/plain');
      if (text) { event.preventDefault(); onPaste(text); }
    }}>
    <table role="presentation" style={{ width: rowHeader + sheetColumns * columnWidth }}>
      <colgroup><col style={{ width: rowHeader }} />{columns.map(col => <col key={col} style={{ width: columnWidth }} />)}</colgroup>
      <thead role="presentation"><tr role="row" aria-rowindex={1}>
        <th className="sheet-corner" role="columnheader" aria-label="Row" aria-colindex={1} />
        {columns.map(col => <th key={col} role="columnheader" aria-colindex={col + 2}
          data-current={col === selection.col}>{columnLabel(col)}</th>)}
      </tr></thead>
      <tbody role="presentation">
        {first > 0 && <tr aria-hidden="true" className="sheet-spacer"><td colSpan={sheetColumns + 1} style={{ height: first * rowHeight }} /></tr>}
        {rows}
        {end < sheetRows && <tr aria-hidden="true" className="sheet-spacer"><td colSpan={sheetColumns + 1} style={{ height: (sheetRows - end) * rowHeight }} /></tr>}
      </tbody>
    </table>
  </div>;
}
