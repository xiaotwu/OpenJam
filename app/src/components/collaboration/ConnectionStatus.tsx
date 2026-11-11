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
    <div
      className="hidden min-h-11 min-w-11 items-center justify-center rounded-xl sm:flex"
      style={{ color: colors[state] }}
      title={labels[state]}
      aria-label={labels[state]}
      role="status"
    >
      <span className="relative flex h-3 w-3">
        {state === 'connected' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ background: colors[state] }} />}
        <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: colors[state] }} />
      </span>
    </div>
  );
}
