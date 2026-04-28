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
  const tone = getTone(status);

  if (compact) {
    return (
      <span
        className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-lg"
        title={error || label}
        aria-label={label}
        role="status"
        aria-live="polite"
      >
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
      </span>
    );
  }

  return (
    <p
      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
      title={error}
      style={{ color: 'var(--text-secondary)' }}
      aria-live="polite"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      <span>{label}</span>
    </p>
  );
}
