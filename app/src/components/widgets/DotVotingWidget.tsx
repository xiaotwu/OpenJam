// Dot Voting Widget - Visual voting with colored dots
import { useState, useCallback } from 'react';

interface Vote {
  id: string;
  userId: string;
  userColor: string;
  targetId: string;
  x: number;
  y: number;
}

interface DotVotingWidgetProps {
  id: string;
  x: number;
  y: number;
  maxVotesPerUser: number;
  votes: Vote[];
  userId: string;
  userColor: string;
  onUpdate: (data: { votes: Vote[] }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

export default function DotVotingWidget({ x, y, maxVotesPerUser, votes, userId, userColor, onUpdate, onDelete, isSelected, onSelect }: DotVotingWidgetProps) {
  const [showSettings, setShowSettings] = useState(false);
  
  const userVotes = votes.filter((v) => v.userId === userId);
  const remainingVotes = maxVotesPerUser - userVotes.length;

  const handleAddVote = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (remainingVotes <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const voteX = ((e.clientX - rect.left) / rect.width) * 100;
    const voteY = ((e.clientY - rect.top) / rect.height) * 100;
    const newVote: Vote = {
      id: `vote-${Date.now()}`,
      userId, userColor,
      targetId: '',
      x: voteX, y: voteY,
    };
    onUpdate({ votes: [...votes, newVote] });
  }, [remainingVotes, userId, userColor, votes, onUpdate]);

  const handleRemoveVote = useCallback((voteId: string) => {
    const vote = votes.find((v) => v.id === voteId);
    if (vote?.userId !== userId) return;
    onUpdate({ votes: votes.filter((v) => v.id !== voteId) });
  }, [votes, userId, onUpdate]);

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="dot-voting">
      <div className={`bg-white rounded-xl shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-gray-200'} overflow-hidden min-w-[300px]`}>
        {/* Header */}
        <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-100 flex justify-between items-center">
          <div>
            <h3 className="font-semibold text-gray-800">Dot Voting</h3>
            <p className="text-xs text-gray-500">{votes.length} total votes</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">{remainingVotes} votes left</span>
            <button onClick={() => setShowSettings(!showSettings)} className="p-1 hover:bg-yellow-100 rounded">⚙️</button>
          </div>
        </div>

        {/* Voting area */}
        <div className="relative w-[300px] h-[200px] bg-gray-50 cursor-crosshair" onClick={handleAddVote}>
          <div className="absolute inset-0 grid grid-cols-5 grid-rows-4 pointer-events-none">
            {Array(20).fill(0).map((_, i) => (
              <div key={i} className="border border-gray-100" />
            ))}
          </div>
          {/* Votes */}
          {votes.map((vote) => (
            <div key={vote.id} className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md cursor-pointer transform -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform"
              style={{ left: `${vote.x}%`, top: `${vote.y}%`, backgroundColor: vote.userColor }}
              onClick={(e) => { e.stopPropagation(); handleRemoveVote(vote.id); }}
              title={vote.userId === userId ? 'Click to remove' : ''} />
          ))}
        </div>

        {/* Summary */}
        <div className="px-4 py-2 border-t border-gray-100 flex justify-between text-xs text-gray-500">
          <span>Click to place a vote</span>
          <button onClick={() => onUpdate({ votes: votes.filter((v) => v.userId !== userId) })} className="text-red-500 hover:underline">
            Clear my votes
          </button>
        </div>
      </div>
      {isSelected && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 text-xs">✕</button>
      )}
    </div>
  );
}

