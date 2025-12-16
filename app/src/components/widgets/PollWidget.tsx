// Poll Widget - Quick structured voting
import { useState } from 'react';

interface PollOption {
  id: string;
  text: string;
  votes: number;
  voters: string[];
}

interface PollWidgetProps {
  id: string;
  x: number;
  y: number;
  question: string;
  options: PollOption[];
  showResults: boolean;
  userId: string;
  onUpdate: (data: { question?: string; options?: PollOption[]; showResults?: boolean }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

export default function PollWidget({
  x, y, question, options, showResults, userId, onUpdate, onDelete, isSelected, onSelect,
}: PollWidgetProps) {
  const [isEditing, setIsEditing] = useState(!question);
  const [editQuestion, setEditQuestion] = useState(question);
  const [editOptions, setEditOptions] = useState(options.map((o) => o.text).join('\n') || 'Option 1\nOption 2\nOption 3');

  const hasVoted = options.some((o) => o.voters.includes(userId));
  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);

  const handleVote = (optionId: string) => {
    if (hasVoted) return;
    const newOptions = options.map((o) => o.id === optionId
      ? { ...o, votes: o.votes + 1, voters: [...o.voters, userId] }
      : o
    );
    onUpdate({ options: newOptions });
  };

  const handleSave = () => {
    const newOptions = editOptions.split('\n').filter((t) => t.trim()).map((text, i) => ({
      id: `opt-${i}`,
      text: text.trim(),
      votes: 0,
      voters: [],
    }));
    onUpdate({ question: editQuestion, options: newOptions });
    setIsEditing(false);
  };

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="poll">
      <div className={`bg-white rounded-xl shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-gray-200'} min-w-[280px] overflow-hidden`}>
        {isEditing ? (
          <div className="p-4">
            <input type="text" value={editQuestion} onChange={(e) => setEditQuestion(e.target.value)}
              placeholder="Enter your question..." className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3 text-sm" />
            <textarea value={editOptions} onChange={(e) => setEditOptions(e.target.value)}
              placeholder="Enter options (one per line)..." rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3 text-sm resize-none" />
            <button onClick={handleSave} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Create Poll
            </button>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
              <h3 className="font-semibold text-gray-900">{question}</h3>
              <p className="text-xs text-gray-500 mt-1">{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</p>
            </div>
            <div className="p-3 space-y-2">
              {options.map((option) => {
                const percentage = totalVotes > 0 ? (option.votes / totalVotes) * 100 : 0;
                const isVotedByUser = option.voters.includes(userId);
                return (
                  <button key={option.id} onClick={() => handleVote(option.id)} disabled={hasVoted}
                    className={`w-full text-left p-3 rounded-lg border transition-all relative overflow-hidden ${
                      isVotedByUser ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                    } ${hasVoted ? 'cursor-default' : 'cursor-pointer'}`}>
                    {(showResults || hasVoted) && (
                      <div className="absolute inset-0 bg-blue-100 transition-all" style={{ width: `${percentage}%` }} />
                    )}
                    <div className="relative flex justify-between items-center">
                      <span className="text-sm font-medium">{option.text}</span>
                      {(showResults || hasVoted) && (
                        <span className="text-sm text-gray-600">{Math.round(percentage)}%</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="px-4 py-2 border-t border-gray-100 flex justify-between">
              <button onClick={() => onUpdate({ showResults: !showResults })}
                className="text-xs text-blue-600 hover:underline">
                {showResults ? 'Hide results' : 'Show results'}
              </button>
              <button onClick={() => setIsEditing(true)} className="text-xs text-gray-500 hover:underline">Edit</button>
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

