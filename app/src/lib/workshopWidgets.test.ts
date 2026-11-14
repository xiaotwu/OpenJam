import { describe, expect, it } from 'vitest';
import {
  applyLegacyWidgetVote, insertTableColumn, insertTableRow, moveKanbanCard, normalizeKanbanColumns,
  normalizeTable, normalizeTimer, removeTableColumn, removeTableRow, timerView, updateTableCell,
} from './workshopWidgets';

describe('workshop widget data', () => {
  it('normalizes older table cells deterministically without mutating their content', () => {
    const original = { rows: 2, cols: 2, cells: [[{ content: 'Plan', id: 'a', note: 'keep' }, { content: 'Review', id: 'a' }], ['Done']] };
    const saved = JSON.stringify(original);
    const table = normalizeTable(original);
    expect(normalizeTable(original)).toEqual(table);
    expect(new Set(table.cells.flat().map(cell => cell.id)).size).toBe(4);
    expect(table.cells[0][0]).toMatchObject({ id: 'a', content: 'Plan', note: 'keep' });
    expect(table.cells[1][0].content).toBe('Done');
    expect(JSON.stringify(original)).toBe(saved);
  });

  it('keeps row, column and cell identity when table structure changes', () => {
    const table = normalizeTable({ rows: 2, cols: 2, cells: [['First', 'Second'], ['Third', 'Fourth']] });
    const updated = updateTableCell(table, table.cells[1][0].id, { content: 'Updated' });
    const grown = insertTableColumn(insertTableRow(updated, 1), 0);
    expect(grown.rowIds[2]).toBe(table.rowIds[1]);
    expect(grown.columnIds[1]).toBe(table.columnIds[0]);
    expect(grown.cells[2][1]).toMatchObject({ id: table.cells[1][0].id, content: 'Updated' });
    expect(removeTableColumn(removeTableRow(grown, 1), 0)).toEqual(updated);
  });

  it('moves kanban cards within and between columns without changing their IDs or metadata', () => {
    const columns = normalizeKanbanColumns([
      { id: 'todo', title: 'To do', cards: [{ id: 'a', title: 'Draft', assignee: 'Alice' }, { id: 'b', title: 'Discuss' }] },
      'Done',
    ]);
    const within = moveKanbanCard(columns, 'b', 'todo', 'a');
    expect(within[0].cards.map(card => card.id)).toEqual(['b', 'a']);
    const moved = moveKanbanCard(within, 'a', columns[1].id);
    expect(moved[1].cards[0]).toMatchObject({ id: 'a', title: 'Draft', assignee: 'Alice' });
    expect(columns[0].cards.map(card => card.id)).toEqual(['a', 'b']);
  });

  it('derives timer state from a shared deadline and preserves a paused duration', () => {
    const timer = normalizeTimer({ minutes: 2, startedAt: 1000, deadlineAt: 121_000 });
    expect(timerView(timer, 31_000)).toMatchObject({ remainingMs: 90_000, status: 'running' });
    expect(timerView(timer, 121_001)).toMatchObject({ remainingMs: 0, status: 'completed' });
    expect(timerView(normalizeTimer({ minutes: 2, remainingMs: 90_000 }), 5_000_000)).toMatchObject({ remainingMs: 90_000, status: 'paused' });
    expect(timerView(normalizeTimer({ minutes: 2 }), 5_000_000)).toMatchObject({ remainingMs: 120_000, status: 'idle' });
  });

  it('counts historical poll totals and prevents a duplicate vote in compatibility mode', () => {
    const widget = { options: [{ id: 'option', text: 'Keep', voters: [], votes: 3 }] };
    const vote = { action: 'poll-cast', optionId: 'option' } as const;
    const added = applyLegacyWidgetVote('poll', widget, vote, 'person', '#fff');
    expect(added).toEqual({ options: [{ id: 'option', text: 'Keep', voters: ['person'], votes: 4 }] });
    expect(applyLegacyWidgetVote('poll', added ?? {}, vote, 'person', '#fff')).toBeUndefined();
  });
});
