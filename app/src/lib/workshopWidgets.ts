export type WidgetData = Record<string, unknown>;

export type WidgetVoteAction =
  | { action: 'poll-cast'; optionId: string }
  | { action: 'dot-add'; voteId: string; x: number; y: number }
  | { action: 'dot-remove'; voteId: string }
  | { action: 'dot-clear' };

export const MAX_TABLE_ROWS = 20;
export const MAX_TABLE_COLUMNS = 10;
export const MAX_POLL_OPTIONS = 12;
export const MAX_DOT_VOTES = 20;

export type TableCell = WidgetData & { id: string; content: string; backgroundColor?: string };
export type TableData = {
  rows: number;
  cols: number;
  rowIds: string[];
  columnIds: string[];
  cells: TableCell[][];
};

export type KanbanCard = WidgetData & { id: string; title: string; color?: string; assignee?: string };
export type KanbanColumn = WidgetData & { id: string; title: string; cards: KanbanCard[] };
export type PollOption = WidgetData & { id: string; text: string; votes: number; voters: string[] };
export type DotVote = WidgetData & { id: string; userId: string; userColor: string; targetId: string; x: number; y: number };
export type TimerData = {
  minutes: number;
  startedAt: number | null;
  deadlineAt: number | null;
  remainingMs: number | null;
};

function fields(value: unknown): WidgetData {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as WidgetData : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

function spliceCopy<T>(items: T[], index: number, count: number, ...insert: T[]): T[] {
  const next = items.slice();
  next.splice(index, count, ...insert);
  return next;
}

export function newWidgetPartId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function legacyIds(existing: unknown[]) {
  const reserved = new Set(existing.filter(id => typeof id === 'string' && id));
  const used = new Set<string>();
  return (value: unknown, fallback: string): string => {
    if (typeof value === 'string' && value && !used.has(value)) {
      used.add(value);
      return value;
    }
    let candidate = fallback;
    for (let suffix = 1; reserved.has(candidate) || used.has(candidate); suffix++) candidate = `${fallback}-${suffix}`;
    used.add(candidate);
    return candidate;
  };
}

function emptyCell(): TableCell {
  return { id: newWidgetPartId('cell'), content: '' };
}

export function createTable(rows = 3, cols = 3): TableData {
  return {
    rows,
    cols,
    rowIds: Array.from({ length: rows }, () => newWidgetPartId('row')),
    columnIds: Array.from({ length: cols }, () => newWidgetPartId('column')),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, emptyCell)),
  };
}

export function normalizeTable(data: WidgetData): TableData {
  const source = list(data.cells).map(list);
  const sourceRows = list(data.rowIds);
  const sourceColumns = list(data.columnIds);
  // Existing grids may predate the insertion limits. Size from their actual
  // contents before falling back to a declared count or a blank grid.
  const rows = Math.max(source.length, sourceRows.length, integer(data.rows, source.length || 3, 1, MAX_TABLE_ROWS));
  const maxSourceCols = source.reduce((max, row) => Math.max(max, row.length), 0);
  const cols = Math.max(maxSourceCols, sourceColumns.length, integer(data.cols, maxSourceCols || 3, 1, MAX_TABLE_COLUMNS));
  const rowId = legacyIds(sourceRows);
  const columnId = legacyIds(sourceColumns);
  const cellId = legacyIds(source.flatMap(row => row.map(cell => fields(cell).id)));
  return {
    rows,
    cols,
    rowIds: Array.from({ length: rows }, (_, index) => rowId(sourceRows[index], `legacy-row-${index}`)),
    columnIds: Array.from({ length: cols }, (_, index) => columnId(sourceColumns[index], `legacy-column-${index}`)),
    cells: Array.from({ length: rows }, (_, ri) => Array.from({ length: cols }, (_, ci) => {
      const raw = source[ri]?.[ci];
      const cell = fields(raw);
      return {
        ...cell,
        id: cellId(cell.id, `legacy-cell-${ri}-${ci}`),
        content: string(cell.content, string(raw)),
        backgroundColor: string(cell.backgroundColor) || undefined,
      };
    })),
  };
}

