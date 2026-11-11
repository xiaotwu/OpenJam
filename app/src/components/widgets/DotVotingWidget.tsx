import { useMemo, useState } from 'react';
import { MAX_DOT_VOTES, newWidgetPartId, normalizeDotLimit, normalizeDotVotes, type WidgetData, type WidgetVoteAction } from '../../lib/workshopWidgets';

interface DotVotingWidgetProps {
  x: number;
  y: number;
  data: WidgetData;
  editable: boolean;
  votePending: boolean;
  userId: string;
  onVote: (action: WidgetVoteAction) => void;
  onUpdate: (data: { maxVotesPerUser: number }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

function coordinate(value: number) {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

export default function DotVotingWidget({ x, y, data, editable, votePending, userId, onVote, onUpdate, onDelete, isSelected, onSelect }: DotVotingWidgetProps) {
  const [showSettings, setShowSettings] = useState(false);
  const votes = useMemo(() => normalizeDotVotes(data.votes), [data.votes]);
  const limit = normalizeDotLimit(data.maxVotesPerUser);
  const counts = new Map<string, number>();
  let highestCount = 1;
  for (const vote of votes) {
    const count = (counts.get(vote.userId) ?? 0) + 1;
    counts.set(vote.userId, count);
    highestCount = Math.max(highestCount, count);
  }
  const userVoteCount = counts.get(userId) ?? 0;
  const remaining = Math.max(0, limit - userVoteCount);

  function placeDot(event: React.MouseEvent<HTMLButtonElement>) {
    if (!editable || !remaining || votePending) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.detail === 0 ? 50 : coordinate((event.clientX - rect.left) * 100 / rect.width);
    const y = event.detail === 0 ? 50 : coordinate((event.clientY - rect.top) * 100 / rect.height);
    onVote({ action: 'dot-add', voteId: newWidgetPartId('dot'), x, y });
  }

  return (
    <div className="absolute text-gray-900" style={{ left: x, top: y }} onClick={onSelect} data-widget="dot-voting">
      <div className={`min-w-[300px] overflow-hidden rounded-xl border-2 canvas-widget-surface shadow-xl ${isSelected ? 'border-blue-500' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between gap-2 border-b border-yellow-100 bg-yellow-50 px-3 py-2">
          <div>
            <h3 className="text-sm font-semibold">Dot voting</h3>
            <p className="text-xs text-gray-600">{votes.length} {votes.length === 1 ? 'dot' : 'dots'}</p>
          </div>
          {editable && <button type="button" aria-expanded={showSettings} onClick={() => setShowSettings(value => !value)}
            className="rounded px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-yellow-100">Vote limit</button>}
        </div>
        {editable && showSettings && <label className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 text-xs text-gray-700">
          Dots per person
          <select value={limit} disabled={votePending} onChange={event => onUpdate({ maxVotesPerUser: Number(event.target.value) })}
            className="rounded border border-gray-300 bg-white px-1.5 py-1 text-sm">
            {Array.from({ length: MAX_DOT_VOTES }, (_, index) => index + 1).map(value => (
              <option key={value} value={value} disabled={value < highestCount}>{value}</option>
            ))}
          </select>
        </label>}

        <div className="relative h-[200px] w-[300px] bg-gray-50">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-5 grid-rows-4">
            {Array.from({ length: 20 }, (_, index) => <div key={index} className="border border-gray-100" />)}
          </div>
          {editable && <button type="button" aria-label="Place a dot" onClick={placeDot} disabled={remaining === 0 || votePending}
            className="absolute inset-0 enabled:cursor-crosshair focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600" />}
          {votes.map((vote, index) => {
            const style = { left: `${coordinate(vote.x)}%`, top: `${coordinate(vote.y)}%`, backgroundColor: vote.userColor };
            const dotClass = 'absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md';
            if (editable && vote.userId === userId) {
              return <button type="button" key={`${vote.id}-${index}`} aria-label="Remove your dot" disabled={votePending}
                style={style} className={`${dotClass} enabled:hover:scale-125`} onClick={() => onVote({ action: 'dot-remove', voteId: vote.id })} />;
            }
            return <span aria-hidden="true" key={`${vote.id}-${index}`} style={style} className={`${dotClass} pointer-events-none`} />;
          })}
        </div>

        {editable && <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
          <span role="status">{votePending ? 'Vote awaiting confirmation' : `${remaining} ${remaining === 1 ? 'dot' : 'dots'} left`}</span>
          <button type="button" onClick={() => onVote({ action: 'dot-clear' })} disabled={!userVoteCount || votePending}
            className="font-semibold text-red-700 enabled:hover:underline disabled:opacity-40">Clear my dots</button>
        </div>}
      </div>
      {editable && isSelected && <button type="button" aria-label="Delete dot voting widget" onClick={event => { event.stopPropagation(); onDelete(); }}
        className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-red-600 text-xs text-white hover:bg-red-700">✕</button>}
    </div>
  );
}
