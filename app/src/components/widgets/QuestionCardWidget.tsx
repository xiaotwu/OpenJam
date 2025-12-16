// Question Card Widget - Discussion starter prompts
import { useState, useCallback } from 'react';

interface QuestionCardWidgetProps {
  id: string;
  x: number;
  y: number;
  category: 'icebreaker' | 'reflection' | 'brainstorm' | 'custom';
  currentIndex: number;
  customQuestions?: string[];
  onUpdate: (data: { currentIndex?: number; customQuestions?: string[] }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

const QUESTIONS: Record<string, string[]> = {
  icebreaker: [
    "What's your favorite way to spend a weekend?",
    "If you could have dinner with anyone, who would it be?",
    "What's the best advice you've ever received?",
    "What's a skill you'd love to learn?",
    "What's your go-to comfort food?",
    "If you could travel anywhere, where would you go?",
    "What's something that made you smile today?",
    "What's your hidden talent?",
  ],
  reflection: [
    "What's one thing you're proud of this week?",
    "What challenge helped you grow recently?",
    "What would you do differently if you could?",
    "What's something you learned from a mistake?",
    "How have your priorities changed over time?",
    "What motivates you to do your best work?",
  ],
  brainstorm: [
    "How might we improve our team communication?",
    "What's one thing we should start doing?",
    "What process could we simplify?",
    "How can we better support each other?",
    "What would make our meetings more effective?",
    "What's an idea we haven't tried yet?",
  ],
};

export default function QuestionCardWidget({ x, y, category, currentIndex, customQuestions = [], onUpdate, onDelete, isSelected, onSelect }: QuestionCardWidgetProps) {
  const [isFlipping, setIsFlipping] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(customQuestions.join('\n'));

  const questions = category === 'custom' ? customQuestions : QUESTIONS[category] || [];
  const currentQuestion = questions[currentIndex] || 'No questions available';

  const handleNext = useCallback(() => {
    setIsFlipping(true);
    setTimeout(() => {
      const nextIndex = (currentIndex + 1) % questions.length;
      onUpdate({ currentIndex: nextIndex });
      setIsFlipping(false);
    }, 300);
  }, [currentIndex, questions.length, onUpdate]);

  const handleSaveCustom = () => {
    const newQuestions = editText.split('\n').map((s) => s.trim()).filter(Boolean);
    onUpdate({ customQuestions: newQuestions, currentIndex: 0 });
    setIsEditing(false);
  };

  const categoryColors: Record<string, { bg: string; border: string; text: string }> = {
    icebreaker: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600' },
    reflection: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-600' },
    brainstorm: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-600' },
    custom: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-600' },
  };
  const colors = categoryColors[category] || categoryColors.custom;

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="question-card">
      <div className={`${colors.bg} rounded-2xl shadow-xl border-2 ${isSelected ? 'border-blue-500' : colors.border} overflow-hidden min-w-[280px]`}>
        {isEditing ? (
          <div className="p-4">
            <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
              placeholder="Enter questions (one per line)..." rows={6}
              className="w-full text-sm resize-none outline-none border border-gray-200 rounded p-2" />
            <div className="flex gap-2 mt-2">
              <button onClick={() => setIsEditing(false)} className="flex-1 py-2 text-gray-600 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSaveCustom} className={`flex-1 py-2 ${colors.text} bg-white rounded-lg text-sm font-medium`}>Save</button>
            </div>
          </div>
        ) : (
          <>
            {/* Category badge */}
            <div className="px-4 py-2 border-b border-gray-200/50 flex justify-between items-center">
              <span className={`text-xs font-medium ${colors.text} uppercase`}>{category}</span>
              <span className="text-xs text-gray-400">{currentIndex + 1} / {questions.length}</span>
            </div>

            {/* Question card */}
            <div className={`p-6 min-h-[120px] flex items-center justify-center transition-transform duration-300 ${isFlipping ? 'scale-95 opacity-50' : ''}`}>
              <p className="text-lg font-medium text-gray-800 text-center">{currentQuestion}</p>
            </div>

            {/* Controls */}
            <div className="px-4 py-3 border-t border-gray-200/50 flex justify-between">
              <button onClick={() => setIsEditing(true)} className="text-sm text-gray-500 hover:text-gray-700">
                {category === 'custom' ? 'Edit questions' : 'Add custom'}
              </button>
              <button onClick={handleNext} disabled={questions.length <= 1}
                className={`px-4 py-1.5 ${colors.text} bg-white rounded-lg text-sm font-medium hover:shadow disabled:opacity-50`}>
                Next →
              </button>
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

