import type { BoardSyncStatus } from '../../lib/boardSyncSession';
import { useI18n } from '../../i18n';
import './sync-status.css';

interface SyncStatusProps {
  status: BoardSyncStatus | 'idle' | 'dirty' | 'saving' | 'saved';
  editing?: boolean;
  compact?: boolean;
  error?: string;
  pendingCount?: number;
}

export default function SyncStatus({ status, editing, compact, error, pendingCount }: SyncStatusProps) {
  const { messages: { board: text }, formatNumber } = useI18n();
  const state = editing && status === 'synced' ? 'editing' : status;
  const count = pendingCount && status !== 'synced' ? ` · ${formatNumber(pendingCount)}` : '';
  const label = text.sync[state] + count;

  return (
    <span className={compact ? 'sync-status sync-status-compact' : 'sync-status'}
      data-state={state} title={error || label} role="status" aria-label={label}>
      <span className="sync-status-dot" aria-hidden="true" />
      <span className="sync-status-label">{label}</span>
    </span>
  );
}
