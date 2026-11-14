// Random Picker Widget - Randomly select participants
import { useEffect, useState } from 'react';

interface RandomPickerWidgetProps {
  id: string;
  x: number;
  y: number;
  items: string[];
  pickedItems: string[];
  onUpdate: (data: { items?: string[]; pickedItems?: string[] }) => void;
  onDelete: () => void;
  isSelected: boolean;
  editable?: boolean;
  onSelect: () => void;
}

export default function RandomPickerWidget({ x, y, items, pickedItems, onUpdate, onDelete, isSelected, onSelect, editable = true }: RandomPickerWidgetProps) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [isEditing, setIsEditing] = useState(items.length === 0);
  const [editText, setEditText] = useState(items.join('\n'));

  const picked = new Set(pickedItems);
  const availableItems = items.filter(item => !picked.has(item));
  const winner = pickedItems.at(-1);

  useEffect(() => {
    if (!isSpinning) return;
    const timeout = window.setTimeout(() => setIsSpinning(false), 300);
    return () => window.clearTimeout(timeout);
  }, [isSpinning]);

  const handlePick = () => {
    if (!availableItems.length || isSpinning) return;
    const finalWinner = availableItems[Math.floor(Math.random() * availableItems.length)];
    onUpdate({ pickedItems: [...pickedItems, finalWinner] });
    setIsSpinning(true);
  };

  const handleSaveItems = () => {
    const newItems = editText.split('\n').map((s) => s.trim()).filter(Boolean);
    onUpdate({ items: newItems, pickedItems: [] });
    setIsEditing(false);
  };

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="random-picker">
      <div className={`bg-gradient-to-br from-purple-600 to-pink-500 rounded-2xl shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-purple-400'} p-4 min-w-[220px]`}>
        {editable && isEditing ? (
          <div className="bg-white rounded-lg p-3">
            <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
              placeholder="Enter names (one per line)..." rows={6}
              className="w-full text-sm resize-none outline-none border border-gray-200 rounded p-2" />
            <button onClick={handleSaveItems} className="w-full mt-2 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium">Save</button>
          </div>
        ) : (
          <>
            {/* Winner display */}
            <div className={`bg-white rounded-xl p-4 text-center mb-3 ${isSpinning ? 'animate-pulse' : ''}`}>
              <div className="text-3xl mb-1">🎲</div>
              <div className={`text-xl font-bold ${winner ? 'text-purple-600' : 'text-gray-400'}`}>
                {winner || (editable ? 'Ready to pick' : 'No selection yet')}
              </div>
            </div>

            {/* Controls */}
            {editable && <div className="flex gap-2 mb-3">
              <button onClick={handlePick} disabled={isSpinning || availableItems.length === 0}
                className="flex-1 py-2 bg-white text-purple-600 rounded-lg font-semibold disabled:opacity-50 hover:bg-purple-50">
                {isSpinning ? '...' : 'Pick'}
              </button>
              <button type="button" aria-label="Reset picks" onClick={() => onUpdate({ pickedItems: [] })} className="px-3 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30">↺</button>
              <button type="button" aria-label="Edit participants" onClick={() => { setEditText(items.join('\n')); setIsEditing(true); }}
                className="px-3 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30">✎</button>
            </div>}

            {/* Stats */}
            <div className="text-center text-white/80 text-sm">
              {availableItems.length} of {items.length} remaining
            </div>
          </>
        )}
      </div>
      {isSelected && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 text-xs">✕</button>
      )}
    </div>
  );
}

