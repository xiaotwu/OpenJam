// Kanban Board Widget - Task management with columns
import { useState, useCallback } from 'react';

interface KanbanCard {
  id: string;
  title: string;
  color?: string;
  assignee?: string;
}

interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

interface KanbanWidgetProps {
  id: string;
  x: number;
  y: number;
  columns: KanbanColumn[];
  onUpdate: (data: { columns: KanbanColumn[] }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

const CARD_COLORS = ['#FEF3C7', '#DCFCE7', '#DBEAFE', '#F3E8FF', '#FCE7F3', '#FED7AA'];

export default function KanbanWidget({ x, y, columns, onUpdate, onDelete, isSelected, onSelect }: KanbanWidgetProps) {
  const [draggedCard, setDraggedCard] = useState<{ columnId: string; cardId: string } | null>(null);
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);

  const handleAddCard = useCallback((columnId: string) => {
    const newCard: KanbanCard = { id: `card-${Date.now()}`, title: 'New task', color: CARD_COLORS[0] };
    const newColumns = columns.map((col) => col.id === columnId ? { ...col, cards: [...col.cards, newCard] } : col);
    onUpdate({ columns: newColumns });
    setEditingCard(newCard.id);
  }, [columns, onUpdate]);

  const handleUpdateCard = useCallback((columnId: string, cardId: string, updates: Partial<KanbanCard>) => {
    const newColumns = columns.map((col) => col.id === columnId
      ? { ...col, cards: col.cards.map((card) => card.id === cardId ? { ...card, ...updates } : card) }
      : col
    );
    onUpdate({ columns: newColumns });
  }, [columns, onUpdate]);

  const handleDeleteCard = useCallback((columnId: string, cardId: string) => {
    const newColumns = columns.map((col) => col.id === columnId
      ? { ...col, cards: col.cards.filter((card) => card.id !== cardId) }
      : col
    );
    onUpdate({ columns: newColumns });
  }, [columns, onUpdate]);

  const handleDrop = useCallback((targetColumnId: string) => {
    if (!draggedCard || draggedCard.columnId === targetColumnId) return;
    const sourceCol = columns.find((c) => c.id === draggedCard.columnId);
    const card = sourceCol?.cards.find((c) => c.id === draggedCard.cardId);
    if (!card) return;
    const newColumns = columns.map((col) => {
      if (col.id === draggedCard.columnId) return { ...col, cards: col.cards.filter((c) => c.id !== draggedCard.cardId) };
      if (col.id === targetColumnId) return { ...col, cards: [...col.cards, card] };
      return col;
    });
    onUpdate({ columns: newColumns });
    setDraggedCard(null);
  }, [columns, draggedCard, onUpdate]);

  const handleAddColumn = useCallback(() => {
    const newColumn: KanbanColumn = { id: `col-${Date.now()}`, title: 'New Column', cards: [] };
    onUpdate({ columns: [...columns, newColumn] });
  }, [columns, onUpdate]);

  const handleUpdateColumn = useCallback((columnId: string, title: string) => {
    const newColumns = columns.map((col) => col.id === columnId ? { ...col, title } : col);
    onUpdate({ columns: newColumns });
    setEditingColumn(null);
  }, [columns, onUpdate]);

  const handleDeleteColumn = useCallback((columnId: string) => {
    if (columns.length <= 1) return;
    onUpdate({ columns: columns.filter((col) => col.id !== columnId) });
  }, [columns, onUpdate]);

  const handleContainerClick = (e: React.MouseEvent) => {
    // Only select if clicking on the background, not on interactive elements
    if (e.target === e.currentTarget) {
      onSelect();
    }
  };

  return (
    <div className="absolute" style={{ left: x, top: y }} data-widget="kanban">
      <div 
        className={`bg-gray-100 rounded-xl shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-gray-300'} p-3 cursor-pointer`} 
        onClick={handleContainerClick}
      >
        <div className="flex gap-3" onClick={handleContainerClick}>
          {columns.map((column) => (
            <div key={column.id} className="w-56 bg-gray-200 rounded-lg p-2"
              onDragOver={(e) => e.preventDefault()} onDrop={() => handleDrop(column.id)} onClick={handleContainerClick}>
              {/* Column header */}
              <div className="flex items-center justify-between mb-2 px-1">
                {editingColumn === column.id ? (
                  <input type="text" defaultValue={column.title} autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => handleUpdateColumn(column.id, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUpdateColumn(column.id, (e.target as HTMLInputElement).value)}
                    className="flex-1 px-1 py-0.5 text-sm font-semibold bg-white rounded" />
                ) : (
                  <h4 className="text-sm font-semibold text-gray-700 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingColumn(column.id); }}>
                    {column.title} <span className="text-gray-400 font-normal">({column.cards.length})</span>
                  </h4>
                )}
                <button onClick={(e) => { e.stopPropagation(); handleDeleteColumn(column.id); }} className="text-gray-400 hover:text-red-500 text-xs">✕</button>
              </div>

              {/* Cards */}
              <div className="space-y-2 min-h-[60px]">
                {column.cards.map((card) => (
                  <div key={card.id} draggable onDragStart={() => setDraggedCard({ columnId: column.id, cardId: card.id })}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white rounded-lg p-2 shadow-sm cursor-move hover:shadow-md transition-shadow group"
                    style={{ borderLeft: `3px solid ${card.color || '#E5E7EB'}` }}>
                    {editingCard === card.id ? (
                      <input type="text" defaultValue={card.title} autoFocus
                        onBlur={(e) => { handleUpdateCard(column.id, card.id, { title: e.target.value }); setEditingCard(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { handleUpdateCard(column.id, card.id, { title: (e.target as HTMLInputElement).value }); setEditingCard(null); }}}
                        className="w-full text-sm bg-transparent outline-none" />
                    ) : (
                      <div className="flex justify-between items-start">
                        <span className="text-sm text-gray-800 cursor-text" onClick={() => setEditingCard(card.id)}>{card.title}</span>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteCard(column.id, card.id); }}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs">✕</button>
                      </div>
                    )}
                    {/* Color picker */}
                    <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {CARD_COLORS.map((color) => (
                        <button key={color} onClick={(e) => { e.stopPropagation(); handleUpdateCard(column.id, card.id, { color }); }}
                          className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Add card button */}
              <button onClick={(e) => { e.stopPropagation(); handleAddCard(column.id); }}
                className="w-full mt-2 py-1.5 text-sm text-gray-500 hover:bg-gray-300 rounded transition-colors">+ Add card</button>
            </div>
          ))}
          {/* Add column button */}
          <button onClick={(e) => { e.stopPropagation(); handleAddColumn(); }}
            className="w-12 h-12 bg-gray-200 hover:bg-gray-300 rounded-lg flex items-center justify-center text-gray-500 self-start">+</button>
        </div>
      </div>
      {isSelected && (
        <button 
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(); }} 
          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 text-xs z-10"
        >✕</button>
      )}
    </div>
  );
}

