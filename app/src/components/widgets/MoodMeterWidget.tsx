// Mood Meter Widget - Team sentiment measurement
import { useState } from 'react';

interface MoodEntry {
  id: string;
  userId: string;
  userName: string;
  color: string;
  quadrant: 'high-pleasant' | 'high-unpleasant' | 'low-unpleasant' | 'low-pleasant';
  x: number;
  y: number;
}

interface MoodMeterWidgetProps {
  id: string;
  x: number;
  y: number;
  entries: MoodEntry[];
  userId: string;
  userName: string;
  userColor: string;
  onUpdate: (data: { entries: MoodEntry[] }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

const QUADRANTS = [
  { id: 'high-pleasant', label: '😄 High Energy\nPleasant', color: '#DCFCE7', x: 1, y: 0 },
  { id: 'high-unpleasant', label: '😤 High Energy\nUnpleasant', color: '#FEE2E2', x: 0, y: 0 },
  { id: 'low-unpleasant', label: '😔 Low Energy\nUnpleasant', color: '#E0E7FF', x: 0, y: 1 },
  { id: 'low-pleasant', label: '😌 Low Energy\nPleasant', color: '#FEF3C7', x: 1, y: 1 },
];

export default function MoodMeterWidget({ x, y, entries, userId, userName, userColor, onUpdate, onDelete, isSelected, onSelect }: MoodMeterWidgetProps) {
  const [hoveredQuadrant, setHoveredQuadrant] = useState<string | null>(null);

  const handleClick = (quadrantId: string, clickX: number, clickY: number) => {
    const existingEntry = entries.find((e) => e.userId === userId);
    const newEntry: MoodEntry = {
      id: existingEntry?.id || `mood-${Date.now()}`,
      userId, userName, color: userColor,
      quadrant: quadrantId as MoodEntry['quadrant'],
      x: clickX, y: clickY,
    };
    const newEntries = existingEntry
      ? entries.map((e) => e.userId === userId ? newEntry : e)
      : [...entries, newEntry];
    onUpdate({ entries: newEntries });
  };

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="mood-meter">
      <div className={`bg-white rounded-xl shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-gray-200'} overflow-hidden`}>
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
          <h3 className="font-semibold text-gray-800">Mood Meter</h3>
          <p className="text-xs text-gray-500">{entries.length} response{entries.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="grid grid-cols-2 w-[320px] h-[320px] relative">
          {QUADRANTS.map((q) => (
            <div key={q.id} className="relative cursor-pointer transition-all"
              style={{ backgroundColor: hoveredQuadrant === q.id ? q.color : `${q.color}80`, gridColumn: q.x + 1, gridRow: q.y + 1 }}
              onMouseEnter={() => setHoveredQuadrant(q.id)}
              onMouseLeave={() => setHoveredQuadrant(null)}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                handleClick(q.id, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
              }}>
              <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-gray-600 whitespace-pre-line p-2">
                {q.label}
              </div>
              {/* User markers */}
              {entries.filter((e) => e.quadrant === q.id).map((entry) => (
                <div key={entry.id} className="absolute w-6 h-6 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: entry.color, left: `${entry.x * 100}%`, top: `${entry.y * 100}%`, transform: 'translate(-50%, -50%)' }}
                  title={entry.userName}>
                  {entry.userName.charAt(0)}
                </div>
              ))}
            </div>
          ))}
          {/* Axis lines */}
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gray-300" />
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gray-300" />
        </div>
      </div>
      {isSelected && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 text-xs">✕</button>
      )}
    </div>
  );
}

