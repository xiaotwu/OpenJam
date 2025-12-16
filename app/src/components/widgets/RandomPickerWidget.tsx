// Random Picker Widget - Randomly select participants
import { useState, useCallback } from 'react';

interface RandomPickerWidgetProps {
  id: string;
  x: number;
  y: number;
  items: string[];
  pickedItems: string[];
  onUpdate: (data: { items?: string[]; pickedItems?: string[] }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

export default function RandomPickerWidget({ x, y, items, pickedItems, onUpdate, onDelete, isSelected, onSelect }: RandomPickerWidgetProps) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(items.length === 0);
  const [editText, setEditText] = useState(items.join('\n'));

  const availableItems = items.filter((item) => !pickedItems.includes(item));

  const handlePick = useCallback(() => {
    if (availableItems.length === 0) return;
    setIsSpinning(true);
    setWinner(null);
    
    // Animate through items
    let count = 0;
    const maxCount = 20;
    const interval = setInterval(() => {
      const randomItem = availableItems[Math.floor(Math.random() * availableItems.length)];
      setWinner(randomItem);
      count++;
      if (count >= maxCount) {
        clearInterval(interval);
        setIsSpinning(false);
        const finalWinner = availableItems[Math.floor(Math.random() * availableItems.length)];
        setWinner(finalWinner);
        onUpdate({ pickedItems: [...pickedItems, finalWinner] });
      }
    }, 100);
  }, [availableItems, pickedItems, onUpdate]);

  const handleReset = () => {
    onUpdate({ pickedItems: [] });
    setWinner(null);
  };

  const handleSaveItems = () => {
    const newItems = editText.split('\n').map((s) => s.trim()).filter(Boolean);
    onUpdate({ items: newItems, pickedItems: [] });
    setIsEditing(false);
  };

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="random-picker">
      <div className={`bg-gradient-to-br from-purple-600 to-pink-500 rounded-2xl shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-purple-400'} p-4 min-w-[220px]`}>
        {isEditing ? (
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
                {winner || 'Click to pick!'}
              </div>
            </div>

            {/* Controls */}
            <div className="flex gap-2 mb-3">
              <button onClick={handlePick} disabled={isSpinning || availableItems.length === 0}
                className="flex-1 py-2 bg-white text-purple-600 rounded-lg font-semibold disabled:opacity-50 hover:bg-purple-50">
                {isSpinning ? '...' : 'Pick'}
              </button>
              <button onClick={handleReset} className="px-3 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30">↺</button>
              <button onClick={() => setIsEditing(true)} className="px-3 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30">✎</button>
            </div>

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

