// Retrospective Widget - Team retrospective boards
import { useState, useCallback } from 'react';

interface RetroNote {
  id: string;
  text: string;
  votes: number;
  author: string;
}

interface RetroColumn {
  id: string;
  title: string;
  emoji: string;
  color: string;
  notes: RetroNote[];
}

interface RetroWidgetProps {
  id: string;
  x: number;
  y: number;
  template: 'start-stop-continue' | 'mad-sad-glad' | 'keep-drop-add';
  columns: RetroColumn[];
  userId: string;
  onUpdate: (data: { columns: RetroColumn[] }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

export default function RetroWidget({ x, y, columns, userId, onUpdate, onDelete, isSelected, onSelect }: RetroWidgetProps) {
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [newNoteColumn, setNewNoteColumn] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');

  const handleAddNote = useCallback((columnId: string) => {
    if (!newNoteText.trim()) return;
    const newNote: RetroNote = { id: `note-${Date.now()}`, text: newNoteText.trim(), votes: 0, author: userId };
    const newColumns = columns.map((col) => col.id === columnId ? { ...col, notes: [...col.notes, newNote] } : col);
    onUpdate({ columns: newColumns });
    setNewNoteText('');
    setNewNoteColumn(null);
  }, [columns, newNoteText, userId, onUpdate]);

  const handleVote = useCallback((columnId: string, noteId: string) => {
    const newColumns = columns.map((col) => col.id === columnId
      ? { ...col, notes: col.notes.map((note) => note.id === noteId ? { ...note, votes: note.votes + 1 } : note) }
      : col
    );
    onUpdate({ columns: newColumns });
  }, [columns, onUpdate]);

  const handleDeleteNote = useCallback((columnId: string, noteId: string) => {
    const newColumns = columns.map((col) => col.id === columnId
      ? { ...col, notes: col.notes.filter((note) => note.id !== noteId) }
      : col
    );
    onUpdate({ columns: newColumns });
  }, [columns, onUpdate]);

  const handleUpdateNote = useCallback((columnId: string, noteId: string, text: string) => {
    const newColumns = columns.map((col) => col.id === columnId
      ? { ...col, notes: col.notes.map((note) => note.id === noteId ? { ...note, text } : note) }
      : col
    );
    onUpdate({ columns: newColumns });
    setEditingNote(null);
  }, [columns, onUpdate]);

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="retro">
      <div className={`bg-white rounded-xl shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-gray-200'} overflow-hidden`}>
        <div className="flex">
          {columns.map((column) => (
            <div key={column.id} className="w-64 border-r border-gray-200 last:border-r-0" style={{ backgroundColor: column.color }}>
              {/* Column header */}
              <div className="px-3 py-2 border-b border-gray-200 bg-white/50">
                <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                  <span>{column.emoji}</span> {column.title}
                  <span className="text-xs text-gray-500 font-normal">({column.notes.length})</span>
                </h4>
              </div>

              {/* Notes */}
              <div className="p-2 space-y-2 min-h-[120px] max-h-[300px] overflow-y-auto">
                {column.notes.sort((a, b) => b.votes - a.votes).map((note) => (
                  <div key={note.id} className="bg-white rounded-lg p-2 shadow-sm group">
                    {editingNote === note.id ? (
                      <textarea defaultValue={note.text} autoFocus rows={2}
                        onBlur={(e) => handleUpdateNote(column.id, note.id, e.target.value)}
                        className="w-full text-sm resize-none outline-none" />
                    ) : (
                      <>
                        <p className="text-sm text-gray-800 cursor-pointer" onClick={() => setEditingNote(note.id)}>{note.text}</p>
                        <div className="flex justify-between items-center mt-2">
                          <button onClick={() => handleVote(column.id, note.id)}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600">
                            👍 {note.votes > 0 && note.votes}
                          </button>
                          <button onClick={() => handleDeleteNote(column.id, note.id)}
                            className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500">✕</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {/* Add note input */}
                {newNoteColumn === column.id ? (
                  <div className="bg-white rounded-lg p-2 shadow-sm">
                    <textarea value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)} autoFocus
                      placeholder="Add a note..." rows={2} className="w-full text-sm resize-none outline-none" />
                    <div className="flex justify-end gap-1 mt-1">
                      <button onClick={() => setNewNoteColumn(null)} className="px-2 py-1 text-xs text-gray-500">Cancel</button>
                      <button onClick={() => handleAddNote(column.id)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">Add</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setNewNoteColumn(column.id)}
                    className="w-full py-2 text-sm text-gray-500 hover:bg-white/50 rounded transition-colors">+ Add note</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {isSelected && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 text-xs">✕</button>
      )}
    </div>
  );
}

