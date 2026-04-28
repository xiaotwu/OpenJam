import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Room, User } from '../lib/api';
import { createRoom, deleteRoom, listRooms, updateRoom } from '../lib/api';

interface WorkspaceDashboardProps {
  user: User;
  onLogout: () => void | Promise<void>;
}

interface Workspace {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

interface WorkspaceState {
  workspaces: Workspace[];
  assignments: Record<string, string>;
}

const defaultWorkspaces: Workspace[] = [
  { id: 'active', name: 'Active work', color: '#F59E0B', collapsed: false },
  { id: 'team', name: 'Team spaces', color: '#3B82F6', collapsed: false },
  { id: 'drafts', name: 'Drafts', color: '#10B981', collapsed: false },
  { id: 'archive', name: 'Archive', color: '#6B7280', collapsed: true },
];

const roomAccents = ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#14B8A6'];

function storageKey(userId: string): string {
  return `openjam-workspace-state-${userId}`;
}

function createEmptyState(): WorkspaceState {
  return {
    workspaces: defaultWorkspaces,
    assignments: {},
  };
}

function loadWorkspaceState(userId: string): WorkspaceState {
  try {
    const stored = localStorage.getItem(storageKey(userId));
    if (!stored) {
      return createEmptyState();
    }

    const parsed = JSON.parse(stored) as Partial<WorkspaceState>;
    const workspaces = Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0
      ? parsed.workspaces
      : defaultWorkspaces;

    return {
      workspaces,
      assignments: parsed.assignments || {},
    };
  } catch {
    return createEmptyState();
  }
}

function saveWorkspaceState(userId: string, state: WorkspaceState) {
  localStorage.setItem(storageKey(userId), JSON.stringify(state));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function roomAccent(roomId: string): string {
  const total = roomId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return roomAccents[total % roomAccents.length];
}

export default function WorkspaceDashboard({ user, onLogout }: WorkspaceDashboardProps) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() => loadWorkspaceState(user.id));
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveWorkspaceState(user.id, workspaceState);
  }, [user.id, workspaceState]);

  useEffect(() => {
    let cancelled = false;

    const loadRooms = async () => {
      setLoading(true);
      setError(null);

      try {
        const { rooms } = await listRooms();
        if (!cancelled) {
          setRooms(rooms);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load projects');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadRooms();

    return () => {
      cancelled = true;
    };
  }, []);

  const workspaceIds = new Set(workspaceState.workspaces.map((workspace) => workspace.id));

  const assignedWorkspace = (roomId: string) => {
    const assignment = workspaceState.assignments[roomId];
    return assignment && workspaceIds.has(assignment) ? assignment : 'active';
  };

  const groupedWorkspaces = workspaceState.workspaces.map((workspace) => ({
    ...workspace,
    rooms: rooms.filter((room) => assignedWorkspace(room.id) === workspace.id),
  }));

  const handleNewBoard = async () => {
    setCreating(true);
    setError(null);

    try {
      const room = await createRoom('Untitled Board');
      setRooms((current) => [room, ...current]);
      setWorkspaceState((current) => ({
        ...current,
        assignments: {
          ...current.assignments,
          [room.id]: 'drafts',
        },
      }));
      navigate(`/board/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create board');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (room: Room) => {
    const nextName = window.prompt('Rename project', room.name)?.trim();
    if (!nextName || nextName === room.name) {
      return;
    }

    try {
      const updated = await updateRoom(room.id, nextName);
      setRooms((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename project');
    }
  };

  const handleDelete = async (room: Room) => {
    const confirmed = window.confirm(`Delete "${room.name}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteRoom(room.id);
      setRooms((current) => current.filter((item) => item.id !== room.id));
      setWorkspaceState((current) => {
        const assignments = { ...current.assignments };
        delete assignments[room.id];
        return { ...current, assignments };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  const handleMove = (roomId: string, workspaceId: string) => {
    setWorkspaceState((current) => ({
      ...current,
      assignments: {
        ...current.assignments,
        [roomId]: workspaceId,
      },
    }));
  };

  const handleToggleWorkspace = (workspaceId: string) => {
    setWorkspaceState((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => (
        workspace.id === workspaceId ? { ...workspace, collapsed: !workspace.collapsed } : workspace
      )),
    }));
  };

  const handleAddWorkspace = () => {
    const name = window.prompt('Workspace name')?.trim();
    if (!name) {
      return;
    }

    const id = `workspace-${Date.now().toString(36)}`;
    const color = roomAccents[workspaceState.workspaces.length % roomAccents.length];
    setWorkspaceState((current) => ({
      ...current,
      workspaces: [...current.workspaces, { id, name, color, collapsed: false }],
    }));
  };

  return (
    <main className="min-h-screen overflow-auto" style={{ background: 'var(--surface-canvas)', color: 'var(--text-primary)' }}>
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_520px]">
        <aside className="border-b border-black/5 bg-white/50 p-5 backdrop-blur-xl lg:border-b-0 lg:border-r">
          <Link to="/" className="flex min-h-11 items-center gap-3 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
            <img src="/icons/openjam.png" alt="" className="h-10 w-10 rounded-xl shadow-sm" />
            <div>
              <p className="font-semibold leading-tight">OpenJam</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Workplace</p>
            </div>
          </Link>

          <div className="mt-8">
            <button
              type="button"
              onClick={handleNewBoard}
              disabled={creating}
              className="flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ background: 'var(--accent-gradient)' }}
            >
              {creating ? 'Creating...' : 'New'}
            </button>
          </div>
        </aside>

        <section className="min-w-0 px-6 py-6 lg:px-8">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--accent)' }}>
                Workplace
              </p>
              <h1 className="mt-2 text-3xl font-semibold">Good to see you, {user.displayName}.</h1>
              <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
                Projects, drafts, and workspace categories for your saved OpenJam boards.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium">{user.displayName}</p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{user.email}</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="min-h-11 rounded-xl px-4 text-sm font-medium transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                Sign out
              </button>
            </div>
          </header>

          {error && (
            <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <section className="mt-8 glass-elevated rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Categorization</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{rooms.length} saved projects</p>
              </div>
              <button
                type="button"
                onClick={handleAddWorkspace}
                className="min-h-11 rounded-xl px-4 text-sm font-semibold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ color: 'var(--text-primary)' }}
              >
                Add workspace
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {groupedWorkspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => handleToggleWorkspace(workspace.id)}
                  className="min-h-[112px] rounded-2xl border bg-white/55 p-4 text-left transition hover:-translate-y-0.5 hover:bg-white/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  style={{ borderColor: 'var(--glass-border-strong)' }}
                  aria-expanded={!workspace.collapsed}
                >
                  <span className="block h-2 w-12 rounded-full" style={{ background: workspace.color }} />
                  <span className="mt-4 block text-base font-semibold">{workspace.name}</span>
                  <span className="mt-1 block text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {workspace.rooms.length} {workspace.rooms.length === 1 ? 'project' : 'projects'}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="border-t border-black/5 bg-white/55 p-5 backdrop-blur-xl lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Workspaces</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Saved projects and drafts</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {loading ? (
              <div className="glass-subtle rounded-2xl p-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                Loading projects...
              </div>
            ) : rooms.length === 0 ? (
              <div className="glass-subtle rounded-2xl p-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                No saved projects yet.
              </div>
            ) : (
              groupedWorkspaces.map((workspace) => (
                <section key={workspace.id} className="rounded-2xl border bg-white/55" style={{ borderColor: 'var(--glass-border-strong)' }}>
                  <button
                    type="button"
                    onClick={() => handleToggleWorkspace(workspace.id)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    aria-expanded={!workspace.collapsed}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="h-3 w-3 rounded-full" style={{ background: workspace.color }} />
                      <span className="truncate font-semibold">{workspace.name}</span>
                    </span>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {workspace.collapsed ? '+' : '-'} {workspace.rooms.length}
                    </span>
                  </button>

                  {!workspace.collapsed && (
                    <div className="space-y-3 px-3 pb-3">
                      {workspace.rooms.length === 0 ? (
                        <div className="rounded-xl bg-white/50 px-3 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          Empty workspace
                        </div>
                      ) : (
                        workspace.rooms.map((room) => (
                          <article key={room.id} className="rounded-xl border bg-white p-3 shadow-sm" style={{ borderColor: 'var(--glass-border-strong)' }}>
                            <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-3">
                              <div className="rounded-xl" style={{ background: roomAccent(room.id) }}>
                                <div className="h-full min-h-[52px] w-full rounded-xl bg-white/20" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <h3 className="truncate text-sm font-semibold">{room.name}</h3>
                                    <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                      Updated {formatDate(room.updatedAt)}
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2" role="toolbar" aria-label={`${room.name} actions`}>
                                  <Link
                                    to={`/board/${room.id}`}
                                    className="flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-white transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                                    style={{ background: roomAccent(room.id) }}
                                  >
                                    Open
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => handleRename(room)}
                                    className="min-h-11 rounded-lg px-3 text-xs font-semibold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(room)}
                                    className="min-h-11 rounded-lg px-3 text-xs font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                                  >
                                    Delete
                                  </button>
                                  <label className="sr-only" htmlFor={`move-${room.id}`}>Move {room.name}</label>
                                  <select
                                    id={`move-${room.id}`}
                                    value={assignedWorkspace(room.id)}
                                    onChange={(event) => handleMove(room.id, event.target.value)}
                                    className="min-h-11 rounded-lg border border-black/10 bg-white px-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                                  >
                                    {workspaceState.workspaces.map((option) => (
                                      <option key={option.id} value={option.id}>{option.name}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  )}
                </section>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
