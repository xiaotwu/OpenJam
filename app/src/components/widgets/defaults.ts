// Widget default data creators
// Separated from components for fast refresh compatibility

interface TableCell {
  id: string;
  content: string;
  backgroundColor?: string;
}

interface PollOption {
  id: string;
  text: string;
  votes: number;
  voters: string[];
}

interface KanbanCard {
  id: string;
  title: string;
  color?: string;
}

interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

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

interface MoodEntry {
  id: string;
  userId: string;
  userName: string;
  color: string;
  quadrant: string;
  x: number;
  y: number;
}

interface Vote {
  id: string;
  userId: string;
  userColor: string;
  targetId: string;
  x: number;
  y: number;
}

interface Reaction {
  emoji: string;
  count: number;
  users: string[];
}

export function createDefaultTable(rows = 3, cols = 3): { rows: number; cols: number; cells: TableCell[][] } {
  const cells = Array(rows).fill(null).map((_, ri) =>
    Array(cols).fill(null).map((_, ci) => ({
      id: `cell-${ri}-${ci}`,
      content: ri === 0 ? `Column ${ci + 1}` : '',
      backgroundColor: ri === 0 ? '#F3F4F6' : undefined,
    }))
  );
  return { rows, cols, cells };
}

export function createDefaultPoll(): { question: string; options: PollOption[]; showResults: boolean } {
  return { question: '', options: [], showResults: false };
}

export function createDefaultKanban(): { columns: KanbanColumn[] } {
  return {
    columns: [
      { id: 'col-1', title: 'To Do', cards: [] },
      { id: 'col-2', title: 'In Progress', cards: [] },
      { id: 'col-3', title: 'Done', cards: [] },
    ],
  };
}

const RETRO_TEMPLATES: Record<string, RetroColumn[]> = {
  'start-stop-continue': [
    { id: 'start', title: 'Start', emoji: '🚀', color: '#DCFCE7', notes: [] },
    { id: 'stop', title: 'Stop', emoji: '🛑', color: '#FEE2E2', notes: [] },
    { id: 'continue', title: 'Continue', emoji: '✅', color: '#DBEAFE', notes: [] },
  ],
  'mad-sad-glad': [
    { id: 'mad', title: 'Mad', emoji: '😠', color: '#FEE2E2', notes: [] },
    { id: 'sad', title: 'Sad', emoji: '😢', color: '#E0E7FF', notes: [] },
    { id: 'glad', title: 'Glad', emoji: '😊', color: '#DCFCE7', notes: [] },
  ],
  'keep-drop-add': [
    { id: 'keep', title: 'Keep', emoji: '💚', color: '#DCFCE7', notes: [] },
    { id: 'drop', title: 'Drop', emoji: '🗑️', color: '#FEE2E2', notes: [] },
    { id: 'add', title: 'Add', emoji: '➕', color: '#FEF3C7', notes: [] },
  ],
};

export function createDefaultRetro(template = 'start-stop-continue'): { template: string; columns: RetroColumn[] } {
  return { template, columns: RETRO_TEMPLATES[template] || RETRO_TEMPLATES['start-stop-continue'] };
}

export function createDefaultMoodMeter(): { entries: MoodEntry[] } {
  return { entries: [] };
}

export function createDefaultRandomPicker(): { items: string[]; pickedItems: string[] } {
  return { items: [], pickedItems: [] };
}

export function createDefaultQuestionCard(category = 'icebreaker'): { category: string; currentIndex: number; customQuestions: string[] } {
  return { category, currentIndex: 0, customQuestions: [] };
}

export function createDefaultDotVoting(): { maxVotesPerUser: number; votes: Vote[] } {
  return { maxVotesPerUser: 3, votes: [] };
}

export function createDefaultReactionCounter(): { reactions: Reaction[]; allowMultiple: boolean } {
  return { reactions: [], allowMultiple: true };
}
