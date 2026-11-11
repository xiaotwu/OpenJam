import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { updateRoom, type User } from '../lib/api';
import {
  createOrganization, createProject, createProjectBoard, createProjectDoc, createWorkspace, getDirectory,
  moveBoard, resourcePath, setBoardArchive, setBoardFavorite,
  type Directory, type DirectoryBoard, type Organization, type Project, type ResourceKind, type Workspace,
} from '../lib/directory';
import { useTheme } from '../lib/useTheme';
import { useAppearance } from '../lib/useAppearance';
import { useWorkshopResource, workshopPath, type Inbox } from '../lib/workshop';
import { useI18n } from '../i18n';
import AccountPopover from './workbench/AccountPopover';
import BoardCollection, { type BoardAction, type BoardEntry, type BoardLayout } from './workbench/BoardCollection';
import BoardFilesPanel from './BoardFilesPanel';
import DocImportDialog from './docs/DocImportDialog';
import ProjectFilesActions from './workbench/ProjectFilesActions';
import WorkbenchDialog, { type DialogField, type DialogSelection } from './workbench/WorkbenchDialog';
import { ProjectAccess, ProjectList, TeamMembers } from './workbench/TeamDirectoryPanels';
import { WorkshopRecents, WorkshopSearch } from './workbench/DiscoveryPanels';
import TeamRelationships from './workbench/TeamRelationships';
import { WorkshopCalendar } from './workbench/WorkshopCalendar';
import WorkshopInbox from './workbench/WorkshopInbox';
import WorkshopNavigation, { type WorkshopView } from './workbench/WorkshopNavigation';
import WorkbenchIcon, { type WorkbenchIconName } from './workbench/WorkbenchIcon';
import './workbench/workbench.css';
import './workbench/workshop.css';

interface WorkspaceDashboardProps {
  user: User;
  onLogout: () => void | Promise<void>;
}

type CollectionView = 'recent' | 'favorites' | 'shared' | 'archive';
type Sort = 'updated' | 'name';

