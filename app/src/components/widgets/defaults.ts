// Widget default data creators
// Separated from components for fast refresh compatibility

import { createTable, newWidgetPartId, type DotVote, type KanbanColumn, type PollOption } from '../../lib/workshopWidgets';

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

interface Reaction {
  emoji: string;
  count: number;
  users: string[];
}

export const createDefaultTable = createTable;

export function createDefaultPoll(): { question: string; options: PollOption[]; showResults: boolean } {
  return { question: '', options: [], showResults: false };
}

export function createDefaultKanban(titles = ['To Do', 'In Progress', 'Done']): { columns: KanbanColumn[] } {
  return {
    columns: titles.map(title => ({ id: newWidgetPartId('column'), title, cards: [] })),
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

export function createDefaultDotVoting(): { maxVotesPerUser: number; votes: DotVote[] } {
  return { maxVotesPerUser: 3, votes: [] };
}

export function createDefaultReactionCounter(): { reactions: Reaction[]; allowMultiple: boolean } {
  return { reactions: [], allowMultiple: true };
}
