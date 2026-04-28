export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict';

interface SaveStatusIndicatorProps {
  status: SaveState | string;
  error?: string;
  compact?: boolean;
}

const labels: Record<SaveState, string> = {
  idle: 'Ready',
  dirty: 'Unsaved changes',
  saving: 'Saving...',
  saved: 'Saved',
  error: 'Save failed',
  offline: 'Offline',
  conflict: 'Conflict',
};

function getTone(status: string): string {
  if (status === 'error' || status === 'conflict') return '#EF4444';
  if (status === 'saving' || status === 'dirty') return '#F59E0B';
  if (status === 'offline') return '#6B7280';
  return '#10B981';
}

export default function SaveStatusIndicator({ status, error, compact }: SaveStatusIndicatorProps) {
  const label = labels[status as SaveState] || status;

  return (
    <p
      className={`flex items-center gap-1.5 ${compact ? 'px-2 text-xs' : 'rounded-full px-3 py-1 text-sm'}`}
      title={error}
      style={{ color: 'var(--text-secondary)' }}
      aria-live="polite"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: getTone(status) }} />
      <span>{label}</span>
    </p>
  );
}
