import { useState } from 'react';

export interface Stamp {
  id: string;
  emoji: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  userId: string;
  createdAt: number;
}

// Available stamp categories
// eslint-disable-next-line react-refresh/only-export-components
export const STAMP_CATEGORIES = {
  reactions: ['👍', '👎', '❤️', '🔥', '⭐', '👀', '💯', '🎉', '🤔', '😂', '😍', '🙌'],
  arrows: ['➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '🔄', '↩️', '↪️', '🔀'],
  shapes: ['⭕', '❌', '✅', '❓', '❗', '💡', '🔴', '🟢', '🟡', '🔵', '⚫', '⚪'],
  objects: ['📌', '📎', '✏️', '🔑', '🎯', '🏆', '💎', '🔔', '📁', '📊', '📈', '📉'],
};

interface StampPickerProps {
  onSelectStamp: (emoji: string) => void;
  onClose: () => void;
}

export function StampPicker({ onSelectStamp, onClose }: StampPickerProps) {
  const [activeCategory, setActiveCategory] = useState<keyof typeof STAMP_CATEGORIES>('reactions');

  return (
    <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-3 w-72">
      {/* Category tabs */}
      <div className="flex gap-1 mb-3 border-b border-gray-100 pb-2">
        {(Object.keys(STAMP_CATEGORIES) as (keyof typeof STAMP_CATEGORIES)[]).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
              activeCategory === cat
                ? 'bg-purple-100 text-purple-700'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="grid grid-cols-6 gap-1">
        {STAMP_CATEGORIES[activeCategory].map((emoji) => (
          <button
            key={emoji}
            onClick={() => {
              onSelectStamp(emoji);
              onClose();
            }}
            className="w-10 h-10 flex items-center justify-center text-xl hover:bg-gray-100 rounded-lg transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Quick access row */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="text-xs text-gray-400 mb-2">Quick access</div>
        <div className="flex gap-1">
          {['👍', '❤️', '🔥', '✅', '❌', '🤔'].map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onSelectStamp(emoji);
                onClose();
              }}
              className="w-8 h-8 flex items-center justify-center text-lg hover:bg-gray-100 rounded-lg transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Default export for the StampPicker component
export default StampPicker;

interface StampElementProps {
  stamp: Stamp;
  isSelected: boolean;
  onSelect: (id: string, addToSelection: boolean) => void;
  onDelete: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
}

export function StampElement({ stamp, isSelected, onSelect, onDelete, onMove }: StampElementProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialPos, setInitialPos] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Select the stamp
    onSelect(stamp.id, e.shiftKey);
    
    // Start dragging if already selected or just selected
    if (isSelected || !e.shiftKey) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setInitialPos({ x: stamp.x, y: stamp.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !onMove) return;
    
    e.stopPropagation();
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    onMove(stamp.id, initialPos.x + dx, initialPos.y + dy);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(stamp.id);
  };

  return (
    <div
      className={`absolute select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${!isDragging ? 'hover:scale-110 transition-transform' : ''}`}
      style={{
        left: stamp.x,
        top: stamp.y,
        transform: `translate(-50%, -50%) scale(${stamp.scale}) rotate(${stamp.rotation}deg)`,
        fontSize: '2rem',
        zIndex: isSelected ? 1001 : 1000,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      <span className="drop-shadow-md">{stamp.emoji}</span>
      
      {/* Selection ring with drag handle indicator */}
      {isSelected && (
        <div className="absolute -inset-2 border-2 border-purple-500 rounded-full pointer-events-none">
          {/* Corner indicators for dragging */}
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-purple-500 rounded-full" />
          <div className="absolute -top-1 -right-1 w-2 h-2 bg-purple-500 rounded-full" />
          <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-purple-500 rounded-full" />
          <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-purple-500 rounded-full" />
        </div>
      )}
    </div>
  );
}