const collectionIcons: Record<CollectionView, WorkbenchIconName> = {
  recent: 'board', favorites: 'star', shared: 'shared', archive: 'archive',
};

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
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<DirectoryLoad | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [layout, setLayout] = useState<BoardLayout>('grid');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [docImportProject, setDocImportProject] = useState<Project>();
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
  const { appearance } = useAppearance(user.id);
  const inbox = useWorkshopResource<Inbox>(workshopPath + '/inbox', 8_000);
  const { locale, formatNumber, messages: { workbench: { directory: text, teams: teamText } } } = useI18n();
  const collator = useMemo(() => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }), [locale]);

  const key = `${user.id}:${attempt}`;
  const currentLoad = load?.key === key ? load : null;
  const directory = currentLoad?.directory;
  const loadError = currentLoad?.error;
  const loading = currentLoad === null;

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    function refreshDirectory() {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      void getDirectory(controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setLoad({ key, directory: data });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setLoad({ key, error: errorMessage(error, text.loadBoardsError) });
        })
        .finally(() => { pending = false; });
    }
    refreshDirectory();
    window.addEventListener('focus', refreshDirectory);
    document.addEventListener('visibilitychange', refreshDirectory);
    const timer = window.setInterval(refreshDirectory, 20_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshDirectory);
      document.removeEventListener('visibilitychange', refreshDirectory);
    };
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
  const organizationId = params.get('organization');
  const personal = directory?.organizations.find(item => item.kind === 'personal');
  const teams = directory?.organizations.filter(item => item.kind === 'team') ?? [];
  const requestedTeam = teams.find(item => item.id === organizationId);
  const section = params.get('section');
  const teamMode = section === 'teams' || (section !== 'projects' && requestedTeam !== undefined);
  const organization = teamMode
    ? organizationId ? requestedTeam : teams.find(item => item.id === preferredOrganization) ?? teams[0]
    : personal;
  const canAddWorkspace = organization?.role === 'owner' || organization?.role === 'admin';
  const activeOrganizationId = organization?.id;
  const projectId = params.get('project');
  const requestedView = params.get('view');
  const view: WorkshopView = requestedView === 'inbox' || requestedView === 'calendar' || requestedView === 'recents'
    || requestedView === 'favorites' || requestedView === 'shared' || requestedView === 'archive' ? requestedView
    : section || organizationId || projectId || requestedView === 'recent' ? 'recent' : 'inbox';
  const collectionView: CollectionView = view === 'favorites' || view === 'shared' || view === 'archive' ? view : 'recent';
  const workshopHome = view === 'inbox' || view === 'calendar' || view === 'recents';

  useEffect(() => {
    if (!activeOrganizationId || !teamMode || view !== 'recent') return;
    try {
      sessionStorage.setItem(organizationPreferenceKey(user.id), activeOrganizationId);
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
  }, [activeOrganizationId, teamMode, user.id, view]);

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
  const editableProjects = organizationProjects.filter(item => item.role === 'manager' || item.role === 'edit');
  const defaultProject = activeProject
    ? editableProjects.find(item => item.id === activeProject.id)
    : editableProjects.find(item => item.isDefault) ?? editableProjects[0];
  const search = query.trim();
  const showAreaHome = !activeProject && view === 'recent' && !search;
  const showBoardTools = !workshopHome && !search;
  const projectsByTeam = new Map<string, Project[]>();
  for (const { organization: owner, project } of locations.values()) {
    if (owner.kind !== 'team') continue;
    const projects = projectsByTeam.get(owner.id) ?? [];
    projects.push(project);
    projectsByTeam.set(owner.id, projects);
  }
  const personalProjects = (directory?.projects ?? noProjects)
    .filter(project => locations.get(project.id)?.organization.id === personal?.id);

  const entries = useMemo(() => {
    const projectCounts = new Map<string, number>();
    for (const { organization: owner, project } of locations.values()) {
      if (project.role === 'manager') projectCounts.set(owner.id, (projectCounts.get(owner.id) ?? 0) + 1);
    }

    const visible: BoardEntry[] = [];
    for (const board of [...(directory?.boards ?? []), ...(directory?.docs ?? [])]) {
      const location = board.projectId ? locations.get(board.projectId) : undefined;
      const ownOrganization = location !== undefined && location.organization.id === organization?.id;
      const legacyPersonalBoard = !location && board.ownerId === user.id && organization?.kind === 'personal';
      const archived = board.permission === 'owner' && board.archivedAt !== null;
      const boardLocation = location ? `${location.workspace.name} / ${location.project.name}` : text.sharedBoard;

      if (activeProject) {
        if (archived || board.projectId !== activeProject.id) continue;
      } else if (collectionView === 'archive') {
        if (!archived || (!ownOrganization && !legacyPersonalBoard)) continue;
      } else {
        if (archived) continue;
        if (collectionView === 'favorites' && !board.favorite) continue;
        if (collectionView === 'shared' && (board.permission === 'owner' || location)) continue;
        if (collectionView === 'recent' && !ownOrganization && !legacyPersonalBoard) continue;
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
  }, [activeProject, collator, collectionView, directory?.boards, directory?.docs, locations, organization?.id, organization?.kind, sort, text.personalDrafts, text.sharedBoard, user.id]);

  function closeMobileNav() {
    setMobileNavOpen(false);
    mobileMenuButton.current?.focus();
  }

  function changeDestination(next: URLSearchParams) {
    setParams(next);
    setQuery('');
    setMenuId(null);
    setActionError(null);
    if (mobileNavOpen) closeMobileNav();
  }

  function selectDestination(destinationOrganization: string, destinationProject?: string) {
    const next = new URLSearchParams({ section: teams.some(team => team.id === destinationOrganization) ? 'teams' : 'projects' });
    if (destinationOrganization) next.set('organization', destinationOrganization);
    if (destinationProject) next.set('project', destinationProject);
    changeDestination(next);
  }

  function selectView(destination: WorkshopView) {
    const next = new URLSearchParams({ view: destination });
    if (destination === 'archive' && teamMode && activeOrganizationId) {
      next.set('section', 'teams');
      next.set('organization', activeOrganizationId);
    }
    changeDestination(next);
  }

  function selectProject(id: string) {
    const location = locations.get(id);
    if (location) selectDestination(location.organization.id, id);
  }

  function selectConversation(id?: string) {
    const next = new URLSearchParams({ view: 'inbox' });
    if (id) next.set('conversation', id);
    setParams(next);
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
      docs: (data.docs ?? []).map(doc => doc.id === id ? { ...doc, ...changes } : doc),
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
      title: teamText.newTeam,
      submitLabel: teamText.createTeam,
      field: { label: teamText.teamName, placeholder: text.teamExample },
      save: async (name) => {
        const result = await createOrganization(name);
        changeDestination(new URLSearchParams({ section: 'teams', organization: result.id }));
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
      title: text.newProject,
      submitLabel: text.createProject,
      field: { label: text.projectName, placeholder: text.projectExample },
      selection: organizationWorkspaces.length > 1 ? {
        label: 'Workspace',
        value: workspace.id,
        options: organizationWorkspaces.map(item => ({ id: item.id, label: item.name })),
      } : undefined,
      save: async (name, workspaceId) => {
        const result = await createProject(workspaceId || workspace.id, name);
        selectDestination(workspace.organizationId, result.id);
        setAttempt(current => current + 1);
      },
    });
  }

  function openResource(kind: ResourceKind, id: string) {
    navigate(resourcePath(kind, id), { state: { workshop: location.pathname + location.search } });
  }

  function addResource(kind: ResourceKind) {
    if (!defaultProject) return;
    const doc = kind === 'doc';
    openModal({
      title: doc ? 'New Document' : text.newBoard,
      submitLabel: doc ? 'Create Document' : text.createBoard,
      field: { label: doc ? 'Document Name' : text.boardName, value: doc ? 'Untitled Document' : text.untitled },
      selection: activeProject ? undefined : {
        label: text.project,
        value: defaultProject.id,
        options: editableProjects.map((item) => ({
          id: item.id,
          label: `${locations.get(item.id)?.workspace.name} / ${item.name}`,
        })),
      },
      save: async (name, selectionId) => {
        const create = doc ? createProjectDoc : createProjectBoard;
        const file = await create(selectionId || defaultProject.id, name);
        openResource(kind, file.id);
      },
    });
  }

  function handleBoardAction(action: BoardAction, board: DirectoryBoard) {
    if (action === 'reference') {
      setMenuId(null);
      setActionError(null);
      const reference = resourcePath(board.kind, board.id);
      if (!navigator.clipboard) {
        setActionError('Select and copy ' + reference);
        return;
      }
      void navigator.clipboard.writeText(reference)
        .then(() => setNotice('Reference copied.'), () => setActionError('Select and copy ' + reference));
      return;
    }

    if (action === 'rename') {
      openModal({
        title: board.kind === 'doc' ? 'Rename Document' : text.renameBoard,
        submitLabel: text.saveName,
        field: { label: board.kind === 'doc' ? 'Document Name' : text.boardName, value: board.name, maxLength: 255 },
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
        .filter((item) => item.organization.id === origin.organization.id && item.project.id !== board.projectId && item.project.role === 'manager')
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

  const title = search ? text.searchResults
    : view === 'inbox' ? 'Inbox'
      : view === 'calendar' ? 'Calendar'
        : view === 'recents' ? 'Recents'
          : activeProject?.name ?? (showAreaHome ? (teamMode ? organization?.name ?? (organizationId ? 'Team Unavailable' : teamText.noTeams) : teamText.personal) : text[collectionView]);
  const empty = text.empty[activeProject ? 'recent' : collectionView];
  const firstWorkspace = organizationWorkspaces.find(item => item.isDefault) ?? organizationWorkspaces[0];
  const primaryAction = activeProject ? null
    : firstWorkspace ? { label: text.newProject, run: () => addProject(firstWorkspace) }
      : organization && canAddWorkspace ? { label: text.newWorkspace, run: addWorkspace }
        : teamMode && !organization ? { label: teamText.newTeam, run: addOrganization } : null;
  const scope = !showBoardTools ? undefined : view === 'shared' || view === 'favorites' ? text.allOrganizations
    : selectedLocation && activeProject ? selectedLocation.organization.name
      : view === 'archive' ? organization?.name : undefined;
  const scheduleScope = activeProject ? 'project:' + activeProject.id
    : teamMode && activeOrganizationId ? 'team:' + activeOrganizationId : undefined;
  const showTeamWorkspaceAction = showAreaHome && teamMode && canAddWorkspace && firstWorkspace;
  const calendarDate = params.get('date') ?? undefined;
  const calendarItem = params.get('item') ?? undefined;
  const calendarScope = params.get('scope') ?? undefined;

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
            to="/workplace"
            className="wb-brand"
            onClick={() => { setQuery(''); setMobileNavOpen(false); }}
          >
            <img src="/icons/openjam.png" alt="" width="28" height="28" />
            <span>OpenJam</span>
          </Link>
          <button type="button" ref={mobileCloseButton} className="wb-icon-button wb-mobile-close" aria-label={text.closeNavigation} onClick={closeMobileNav}>
            <WorkbenchIcon name="close" />
          </button>
        </div>

        <div className="wb-sidebar-scroll">
          <WorkshopNavigation activeView={search ? undefined : view} personalProjects={personalProjects} teams={teams}
            projectsByTeam={projectsByTeam} activeTeam={teamMode && view === 'recent' ? activeOrganizationId : undefined}
            activeProject={!search ? activeProject?.id : undefined} personalOpen={!teamMode && view === 'recent' && !search}
            badge={appearance.inboxBadge} unread={inbox.data?.unread ?? 0}
            onView={selectView} onProjects={() => selectDestination(personal?.id ?? '')}
            onTeam={selectDestination} onProject={selectProject} onNewTeam={addOrganization} />
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
          <div className="wb-search" role="search">
            <WorkbenchIcon name="search" />
            <input type="search" aria-label={text.search} placeholder={text.searchPlaceholder} value={query} maxLength={120}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />
            {query && <button type="button" className="wb-icon-button" aria-label={text.clearSearch} onClick={() => setQuery('')}>
              <WorkbenchIcon name="close" />
            </button>}
          </div>
          {directory && showBoardTools && (
            <div className="shell-island wb-toolbar-actions">
              {scheduleScope && view === 'recent' && <Link className="wb-icon-button" aria-label="Open Calendar" title="Open Calendar"
                to={'/workplace?' + new URLSearchParams({ view: 'calendar', scope: scheduleScope })}><WorkbenchIcon name="calendar" /></Link>}
              {showTeamWorkspaceAction && <button type="button" className="wb-icon-button" aria-label={text.newWorkspace}
                title={text.newWorkspace} onClick={addWorkspace}><WorkbenchIcon name="folder" /></button>}
              {activeProject && defaultProject && view === 'recent' && <ProjectFilesActions
                onNewBoard={() => addResource('board')} onNewDoc={() => addResource('doc')}
                onImportBoard={() => setShowImport(true)} onImportDoc={() => setDocImportProject(activeProject)} />}
              {!activeProject && (!showAreaHome || !teamMode) && <button type="button" className="wb-icon-button" aria-label={text.importBoard}
                title={text.importBoard} aria-expanded={showImport} onClick={() => setShowImport(open => !open)}><WorkbenchIcon name="import" /></button>}
              {primaryAction && view === 'recent' && <button type="button" className="wb-button wb-button-primary" onClick={primaryAction.run}
                aria-label={primaryAction.label} title={primaryAction.label}><WorkbenchIcon name="plus" /><span>{primaryAction.label}</span></button>}
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

          {search ? (
            <WorkshopSearch query={search} teamId={teamMode && view === 'recent' ? organizationId ?? activeOrganizationId : undefined}
              teamName={teamMode && view === 'recent' ? organization?.name : undefined} onOpen={() => setQuery('')} />
          ) : view === 'inbox' ? (
            <WorkshopInbox user={user} teams={teams} data={inbox.data} loading={inbox.loading} error={inbox.error}
              selected={params.get('conversation') ?? undefined} onSelect={selectConversation} onChange={inbox.refresh} />
          ) : view === 'calendar' ? (
            <WorkshopCalendar key={[calendarDate, calendarItem, calendarScope].join(':')} teams={teams}
              projects={directory?.projects ?? noProjects} initialDate={calendarDate} initialItem={calendarItem} initialScope={calendarScope} />
          ) : view === 'recents' ? <WorkshopRecents /> : loading ? (
            <div className="wb-loading" role="status">
              <p>{text.loading}</p>
              <div className="wb-skeletons" aria-hidden="true"><span /><span /><span /></div>
            </div>
          ) : loadError ? (
            <div className="wb-message wb-message-error" role="alert">
              <div><strong>{text.loadError}</strong><p>{loadError}</p></div>
              <button type="button" className="wb-button wb-button-secondary" onClick={() => setAttempt((current) => current + 1)}>{text.retry}</button>
            </div>
          ) : showAreaHome && teamMode ? (
            organization ? <>
              <div className="wb-team-overview">
                <TeamRelationships key={organization.id} teamId={organization.id} />
                <div className="wb-team-details">
                  <ProjectList projects={organizationProjects} onOpen={selectProject} />
                  <TeamMembers key={organization.id} team={organization} currentUserId={user.id} focusedMember={params.get('member')}
                    onLeave={() => { selectView('inbox'); setAttempt(current => current + 1); }} />
                </div>
              </div>
            </> : <p className="wb-inline-empty">{organizationId ? 'This team is unavailable.' : 'Create a team or accept an invitation.'}</p>
          ) : (
            <>
              {showAreaHome && organization && <ProjectList projects={organizationProjects} onOpen={selectProject} />}
              {teamMode && organization && activeProject?.role === 'manager' && <ProjectAccess key={activeProject.id}
                project={activeProject} teamId={organization.id} currentUserId={user.id}
                onChange={() => setAttempt(current => current + 1)} />}
              <div className="wb-collection-bar">
                <p role="status">{formatNumber(entries.length)} {entries.length === 1 ? 'file' : 'files'}</p>
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
                  <span className="wb-empty-icon" aria-hidden="true"><WorkbenchIcon name={activeProject ? 'board' : collectionIcons[collectionView]} /></span>
                  <h2>{activeProject ? 'No files yet' : empty.title}</h2>
                  <p>{activeProject && defaultProject ? 'Create a board or document in this project.' : activeProject ? 'Project files will appear here.' : empty.description}</p>
                  {primaryAction && (activeProject || view === 'recent') && (
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
      {docImportProject && <DocImportDialog projectId={docImportProject.id} projectName={docImportProject.name}
        onClose={() => setDocImportProject(undefined)} onImported={id => { setDocImportProject(undefined); openResource('doc', id); }} />}
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
