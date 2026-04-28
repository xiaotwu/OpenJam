export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'offline' | 'error';

interface ConnectionStatusProps {
  state: ConnectionState;
}

const labels: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  error: 'Connection error',
};

const colors: Record<ConnectionState, string> = {
  connected: '#10B981',
  connecting: '#F59E0B',
  reconnecting: '#F59E0B',
  offline: '#6B7280',
  error: '#EF4444',
};

export default function ConnectionStatus({ state }: ConnectionStatusProps) {
  return (
    <div className="hidden items-center gap-1.5 rounded-full px-2 py-1 text-xs sm:flex" style={{ background: 'var(--glass-bg-subtle)', color: 'var(--text-secondary)' }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors[state] }} />
      <span>{labels[state]}</span>
    </div>
  );
}
