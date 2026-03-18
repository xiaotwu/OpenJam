import { useState, useRef, useEffect } from 'react';
import { ProfileSettingsDialog } from './UserMenu';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  divider?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  toggle?: boolean;
  toggled?: boolean;
}

interface Collaborator {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
}

interface MenuBarProps {
  boardName: string;
  onBoardNameChange: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomFit: () => void;
  onSave?: () => void;
  onExportPNG: () => void;
  onExportJSON: () => void;
  onShare: () => void;
  onToggleGrid: () => void;
  showGrid: boolean;
  onVersionHistory?: () => void;
  onMoveToProject?: () => void;
  onFileInfo?: () => void;
  onDeleteBoard?: () => void;
  pages?: unknown[];
  currentPageId?: string;
  onSelectPage?: (pageId: string) => void;
  onAddPage?: () => void;
  onRenamePage?: (pageId: string, name: string) => void;
  onDuplicatePage?: (pageId: string) => void;
  onDeletePage?: (pageId: string) => void;
  onDuplicateBoard?: () => void;
  username?: string;
  userEmail?: string;
  userColor?: string;
  userAvatarUrl?: string;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onUpdateProfile?: (settings: { username: string; color: string; avatarUrl?: string }) => void;
  onLogout?: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onLock?: () => void;
  onUnlockAll?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  collaborators?: Collaborator[];
  permissionLevel?: 'view' | 'comment' | 'edit';
  isDark?: boolean;
  onToggleTheme?: () => void;
}

