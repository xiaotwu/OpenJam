import { useState, useRef, useEffect } from 'react';

export interface Collaborator {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  color: string;
  permission: 'view' | 'comment' | 'edit';
  isOnline: boolean;
  lastSeen?: Date;
}

interface CollaboratorPanelProps {
  collaborators: Collaborator[];
  currentUserId: string;
  onInvite: (email: string, permission: 'view' | 'comment' | 'edit') => void;
  onRemove: (userId: string) => void;
  onChangePermission: (userId: string, permission: 'view' | 'comment' | 'edit') => void;
  onCopyLink: () => void;
}

export default function CollaboratorPanel({
  collaborators,
  currentUserId,
  onInvite,
  onRemove,
  onChangePermission,
  onCopyLink,
}: CollaboratorPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePermission, setInvitePermission] = useState<'view' | 'comment' | 'edit'>('edit');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const onlineCollaborators = collaborators.filter((c) => c.isOnline);
  const offlineCollaborators = collaborators.filter((c) => !c.isOnline);

  const handleInvite = () => {
    if (inviteEmail.trim()) {
      onInvite(inviteEmail.trim(), invitePermission);
      setInviteEmail('');
      setShowInviteForm(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Avatar stack */}
      <div className="flex items-center">
        <div className="flex -space-x-2">
          {onlineCollaborators.slice(0, 4).map((collaborator) => (
            <div
              key={collaborator.id}
              className="relative"
              title={collaborator.name}
            >
              {collaborator.avatarUrl ? (
                <img
                  src={collaborator.avatarUrl}
                  alt={collaborator.name}
                  className="w-8 h-8 rounded-full border-2 border-white"
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-medium"
                  style={{ backgroundColor: collaborator.color }}
                >
                  {getInitials(collaborator.name)}
                </div>
              )}
              {/* Online indicator */}
              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
            </div>
          ))}
          {onlineCollaborators.length > 4 && (
            <div className="w-8 h-8 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
              +{onlineCollaborators.length - 4}
            </div>
          )}
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="ml-2 p-1.5 hover:bg-gray-100 rounded-md transition-colors"
          title="View collaborators"
        >
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Panel dropdown */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Collaborators</h3>
            <p className="text-sm text-gray-500">
              {onlineCollaborators.length} online · {collaborators.length} total
            </p>
          </div>

          {/* Invite section */}
          <div className="px-4 py-3 border-b border-gray-200">
            {showInviteForm ? (
              <div className="space-y-3">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Enter email address"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <select
                    value={invitePermission}
                    onChange={(e) => setInvitePermission(e.target.value as 'view' | 'comment' | 'edit')}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="view">Can view</option>
                    <option value="comment">Can comment</option>
                    <option value="edit">Can edit</option>
                  </select>
                  <button
                    onClick={handleInvite}
                    className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700"
                  >
                    Invite
                  </button>
                </div>
                <button
                  onClick={() => setShowInviteForm(false)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowInviteForm(true)}
                  className="flex-1 px-3 py-2 text-sm font-medium text-purple-600 bg-purple-50 rounded-md hover:bg-purple-100"
                >
                  + Invite teammate
                </button>
                <button
                  onClick={onCopyLink}
                  className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md"
                  title="Copy link"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Online collaborators */}
          {onlineCollaborators.length > 0 && (
            <div className="px-4 py-2">
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Online Now</h4>
              {onlineCollaborators.map((collaborator) => (
                <CollaboratorItem
                  key={collaborator.id}
                  collaborator={collaborator}
                  isCurrentUser={collaborator.id === currentUserId}
                  onChangePermission={onChangePermission}
                  onRemove={onRemove}
                />
              ))}
            </div>
          )}

          {/* Offline collaborators */}
          {offlineCollaborators.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-200">
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Offline</h4>
              {offlineCollaborators.map((collaborator) => (
                <CollaboratorItem
                  key={collaborator.id}
                  collaborator={collaborator}
                  isCurrentUser={collaborator.id === currentUserId}
                  onChangePermission={onChangePermission}
                  onRemove={onRemove}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Individual collaborator item
interface CollaboratorItemProps {
  collaborator: Collaborator;
  isCurrentUser: boolean;
  onChangePermission: (userId: string, permission: 'view' | 'comment' | 'edit') => void;
  onRemove: (userId: string) => void;
}

function CollaboratorItem({
  collaborator,
  isCurrentUser,
  onChangePermission,
  onRemove,
}: CollaboratorItemProps) {
  const [showMenu, setShowMenu] = useState(false);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const permissionLabels = {
    view: 'Can view',
    comment: 'Can comment',
    edit: 'Can edit',
  };

  return (
    <div className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-md px-2 -mx-2">
      <div className="relative">
        {collaborator.avatarUrl ? (
          <img
            src={collaborator.avatarUrl}
            alt={collaborator.name}
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
            style={{ backgroundColor: collaborator.color }}
          >
            {getInitials(collaborator.name)}
          </div>
        )}
        {collaborator.isOnline && (
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {collaborator.name}
          {isCurrentUser && <span className="text-gray-500"> (you)</span>}
        </p>
        <p className="text-xs text-gray-500 truncate">{collaborator.email}</p>
      </div>

      {!isCurrentUser && (
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            {permissionLabels[collaborator.permission]}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
              {(['view', 'comment', 'edit'] as const).map((perm) => (
                <button
                  key={perm}
                  onClick={() => {
                    onChangePermission(collaborator.id, perm);
                    setShowMenu(false);
                  }}
                  className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${
                    collaborator.permission === perm ? 'text-purple-600 font-medium' : 'text-gray-700'
                  }`}
                >
                  {permissionLabels[perm]}
                </button>
              ))}
              <div className="border-t border-gray-200 my-1" />
              <button
                onClick={() => {
                  onRemove(collaborator.id);
                  setShowMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Export Collaborator Avatars component for header
export function CollaboratorAvatars({
  collaborators,
  onClick,
}: {
  collaborators: Collaborator[];
  onClick: () => void;
}) {
  const onlineCollaborators = collaborators.filter((c) => c.isOnline);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <button
      onClick={onClick}
      className="flex -space-x-2 hover:opacity-80 transition-opacity"
    >
      {onlineCollaborators.slice(0, 4).map((collaborator) => (
        <div key={collaborator.id} className="relative" title={collaborator.name}>
          {collaborator.avatarUrl ? (
            <img
              src={collaborator.avatarUrl}
              alt={collaborator.name}
              className="w-7 h-7 rounded-full border-2 border-white"
            />
          ) : (
            <div
              className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-medium"
              style={{ backgroundColor: collaborator.color }}
            >
              {getInitials(collaborator.name)}
            </div>
          )}
        </div>
      ))}
      {onlineCollaborators.length > 4 && (
        <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
          +{onlineCollaborators.length - 4}
        </div>
      )}
    </button>
  );
}