export function insertTableRow(table: TableData, index: number): TableData {
  if (table.rows >= MAX_TABLE_ROWS || index < 0 || index > table.rows) return table;
  return {
    ...table, rows: table.rows + 1,
    rowIds: spliceCopy(table.rowIds, index, 0, newWidgetPartId('row')),
    cells: spliceCopy(table.cells, index, 0, Array.from({ length: table.cols }, emptyCell)),
  };
}

export function removeTableRow(table: TableData, index: number): TableData {
  if (table.rows <= 1 || index < 0 || index >= table.rows) return table;
  return { ...table, rows: table.rows - 1, rowIds: spliceCopy(table.rowIds, index, 1), cells: spliceCopy(table.cells, index, 1) };
}

export function insertTableColumn(table: TableData, index: number): TableData {
  if (table.cols >= MAX_TABLE_COLUMNS || index < 0 || index > table.cols) return table;
  return {
    ...table, cols: table.cols + 1,
    columnIds: spliceCopy(table.columnIds, index, 0, newWidgetPartId('column')),
    cells: table.cells.map(row => spliceCopy(row, index, 0, emptyCell())),
  };
}

export function removeTableColumn(table: TableData, index: number): TableData {
  if (table.cols <= 1 || index < 0 || index >= table.cols) return table;
  return {
    ...table, cols: table.cols - 1,
    columnIds: spliceCopy(table.columnIds, index, 1),
    cells: table.cells.map(row => spliceCopy(row, index, 1)),
  };
}

export function updateTableCell(table: TableData, id: string, patch: Pick<Partial<TableCell>, 'content' | 'backgroundColor'>): TableData {
  const rowIndex = table.cells.findIndex(row => row.some(cell => cell.id === id));
  if (rowIndex < 0) return table;
  const row = table.cells[rowIndex].map(cell => cell.id === id ? { ...cell, ...patch } : cell);
  return { ...table, cells: spliceCopy(table.cells, rowIndex, 1, row) };
}

export function normalizeKanbanColumns(value: unknown): KanbanColumn[] {
  const source = list(value);
  const columnId = legacyIds(source.map(column => fields(column).id));
  const cardId = legacyIds(source.flatMap(column => list(fields(column).cards).map(card => fields(card).id)));
  return source.map((item, ci) => {
    const column = fields(item);
    return {
      ...column,
      id: columnId(column.id, `legacy-column-${ci}`),
      title: string(column.title, string(item, `Column ${ci + 1}`)),
      cards: list(column.cards).map((item, ri) => {
        const card = fields(item);
        return {
          ...card,
          id: cardId(card.id, `legacy-card-${ci}-${ri}`),
          title: string(card.title, string(item, 'Untitled task')),
          color: string(card.color) || undefined,
          assignee: string(card.assignee) || undefined,
        };
      }),
    };
  });
}

export function moveKanbanCard(columns: KanbanColumn[], cardId: string, targetColumnId: string, beforeCardId?: string): KanbanColumn[] {
  if (cardId === beforeCardId) return columns;
  const source = columns.find(column => column.cards.some(card => card.id === cardId));
  const target = columns.find(column => column.id === targetColumnId);
  const card = source?.cards.find(card => card.id === cardId);
  if (!source || !target || !card) return columns;
  const targetCards = target.cards.filter(item => item.id !== cardId);
  const position = beforeCardId ? targetCards.findIndex(item => item.id === beforeCardId) : targetCards.length;
  if (position < 0) return columns;
  const reordered = spliceCopy(targetCards, position, 0, card);
  if (source === target && reordered.every((item, index) => item === source.cards[index])) return columns;
  return columns.map(column => {
    if (column === target) return { ...column, cards: reordered };
    if (column === source) return { ...column, cards: column.cards.filter(item => item.id !== cardId) };
    return column;
  });
}

