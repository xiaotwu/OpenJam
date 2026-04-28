export interface PresenceCollaborator {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
  isOnline?: boolean;
}

interface CollaborationPresenceProps {
  collaborators: PresenceCollaborator[];
  currentUserName?: string;
}

export default function CollaborationPresence({ collaborators, currentUserName }: CollaborationPresenceProps) {
  const visibleCollaborators = collaborators.filter((collaborator) => collaborator.name !== currentUserName);

  if (visibleCollaborators.length === 0) {
    return null;
  }

  return (
    <div className="hidden items-center -space-x-2 px-2 sm:flex" aria-label={`${visibleCollaborators.length} collaborators online`}>
      {visibleCollaborators.slice(0, 4).map((collaborator) => (
        <div
          key={collaborator.id}
          className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold text-white shadow-sm"
          style={{ backgroundColor: collaborator.color, borderColor: 'var(--glass-bg-elevated)' }}
          title={collaborator.name}
        >
          {collaborator.avatarUrl ? (
            <img src={collaborator.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            collaborator.name.charAt(0).toUpperCase()
          )}
          {collaborator.isOnline !== false && (
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500" style={{ border: '1.5px solid var(--glass-bg-elevated)' }} />
          )}
        </div>
      ))}
      {visibleCollaborators.length > 4 && (
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold"
          style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-bg-elevated)', color: 'var(--text-secondary)' }}
        >
          +{visibleCollaborators.length - 4}
        </div>
      )}
    </div>
  );
}
