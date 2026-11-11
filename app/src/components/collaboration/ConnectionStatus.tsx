import { useI18n } from '../../i18n';

export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'offline' | 'error';

interface ConnectionStatusProps {
  state: ConnectionState;
}

export default function ConnectionStatus({ state }: ConnectionStatusProps) {
  const { messages: { board: text } } = useI18n();
  const label = text.connection[state];
  return (
    <div
      className="flex min-h-8 items-center gap-1.5 px-1.5 text-xs font-medium"
      style={{ color: 'var(--text-secondary)' }}
      title={label}
      aria-label={label}
      role="status"
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full border border-current" />
      <span className="board-connection-label hidden lg:inline">{label}</span>
    </div>
  );
}
