import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { updateRoom, type User } from '../lib/api';
import {
  createOrganization, createProject, createProjectBoard, createWorkspace, getDirectory,
  moveBoard, setBoardArchive, setBoardFavorite,
  type Directory, type DirectoryBoard, type Organization, type Project, type Workspace,
} from '../lib/directory';
import { useTheme } from '../lib/useTheme';
import { useI18n } from '../i18n';
import AccountPopover from './workbench/AccountPopover';
import BoardCollection, { type BoardAction, type BoardEntry, type BoardLayout } from './workbench/BoardCollection';
import BoardFilesPanel from './BoardFilesPanel';
import WorkbenchDialog, { type DialogField, type DialogSelection } from './workbench/WorkbenchDialog';
import WorkbenchIcon, { type WorkbenchIconName } from './workbench/WorkbenchIcon';
import './workbench/workbench.css';

interface WorkspaceDashboardProps {
  user: User;
  onLogout: () => void | Promise<void>;
}

type View = 'recent' | 'favorites' | 'shared' | 'archive';
type Sort = 'updated' | 'name';

const views: Array<{ id: View; icon: WorkbenchIconName }> = [
  { id: 'recent', icon: 'recent' },
  { id: 'favorites', icon: 'star' },
  { id: 'shared', icon: 'shared' },
  { id: 'archive', icon: 'archive' },
];

interface DirectoryLoad {
  key: string;
  directory?: Directory;
  error?: string;
}

interface ModalSettings {
  title: string;
  submitLabel: string;
  field?: DialogField;
  selection?: DialogSelection;
  save: (name: string, selectionId: string) => Promise<void>;
}

interface ActiveModal extends ModalSettings {
  returnFocus: HTMLElement | null;
}

interface ProjectLocation {
  project: Project;
  workspace: Workspace;
  organization: Organization;
}

const noProjects: Project[] = [];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function organizationPreferenceKey(userId: string): string {
  return `openjam-workbench-organization-v1:${userId}`;
}

function getOrganizationPreference(userId: string): string | null {
  try {
    return sessionStorage.getItem(organizationPreferenceKey(userId));
  } catch {
    return null;
  }
}

