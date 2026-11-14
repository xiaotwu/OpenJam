import { useMemo, useState } from 'react';
import { MAX_POLL_OPTIONS, newWidgetPartId, normalizePollOptions, type PollOption, type WidgetData, type WidgetVoteAction } from '../../lib/workshopWidgets';

interface PollWidgetProps {
  x: number;
  y: number;
  data: WidgetData;
  editable: boolean;
  votePending: boolean;
  userId: string;
  onVote: (action: WidgetVoteAction) => void;
  onUpdate: (data: { question?: string; options?: PollOption[]; showResults?: boolean }, expected?: WidgetData) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

type PollDraft = { question: string; options: PollOption[]; expected: WidgetData };

function emptyOption(): PollOption {
  return { id: newWidgetPartId('option'), text: '', voters: [], votes: 0 };
}

const inputClass = 'w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm text-gray-900 placeholder:text-gray-500 disabled:bg-gray-100';

export default function PollWidget({ x, y, data, editable, votePending, userId, onVote, onUpdate, onDelete, isSelected, onSelect }: PollWidgetProps) {
  const options = useMemo(() => normalizePollOptions(data.options), [data.options]);
  const question = typeof data.question === 'string' ? data.question : '';
  const showResults = data.showResults === true;
  const [draft, setDraft] = useState<PollDraft | null>(null);
  const [blankOptions] = useState(() => [emptyOption(), emptyOption()]);
  const editing = editable && (draft !== null || !question);
  const edit = draft ?? { question, options: options.length ? options : blankOptions, expected: data };
  const cleaned = editing ? edit.options.map(option => ({ ...option, text: option.text.trim() })).filter(option => option.text) : [];
  const valid = edit.question.trim().length > 0 && cleaned.length >= 2;
  const hasVoted = options.some(option => option.voters.includes(userId));
  const total = options.reduce((sum, option) => sum + option.votes, 0);
  const resultsVisible = showResults || hasVoted;

  function editOption(id: string, text: string) {
    setDraft({ ...edit, options: edit.options.map(option => option.id === id ? { ...option, text } : option) });
  }

  return (
    <div className="absolute text-gray-900" style={{ left: x, top: y }} onClick={onSelect} data-widget="poll">
      <div className={`min-w-[280px] max-w-[360px] overflow-hidden rounded-xl border-2 canvas-widget-surface shadow-xl ${isSelected ? 'border-blue-500' : 'border-gray-200'}`}>
        {editing ? (
          <form className="space-y-2 p-3" onSubmit={event => {
            event.preventDefault();
            if (!valid || votePending) return;
            onUpdate({ question: edit.question.trim(), options: cleaned }, edit.expected);
            setDraft(null);
          }}>
            <label className="block text-xs font-semibold text-gray-700">
              Question
              <input className={`${inputClass} mt-1`} value={edit.question} maxLength={240} onChange={event => setDraft({ ...edit, question: event.target.value })} />
            </label>
            <div className="space-y-1.5">
              {edit.options.map((option, index) => (
                <div key={option.id} className="flex items-center gap-1.5">
                  <input className={inputClass} aria-label={`Option ${index + 1}`} value={option.text} maxLength={140}
                    disabled={option.votes > 0} onChange={event => editOption(option.id, event.target.value)} />
                  <button type="button" aria-label={`Remove option ${index + 1}`}
                    disabled={edit.options.length <= 2 || option.votes > 0}
                    onClick={() => setDraft({ ...edit, options: edit.options.filter(item => item.id !== option.id) })}
                    className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-35">✕</button>
                </div>
              ))}
            </div>
            <button type="button" disabled={edit.options.length >= MAX_POLL_OPTIONS}
              onClick={() => setDraft({ ...edit, options: [...edit.options, emptyOption()] })}
              className="rounded px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-45">Add option</button>
            <div className="flex justify-end gap-2">
              {question && <button type="button" onClick={() => setDraft(null)} className="rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>}
              <button type="submit" disabled={!valid || votePending} className="rounded-md bg-blue-600 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-45">
                {question ? 'Save poll' : 'Create poll'}</button>
            </div>
          </form>
        ) : (
          <>
            <div className="border-b border-blue-100 bg-blue-50 px-4 py-3">
              <h3 className="break-words font-semibold">{question || 'Poll'}</h3>
              <p className="mt-1 text-xs text-gray-600">{question ? `${total} ${total === 1 ? 'vote' : 'votes'}` : 'No options yet'}</p>
            </div>
            {options.length > 0 && <div className="space-y-2 p-3">
              {options.map(option => {
                const percent = total ? Math.round(option.votes * 100 / total) : 0;
                const selected = option.voters.includes(userId);
                return (
                  <button type="button" key={option.id} disabled={!editable || hasVoted || votePending}
                    aria-pressed={selected} onClick={() => onVote({ action: 'poll-cast', optionId: option.id })}
                    className={`relative w-full overflow-hidden rounded-lg border p-2.5 text-left ${selected ? 'border-blue-500' : 'border-gray-200'} enabled:hover:border-blue-400`}>
                    {resultsVisible && <span className="absolute inset-y-0 left-0 bg-blue-100" style={{ width: `${percent}%` }} />}
                    <span className="relative flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 break-words font-medium">{option.text}</span>
                      {resultsVisible && <span className="text-gray-700">{percent}%</span>}
                    </span>
                  </button>
                );
              })}
            </div>}
            {(editable || votePending) && <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-xs">
              {votePending ? <span role="status" className="text-gray-600">Vote awaiting confirmation</span> : <button type="button"
                onClick={() => onUpdate({ showResults: !showResults })} className="font-semibold text-blue-700 hover:underline">{showResults ? 'Hide results' : 'Show results'}</button>}
              {editable && <button type="button" disabled={votePending} onClick={() => setDraft({ question, options, expected: data })}
                className="text-gray-600 hover:underline disabled:opacity-45">Edit poll</button>}
            </div>}
          </>
        )}
      </div>
      {editable && isSelected && <button type="button" aria-label="Delete poll" onClick={event => { event.stopPropagation(); onDelete(); }}
        className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-red-600 text-xs text-white hover:bg-red-700">✕</button>}
    </div>
  );
}