export function normalizePollOptions(value: unknown): PollOption[] {
  const source = list(value);
  const optionId = legacyIds(source.map(option => fields(option).id));
  return source.map((item, index) => {
    const option = fields(item);
    const voters = Array.from(new Set(list(option.voters).filter((voter): voter is string => typeof voter === 'string' && !!voter)));
    return {
      ...option,
      id: optionId(option.id, `legacy-option-${index}`),
      text: string(option.text, string(item, `Option ${index + 1}`)),
      voters,
      votes: Math.max(voters.length, integer(option.votes, 0, 0, Number.MAX_SAFE_INTEGER)),
    };
  });
}

export function normalizeDotVotes(value: unknown): DotVote[] {
  return list(value).flatMap(item => {
    const vote = fields(item);
    const { id, userId, x, y } = vote;
    if (typeof id !== 'string' || !id || typeof userId !== 'string' || !userId
      || typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return [];
    return [{ ...vote, id, userId, x, y, userColor: string(vote.userColor, '#6366f1'), targetId: string(vote.targetId) }];
  });
}

export function normalizeDotLimit(value: unknown): number {
  return integer(value, 3, 1, MAX_DOT_VOTES);
}

// V2 waits for a canonical ballot. Compatibility-mode boards still submit
// a guarded widget data edit and use this local representation.
export function applyLegacyWidgetVote(widgetType: string, data: WidgetData, action: WidgetVoteAction, userId: string, userColor: string): WidgetData | undefined {
  if (widgetType === 'poll' && action.action === 'poll-cast') {
    const options = normalizePollOptions(data.options);
    if (options.some(option => option.voters.includes(userId)) || !options.some(option => option.id === action.optionId)) return;
    return { options: options.map(option => option.id === action.optionId
      ? { ...option, voters: [...option.voters, userId], votes: option.votes + 1 } : option) };
  }
  if (widgetType !== 'dot-voting') return;
  const votes = normalizeDotVotes(data.votes);
  switch (action.action) {
    case 'dot-add':
      if (votes.filter(vote => vote.userId === userId).length >= normalizeDotLimit(data.maxVotesPerUser)
        || votes.some(vote => vote.id === action.voteId)) return;
      return { votes: [...votes, { id: action.voteId, userId, userColor, targetId: '', x: action.x, y: action.y }] };
    case 'dot-remove':
      return { votes: votes.filter(vote => vote.id !== action.voteId || vote.userId !== userId) };
    case 'dot-clear':
      return { votes: votes.filter(vote => vote.userId !== userId) };
  }
}

export function idleTimer(minutes: number): TimerData {
  return { minutes: integer(minutes, 5, 1, 180), startedAt: null, deadlineAt: null, remainingMs: null };
}

export function normalizeTimer(data: WidgetData): TimerData {
  const timer = idleTimer(integer(data.minutes, 5, 1, 180));
  const deadlineAt = integer(data.deadlineAt, 0, 1, Number.MAX_SAFE_INTEGER);
  if (deadlineAt > 0) {
    return { ...timer, startedAt: integer(data.startedAt, deadlineAt - timer.minutes * 60_000, 1, deadlineAt), deadlineAt };
  }
  const remainingMs = integer(data.remainingMs, -1, 0, timer.minutes * 60_000);
  return remainingMs < 0 ? timer : { ...timer, remainingMs };
}

export function timerView(timer: TimerData, now: number) {
  const durationMs = timer.minutes * 60_000;
  const remainingMs = timer.deadlineAt === null
    ? timer.remainingMs ?? durationMs
    : Math.min(durationMs, Math.max(0, timer.deadlineAt - now));
  const status = remainingMs === 0 ? 'completed' : timer.deadlineAt !== null ? 'running' : timer.remainingMs === null ? 'idle' : 'paused';
  return { remainingMs, status, progress: remainingMs / durationMs } as const;
}
