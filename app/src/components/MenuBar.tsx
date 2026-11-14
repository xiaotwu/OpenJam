import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import CollaborationPresence, { type PresenceCollaborator } from './collaboration/CollaborationPresence';
import ConnectionStatus, { type ConnectionState } from './collaboration/ConnectionStatus';
import SyncStatus from './collaboration/SyncStatus';
import { ProfileSettingsDialog } from './UserMenu';
import PagesPanel, { type Page } from './PagesPanel';
import { useI18n } from '../i18n';

type MenuKey = 'main' | 'more' | 'account' | 'pages';
const mainSections = ['file', 'edit', 'view', 'window', 'help'] as const;
type MainSection = typeof mainSections[number];

type Collaborator = PresenceCollaborator;

interface MenuBarProps {
  boardName: string;
  onBoardNameChange: (name: string, expectedName: string) => void;
  canEdit?: boolean;
  pendingCount?: number;
  limitedAccess?: 'comment' | 'view';
  onUndo: () => void;
  onRedo: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
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
  saveStatus?: ComponentProps<typeof SyncStatus>['status'];
  saveError?: string;
  onExportPNG?: () => void;
  onExportJSON?: () => void;
  onShare: () => void;
  onOpenComments?: () => void;
  commentsOpen?: boolean;
  onOpenVersions?: () => void;
  onOpenFiles?: () => void;
  onOpenAgent?: () => void;
  onOpenHelp?: () => void;
  onOpenCommands?: () => void;
  presentationControls?: ReactNode;
  onToggleGrid: () => void;
  showGrid: boolean;
  onToggleSnap?: () => void;
  snapToGrid?: boolean;
  onFileInfo?: () => void;
  onDeleteBoard?: () => void;
  onDuplicateBoard?: () => void;
  pages?: Page[];
  currentPageId?: string;
  onSelectPage?: (pageId: string) => void;
  onAddPage?: () => void;
  onRenamePage?: (pageId: string, name: string, expectedName: string) => void;
  onDuplicatePage?: (pageId: string) => void;
  onDeletePage?: (pageId: string) => void;
  onReorderPage?: (pageId: string, position: number) => void;
  defaultPageId?: string;
  onDefaultPage?: (pageId: string) => void;
  onCopyPageLink?: (pageId: string) => Promise<boolean>;
  onMoveSelection?: (pageId: string) => void;
  sections?: { id: string; name: string }[];
  onSelectSection?: (elementId: string) => void;
  onCopySectionLink?: (elementId: string) => Promise<boolean>;
  username?: string;
  userEmail?: string;
  userColor?: string;
  userId?: string;
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
  connectionState?: ConnectionState;
  isDark?: boolean;
  theme?: 'light' | 'dark' | 'system';
  onToggleTheme?: () => void;
}

