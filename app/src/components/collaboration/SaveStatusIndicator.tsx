import { useI18n } from '../../i18n';

export type SaveState =
  | 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict'
  | 'loading' | 'catching-up' | 'synced' | 'saving-local' | 'pending' | 'revoked';

interface SaveStatusIndicatorProps {
  status: SaveState | string;
  error?: string;
  compact?: boolean;
  monochrome?: boolean;
  pendingCount?: number;
}

function getTone(status: string): string {
  if (['error', 'conflict', 'revoked'].includes(status)) return '#EF4444';
  if (['saving', 'dirty', 'saving-local', 'pending', 'catching-up'].includes(status)) return '#F59E0B';
  if (status === 'offline' || status === 'loading') return '#6B7280';
  return '#10B981';
}

export default function SaveStatusIndicator({ status, error, compact, monochrome, pendingCount }: SaveStatusIndicatorProps) {
  const { messages: { board: text }, formatNumber } = useI18n();
  const label = `${text.sync[status as SaveState] || status}${pendingCount && status !== 'synced' ? ` · ${formatNumber(pendingCount)}` : ''}`;
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
        <span className="h-2 w-2 rounded-full" style={monochrome
          ? ['idle', 'saved', 'synced'].includes(status) ? { background: 'var(--text-secondary)' } : { border: '1.5px solid var(--text-secondary)' }
          : { background: tone }} />
      </span>
    );
  }

  return (
    <p
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-1.5 py-1 text-xs sm:px-2"
      title={error || label}
      role="status"
      aria-label={label}
      style={{ color: 'var(--text-secondary)' }}
      aria-live="polite"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      <span className="hidden md:inline">{label}</span>
    </p>
  );
}
