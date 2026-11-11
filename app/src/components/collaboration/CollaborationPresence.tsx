import { useI18n } from '../../i18n';

export interface PresenceCollaborator {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
  isOnline?: boolean;
}

interface CollaborationPresenceProps {
  collaborators: PresenceCollaborator[];
  currentUserId?: string;
  currentUserName?: string;
  compact?: boolean;
}

export default function CollaborationPresence({ collaborators, currentUserId, currentUserName, compact }: CollaborationPresenceProps) {
  const { messages: { board: text } } = useI18n();
  const visibleCollaborators = collaborators.filter((collaborator) => (
    currentUserId ? collaborator.id !== currentUserId : collaborator.name !== currentUserName
  ));

  if (visibleCollaborators.length === 0) {
    return null;
  }

  return (
    <div className={`flex items-center -space-x-1.5 ${compact ? 'px-3 py-2' : 'pl-1.5 pr-0.5'}`} aria-label={text.collaboratorsOnline(visibleCollaborators.length)}>
      {visibleCollaborators.slice(0, 2).map((collaborator) => (
        <div
          key={collaborator.id}
          className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold text-white"
          style={{ backgroundColor: collaborator.color, borderColor: 'var(--glass-bg-elevated)' }}
          title={collaborator.name}
        >
          {collaborator.avatarUrl ? (
            <img src={collaborator.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            collaborator.name.charAt(0).toUpperCase()
          )}
        </div>
      ))}
      {visibleCollaborators.length > 2 && (
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-semibold"
          style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-bg-elevated)', color: 'var(--text-secondary)' }}
        >
          +{visibleCollaborators.length - 2}
        </div>
      )}
    </div>
  );
}
