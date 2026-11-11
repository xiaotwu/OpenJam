import type { Page } from '../components/PagesPanel';
import { request, requestResponse } from './api';
import type { BoardElement, DocumentMutation } from './boardSyncProtocol';
import type { DirectoryBoard } from './directory';

export type SheetFormat = 'csv' | 'xlsx';
export type CellType = '' | 'text' | 'number' | 'boolean' | 'error' | 'formula';
export type CellValue = { input: string; valueType: CellType };
export type CellEdit = CellValue & { pageId: string; address: string };
export type SheetCell = CellEdit & { id: string; type: 'sheetCell'; display?: string };
export interface SheetTab extends Page { sheetTab: true }
export type CellPosition = { row: number; col: number };

export const sheetRows = 1000;
export const sheetColumns = 52;
export const sheetTabs = 8;
export const maxCellBytes = 1024;
export const maxSheetUploadBytes = 4 * 1024 * 1024;
export const blankCell: CellValue = { input: '', valueType: '' };

const decimal = /^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function columnLabel(col: number) {
  return col < 26 ? String.fromCharCode(65 + col) : 'A' + String.fromCharCode(65 + col - 26);
}

export function cellAddress({ row, col }: CellPosition) {
  return columnLabel(col) + (row + 1);
}

export function nextCell(cell: CellPosition, rows: number, cols: number): CellPosition {
  return { row: Math.max(0, Math.min(sheetRows - 1, cell.row + rows)),
    col: Math.max(0, Math.min(sheetColumns - 1, cell.col + cols)) };
}

export function parseCellAddress(value: string | null): CellPosition | undefined {
  const parts = /^([A-Z]{1,2})([1-9]\d{0,3})$/.exec(value?.toUpperCase() ?? '');
  if (!parts) return;
  let col = 0;
  for (const letter of parts[1]) col = col * 26 + letter.charCodeAt(0) - 64;
  const row = Number(parts[2]);
  return row <= sheetRows && col <= sheetColumns ? { row: row - 1, col: col - 1 } : undefined;
}

export function worksheets(pages: Page[]): SheetTab[] {
  return pages.filter((page): page is SheetTab => (page as Partial<SheetTab>).sheetTab === true);
}

export function asSheetCell(record: BoardElement | undefined): SheetCell | undefined {
  const cell = record as unknown as SheetCell | undefined;
  return cell?.type === 'sheetCell' ? cell : undefined;
}

export function cellValue(cell: SheetCell | undefined): CellValue {
  return cell ? { input: cell.input, valueType: cell.valueType } : blankCell;
}

export function visibleCellValue(cell: SheetCell | undefined) {
  if (!cell) return '';
  return cell.valueType === 'formula' ? (cell.display ?? cell.input) : cell.input;
}

export function inputFromEditor(input: string): CellValue {
  if (!input || input === "'") return blankCell;
  if (input.startsWith("'")) return { input: input.slice(1), valueType: 'text' };
  if (input.startsWith('=') && input.length > 1) return { input, valueType: 'formula' };
  if (decimal.test(input) && Number.isFinite(Number(input))) return { input, valueType: 'number' };
  if (/^(TRUE|FALSE)$/i.test(input)) return { input: input.toUpperCase(), valueType: 'boolean' };
  return { input, valueType: 'text' };
}

export function editorText(cell: CellValue) {
  if (cell.valueType === 'text' && (cell.input.startsWith("'") || inputFromEditor(cell.input).valueType !== 'text')) {
    return "'" + cell.input;
  }
  return cell.input;
}

export function cellEdit(pageId: string, address: string, value: CellValue, expected: CellValue): DocumentMutation {
  return { kind: 'setCell', collection: 'elements', id: pageId + ':' + address,
    value: { pageId, address, ...value }, expected };
}

export function importSheet(project: string, name: string, format: SheetFormat, file: File) {
  const params = new URLSearchParams({ name, format });
  return request<DirectoryBoard>('/api/v2/projects/' + encodeURIComponent(project) + '/sheets/import?' + params, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  });
}

export async function downloadSheet(id: string, title: string, format: SheetFormat, sheet: string) {
  const params = new URLSearchParams({ format, sheet });
  const response = await requestResponse('/api/v2/sheets/' + encodeURIComponent(id) + '/export?' + params, { cache: 'no-store' });
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  const filename = Array.from(title.trim(), character =>
    character === '/' || character === '\\' || character.charCodeAt(0) < 32 ? '_' : character).join('');
  link.download = (filename || 'Untitled Spreadsheet') + '.' + format;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
