import { useCallback } from 'react';
import type { Element, WidgetElement } from '../lib/elements';
import { applyLegacyWidgetVote, type WidgetData, type WidgetVoteAction } from '../lib/workshopWidgets';
import {
  TableWidget,
  TimerWidget,
  StopwatchWidget,
  PollWidget,
  KanbanWidget,
  RetroWidget,
  MoodMeterWidget,
  RandomPickerWidget,
  QuestionCardWidget,
  DotVotingWidget,
  ReactionCounterWidget,
} from './widgets';

const EMPTY_DATA: WidgetData = {};

export interface WidgetRendererProps {
  element: WidgetElement;
  isSelected: boolean;
  editable?: boolean;
  onSelect: (id: string, addToSelection: boolean) => void;
  onUpdate: (id: string, changes: Partial<Element>, expected?: Record<string, unknown>) => void;
  onVote?: (action: WidgetVoteAction) => void;
  votePending?: boolean;
  onDelete: () => void;
  // Real identity of the acting user, needed for collaborative widget
  // attribution (poll votes, dot-voting, mood entries, reaction counts).
  userId: string;
  userName: string;
  userColor: string;
}

// Renders the appropriate widget component based on widget type.
export default function WidgetRenderer({
  element, isSelected, editable = true, onSelect, onUpdate, onVote, votePending = false, onDelete, userId, userName, userColor,
}: WidgetRendererProps) {
  const data = element.widgetData ?? EMPTY_DATA;
  const handleWidgetUpdate = useCallback((patch: WidgetData, expected = data) => {
    if (!editable) return;
    onUpdate(element.id, { widgetData: { ...expected, ...patch } }, { widgetData: expected });
  }, [data, editable, element.id, onUpdate]);

  const handleVote = useCallback((action: WidgetVoteAction) => {
    if (!editable || votePending) return;
    if (onVote) {
      onVote(action);
      return;
    }
    const patch = applyLegacyWidgetVote(element.widgetType, data, action, userId, userColor);
    if (patch) handleWidgetUpdate(patch);
  }, [data, editable, element.widgetType, handleWidgetUpdate, onVote, userColor, userId, votePending]);

  const commonProps = {
    id: element.id,
    x: element.x,
    y: element.y,
    editable,
    isSelected: editable && isSelected,
    onSelect: () => onSelect(element.id, false),
    onDelete,
  };

  switch (element.widgetType) {
    case 'table':
      return (
        <TableWidget
          {...commonProps}
          data={data}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'timer':
      return (
        <TimerWidget
          {...commonProps}
          data={data}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'stopwatch':
      return (
        <StopwatchWidget
          {...commonProps}
          data={data}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'poll':
      return (
        <PollWidget
          {...commonProps}
          data={data}
          votePending={votePending}
          userId={userId}
          onVote={handleVote}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'kanban':
      return (
        <KanbanWidget
          {...commonProps}
          data={data}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'dot-voting':
      return (
        <DotVotingWidget
          {...commonProps}
          data={data}
          votePending={votePending}
          userId={userId}
          onVote={handleVote}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'retro':
      return (
        <RetroWidget
          {...commonProps}
          template={data.template || 'start-stop-continue'}
          columns={Array.isArray(data.columns) ? data.columns : []}
          onUpdate={handleWidgetUpdate}
          userId={userId}
        />
      );
    case 'mood-meter':
      return (
        <MoodMeterWidget
          {...commonProps}
          entries={Array.isArray(data.entries) ? data.entries : []}
          onUpdate={handleWidgetUpdate}
          userId={userId}
          userName={userName}
          userColor={userColor}
        />
      );
    case 'random-picker':
      return (
        <RandomPickerWidget
          {...commonProps}
          items={Array.isArray(data.items) ? data.items : []}
          pickedItems={Array.isArray(data.pickedItems) ? data.pickedItems : []}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'question-card':
      return (
        <QuestionCardWidget
          {...commonProps}
          category={data.category || 'icebreaker'}
          currentIndex={data.currentIndex || 0}
          customQuestions={Array.isArray(data.customQuestions) ? data.customQuestions : []}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'reaction-counter':
      return (
        <ReactionCounterWidget
          {...commonProps}
          reactions={Array.isArray(data.reactions) ? data.reactions : []}
          allowMultiple={data.allowMultiple !== false}
          onUpdate={handleWidgetUpdate}
          userId={userId}
        />
      );
    default:
      return null;
  }
}
