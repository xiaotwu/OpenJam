import { useEffect, useRef, useState, type ReactNode } from 'react';
import CollaborationPresence, { type PresenceCollaborator } from './collaboration/CollaborationPresence';
import ConnectionStatus from './collaboration/ConnectionStatus';
import SaveStatusIndicator from './collaboration/SaveStatusIndicator';
import { ProfileSettingsDialog } from './UserMenu';

type MenuKey = 'board' | 'view' | 'export' | 'account';

type Collaborator = PresenceCollaborator;

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
  saveStatus?: string;
  saveError?: string;
  onExportPNG: () => void;
  onExportJSON: () => void;
  onShare: () => void;
  onToggleGrid: () => void;
  showGrid: boolean;
  onVersionHistory?: () => void;
  onFileInfo?: () => void;
  onDeleteBoard?: () => void;
  onDuplicateBoard?: () => void;
  pages?: unknown[];
  currentPageId?: string;
  onSelectPage?: (pageId: string) => void;
  onAddPage?: () => void;
  onRenamePage?: (pageId: string, name: string) => void;
  onDuplicatePage?: (pageId: string) => void;
  onDeletePage?: (pageId: string) => void;
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
  isDark?: boolean;
  onToggleTheme?: () => void;
}

export default function MenuBar(props: MenuBarProps) {
  const {
    boardName,
    onBoardNameChange,
    onUndo,
    onRedo,
    onSelectAll,
    onDelete,
    onDuplicate,
    onCopy,
    onPaste,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onZoomFit,
    onSave,
    saveStatus = 'idle',
    saveError,
    onExportPNG,
    onExportJSON,
    onShare,
    onToggleGrid,
    showGrid,
    onVersionHistory,
    onFileInfo,
    onDeleteBoard,
    onDuplicateBoard,
    username,
    userEmail,
    userColor,
    userAvatarUrl,
    isPinned,
    onTogglePin,
    onUpdateProfile,
    onLogout,
    onBringToFront,
    onSendToBack,
    onLock,
    onUnlockAll,
    onGroup,
    onUngroup,
    collaborators = [],
    isDark,
    onToggleTheme,
  } = props;

  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(boardName);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTempName(boardName);
  }, [boardName]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const closeMenu = () => setActiveMenu(null);

  const handleMenuAction = (action?: () => void) => {
    action?.();
    closeMenu();
  };

  const handleNameSubmit = () => {
    setIsEditingName(false);
    const nextName = tempName.trim();
    if (nextName) {
      onBoardNameChange(nextName);
    } else {
      setTempName(boardName);
    }
  };

  const toggleMenu = (menu: MenuKey) => {
    setActiveMenu((current) => current === menu ? null : menu);
  };

  return (
    <div ref={barRef} className="pointer-events-none absolute left-3 right-3 top-3 z-50 flex items-start justify-between gap-3">
      <section className="pointer-events-auto glass-elevated flex min-h-12 min-w-0 items-center gap-3 rounded-2xl px-3 py-2">
        <button
          type="button"
          onClick={() => { window.location.href = '/'; }}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          aria-label="Go to dashboard"
        >
          <img src="/icons/openjam.png" alt="" className="h-8 w-8 rounded-lg" />
        </button>

        <div className="min-w-0">
          {isEditingName ? (
            <input
              value={tempName}
              onChange={(event) => setTempName(event.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleNameSubmit();
                if (event.key === 'Escape') {
                  setIsEditingName(false);
                  setTempName(boardName);
                }
              }}
              className="h-9 w-64 max-w-[52vw] rounded-lg border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}
              aria-label="Board name"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              className="group flex max-w-[52vw] items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              aria-label="Rename board"
            >
              <span className="truncate text-sm font-semibold sm:text-base">{boardName}</span>
              <PencilIcon className="h-3.5 w-3.5 opacity-55 transition group-hover:opacity-100" />
            </button>
          )}
          <SaveStatusIndicator status={saveStatus} error={saveError} compact />
        </div>

        <div className="hidden h-7 w-px sm:block" style={{ background: 'var(--glass-border-strong)' }} />

        <MenuTrigger active={activeMenu === 'board'} onClick={() => toggleMenu('board')}>Board</MenuTrigger>
        <MenuTrigger active={activeMenu === 'view'} onClick={() => toggleMenu('view')}>View</MenuTrigger>

        {activeMenu === 'board' && (
          <MenuPanel align="left">
            <MenuItemButton label="Save" shortcut="Ctrl+S" icon={<SaveIcon />} onClick={() => handleMenuAction(onSave || onExportJSON)} />
            <MenuItemButton label="Rename board" icon={<PencilIcon />} onClick={() => { setIsEditingName(true); closeMenu(); }} />
            <MenuDivider />
            <MenuItemButton label="Undo" shortcut="Ctrl+Z" onClick={() => handleMenuAction(onUndo)} />
            <MenuItemButton label="Redo" shortcut="Ctrl+Y" onClick={() => handleMenuAction(onRedo)} />
            <MenuItemButton label="Copy" shortcut="Ctrl+C" onClick={() => handleMenuAction(onCopy)} />
            <MenuItemButton label="Paste" shortcut="Ctrl+V" onClick={() => handleMenuAction(onPaste)} />
            <MenuItemButton label="Duplicate" shortcut="Ctrl+D" onClick={() => handleMenuAction(onDuplicate)} />
            <MenuItemButton label="Delete selection" shortcut="Del" onClick={() => handleMenuAction(onDelete)} />
            <MenuItemButton label="Select all" shortcut="Ctrl+A" onClick={() => handleMenuAction(onSelectAll)} />
            <MenuDivider />
            <MenuItemButton label="Bring to front" shortcut="]" onClick={() => handleMenuAction(onBringToFront)} />
            <MenuItemButton label="Send to back" shortcut="[" onClick={() => handleMenuAction(onSendToBack)} />
            <MenuItemButton label="Lock" shortcut="Ctrl+Shift+L" onClick={() => handleMenuAction(onLock)} />
            <MenuItemButton label="Unlock all" onClick={() => handleMenuAction(onUnlockAll)} />
            <MenuItemButton label="Group" shortcut="Ctrl+G" onClick={() => handleMenuAction(onGroup)} />
            <MenuItemButton label="Ungroup" shortcut="Ctrl+Shift+G" onClick={() => handleMenuAction(onUngroup)} />
            <MenuDivider />
            <MenuItemButton label="Duplicate board" onClick={() => handleMenuAction(onDuplicateBoard || onDuplicate)} />
            <MenuItemButton label="Version history" onClick={() => handleMenuAction(onVersionHistory)} />
            <MenuItemButton label="Board info" onClick={() => handleMenuAction(onFileInfo)} />
            <MenuItemButton label="Delete board" danger onClick={() => handleMenuAction(onDeleteBoard)} />
          </MenuPanel>
        )}

        {activeMenu === 'view' && (
          <MenuPanel align="left">
            <MenuItemButton label="Zoom in" shortcut="Ctrl++" onClick={() => handleMenuAction(onZoomIn)} />
            <MenuItemButton label="Zoom out" shortcut="Ctrl+-" onClick={() => handleMenuAction(onZoomOut)} />
            <MenuItemButton label="Zoom 100%" shortcut="Ctrl+0" onClick={() => handleMenuAction(onZoomReset)} />
            <MenuItemButton label="Zoom to fit" shortcut="Ctrl+1" onClick={() => handleMenuAction(onZoomFit)} />
            <MenuDivider />
            <MenuItemButton label={showGrid ? 'Hide grid' : 'Show grid'} checked={showGrid} onClick={() => handleMenuAction(onToggleGrid)} />
          </MenuPanel>
        )}
      </section>

      <section className="pointer-events-auto glass-elevated flex min-h-12 items-center gap-1 rounded-2xl px-2 py-2">
        <CollaborationPresence collaborators={collaborators} currentUserName={username} />
        <ConnectionStatus state="connected" />

        <button
          type="button"
          onClick={onShare}
          className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <ShareIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Share</span>
        </button>

        <div className="relative">
          <IconButton label="Export" active={activeMenu === 'export'} onClick={() => toggleMenu('export')}>
            <DownloadIcon className="h-5 w-5" />
          </IconButton>
          {activeMenu === 'export' && (
            <MenuPanel align="right">
              <MenuItemButton label="Export as PNG" onClick={() => handleMenuAction(onExportPNG)} />
              <MenuItemButton label="Export as JSON" onClick={() => handleMenuAction(onExportJSON)} />
            </MenuPanel>
          )}
        </div>

        <IconButton label={isDark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => onToggleTheme?.()}>
          {isDark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
        </IconButton>

        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu('account')}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-full text-sm font-semibold text-white transition hover:ring-2 hover:ring-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${isPinned ? 'ring-2 ring-blue-500' : ''}`}
            style={{ backgroundColor: userAvatarUrl ? 'transparent' : (userColor || '#9CA3AF') }}
            aria-label="Open account menu"
          >
            {userAvatarUrl ? (
              <img src={userAvatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
            ) : (
              (username || 'U').charAt(0).toUpperCase()
            )}
          </button>

          {activeMenu === 'account' && (
            <MenuPanel align="right" width="w-72">
              <div className="px-3 py-2">
                <p className="truncate text-sm font-semibold">{username || 'User'}</p>
                {userEmail && <p className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{userEmail}</p>}
              </div>
              <MenuDivider />
              <MenuItemButton label="Profile settings" onClick={() => { setShowProfileSettings(true); closeMenu(); }} />
              <MenuItemButton label={isPinned ? 'Stop spotlighting me' : 'Spotlight me'} checked={isPinned} onClick={() => handleMenuAction(onTogglePin)} />
              <MenuItemButton label={isDark ? 'Light mode' : 'Dark mode'} onClick={() => handleMenuAction(onToggleTheme)} />
              {onLogout && (
                <>
                  <MenuDivider />
                  <MenuItemButton label="Sign out" danger onClick={() => handleMenuAction(onLogout)} />
                </>
              )}
            </MenuPanel>
          )}
        </div>
      </section>

      {username && userColor && onUpdateProfile && (
        <ProfileSettingsDialog
          isOpen={showProfileSettings}
          onClose={() => setShowProfileSettings(false)}
          username={username}
          email={userEmail}
          color={userColor}
          avatarUrl={userAvatarUrl}
          onSave={onUpdateProfile}
        />
      )}
    </div>
  );
}

function MenuTrigger({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hidden min-h-11 rounded-xl px-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:block ${active ? 'bg-white/25' : 'hover:bg-white/15'}`}
      style={{ color: 'var(--text-primary)' }}
      aria-expanded={active}
    >
      {children}
    </button>
  );
}

function IconButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${active ? 'bg-white/25' : 'hover:bg-white/15'}`}
      style={{ color: 'var(--text-primary)' }}
      aria-label={label}
      title={label}
      aria-expanded={active}
    >
      {children}
    </button>
  );
}

function MenuPanel({ align, width = 'w-64', children }: { align: 'left' | 'right'; width?: string; children: ReactNode }) {
  return (
    <div
      className={`glass-elevated glass-panel-enter absolute top-full mt-2 max-h-[70vh] overflow-y-auto rounded-xl p-2 shadow-xl ${width} ${align === 'right' ? 'right-0' : 'left-0'}`}
      style={{ color: 'var(--text-primary)' }}
    >
      {children}
    </div>
  );
}

function MenuItemButton({
  label,
  shortcut,
  icon,
  checked,
  danger,
  onClick,
}: {
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  checked?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${onClick ? 'hover:bg-white/15' : 'cursor-not-allowed opacity-40'}`}
      style={{ color: danger ? '#EF4444' : 'var(--text-primary)' }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon && <span style={{ color: 'var(--text-secondary)' }}>{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      {checked !== undefined && <span className="text-xs" style={{ color: checked ? 'var(--accent)' : 'var(--text-tertiary)' }}>{checked ? 'On' : 'Off'}</span>}
      {shortcut && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{shortcut}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t" style={{ borderColor: 'var(--glass-border-strong)' }} />;
}

function PencilIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>;
}

function SaveIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>;
}

function ShareIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>;
}

function DownloadIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l4-4m-4 4l-4-4M4 19h16" /></svg>;
}

function SunIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
}

function MoonIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>;
}