export default function MenuBar(props: MenuBarProps) {
  const { messages: { board: text } } = useI18n();
  const {
    boardName,
    onBoardNameChange,
    canEdit = true,
    pendingCount,
    limitedAccess,
    onUndo,
    onRedo,
    canUndo = true,
    canRedo = true,
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
    onOpenComments,
    commentsOpen,
    onOpenVersions,
    onOpenFiles,
    onOpenAgent,
    onOpenHelp,
    onOpenCommands,
    presentationControls,
    onToggleGrid,
    showGrid,
    onToggleSnap,
    snapToGrid = false,
    onFileInfo,
    onDeleteBoard,
    onDuplicateBoard,
    pages,
    currentPageId,
    onSelectPage,
    onAddPage,
    onRenamePage,
    onDuplicatePage,
    onDeletePage,
    onReorderPage,
    defaultPageId,
    onDefaultPage,
    onCopyPageLink,
    onMoveSelection,
    sections,
    onSelectSection,
    onCopySectionLink,
    username,
    userEmail,
    userColor,
    userId,
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
    connectionState = 'connected',
    isDark,
    theme = 'system',
    onToggleTheme,
  } = props;

  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [mainSection, setMainSection] = useState<MainSection>();
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(boardName);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const originalName = useRef<string | null>(null);
  const mainTrigger = useRef<HTMLButtonElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!canEdit && isEditingName) {
      originalName.current = null;
      setIsEditingName(false);
    }
  }, [canEdit, isEditingName]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const closeMenu = useCallback(() => setActiveMenu(null), []);

  const handleMenuAction = (action?: () => void) => {
    action?.();
    closeMenu();
  };

  const handleNameSubmit = () => {
    const expected = originalName.current;
    originalName.current = null;
    setIsEditingName(false);
    const nextName = tempName.trim();
    if (canEdit && nextName && expected !== null && nextName !== expected) onBoardNameChange(nextName, expected);
  };

  const startRename = () => {
    if (!canEdit) return;
    originalName.current = boardName;
    setTempName(boardName);
    setIsEditingName(true);
  };

  const toggleMenu = (menu: MenuKey) => {
    if (menu === 'main') setMainSection(undefined);
    setActiveMenu((current) => current === menu ? null : menu);
  };

  const mainItems: Record<MainSection, ReactNode> = {
    file: <>
      <MenuItemButton label={text.home} onClick={() => { window.location.href = '/'; }} />
      {onSave && <MenuItemButton label={text.save} shortcut="Ctrl+S" onClick={canEdit ? () => handleMenuAction(onSave) : undefined} />}
      <MenuItemButton label={text.rename} onClick={canEdit ? () => handleMenuAction(startRename) : undefined} />
      {onDuplicateBoard && <MenuItemButton label={text.clone} onClick={() => handleMenuAction(onDuplicateBoard)} />}
      {onOpenFiles && <MenuItemButton label={text.exportTasks} onClick={() => handleMenuAction(onOpenFiles)} />}
      {onFileInfo && <MenuItemButton label={text.information} onClick={() => handleMenuAction(onFileInfo)} />}
      {onDeleteBoard && <MenuItemButton label={text.deleteBoard} danger onClick={() => handleMenuAction(onDeleteBoard)} />}
    </>,
    edit: <>
      <MenuItemButton label={text.undo} shortcut="Ctrl+Z" onClick={canEdit && canUndo ? () => handleMenuAction(onUndo) : undefined} />
      <MenuItemButton label={text.redo} shortcut="Ctrl+Y" onClick={canEdit && canRedo ? () => handleMenuAction(onRedo) : undefined} />
      <MenuItemButton label={text.copy} shortcut="Ctrl+C" onClick={() => handleMenuAction(onCopy)} />
      <MenuItemButton label={text.paste} shortcut="Ctrl+V" onClick={canEdit ? () => handleMenuAction(onPaste) : undefined} />
      <MenuItemButton label={text.duplicate} shortcut="Ctrl+D" onClick={canEdit ? () => handleMenuAction(onDuplicate) : undefined} />
      <MenuItemButton label={text.deleteSelection} shortcut="Del" onClick={canEdit ? () => handleMenuAction(onDelete) : undefined} />
      <MenuItemButton label={text.selectAll} shortcut="Ctrl+A" onClick={() => handleMenuAction(onSelectAll)} />
      <MenuDivider />
      {onBringToFront && <MenuItemButton label={text.front} shortcut="]" onClick={canEdit ? () => handleMenuAction(onBringToFront) : undefined} />}
      {onSendToBack && <MenuItemButton label={text.back} shortcut="[" onClick={canEdit ? () => handleMenuAction(onSendToBack) : undefined} />}
      {onLock && <MenuItemButton label={text.lock} shortcut="Shift+L" onClick={canEdit ? () => handleMenuAction(onLock) : undefined} />}
      {onUnlockAll && <MenuItemButton label={text.unlock} onClick={canEdit ? () => handleMenuAction(onUnlockAll) : undefined} />}
      {onGroup && <MenuItemButton label={text.group} shortcut="Ctrl+G" onClick={canEdit ? () => handleMenuAction(onGroup) : undefined} />}
      {onUngroup && <MenuItemButton label={text.ungroup} shortcut="Shift+G" onClick={canEdit ? () => handleMenuAction(onUngroup) : undefined} />}
    </>,
    view: <>
      <MenuItemButton label={text.zoomIn} shortcut="Ctrl++" onClick={() => handleMenuAction(onZoomIn)} />
      <MenuItemButton label={text.zoomOut} shortcut="Ctrl+-" onClick={() => handleMenuAction(onZoomOut)} />
      <MenuItemButton label={text.zoomReset} shortcut="Ctrl+0" onClick={() => handleMenuAction(onZoomReset)} />
      <MenuItemButton label={text.zoomFit} shortcut="Ctrl+1" onClick={() => handleMenuAction(onZoomFit)} />
      <MenuDivider />
      <MenuItemButton label={showGrid ? text.hideGrid : text.showGrid} checked={showGrid} onClick={() => handleMenuAction(onToggleGrid)} />
      {onToggleSnap && <MenuItemButton label={text.snap} checked={snapToGrid} onClick={() => handleMenuAction(onToggleSnap)} />}
    </>,
    window: <>
      <MenuItemButton label={text.workspace} onClick={() => { window.location.href = '/workplace'; }} />
      {pages?.length ? <MenuItemButton label={text.pages} onClick={() => setActiveMenu('pages')} /> : null}
      {onOpenAgent && <MenuItemButton label={text.assistant} onClick={() => handleMenuAction(onOpenAgent)} />}
      {onOpenComments && <MenuItemButton label={text.comments} onClick={() => handleMenuAction(onOpenComments)} />}
      {onOpenVersions && <MenuItemButton label={text.history} onClick={() => handleMenuAction(onOpenVersions)} />}
    </>,
    help: <>
      {onOpenHelp && <MenuItemButton label={text.helpAndShortcuts} onClick={() => handleMenuAction(onOpenHelp)} />}
      {onOpenCommands && <MenuItemButton label={text.commandPalette} shortcut="Ctrl+K" onClick={() => handleMenuAction(onOpenCommands)} />}
    </>,
  };

  const accountItems = (
    <>
      <div className="px-3 py-2">
        <p className="truncate text-sm font-semibold">{username || text.user}</p>
        {userEmail && <p className="truncate text-xs text-[var(--text-secondary)]">{userEmail}</p>}
      </div>
      <MenuDivider />
      <MenuItemButton label={text.profile} icon={<UserIcon />} onClick={() => { setShowProfileSettings(true); closeMenu(); }} />
      {onTogglePin && <MenuItemButton label={isPinned ? text.stopSpotlight : text.spotlight} icon={<PinIcon />} checked={isPinned} onClick={() => handleMenuAction(onTogglePin)} />}
      <MenuItemButton
        label={text.theme(theme === 'system' ? text.system : isDark ? text.dark : text.light)}
        icon={theme === 'system' ? <SystemIcon /> : isDark ? <SunIcon /> : <MoonIcon />}
        onClick={() => handleMenuAction(onToggleTheme)}
      />
      {onLogout && <MenuItemButton label={text.signOut} icon={<LogoutIcon />} danger onClick={() => handleMenuAction(onLogout)} />}
    </>
  );

  return (
    <div ref={barRef} className="board-topbar pointer-events-none absolute left-3 right-3 top-3 z-[90] flex items-center justify-between gap-1.5 sm:gap-2" onKeyDown={(event) => {
      if (event.key !== 'Escape' || !activeMenu) return;
      event.stopPropagation();
      closeMenu();
      if (activeMenu === 'main') mainTrigger.current?.focus();
      if (activeMenu === 'more') moreTrigger.current?.focus();
      if (activeMenu === 'account') accountTrigger.current?.focus();
    }}>
      <section aria-label={text.navigation} className="pointer-events-auto relative flex min-w-0 items-center gap-1.5 sm:gap-2">
        <div className="board-action-island board-title-island">
          <IconButton buttonRef={mainTrigger} label={text.mainMenu} expanded={activeMenu === 'main'} onClick={() => toggleMenu('main')}>
            <SvgIcon><path d="M5 7h14M5 12h14M5 17h14" /></SvgIcon>
          </IconButton>

        <div className="min-w-0">
          {canEdit && isEditingName ? (
            <input
              value={tempName}
              onChange={(event) => setTempName(event.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') handleNameSubmit();
                if (event.key === 'Escape') {
                  originalName.current = null;
                  setIsEditingName(false);
                }
              }}
              className="h-8 w-64 max-w-full rounded-full border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}
              aria-label={text.name}
              autoFocus
            />
          ) : canEdit ? (
            <button
              type="button"
              onClick={startRename}
              className="board-name-trigger group flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-1.5 text-left transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              aria-label={text.renameBoard}
            >
              <span className="truncate text-[13px] font-semibold sm:text-sm">{boardName}</span>
              <PencilIcon className="h-3 w-3 shrink-0 opacity-45 transition group-hover:opacity-100" />
            </button>
          ) : <span className="block truncate px-1.5 py-1 text-[13px] font-semibold sm:text-sm">{boardName}</span>}
        </div>

        <SyncStatus compact status={saveStatus} error={saveError} pendingCount={pendingCount} />
        {limitedAccess && <span className="board-access-indicator" title={limitedAccess === 'comment' ? text.canComment : text.viewOnly}
          role="img" aria-label={limitedAccess === 'comment' ? text.canComment : text.viewOnly}>
          {limitedAccess === 'comment' ? <CommentsIcon /> : <ViewMenuIcon />}
        </span>}
        </div>
        {!!pages?.length && currentPageId && onSelectPage && (
          <div role="group" aria-label={text.pageControls} className={activeMenu === 'pages' ? 'board-pages-detached' : 'board-action-island board-pages-island shrink-0'}>
          <PagesPanel
            pages={pages}
            currentPageId={currentPageId}
            onSelectPage={onSelectPage}
            onAddPage={canEdit ? onAddPage : undefined}
            onRenamePage={canEdit ? onRenamePage : undefined}
            onDuplicatePage={canEdit ? onDuplicatePage : undefined}
            onDeletePage={canEdit ? onDeletePage : undefined}
            onReorderPage={canEdit ? onReorderPage : undefined}
            defaultPageId={defaultPageId}
            onDefaultPage={canEdit ? onDefaultPage : undefined}
            onCopyPageLink={onCopyPageLink}
            onMoveSelection={canEdit ? onMoveSelection : undefined}
            sections={sections}
            onSelectSection={onSelectSection}
            onCopySectionLink={onCopySectionLink}
            onDismiss={activeMenu === 'pages' ? closeMenu : undefined}
          />
          </div>
        )}

        {activeMenu === 'main' && (
          <MenuPanel align="left" width="w-64">
            {mainSections.map(section => (
              <div key={section}>
                <button type="button" aria-label={text.menu[section]} aria-expanded={mainSection === section}
                  className="board-main-menu-section" onClick={() => setMainSection(current => current === section ? undefined : section)}>
                  {text.menu[section]}
                </button>
                {mainSection === section && <div className="board-main-menu-items">{mainItems[section]}</div>}
              </div>
            ))}
          </MenuPanel>
        )}
      </section>

      <section aria-label={text.collaborationAndSharing} className="pointer-events-auto relative ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        {(presentationControls || connectionState !== 'connected' || collaborators.length > 0) && (
          <div role="group" aria-label={text.liveCollaboration} className="board-action-island board-wide-only">
            <CollaborationPresence collaborators={collaborators} currentUserId={userId} currentUserName={username} />
            {connectionState !== 'connected' && <ConnectionStatus state={connectionState} />}
            {presentationControls}
          </div>
        )}

        <div role="group" aria-label={text.reviewAndTools} className="board-action-island">
          {onOpenComments && <div className="board-wide-only">
            <IconButton label={text.comments} pressed={commentsOpen} onClick={() => handleMenuAction(onOpenComments)}>
              <CommentsIcon />
            </IconButton>
          </div>}
          <IconButton buttonRef={moreTrigger} label={text.more} expanded={activeMenu === 'more'} onClick={() => toggleMenu('more')}>
            <SvgIcon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></SvgIcon>
          </IconButton>
        </div>
        {activeMenu === 'more' && (
            <MenuPanel align="right" width="w-64">
              <div className="board-compact-only">
                {!!pages?.length && <div className="board-pages-overflow">
                  <MenuItemButton label={text.pages} onClick={() => setActiveMenu('pages')} />
                </div>}
                <CollaborationPresence compact collaborators={collaborators} currentUserId={userId} currentUserName={username} />
                {connectionState !== 'connected' && <ConnectionStatus state={connectionState} />}
                {presentationControls && <div className="board-compact-presentation">{presentationControls}</div>}
                {onOpenComments && <MenuItemButton label={text.comments} icon={<CommentsIcon />} onClick={() => handleMenuAction(onOpenComments)} />}
                <MenuItemButton label={text.shareBoard} icon={<ShareIcon className="h-[17px] w-[17px]" />} onClick={() => handleMenuAction(onShare)} />
              </div>
              {onOpenVersions && <MenuItemButton label={text.history} icon={<HistoryIcon />} onClick={() => handleMenuAction(onOpenVersions)} />}
              {onOpenAgent && <MenuItemButton label={text.assistant} icon={<AssistantIcon />} onClick={() => handleMenuAction(onOpenAgent)} />}
              {onOpenFiles ? (
                <MenuItemButton label={text.exportTasks} icon={<DownloadIcon className="h-4 w-4" />} onClick={() => handleMenuAction(onOpenFiles)} />
              ) : (
                <>
                  {onExportPNG && <MenuItemButton label={text.exportPNG} icon={<ImageFileIcon />} onClick={() => handleMenuAction(onExportPNG)} />}
                  {onExportJSON && <MenuItemButton label={text.exportJSON} icon={<CodeFileIcon />} onClick={() => handleMenuAction(onExportJSON)} />}
                </>
              )}
              {!onOpenVersions && !onOpenFiles && !onOpenAgent && !onExportPNG && !onExportJSON && <MenuItemButton label={text.information} icon={<InfoIcon />} onClick={() => handleMenuAction(onFileInfo)} />}
              <div className="board-compact-only"><MenuDivider />{accountItems}</div>
            </MenuPanel>
        )}

        <button
          type="button"
          onClick={() => handleMenuAction(onShare)}
          className="board-action-island board-share-action board-wide-only"
          aria-label={text.shareBoard}
          title={text.shareBoard}
        >
          <ShareIcon className="h-[17px] w-[17px]" />
        </button>

        <div className="relative board-wide-only">
          <button
            ref={accountTrigger}
            type="button"
            onClick={() => toggleMenu('account')}
            className="board-account-trigger"
            aria-label={text.accountMenu}
            aria-expanded={activeMenu === 'account'}
            title={text.account}
          >
            {userAvatarUrl ? <img src={userAvatarUrl} alt="" className="h-full w-full object-cover" /> : (username || 'U').charAt(0).toUpperCase()}
          </button>

          {activeMenu === 'account' && (
            <MenuPanel align="right" width="w-64">
              {accountItems}
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

function IconButton({ label, pressed, expanded, buttonRef, onClick, children }: {
  label: string;
  pressed?: boolean;
  expanded?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      className="board-action-button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
}

function MenuPanel({ align, width = 'w-56', children }: { align: 'left' | 'right'; width?: string; children: ReactNode }) {
  return (
    <div
      className={`board-chrome-popover glass-panel-enter absolute top-full mt-1 max-h-[min(73dvh,calc(100dvh-4.75rem))] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-[var(--glass-border-strong)] p-1.5 shadow-xl ${width} ${align === 'right' ? 'right-0' : 'left-0'}`}
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
      className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-full px-3 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${onClick ? 'hover:bg-[var(--badge-bg)]' : 'cursor-not-allowed opacity-40'}`}
      style={{ color: danger ? '#EF4444' : 'var(--text-primary)' }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon && <span style={{ color: 'var(--text-secondary)' }}>{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      {checked !== undefined && <span className="text-xs" style={{ color: checked ? 'var(--accent)' : 'var(--text-tertiary)' }}>{checked ? '✓' : '○'}</span>}
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

function ShareIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>;
}

function DownloadIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l4-4m-4 4l-4-4M4 19h16" /></svg>;
}

function HistoryIcon() {
  return <SvgIcon><path d="M4.8 10a7.5 7.5 0 1 1 1.1 6.6M4.8 6.5V10h3.5M12 8v4l2.7 1.7" /></SvgIcon>;
}

function CommentsIcon() {
  return <SvgIcon><path d="M7 4.5h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-5l-5 3v-3a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3Z" /><path d="M8 9.5h8M8 12.5h5" /></SvgIcon>;
}

function AssistantIcon() {
  return <SvgIcon><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z" /></SvgIcon>;
}

function SunIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
}

function MoonIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>;
}

function SystemIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
}

function ViewMenuIcon() {
  return <SvgIcon><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="3" /></SvgIcon>;
}

function InfoIcon() {
  return <SvgIcon><circle cx="12" cy="12" r="8" /><path d="M12 11v5" /><path d="M12 8h.01" /></SvgIcon>;
}

function ImageFileIcon() {
  return <SvgIcon><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="M6 18l5-5 3 3 2-2 2 4" /></SvgIcon>;
}

function CodeFileIcon() {
  return <SvgIcon><path d="M7 4h7l5 5v11H7z" /><path d="M14 4v5h5" /><path d="M11 13l-2 2 2 2M15 13l2 2-2 2" /></SvgIcon>;
}

function UserIcon() {
  return <SvgIcon><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0116 0" /></SvgIcon>;
}

function PinIcon() {
  return <SvgIcon><path d="M14 4l6 6-4 1-4 7-2-2 7-4 1-4-6-6z" /><path d="M8 16l-4 4" /></SvgIcon>;
}

function LogoutIcon() {
  return <SvgIcon><path d="M10 5H6a2 2 0 00-2 2v10a2 2 0 002 2h4" /><path d="M14 8l4 4-4 4M18 12H9" /></SvgIcon>;
}

function SvgIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
