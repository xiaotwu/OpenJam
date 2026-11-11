// Reaction Counter Widget - Count emoji reactions
import { useState, useCallback } from 'react';

interface Reaction {
  emoji: string;
  count: number;
  users: string[];
}

interface ReactionCounterWidgetProps {
  id: string;
  x: number;
  y: number;
  reactions: Reaction[];
  userId: string;
  allowMultiple: boolean;
  onUpdate: (data: { reactions: Reaction[]; allowMultiple?: boolean }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

const DEFAULT_EMOJIS = ['👍', '❤️', '🎉', '🤔', '👀', '🔥'];

export default function ReactionCounterWidget({ x, y, reactions, userId, allowMultiple, onUpdate, onDelete, isSelected, onSelect }: ReactionCounterWidgetProps) {
  const [showAnimation, setShowAnimation] = useState<string | null>(null);

  const handleReact = useCallback((emoji: string) => {
    const reaction = reactions.find((r) => r.emoji === emoji);
    const hasReacted = reaction?.users.includes(userId);
    
    let newReactions: Reaction[];
    if (hasReacted) {
      // Remove reaction
      newReactions = reactions.map((r) => r.emoji === emoji
        ? { ...r, count: r.count - 1, users: r.users.filter((u) => u !== userId) }
        : r
      );
    } else {
      // Add reaction
      if (!allowMultiple) {
        // Remove user from all other reactions first
        newReactions = reactions.map((r) => ({
          ...r,
          count: r.users.includes(userId) ? r.count - 1 : r.count,
          users: r.users.filter((u) => u !== userId),
        }));
      } else {
        newReactions = [...reactions];
      }
      
      const existingReaction = newReactions.find((r) => r.emoji === emoji);
      if (existingReaction) {
        newReactions = newReactions.map((r) => r.emoji === emoji
          ? { ...r, count: r.count + 1, users: [...r.users, userId] }
          : r
        );
      } else {
        newReactions.push({ emoji, count: 1, users: [userId] });
      }
      
      // Show animation
      setShowAnimation(emoji);
      setTimeout(() => setShowAnimation(null), 500);
    }
    
    onUpdate({ reactions: newReactions });
  }, [reactions, userId, allowMultiple, onUpdate]);

  const totalReactions = reactions.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="reaction-counter">
      <div className={`bg-white rounded-2xl shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-gray-200'} p-4 min-w-[240px]`}>
        {/* Header */}
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-gray-800">Reactions</h3>
          <span className="text-sm text-gray-500">{totalReactions} total</span>
        </div>

        {/* Emoji buttons */}
        <div className="flex flex-wrap gap-2 justify-center">
          {DEFAULT_EMOJIS.map((emoji) => {
            const reaction = reactions.find((r) => r.emoji === emoji);
            const count = reaction?.count || 0;
            const hasReacted = reaction?.users.includes(userId);
            
            return (
              <button key={emoji} onClick={() => handleReact(emoji)}
                className={`relative flex flex-col items-center p-2 rounded-xl transition-all ${
                  hasReacted ? 'bg-blue-100 border-2 border-blue-300' : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}>
                <span className="text-2xl">{emoji}</span>
                <span className={`text-sm font-medium ${hasReacted ? 'text-blue-600' : 'text-gray-600'}`}>{count}</span>
                
                {/* Animation */}
                {showAnimation === emoji && (
                  <span className="absolute -top-2 text-lg animate-bounce">+1</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Settings */}
        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={allowMultiple} onChange={(e) => onUpdate({ reactions, allowMultiple: e.target.checked })}
              className="rounded" />
            Allow multiple reactions
          </label>
        </div>
      </div>
      {isSelected && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 text-xs">✕</button>
      )}
    </div>
  );
}