export default function WorkspaceDashboard({ user, onLogout }: WorkspaceDashboardProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<DirectoryLoad | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [layout, setLayout] = useState<BoardLayout>('grid');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [modal, setModal] = useState<ActiveModal | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busyBoards, setBusyBoards] = useState<ReadonlySet<string>>(() => new Set());
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const mobileCloseButton = useRef<HTMLButtonElement>(null);
  const { theme, setTheme, isDark } = useTheme();
  const { locale, formatNumber, messages: { workbench: { directory: text } } } = useI18n();
  const collator = useMemo(() => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }), [locale]);

  const key = `${user.id}:${attempt}`;
  const currentLoad = load?.key === key ? load : null;
  const directory = currentLoad?.directory;
  const loadError = currentLoad?.error;
  const loading = currentLoad === null;

  useEffect(() => {
    const controller = new AbortController();
    void getDirectory(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLoad({ key, directory: data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ key, error: errorMessage(error, text.loadBoardsError) });
      });
    return () => controller.abort();
  }, [key, text.loadBoardsError]);

  useEffect(() => {
    if (!menuId) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('[data-wb-board-menu]')) setMenuId(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (mobileNavOpen) mobileCloseButton.current?.focus();
  }, [mobileNavOpen]);

  const preferredOrganization = useMemo(() => getOrganizationPreference(user.id), [user.id]);
  const organizationId = params.get('organization') ?? preferredOrganization;
  const organization = directory?.organizations.find((item) => item.id === organizationId)
    ?? directory?.organizations.find((item) => item.kind === 'personal')
    ?? directory?.organizations[0];
  const activeOrganizationId = organization?.id;
  const view = views.find((item) => item.id === params.get('view')) ?? views[0];
  const projectId = params.get('project');

  useEffect(() => {
    if (!activeOrganizationId) return;
    try {
      sessionStorage.setItem(organizationPreferenceKey(user.id), activeOrganizationId);
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
  }, [activeOrganizationId, user.id]);

  const locations = useMemo(() => {
    const workspaces = new Map(directory?.workspaces.map((item) => [item.id, item]));
    const organizations = new Map(directory?.organizations.map((item) => [item.id, item]));
    const projects = new Map<string, ProjectLocation>();
    for (const project of directory?.projects ?? noProjects) {
      const workspace = workspaces.get(project.workspaceId);
      const owner = workspace && organizations.get(workspace.organizationId);
      if (workspace && owner) projects.set(project.id, { project, workspace, organization: owner });
    }
    return projects;
  }, [directory?.organizations, directory?.projects, directory?.workspaces]);

  const organizationWorkspaces = directory?.workspaces.filter((item) => item.organizationId === organization?.id) ?? [];
  const selectedLocation = projectId ? locations.get(projectId) : undefined;
  const activeProject = selectedLocation?.organization.id === organization?.id ? selectedLocation?.project : undefined;
  const organizationProjects = directory?.projects.filter((item) => locations.get(item.id)?.organization.id === organization?.id) ?? noProjects;
  const defaultProject = activeProject ?? organizationProjects.find((item) => item.name === 'Drafts') ?? organizationProjects[0];
  const search = query.trim().toLocaleLowerCase(locale);

  const entries = useMemo(() => {
    const projectCounts = new Map<string, number>();
    for (const { organization: owner } of locations.values()) {
      projectCounts.set(owner.id, (projectCounts.get(owner.id) ?? 0) + 1);
    }

    const visible: BoardEntry[] = [];
    for (const board of directory?.boards ?? []) {
      const location = board.projectId ? locations.get(board.projectId) : undefined;
      const ownOrganization = location !== undefined && location.organization.id === organization?.id;
      const legacyPersonalBoard = !location && board.ownerId === user.id && organization?.kind === 'personal';
      const archived = board.permission === 'owner' && board.archivedAt !== null;
      const boardLocation = location ? `${location.workspace.name} / ${location.project.name}` : text.sharedBoard;

      if (search) {
        if (view.id === 'archive' && !activeProject) {
          if (!archived || (!ownOrganization && !legacyPersonalBoard)) continue;
        } else if (archived) {
          continue;
        }
        const haystack = `${board.name} ${boardLocation} ${location?.organization.name ?? ''}`;
        if (!haystack.toLocaleLowerCase(locale).includes(search)) continue;
      } else if (activeProject) {
        if (archived || board.projectId !== activeProject.id) continue;
      } else {
        if (view.id === 'archive') {
          if (!archived || (!ownOrganization && !legacyPersonalBoard)) continue;
        } else {
          if (archived) continue;
          if (view.id === 'favorites' && !board.favorite) continue;
          if (view.id === 'shared' && board.ownerId === user.id) continue;
          if (view.id === 'recent' && !ownOrganization && !legacyPersonalBoard) continue;
        }
      }

      visible.push({
        board,
        location: location
          ? (ownOrganization ? boardLocation : `${location.organization.name} / ${location.project.name}`)
          : (legacyPersonalBoard ? text.personalDrafts : boardLocation),
        canMove: board.permission === 'owner' && location !== undefined
          && (projectCounts.get(location.organization.id) ?? 0) > 1,
      });
    }

    return visible.sort((a, b) => sort === 'name'
      ? collator.compare(a.board.name, b.board.name)
      : Date.parse(b.board.updatedAt) - Date.parse(a.board.updatedAt));
  }, [activeProject, collator, directory?.boards, locale, locations, organization?.id, organization?.kind, search, sort, text.personalDrafts, text.sharedBoard, user.id, view.id]);

  function closeMobileNav() {
    setMobileNavOpen(false);
    mobileMenuButton.current?.focus();
  }

  function selectDestination(destinationOrganization: string, destination: View = 'recent', destinationProject?: string) {
    const next = new URLSearchParams();
    if (destinationOrganization) next.set('organization', destinationOrganization);
    if (destinationProject) next.set('project', destinationProject);
    else if (destination !== 'recent') next.set('view', destination);
    setParams(next);
    setQuery('');
    setMenuId(null);
    if (mobileNavOpen) closeMobileNav();
  }

  function updateDirectory(update: (data: Directory) => Directory) {
    setLoad((previous) => previous?.key === key && previous.directory
      ? { key, directory: update(previous.directory) }
      : previous);
  }

  function patchBoard(id: string, changes: Partial<DirectoryBoard>) {
    updateDirectory((data) => ({
      ...data,
      boards: data.boards.map((board) => board.id === id ? { ...board, ...changes } : board),
    }));
  }

  function openModal(settings: ModalSettings) {
    const focused = document.activeElement;
    const trigger = focused?.closest('[data-wb-board-menu]')?.querySelector<HTMLElement>('[data-wb-menu-trigger]');
    setMenuId(null);
    setDialogError(null);
    setModal({ ...settings, returnFocus: trigger ?? (focused instanceof HTMLElement ? focused : null) });
  }

  async function submitModal(name: string, selectionId: string) {
    if (!modal || dialogBusy) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      await modal.save(name, selectionId);
      setModal(null);
    } catch (error) {
      setDialogError(errorMessage(error, text.saveError));
    } finally {
      setDialogBusy(false);
    }
  }

  function addOrganization() {
    openModal({
      title: text.newOrganization,
      submitLabel: text.createOrganization,
      field: { label: text.organizationName, placeholder: text.teamExample },
      save: async (name) => {
        const result = await createOrganization(name);
        selectDestination(result.id);
        setAttempt((current) => current + 1);
      },
    });
  }

  function addWorkspace() {
    if (!organization) return;
    openModal({
      title: text.newWorkspace,
      submitLabel: text.createWorkspace,
      field: { label: text.workspaceName, placeholder: text.workspaceExample },
      save: async (name) => {
        const result = await createWorkspace(organization.id, name);
        updateDirectory((data) => ({ ...data, workspaces: [...data.workspaces, result] }));
      },
    });
  }

  function addProject(workspace: Workspace) {
    openModal({
      title: text.newProjectIn(workspace.name),
      submitLabel: text.createProject,
      field: { label: text.projectName, placeholder: text.projectExample },
      save: async (name) => {
        const result = await createProject(workspace.id, name);
        updateDirectory((data) => ({ ...data, projects: [...data.projects, result] }));
        selectDestination(workspace.organizationId, 'recent', result.id);
      },
    });
  }

  function addBoard() {
    if (!defaultProject) return;
    openModal({
      title: text.newBoard,
      submitLabel: text.createBoard,
      field: { label: text.boardName, value: text.untitled },
      selection: activeProject ? undefined : {
        label: text.project,
        value: defaultProject.id,
        options: organizationProjects.map((item) => ({
          id: item.id,
          label: `${locations.get(item.id)?.workspace.name} / ${item.name}`,
        })),
      },
      save: async (name, selectionId) => {
        const board = await createProjectBoard(selectionId || defaultProject.id, name);
        navigate(`/board/${encodeURIComponent(board.id)}`);
      },
    });
  }

  function handleBoardAction(action: BoardAction, board: DirectoryBoard) {
    if (action === 'rename') {
      openModal({
        title: text.renameBoard,
        submitLabel: text.saveName,
        field: { label: text.boardName, value: board.name, maxLength: 255 },
        save: async (name) => {
          if (name === board.name) return;
          const result = await updateRoom(board.id, name);
          patchBoard(board.id, { name: result.name, updatedAt: result.updatedAt });
        },
      });
      return;
    }

    if (action === 'move') {
      const origin = board.projectId ? locations.get(board.projectId) : undefined;
      if (!origin) return;
      const options = Array.from(locations.values())
        .filter((item) => item.organization.id === origin.organization.id && item.project.id !== board.projectId)
        .map((item) => ({ id: item.project.id, label: `${item.workspace.name} / ${item.project.name}` }));
      if (options.length === 0) return;
      openModal({
        title: text.moveNamedBoard(board.name),
        submitLabel: text.moveBoard,
        selection: { label: text.destinationProject, options },
        save: async (_name, selectionId) => {
          const result = await moveBoard(board.id, selectionId);
          patchBoard(board.id, { projectId: result.projectId });
          setNotice(text.moved(board.name));
        },
      });
      return;
    }

    if (busyBoards.has(board.id)) return;
    setMenuId(null);
    setActionError(null);
    setBusyBoards((previous) => new Set([...previous, board.id]));
    void (async () => {
      try {
        if (action === 'favorite') {
          const result = await setBoardFavorite(board.id, !board.favorite);
          patchBoard(board.id, { favorite: result.favorite });
        } else {
          const result = await setBoardArchive(board.id, board.archivedAt === null);
          patchBoard(board.id, { archivedAt: result.archivedAt });
          setNotice(result.archivedAt ? text.archived(board.name) : text.restored(board.name));
        }
      } catch (error) {
        setActionError(errorMessage(error, text.updateError));
      } finally {
        setBusyBoards((previous) => {
          const next = new Set(previous);
          next.delete(board.id);
          return next;
        });
      }
    })();
  }

  const title = search ? text.searchResults : (activeProject?.name ?? text[view.id]);
  const empty = search
    ? text.empty.search
    : text.empty[activeProject ? 'recent' : view.id];
  const firstWorkspace = organizationWorkspaces[0];
  const primaryAction = defaultProject ? { label: text.newBoard, run: addBoard }
    : firstWorkspace ? { label: text.newProject, run: () => addProject(firstWorkspace) }
    : organization ? { label: text.newWorkspace, run: addWorkspace }
    : { label: text.newOrganization, run: addOrganization };
  const globalScope = view.id === 'shared' || view.id === 'favorites' || (search && (view.id !== 'archive' || activeProject));
  const scope = globalScope
    ? text.allOrganizations
    : selectedLocation && activeProject
      ? `${selectedLocation.organization.name} / ${selectedLocation.workspace.name}`
      : organization?.name;

  return (
    <main className="openjam-workbench">
      <aside
        className="wb-sidebar"
        id="wb-sidebar"
        data-open={mobileNavOpen}
        aria-label={text.sidebar}
        onKeyDown={(event) => {
          if (mobileNavOpen && event.key === 'Escape') closeMobileNav();
        }}
      >
        <div className="wb-sidebar-top">
          <Link
            to={activeOrganizationId ? `/workplace?organization=${encodeURIComponent(activeOrganizationId)}` : '/workplace'}
            className="shell-island wb-brand"
            onClick={() => { setQuery(''); setMobileNavOpen(false); }}
          >
            <img src="/icons/openjam.png" alt="" width="28" height="28" />
            <span>OpenJam</span>
          </Link>
          <button type="button" ref={mobileCloseButton} className="wb-icon-button wb-mobile-close" aria-label={text.closeNavigation} onClick={closeMobileNav}>
            <WorkbenchIcon name="close" />
          </button>
        </div>

        <div className="wb-organization-row">
          <label className="shell-island wb-organization-select">
            <span className="wb-organization-mark"><WorkbenchIcon name="organization" /></span>
            <select
              aria-label={text.organization}
              value={organization?.id ?? ''}
              onChange={(event) => selectDestination(event.target.value)}
              disabled={!organization}
            >
              {!organization && <option value="">{text.organizations}</option>}
              {directory?.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <WorkbenchIcon name="chevron" />
          </label>
          <button type="button" className="shell-island wb-organization-add" aria-label={text.newOrganization} title={text.newOrganization} onClick={addOrganization} disabled={!directory}>
            <WorkbenchIcon name="plus" />
          </button>
        </div>

        <div className="wb-sidebar-scroll">
          <nav className="wb-quick-nav" aria-label={text.views}>
            {views.map((item) => (
              <button
                type="button"
                key={item.id}
                className="wb-nav-button"
                aria-current={!activeProject && view.id === item.id && !search ? 'page' : undefined}
                onClick={() => selectDestination(organization?.id ?? '', item.id)}
              >
                <WorkbenchIcon name={item.icon} /> <span>{text[item.id]}</span>
              </button>
            ))}
          </nav>
          <section className="wb-workspaces" aria-labelledby="wb-workspaces-title">
            <div className="wb-sidebar-heading">
              <h2 id="wb-workspaces-title">{text.workspaces}</h2>
              <button type="button" className="wb-icon-button" aria-label={text.newWorkspace} title={text.newWorkspace} onClick={addWorkspace} disabled={!organization}>
                <WorkbenchIcon name="plus" />
              </button>
            </div>
            {organizationWorkspaces.map((workspace) => {
              const workspaceProjects = organizationProjects.filter((item) => item.workspaceId === workspace.id);
              return (
                <section className="wb-workspace" key={workspace.id} aria-label={workspace.name}>
                  <div className="wb-workspace-heading">
                    <span title={workspace.name}><WorkbenchIcon name="folder" /> {workspace.name}</span>
                    <button
                      type="button"
                      className="wb-icon-button"
                      aria-label={text.newProjectIn(workspace.name)}
                      title={text.newProjectIn(workspace.name)}
                      onClick={() => addProject(workspace)}
                    >
                      <WorkbenchIcon name="plus" />
                    </button>
                  </div>
                  {workspaceProjects.map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      className="wb-nav-button wb-project"
                      aria-current={activeProject?.id === project.id && !search ? 'page' : undefined}
                      onClick={() => selectDestination(workspace.organizationId, 'recent', project.id)}
                    >
                      <WorkbenchIcon name="board" /> <span>{project.name}</span>
                    </button>
                  ))}
                </section>
              );
            })}
          </section>
        </div>

        <div className="wb-profile">
          <AccountPopover user={user} onLogout={onLogout} theme={theme} setTheme={setTheme} side="above" expanded />
        </div>
      </aside>
      {mobileNavOpen && <button type="button" tabIndex={-1} className="wb-navigation-scrim" onClick={closeMobileNav} aria-label={text.closeNavigation} />}

      <section className="wb-main" aria-label={text.name}>
        <header className="wb-toolbar">
          <button
            type="button"
            ref={mobileMenuButton}
            className="shell-island wb-mobile-menu"
            aria-label={mobileNavOpen ? text.closeNavigation : text.showNavigation}
            aria-expanded={mobileNavOpen}
            aria-controls="wb-sidebar"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <WorkbenchIcon name="menu" />
          </button>
          <label className="shell-island wb-search">
            <WorkbenchIcon name="search" />
            <input type="search" aria-label={text.search} placeholder={text.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {directory && (
            <div className="shell-island wb-toolbar-actions">
              <button type="button" className="shell-icon-button" aria-label={text.importBoard} title={text.importBoard} aria-expanded={showImport} onClick={() => setShowImport(open => !open)}>
                <WorkbenchIcon name="import" />
              </button>
              <button type="button" className="wb-create-button" onClick={primaryAction.run} aria-label={primaryAction.label} title={primaryAction.label}>
                <WorkbenchIcon name="plus" /> <span>{primaryAction.label}</span>
              </button>
            </div>
          )}
        </header>

        <div className="wb-content">
          <header className="wb-page-heading">
            {scope && <p>{scope}</p>}
            <h1>{title}</h1>
          </header>

          {actionError && (
            <div className="wb-message wb-message-error" role="alert">
              <p>{actionError}</p>
              <button type="button" className="wb-icon-button" aria-label={text.dismissError} onClick={() => setActionError(null)}>
                <WorkbenchIcon name="close" />
              </button>
            </div>
          )}

          {loading ? (
            <div className="wb-loading" role="status">
              <p>{text.loading}</p>
              <div className="wb-skeletons" aria-hidden="true"><span /><span /><span /></div>
            </div>
          ) : loadError ? (
            <div className="wb-message wb-message-error" role="alert">
              <div><strong>{text.loadError}</strong><p>{loadError}</p></div>
              <button type="button" className="wb-button wb-button-secondary" onClick={() => setAttempt((current) => current + 1)}>{text.retry}</button>
            </div>
          ) : (
            <>
              <div className="wb-collection-bar">
                <p role="status">{text.boardCount(entries.length, formatNumber(entries.length))}</p>
                <div className="wb-collection-controls">
                  <label className="wb-sort">
                    <select aria-label={text.sort} value={sort} onChange={(event) => setSort(event.target.value === 'name' ? 'name' : 'updated')}>
                      <option value="updated">{text.updated}</option>
                      <option value="name">{text.nameSort}</option>
                    </select>
                  </label>
                  <div className="shell-island wb-layout-toggle" role="group" aria-label={text.layout}>
                    <button type="button" className="wb-icon-button" aria-label={text.grid} aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
                      <WorkbenchIcon name="grid" />
                    </button>
                    <button type="button" className="wb-icon-button" aria-label={text.list} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
                      <WorkbenchIcon name="list" />
                    </button>
                  </div>
                </div>
              </div>
              {entries.length > 0 ? (
                <BoardCollection entries={entries} theme={isDark ? 'dark' : 'light'} layout={layout} busyBoards={busyBoards} menuId={menuId} onMenuChange={setMenuId} onAction={handleBoardAction} />
              ) : (
                <div className="wb-empty">
                  <span className="wb-empty-icon" aria-hidden="true"><WorkbenchIcon name={search ? 'search' : activeProject ? 'board' : view.icon} /></span>
                  <h2>{empty.title}</h2>
                  <p>{empty.description}</p>
                  {search ? (
                    <button type="button" className="wb-button wb-button-secondary" onClick={() => setQuery('')}>{text.clearSearch}</button>
                  ) : (activeProject || view.id === 'recent') && (
                    <button type="button" className="wb-button wb-button-secondary" onClick={primaryAction.run}>
                      <WorkbenchIcon name="plus" /> {primaryAction.label}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {notice && <div className="wb-toast" role="status"><WorkbenchIcon name="check" /> {notice}</div>}
      {showImport && <BoardFilesPanel onClose={() => setShowImport(false)} onOpenBoard={id => navigate(`/board/${encodeURIComponent(id)}`)} />}
      {modal && (
        <WorkbenchDialog
          title={modal.title}
          submitLabel={modal.submitLabel}
          field={modal.field}
          selection={modal.selection}
          busy={dialogBusy}
          error={dialogError}
          returnFocus={modal.returnFocus}
          onClose={() => setModal(null)}
          onSubmit={(name, selectionId) => void submitModal(name, selectionId)}
        />
      )}
    </main>
  );
}
