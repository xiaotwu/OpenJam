import { useMemo, useState } from 'react';
import {
  moveKanbanCard, newWidgetPartId, normalizeKanbanColumns, type KanbanCard, type KanbanColumn, type WidgetData,
} from '../../lib/workshopWidgets';
import WidgetTextInput from './WidgetTextInput';

interface KanbanWidgetProps {
  x: number;
  y: number;
  data: WidgetData;
  editable: boolean;
  onUpdate: (data: { columns: KanbanColumn[] }, expected?: WidgetData) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

interface EditingTitle {
  id: string;
  kind: 'column' | 'card';
  value: string;
  columns: KanbanColumn[];
  data: WidgetData;
}

const CARD_COLORS = [
  ['Yellow', '#FEF3C7'], ['Green', '#DCFCE7'], ['Blue', '#DBEAFE'],
  ['Purple', '#F3E8FF'], ['Pink', '#FCE7F3'], ['Orange', '#FED7AA'],
] as const;
const smallButton = 'rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-35';

export default function KanbanWidget({ x, y, data, editable, onUpdate, onDelete, isSelected, onSelect }: KanbanWidgetProps) {
  const columns = useMemo(() => normalizeKanbanColumns(data.columns), [data.columns]);
  const [draggedCardId, setDraggedCardId] = useState<string>();
  const [editing, setEditing] = useState<EditingTitle | null>(null);

  function beginEditing(id: string, kind: EditingTitle['kind'], value: string) {
    setEditing({ id, kind, value, columns, data });
  }

  function changeCard(columnId: string, cardId: string, patch: Partial<KanbanCard>) {
    onUpdate({ columns: columns.map(column => column.id === columnId ? {
      ...column, cards: column.cards.map(card => card.id === cardId ? { ...card, ...patch } : card),
    } : column) });
  }

  function saveTitle(entry: EditingTitle, input: string) {
    setEditing(null);
    const title = input.trim();
    if (!title || title === entry.value) return;
    const latest = entry.kind === 'column'
      ? columns.find(column => column.id === entry.id)
      : columns.flatMap(column => column.cards).find(card => card.id === entry.id);
    const unchanged = latest?.title === entry.value;
    const basis = unchanged ? columns : entry.columns;
    const next = basis.map(column => {
      if (entry.kind === 'column') return column.id === entry.id ? { ...column, title } : column;
      if (!column.cards.some(card => card.id === entry.id)) return column;
      return { ...column, cards: column.cards.map(card => card.id === entry.id ? { ...card, title } : card) };
    });
    onUpdate({ columns: next }, unchanged ? undefined : entry.data);
  }

  function addCard(columnId: string) {
    const card: KanbanCard = { id: newWidgetPartId('card'), title: 'New task', color: CARD_COLORS[0][1] };
    const next = columns.map(column => column.id === columnId ? { ...column, cards: [...column.cards, card] } : column);
    onUpdate({ columns: next });
    setEditing({ id: card.id, kind: 'card', value: card.title, columns: next, data: { ...data, columns: next } });
  }

  function moveCard(cardId: string, columnId: string, beforeCardId?: string) {
    const next = moveKanbanCard(columns, cardId, columnId, beforeCardId);
    if (next !== columns) onUpdate({ columns: next });
    setDraggedCardId(undefined);
  }

  function drop(event: React.DragEvent, columnId: string, beforeCardId?: string) {
    if (!editable || !draggedCardId) return;
    event.preventDefault();
    event.stopPropagation();
    moveCard(draggedCardId, columnId, beforeCardId);
  }

  function allowDrop(event: React.DragEvent) {
    if (!editable || !draggedCardId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  return (
    <div className="absolute" style={{ left: x, top: y }} data-widget="kanban" onClick={onSelect}>
      <div className={`flex gap-3 rounded-xl border-2 canvas-widget-surface p-3 text-gray-900 shadow-xl ${isSelected ? 'border-blue-500' : 'border-gray-300'}`}>
        {columns.map(column => (
          <section key={column.id} aria-label={column.title} className="w-56 rounded-lg bg-gray-200 p-2" onDragOver={allowDrop} onDrop={event => drop(event, column.id)}>
            <div className="mb-2 flex items-center justify-between gap-1 px-1">
              {editable && editing?.id === column.id && editing.kind === 'column' ? (
                <WidgetTextInput label="Column name" value={editing.value} maxLength={160}
                  onCommit={value => saveTitle(editing, value)} onCancel={() => setEditing(null)}
                  className="min-w-0 flex-1 rounded bg-white px-1 py-0.5 text-sm font-semibold outline-2 outline-blue-500" />
              ) : editable ? (
                <button type="button" className="min-w-0 text-left text-sm font-semibold" aria-label={`Rename ${column.title}`}
                  onClick={() => beginEditing(column.id, 'column', column.title)}>{column.title}</button>
              ) : <h4 className="min-w-0 text-sm font-semibold">{column.title}</h4>}
              <span className="text-xs text-gray-600">{column.cards.length}</span>
              {editable && (
                <button type="button" aria-label={`Delete ${column.title} column`} className={smallButton}
                  title={column.cards.length ? 'Move cards before deleting this column' : undefined}
                  disabled={columns.length <= 1 || column.cards.length > 0}
                  onClick={() => onUpdate({ columns: columns.filter(item => item.id !== column.id) })}>✕</button>
              )}
            </div>

            <div className="min-h-[60px] space-y-2">
              {column.cards.map((card, index) => (
                <div key={card.id} data-kanban-card={card.id}
                  draggable={editable && editing?.id !== card.id}
                  onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', card.id);
                    setDraggedCardId(card.id);
                  }}
                  onDragEnd={() => setDraggedCardId(undefined)} onDragOver={allowDrop}
                  onDrop={event => drop(event, column.id, card.id)}
                  className={`group rounded-lg bg-white p-2 shadow-sm ${draggedCardId === card.id ? 'opacity-50' : ''}`}
                  style={{ borderLeft: `3px solid ${card.color || '#E5E7EB'}` }}>
                  {editable && editing?.id === card.id && editing.kind === 'card' ? (
                    <WidgetTextInput label="Task title" value={editing.value} maxLength={500}
                      onCommit={value => saveTitle(editing, value)} onCancel={() => setEditing(null)}
                      className="w-full bg-transparent text-sm outline-2 outline-blue-500" />
                  ) : editable ? (
                    <div className="flex items-start justify-between gap-1">
                      <button type="button" aria-label={`Rename task ${card.title}`} onClick={() => beginEditing(card.id, 'card', card.title)}
                        className="min-w-0 break-words text-left text-sm text-gray-800">{card.title}</button>
                      <button type="button" aria-label={`Delete task ${card.title}`} className={smallButton}
                        onClick={() => onUpdate({ columns: columns.map(item => item.id === column.id
                          ? { ...item, cards: item.cards.filter(entry => entry.id !== card.id) } : item) })}>✕</button>
                    </div>
                  ) : <p className="break-words text-sm text-gray-800">{card.title}</p>}
                  {editable && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
                      <div className="flex items-center gap-1">
                        <button type="button" aria-label={`Move ${card.title} up`} className={smallButton} disabled={index === 0}
                          onClick={() => moveCard(card.id, column.id, column.cards[index - 1]?.id)}>↑</button>
                        <button type="button" aria-label={`Move ${card.title} down`} className={smallButton} disabled={index === column.cards.length - 1}
                          onClick={() => moveCard(card.id, column.id, column.cards[index + 2]?.id)}>↓</button>
                        <select aria-label={`Move ${card.title} to column`} value={column.id}
                          className="max-w-24 rounded border border-gray-200 bg-white p-0.5 text-xs text-gray-700"
                          onChange={event => moveCard(card.id, event.target.value)}>
                          {columns.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                        </select>
                      </div>
                      <div className="flex gap-1">
                        {CARD_COLORS.map(([label, color]) => (
                          <button type="button" key={color} aria-label={`Set ${card.title} to ${label.toLowerCase()}`} className="h-3 w-3 rounded-full border border-gray-300"
                            style={{ backgroundColor: color }} onClick={() => changeCard(column.id, card.id, { color })} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {editable && <button type="button" aria-label={`Add card to ${column.title}`} onClick={() => addCard(column.id)}
              className="mt-2 w-full rounded py-1.5 text-sm text-gray-600 hover:bg-gray-300">+ Add card</button>}
          </section>
        ))}
        {editable && (
          <button type="button" onClick={() => onUpdate({ columns: [...columns, { id: newWidgetPartId('column'), title: 'New column', cards: [] }] })}
            className="self-start rounded-lg bg-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-300">+ Add column</button>
        )}
        {!editable && columns.length === 0 && <p className="text-sm text-gray-600">No columns</p>}
      </div>
      {editable && isSelected && <button type="button" aria-label="Delete kanban board" onClick={event => { event.stopPropagation(); onDelete(); }}
        className="absolute -right-2 -top-2 z-10 h-6 w-6 rounded-full bg-red-600 text-xs text-white hover:bg-red-700">✕</button>}
    </div>
  );
}
