import { useRef } from 'react';
import { useI18n } from '../../i18n';

interface BoardPresentationControlsProps {
  connected: boolean;
  canPresent: boolean;
  presenting: boolean;
  followingId?: string;
  presenters: { id: string; displayName: string }[];
  onTogglePresenting: () => void;
  onFollow: (id: string) => void;
  onStopFollowing: () => void;
}

export default function BoardPresentationControls({
  connected, canPresent, presenting, followingId, presenters, onTogglePresenting, onFollow, onStopFollowing,
}: BoardPresentationControlsProps) {
  const { messages: { board: text } } = useI18n();
  const following = presenters.find((presenter) => presenter.id === followingId);
  const label = presenting ? text.presenting : following ? text.following(following.displayName) : text.present;
  const action = 'w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const choose = (action: () => void) => {
    if (disclosure.current) disclosure.current.open = false;
    trigger.current?.focus({ preventScroll: true });
    action();
  };

  return (
    <details
      ref={disclosure}
      className="relative"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return;
        event.stopPropagation();
        event.currentTarget.open = false;
        trigger.current?.focus();
      }}
    >
      <summary ref={trigger} title={label} aria-label={label} className="board-action-button relative cursor-pointer list-none px-2 text-xs font-semibold [&::-webkit-details-marker]:hidden">
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4m-2-13 4 2.5-4 2.5z" />
        </svg>
        {(presenting || following) && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
        <span className="board-presentation-menu-label">{label}</span>
      </summary>
      <div className="board-chrome-popover board-presentation-popover absolute left-0 top-full z-50 mt-2 w-52 rounded-xl border border-[var(--glass-border-strong)] p-2 text-[var(--text-primary)] shadow-lg sm:left-auto sm:right-0">
        {connected ? (
          <>
            {canPresent && <button type="button" className={action} onClick={() => choose(onTogglePresenting)} aria-pressed={presenting}>{presenting ? text.stopPresenting : text.presentView}</button>}
            {following && <button type="button" className={action} onClick={() => choose(onStopFollowing)}>{text.stopFollowing}</button>}
            {presenters.filter((presenter) => presenter.id !== followingId).map((presenter) => (
              <button key={presenter.id} type="button" className={action} onClick={() => choose(() => onFollow(presenter.id))}>{text.follow(presenter.displayName)}</button>
            ))}
            {!presenters.length && !presenting && <p className="px-3 py-2 text-xs text-[var(--text-secondary)]">{text.nobodyPresenting}</p>}
          </>
        ) : <p className="px-3 py-2 text-xs text-[var(--text-secondary)]">{text.reconnectToPresent}</p>}
      </div>
    </details>
  );
}
