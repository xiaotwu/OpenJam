import { Link, useNavigate } from 'react-router-dom';
import type { User } from '../lib/api';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

interface RecentBoard {
  id: string;
  name: string;
  updatedAt: string;
  collaboratorCount: number;
  elementCount: number;
  accent: string;
}

const recentBoards: RecentBoard[] = [
  {
    id: 'default',
    name: 'Team Whiteboard',
    updatedAt: 'Today',
    collaboratorCount: 3,
    elementCount: 24,
    accent: '#F59E0B',
  },
  {
    id: 'sprint-planning',
    name: 'Sprint Planning',
    updatedAt: 'Yesterday',
    collaboratorCount: 5,
    elementCount: 48,
    accent: '#3B82F6',
  },
  {
    id: 'product-retro',
    name: 'Product Retro',
    updatedAt: 'Mar 18',
    collaboratorCount: 4,
    elementCount: 31,
    accent: '#10B981',
  },
];

function createBoardId(): string {
  return `board-${Date.now().toString(36)}`;
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const navigate = useNavigate();

  const handleNewBoard = () => {
    navigate(`/board/${createBoardId()}`);
  };

  return (
    <main className="min-h-screen overflow-auto" style={{ background: 'var(--surface-canvas)', color: 'var(--text-primary)' }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/icons/openjam.png" alt="" className="h-10 w-10 rounded-xl" />
            <div>
              <h1 className="text-xl font-semibold leading-tight">OpenJam</h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Collaborative whiteboards</p>
            </div>
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

        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="max-w-xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--accent)' }}>
              Workspace
            </p>
            <h2 className="text-4xl font-semibold leading-tight sm:text-5xl">
              Pick up the room where the work is already moving.
            </h2>
            <p className="mt-4 text-lg" style={{ color: 'var(--text-secondary)' }}>
              Start a fresh board or jump back into a recent collaboration space. The canvas editor keeps its existing tools and save behavior.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleNewBoard}
                className="min-h-11 rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ background: 'var(--accent-gradient)' }}
              >
                New Board
              </button>
              <Link
                to="/board/default"
                className="flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ color: 'var(--text-primary)' }}
              >
                Open Default Board
              </Link>
            </div>
          </div>

          <div className="glass-elevated rounded-2xl p-4">
            <div className="mb-4 flex items-center justify-between gap-3 px-1">
              <div>
                <h3 className="text-base font-semibold">Recent boards</h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Mock data for the first product shell.</p>
              </div>
            </div>

            <div className="grid gap-3">
              {recentBoards.map((board) => (
                <Link
                  key={board.id}
                  to={`/board/${board.id}`}
                  className="group grid min-h-[116px] grid-cols-[72px_1fr] gap-4 rounded-xl border p-4 transition hover:-translate-y-0.5 hover:bg-white/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  style={{ borderColor: 'var(--glass-border-strong)' }}
                >
                  <div className="rounded-xl" style={{ background: board.accent }}>
                    <div className="h-full w-full rounded-xl bg-white/20" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="truncate text-base font-semibold">{board.name}</h4>
                      <span className="rounded-full px-2 py-1 text-xs" style={{ background: 'var(--glass-bg-subtle)', color: 'var(--text-secondary)' }}>
                        {board.updatedAt}
                      </span>
                    </div>
                    <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {board.elementCount} elements · {board.collaboratorCount} collaborators
                    </p>
                    <p className="mt-3 text-sm font-medium opacity-0 transition group-hover:opacity-100" style={{ color: 'var(--accent)' }}>
                      Open board
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
