import type { BoardSyncState } from '../../lib/boardSync';

interface BoardSyncNoticeProps {
  state: BoardSyncState;
  resourceKind?: 'board' | 'doc';
  onRetry: () => void;
  onExportDraft: () => void;
  onDiscard: () => void;
}

function displayValue(value: unknown): string {
  if (value === null) return 'Empty';
  return typeof value === 'string' ? value || 'Empty' : JSON.stringify(value, null, 2) ?? '';
}

export default function BoardSyncNotice({ state, resourceKind = 'board', onRetry, onExportDraft, onDiscard }: BoardSyncNoticeProps) {
  const { status, mode, error, conflict, pendingCount, hasDraft } = state;
  if (!['offline', 'conflict', 'error', 'revoked'].includes(status)) return null;
  const offline = status === 'offline';
  const revoked = status === 'revoked';
  const file = resourceKind === 'doc' ? 'document' : 'board';
  const localFailure = conflict?.code === 'LOCAL_WRITE_REJECTED';
  const title = offline ? 'Connection lost'
    : revoked ? resourceKind === 'doc' ? 'Document access unavailable' : 'Board access unavailable'
      : localFailure ? 'Could not store the latest edit'
        : conflict ? 'An edit needs review'
        : mode === 'error' ? `Could not open the ${file}` : 'Could not save edits to the device';
  const detail = offline
    ? pendingCount > 0
      ? `${pendingCount} queued ${pendingCount === 1 ? 'edit is' : 'edits are'} stored on this device. Sync will resume when the ${file} is reachable.`
      : mode === 'active' && state.canEdit
        ? `You can keep editing. Changes will sync when the ${file} is reachable.`
        : `Reconnect to load the ${file}.`
    : error;
  const current = conflict?.details?.current;
  const local = conflict?.local;
  const canCompare = current !== undefined || local !== undefined;
  const actionClass = 'min-h-9 rounded-lg border px-3 text-xs font-semibold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

  return (
    <section
      className="pointer-events-auto absolute left-1/2 top-24 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border px-4 py-3 text-sm shadow-xl"
      style={{ background: 'var(--surface-panel)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}
      role={offline ? 'status' : 'alert'}
    >
      <div className="flex items-center gap-2 font-semibold">
        <span className={`h-2 w-2 shrink-0 rounded-full ${offline ? 'bg-amber-500' : 'bg-red-500'}`} aria-hidden="true" />
        {title}
      </div>
      {detail && <p className="mt-1 break-words" style={{ color: 'var(--text-secondary)' }}>{detail}</p>}
      {conflict && (
        <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
          {localFailure
            ? `Download this draft before leaving the ${file}. Discard it when you are ready to resume editing.`
            : `Download your draft to keep a copy. Discard the blocked edit to continue from the current ${file}.`}
        </p>
      )}
      {canCompare && (
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">Compare changes</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {current !== undefined && (
              <div className="min-w-0">
                <div className="text-xs font-medium">Current {file}</div>
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg px-2 py-1 text-xs" style={{ background: 'var(--glass-bg-subtle)' }}>{displayValue(current)}</pre>
              </div>
            )}
            {local !== undefined && (
              <div className="min-w-0">
                <div className="text-xs font-medium">Your queued edit</div>
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg px-2 py-1 text-xs" style={{ background: 'var(--glass-bg-subtle)' }}>{displayValue(local)}</pre>
              </div>
            )}
          </div>
        </details>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--glass-border-strong)' }}>
        {revoked
          ? <a className={`${actionClass} inline-flex items-center`} href="/workplace">Back to Workshop</a>
          : <button type="button" className={actionClass} onClick={onRetry}>Retry sync</button>}
        {hasDraft && !revoked && (
          <button type="button" className={actionClass} onClick={onExportDraft}>Download draft</button>
        )}
        {conflict && (
          <button type="button" className={actionClass} onClick={onDiscard}>
            {localFailure ? 'Discard unsaved draft' : 'Discard blocked edit'}
          </button>
        )}
      </div>
    </section>
  );
}
