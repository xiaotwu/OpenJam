import { useState } from 'react';

interface Widget {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  category: 'basic' | 'agile' | 'voting' | 'timer' | 'icebreaker';
}

interface WidgetsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertWidget: (widgetId: string) => void;
}

const WIDGETS: Widget[] = [
  // Basic widgets
  {
    id: 'table',
    name: 'Table',
    category: 'basic',
    description: 'Create structured data tables',
    icon: <TableIcon />,
  },
  
  // Timer widgets
  {
    id: 'timer',
    name: 'Timer',
    category: 'timer',
    description: 'Countdown timer for activities',
    icon: <TimerIcon />,
  },
  {
    id: 'stopwatch',
    name: 'Stopwatch',
    category: 'timer',
    description: 'Track elapsed time',
    icon: <StopwatchIcon />,
  },
  
  // Voting widgets
  {
    id: 'dot-voting',
    name: 'Dot Voting',
    category: 'voting',
    description: 'Let participants vote with dots',
    icon: <DotVotingIcon />,
  },
  {
    id: 'poll',
    name: 'Poll',
    category: 'voting',
    description: 'Create quick polls',
    icon: <PollIcon />,
  },
  {
    id: 'reactions',
    name: 'Reaction Counter',
    category: 'voting',
    description: 'Count emoji reactions',
    icon: <ReactionIcon />,
  },
  
  // Agile widgets
  {
    id: 'kanban',
    name: 'Kanban Board',
    category: 'agile',
    description: 'Manage tasks in columns',
    icon: <KanbanIcon />,
  },
  {
    id: 'sprint-board',
    name: 'Sprint Board',
    category: 'agile',
    description: 'Plan your sprint',
    icon: <SprintIcon />,
  },
  {
    id: 'retro',
    name: 'Retrospective',
    category: 'agile',
    description: 'Run team retrospectives',
    icon: <RetroIcon />,
  },
  
  // Icebreaker widgets
  {
    id: 'random-picker',
    name: 'Random Picker',
    category: 'icebreaker',
    description: 'Pick random participants',
    icon: <RandomIcon />,
  },
  {
    id: 'mood-meter',
    name: 'Mood Meter',
    category: 'icebreaker',
    description: 'Check team mood',
    icon: <MoodIcon />,
  },
  {
    id: 'question',
    name: 'Question Card',
    category: 'icebreaker',
    description: 'Discussion starter questions',
    icon: <QuestionIcon />,
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'basic', label: 'Basic' },
  { id: 'timer', label: 'Timers' },
  { id: 'voting', label: 'Voting' },
  { id: 'agile', label: 'Agile' },
  { id: 'icebreaker', label: 'Icebreakers' },
];

export default function WidgetsPanel({
  isOpen,
  onClose,
  onInsertWidget,
}: WidgetsPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filteredWidgets = WIDGETS.filter((widget) => {
    const matchesCategory = selectedCategory === 'all' || widget.category === selectedCategory;
    const matchesSearch = widget.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          widget.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Components</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search components..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="px-4 py-2 border-b border-gray-200 flex gap-1 overflow-x-auto">
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
              selectedCategory === category.id
                ? 'bg-purple-100 text-purple-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {category.label}
          </button>
        ))}
      </div>

      {/* Widget grid */}
      <div className="p-3 max-h-72 overflow-y-auto">
        <div className="grid grid-cols-2 gap-2">
          {filteredWidgets.map((widget) => (
            <button
              key={widget.id}
              onClick={() => {
                onInsertWidget(widget.id);
                onClose();
              }}
              className="p-3 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors text-left"
            >
              <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center mb-2">
                {widget.icon}
              </div>
              <div className="text-sm font-medium text-gray-900">{widget.name}</div>
              <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                {widget.description}
              </div>
            </button>
          ))}
        </div>

        {filteredWidgets.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">No components found</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Icons
function TableIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function TimerIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function StopwatchIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function DotVotingIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="6" r="2" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="6" cy="18" r="2" />
    </svg>
  );
}

function PollIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function ReactionIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function KanbanIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  );
}

function SprintIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function RetroIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function RandomIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function MoodIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