export default function MenuBar(props: MenuBarProps) {
  const {
    boardName, onBoardNameChange, onUndo, onRedo, onSelectAll, onDelete, onDuplicate,
    onCopy, onPaste, onZoomIn, onZoomOut, onZoomReset, onZoomFit, onSave, onExportPNG,
    onExportJSON, onShare, onToggleGrid, showGrid, onVersionHistory,
    onFileInfo, onDeleteBoard, onDuplicateBoard,
    username, userEmail, userColor, userAvatarUrl, isPinned, onTogglePin, onUpdateProfile, onLogout,
    onBringToFront, onSendToBack, onLock, onUnlockAll, onGroup, onUngroup,
    collaborators = [],
    isDark,
    onToggleTheme,
  } = props;

  const [showMenu, setShowMenu] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(boardName);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setActiveSection(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNameSubmit = () => {
    setIsEditingName(false);
    if (tempName.trim()) {
      onBoardNameChange(tempName.trim());
    } else {
      setTempName(boardName);
    }
  };

  const menuAction = (action?: () => void) => {
    action?.();
    setShowMenu(false);
    setActiveSection(null);
  };

  const menuSections: Record<string, MenuItem[]> = {
    Board: [
      { label: isEditingName ? '' : boardName, action: () => { setIsEditingName(true); setTempName(boardName); }, icon: <PencilIcon /> },
      { divider: true, label: '' },
      { label: 'Save', shortcut: 'Ctrl+S', action: onSave || onExportJSON, icon: <SaveIcon /> },
      { label: 'Export as PNG', action: onExportPNG },
      { label: 'Export as JSON', action: onExportJSON },
      { divider: true, label: '' },
      { label: 'Duplicate board', action: onDuplicateBoard || onDuplicate },
      { label: 'Version history', action: onVersionHistory },
      { label: 'Board info', action: onFileInfo },
      { divider: true, label: '' },
      { label: 'Delete board', action: onDeleteBoard },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: onUndo },
      { label: 'Redo', shortcut: 'Ctrl+Y', action: onRedo },
      { divider: true, label: '' },
      { label: 'Copy', shortcut: 'Ctrl+C', action: onCopy },
      { label: 'Paste', shortcut: 'Ctrl+V', action: onPaste },
      { label: 'Duplicate', shortcut: 'Ctrl+D', action: onDuplicate },
      { label: 'Delete', shortcut: 'Del', action: onDelete },
      { divider: true, label: '' },
      { label: 'Select all', shortcut: 'Ctrl+A', action: onSelectAll },
    ],
    View: [
      { label: 'Zoom in', shortcut: 'Ctrl++', action: onZoomIn },
      { label: 'Zoom out', shortcut: 'Ctrl+-', action: onZoomOut },
      { label: 'Zoom 100%', shortcut: 'Ctrl+0', action: onZoomReset },
      { label: 'Zoom to fit', shortcut: 'Ctrl+1', action: onZoomFit },
      { divider: true, label: '' },
      { label: 'Show grid', toggle: true, toggled: showGrid, action: onToggleGrid },
      { label: isDark ? 'Light mode' : 'Dark mode', action: onToggleTheme, icon: isDark ? <SunIcon /> : <MoonIcon /> },
    ],
    Object: [
      { label: 'Bring to front', shortcut: ']', action: onBringToFront },
      { label: 'Send to back', shortcut: '[', action: onSendToBack },
      { divider: true, label: '' },
      { label: 'Lock', shortcut: 'Ctrl+Shift+L', action: onLock },
      { label: 'Unlock all', action: onUnlockAll },
      { divider: true, label: '' },
      { label: 'Group', shortcut: 'Ctrl+G', action: onGroup },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', action: onUngroup },
    ],
  };

  // Online collaborators (excluding self for avatar display)
  const otherCollaborators = collaborators.filter(c => c.name !== username);

  return (
    <div className="absolute top-3 right-3 z-50 flex items-center gap-2">
      {/* Avatar Stack — collaborators expand leftward */}
      <div className="flex items-center h-10 glass-elevated rounded-2xl" ref={menuRef}>
        {/* Other collaborator avatars */}
        {otherCollaborators.length > 0 && (
          <>
            <div className="flex items-center -space-x-2 pl-2">
              {otherCollaborators.slice(0, 5).map((collab) => (
                <div
                  key={collab.id}
                  className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-white text-xs font-semibold shadow-sm cursor-default relative"
                  style={{ backgroundColor: collab.color, borderColor: 'var(--glass-bg-elevated)' }}
                  title={collab.name}
                >
                  {collab.avatarUrl ? (
                    <img src={collab.avatarUrl} alt={collab.name} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    collab.name.charAt(0).toUpperCase()
                  )}
                  {/* Online dot */}
                  <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full" style={{ border: '1.5px solid var(--glass-bg-elevated)' }} />
                </div>
              ))}
              {otherCollaborators.length > 5 && (
                <div className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-medium" style={{ background: 'var(--glass-border-strong)', color: 'var(--text-secondary)', borderColor: 'var(--glass-bg-elevated)' }}>
                  +{otherCollaborators.length - 5}
                </div>
              )}
            </div>
            <div className="w-px h-5 mx-1" style={{ background: 'var(--glass-border-strong)' }} />
          </>
        )}

        {/* Current user avatar — click to open settings menu */}
        <div className="relative px-1.5">
          <button
            onClick={() => { setShowMenu(!showMenu); setActiveSection(null); }}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold overflow-hidden transition-all hover:ring-2 hover:ring-white/30 ${showMenu ? 'ring-2 ring-blue-400' : ''} ${isPinned ? 'ring-2 ring-blue-500' : ''}`}
            style={{ backgroundColor: userAvatarUrl ? 'transparent' : (userColor || '#9CA3AF') }}
            title={username || 'Settings'}
          >
            {userAvatarUrl ? (
              <img src={userAvatarUrl} alt={username} className="w-full h-full object-cover" />
            ) : username ? (
              username.charAt(0).toUpperCase()
            ) : (
              <DefaultAvatarIcon />
            )}
          </button>

          {/* Comprehensive settings dropdown */}
          {showMenu && (
            <div className="absolute top-full right-0 mt-2 w-72 glass-elevated rounded-xl glass-panel-enter overflow-hidden z-50">
              {/* User header */}
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--glass-border-strong)' }}>
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden text-white text-lg font-bold"
                    style={{ backgroundColor: userAvatarUrl ? 'transparent' : (userColor || '#9CA3AF') }}
                  >
                    {userAvatarUrl ? (
                      <img src={userAvatarUrl} alt={username} className="w-full h-full object-cover" />
                    ) : (
                      (username || 'U').charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{username || 'User'}</p>
                    {userEmail && <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{userEmail}</p>}
                  </div>
                </div>
              </div>

              {/* Board name edit */}
              {isEditingName && (
                <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--glass-border-strong)' }}>
                  <input type="text" value={tempName} onChange={(e) => setTempName(e.target.value)}
                    onBlur={handleNameSubmit} onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); if (e.key === 'Escape') { setIsEditingName(false); setTempName(boardName); } }}
                    className="w-full px-2 py-1.5 text-sm border border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200" autoFocus
                    style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--text-primary)' }}
                  />
                </div>
              )}

              {/* Quick actions row */}
              <div className="px-3 py-2 flex items-center gap-1 border-b" style={{ borderColor: 'var(--glass-border-strong)' }}>
                <QuickAction title="Spotlight me" active={isPinned} onClick={() => onTogglePin?.()}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                  </svg>
                </QuickAction>
                <QuickAction title="Profile settings" onClick={() => { setShowProfileSettings(true); setShowMenu(false); }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </QuickAction>
                <QuickAction title={isDark ? 'Light mode' : 'Dark mode'} onClick={() => onToggleTheme?.()}>
                  {isDark ? <SunIcon /> : <MoonIcon />}
                </QuickAction>
                <QuickAction title={showGrid ? 'Hide grid' : 'Show grid'} active={showGrid} onClick={() => onToggleGrid?.()}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M4 4h16v16H4V4zm4 0v16m4-16v16m4-16v16M4 8h16M4 12h16M4 16h16" />
                  </svg>
                </QuickAction>
              </div>

              {/* Collapsible menu sections */}
              <div className="max-h-[50vh] overflow-y-auto py-1">
                {Object.entries(menuSections).map(([sectionName, items]) => (
                  <div key={sectionName}>
                    <button
                      onClick={() => setActiveSection(activeSection === sectionName ? null : sectionName)}
                      className="w-full px-4 py-1.5 text-left text-xs font-semibold uppercase flex items-center justify-between hover:bg-white/5"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      <span>{sectionName}</span>
                      <svg className={`w-3 h-3 transition-transform ${activeSection === sectionName ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {activeSection === sectionName && (
                      <div className="pb-1">
                        {items.map((item, idx) => {
                          if (item.divider) return <div key={idx} className="my-0.5 mx-3 border-t" style={{ borderColor: 'var(--glass-border-strong)' }} />;
                          if (item.toggle) {
                            return (
                              <button key={idx} onClick={() => menuAction(item.action)}
                                className="w-full px-4 py-1.5 text-left text-sm flex items-center justify-between hover:bg-white/10"
                                style={{ color: 'var(--text-primary)' }}>
                                <span>{item.label}</span>
                                <div className={`w-8 h-4 rounded-full relative transition-colors ${item.toggled ? 'bg-blue-500' : 'bg-gray-400'}`}>
                                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${item.toggled ? 'left-4' : 'left-0.5'}`} />
                                </div>
                              </button>
                            );
                          }
                          return (
                            <button key={idx} onClick={() => menuAction(item.action)} disabled={item.disabled}
                              className={`w-full px-4 py-1.5 text-left text-sm flex items-center justify-between ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10'}`}
                              style={{ color: item.label === 'Delete board' ? '#EF4444' : 'var(--text-primary)' }}>
                              <div className="flex items-center gap-2">
                                {item.icon && <span style={{ color: 'var(--text-secondary)' }}>{item.icon}</span>}
                                <span>{item.label}</span>
                              </div>
                              {item.shortcut && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{item.shortcut}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Sign out */}
              {onLogout && (
                <div className="border-t py-1" style={{ borderColor: 'var(--glass-border-strong)' }}>
                  <button onClick={() => menuAction(onLogout)}
                    className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-red-500/10 text-red-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Share Button */}
        <div className="pr-2">
          <button onClick={onShare}
            className="px-3.5 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share
          </button>
        </div>
      </div>

      {/* Profile Settings Dialog */}
      {username && userColor && onUpdateProfile && (
        <ProfileSettingsDialog isOpen={showProfileSettings} onClose={() => setShowProfileSettings(false)}
          username={username} email={userEmail} color={userColor} avatarUrl={userAvatarUrl} onSave={onUpdateProfile} />
      )}
    </div>
  );
}

// Quick action button for the action bar
function QuickAction({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`p-2 rounded-lg transition-colors ${active ? 'bg-blue-500/20 text-blue-500' : 'hover:bg-white/10'}`}
      style={active ? undefined : { color: 'var(--text-secondary)' }}
      title={title}
    >
      {children}
    </button>
  );
}

function DefaultAvatarIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="white" opacity={0.7}>
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

function PencilIcon() {
  return <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>;
}
function SaveIcon() {
  return <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>;
}
function SunIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
}
function MoonIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>;
}
