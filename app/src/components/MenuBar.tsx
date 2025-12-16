import { useState, useRef, useEffect } from 'react';
import DocumentMenu from './DocumentMenu';
import PagesPanel, { type Page } from './PagesPanel';
import UserMenu, { ProfileSettingsDialog } from './UserMenu';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  divider?: boolean;
  disabled?: boolean;
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
  pages?: Page[];
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
}

export default function MenuBar(props: MenuBarProps) {
  const {
    boardName, onBoardNameChange, onUndo, onRedo, onSelectAll, onDelete, onDuplicate,
    onCopy, onPaste, onZoomIn, onZoomOut, onZoomReset, onZoomFit, onSave, onExportPNG,
    onExportJSON, onShare, onToggleGrid, showGrid, onVersionHistory, onMoveToProject,
    onFileInfo, onDeleteBoard, pages, currentPageId, onSelectPage, onAddPage,
    onRenamePage, onDuplicatePage, onDeletePage, onDuplicateBoard, username, userEmail, userColor,
    userAvatarUrl, isPinned, onTogglePin, onUpdateProfile, onLogout,
    onBringToFront, onSendToBack, onLock, onUnlockAll, onGroup, onUngroup,
    collaborators = [],
  } = props;

  const [showMainMenu, setShowMainMenu] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(boardName);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const mainMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mainMenuRef.current && !mainMenuRef.current.contains(e.target as Node)) {
        setShowMainMenu(false);
        setActiveSubmenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'New board', shortcut: 'Ctrl+N', action: () => window.open('/', '_blank') },
      { label: 'Open...', shortcut: 'Ctrl+O', disabled: true },
      { divider: true, label: '' },
      { label: 'Save', shortcut: 'Ctrl+S', action: onSave || onExportJSON },
      { divider: true, label: '' },
      { label: 'Export as PNG', action: onExportPNG },
      { label: 'Export as JSON', action: onExportJSON },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: onUndo },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: onRedo },
      { divider: true, label: '' },
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: true },
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
      { label: 'Zoom to 100%', shortcut: 'Ctrl+0', action: onZoomReset },
      { label: 'Zoom to fit', shortcut: 'Ctrl+1', action: onZoomFit },
      { divider: true, label: '' },
      { label: showGrid ? '✓ Show grid' : 'Show grid', action: onToggleGrid },
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

  const handleItemClick = (item: MenuItem) => {
    if (item.disabled) return;
    item.action?.();
    setShowMainMenu(false);
    setActiveSubmenu(null);
  };

  const handleNameSubmit = () => {
    setIsEditingName(false);
    if (tempName.trim()) {
      onBoardNameChange(tempName.trim());
    } else {
      setTempName(boardName);
    }
  };

  return (
    <div className="absolute top-0 left-0 right-0 h-12 bg-white border-b border-gray-200 flex items-center z-50">
      {/* ===== LEFT SECTION: Logo + Menu + Document ===== */}
      <div className="flex items-center h-full">
        {/* Logo & Main Menu */}
        <div className="relative h-full flex items-center px-2" ref={mainMenuRef}>
          <button
            onClick={() => setShowMainMenu(!showMainMenu)}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors ${showMainMenu ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
          >
            <img src="/icons/openjam.png" alt="OpenJam" className="w-7 h-7 rounded-lg shadow-sm" />
            <svg className={`w-3 h-3 text-gray-400 transition-transform ${showMainMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Main dropdown menu */}
          {showMainMenu && (
            <div className="absolute top-full left-2 mt-1 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
              {Object.entries(menus).map(([menuName, items]) => (
                <div key={menuName} className="relative group" onMouseEnter={() => setActiveSubmenu(menuName)}>
                  <button className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between">
                    <span>{menuName}</span>
                    <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  {activeSubmenu === menuName && (
                    <div className="absolute left-full top-0 -ml-1 pl-2">
                      <div className="w-52 bg-white rounded-lg shadow-xl border border-gray-200 py-1">
                        {items.map((item, idx) => item.divider ? (
                          <div key={idx} className="my-1 border-t border-gray-100" />
                        ) : (
                          <button key={idx} onClick={() => handleItemClick(item)} disabled={item.disabled}
                            className={`w-full px-3 py-1.5 text-left text-sm flex items-center justify-between ${item.disabled ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'}`}>
                            <span>{item.label}</span>
                            {item.shortcut && <span className="text-xs text-gray-400">{item.shortcut}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="w-px h-6 bg-gray-200" />

        {/* Document Title & Controls */}
        <div className="flex items-center gap-2 px-3">
          {isEditingName ? (
            <input type="text" value={tempName} onChange={(e) => setTempName(e.target.value)}
              onBlur={handleNameSubmit} onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
              className="px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-[120px]" autoFocus />
          ) : (
            <button onClick={() => { setIsEditingName(true); setTempName(boardName); }}
              className="text-sm font-medium text-gray-800 hover:bg-gray-100 px-2 py-1 rounded transition-colors max-w-[200px] truncate">
              {boardName}
            </button>
          )}
          <DocumentMenu
            onMoveToProject={onMoveToProject || (() => {})} onVersionHistory={onVersionHistory || (() => {})}
            onDuplicate={onDuplicateBoard || onDuplicate} onRename={() => { setIsEditingName(true); setTempName(boardName); }}
            onExportPNG={onExportPNG} onExportJPG={() => {}} onExportPDF={() => {}} onExportJSON={onExportJSON}
            onDelete={onDeleteBoard || (() => {})} onShowInfo={onFileInfo || (() => {})}
          />
        </div>

        {/* Separator */}
        <div className="w-px h-6 bg-gray-200" />

        {/* Pages Panel */}
        {pages && onSelectPage && onAddPage && (
          <>
            <div className="px-2">
              <PagesPanel pages={pages} currentPageId={currentPageId || ''} onSelectPage={onSelectPage}
                onAddPage={onAddPage} onRenamePage={onRenamePage || (() => {})}
                onDuplicatePage={onDuplicatePage || (() => {})} onDeletePage={onDeletePage || (() => {})} />
            </div>
            <div className="w-px h-6 bg-gray-200" />
          </>
        )}
      </div>

      {/* ===== CENTER SECTION: Flexible space ===== */}
      <div className="flex-1" />

      {/* ===== RIGHT SECTION: Collaborators + Share ===== */}
      <div className="flex items-center h-full">
        {/* Collaborator Avatars */}
        {collaborators.length > 0 && (
          <>
            <div className="flex items-center -space-x-2 px-3">
              {collaborators.slice(0, 4).map((collab) => (
                <div key={collab.id} className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-medium shadow-sm"
                  style={{ backgroundColor: collab.color }} title={collab.name}>
                  {collab.avatarUrl ? (
                    <img src={collab.avatarUrl} alt={collab.name} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    collab.name.charAt(0).toUpperCase()
                  )}
                </div>
              ))}
              {collaborators.length > 4 && (
                <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium">
                  +{collaborators.length - 4}
                </div>
              )}
            </div>
            <div className="w-px h-6 bg-gray-200" />
          </>
        )}

        {/* User Menu */}
        {username && userColor && onTogglePin && (
          <div className="px-2">
            <UserMenu username={username} email={userEmail} avatarUrl={userAvatarUrl} color={userColor}
              isPinned={isPinned || false} onTogglePin={onTogglePin}
              onOpenSettings={() => setShowProfileSettings(true)} onLogout={onLogout} />
          </div>
        )}

        {/* Share Button */}
        <div className="px-3">
          <button onClick={onShare}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
