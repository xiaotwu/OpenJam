import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '../lib/api';
import AuthPage from './AuthPage';

type AuthMode = 'login' | 'register';

interface DashboardProps {
  user: User | null;
  onLogout?: () => void | Promise<void>;
  initialMode?: AuthMode | null;
  authNext?: string | null;
  onSuccess?: () => void;
  onAuthClose?: () => void;
}

const demoCards = [
  { title: 'Launch Map', meta: '18 notes', color: '#F59E0B', className: 'demo-card-a' },
  { title: 'Roadmap', meta: '6 owners', color: '#3B82F6', className: 'demo-card-b' },
  { title: 'Open Issues', meta: '12 votes', color: '#10B981', className: 'demo-card-c' },
];

export default function Dashboard({
  user,
  onLogout,
  initialMode = null,
  authNext,
  onSuccess,
  onAuthClose,
}: DashboardProps) {
  const [authMode, setAuthMode] = useState<AuthMode | null>(initialMode);

  useEffect(() => {
    setAuthMode(initialMode);
  }, [initialMode]);

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
  };

  const closeAuth = () => {
    setAuthMode(null);
    onAuthClose?.();
  };

  return (
    <main className="home-shell min-h-screen overflow-auto" style={{ color: 'var(--text-primary)' }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" className="flex min-h-11 items-center gap-3 rounded-2xl pr-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
            <img src="/icons/openjam.png" alt="" className="h-10 w-10 rounded-xl shadow-sm" />
            <div>
              <h1 className="text-xl font-semibold leading-tight">OpenJam</h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Collaborative whiteboards</p>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                <Link
                  to="/workplace"
                  className="flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Workplace
                </Link>
                <button
                  type="button"
                  onClick={onLogout}
                  className="min-h-11 rounded-xl px-4 text-sm font-medium transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => openAuth('login')}
                className="min-h-11 rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ background: 'var(--accent-gradient)' }}
              >
                Login
              </button>
            )}
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[0.88fr_1.12fr]">
          <div className="max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--accent)' }}>
              Workspace
            </p>
            <h2 className="max-w-xl text-4xl font-semibold leading-tight sm:text-5xl">
              Pick up the room where the work is already moving.
            </h2>
            <p className="mt-5 max-w-xl text-lg" style={{ color: 'var(--text-secondary)' }}>
              A collaborative canvas for mapping ideas, shaping decisions, and returning to the exact boards your team left in motion.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {user ? (
                <Link
                  to="/workplace"
                  className="flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  style={{ background: 'var(--accent-gradient)' }}
                >
                  Open Workplace
                </Link>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => openAuth('login')}
                    className="min-h-11 rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    style={{ background: 'var(--accent-gradient)' }}
                  >
                    Enter Workplace
                  </button>
                  <button
                    type="button"
                    onClick={() => openAuth('register')}
                    className="min-h-11 rounded-xl px-5 text-sm font-semibold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Create account
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="home-demo glass-elevated relative min-h-[520px] overflow-hidden rounded-3xl p-5">
            <div className="demo-grid absolute inset-0" aria-hidden="true" />
            <div className="relative z-10 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Product Sprint</p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Live canvas demo</p>
              </div>
              <div className="flex -space-x-2" aria-label="Demo collaborators">
                {['AM', 'JT', 'SK'].map((initials, index) => (
                  <span
                    key={initials}
                    className="grid h-9 w-9 place-items-center rounded-full border-2 border-white text-xs font-semibold text-white shadow-sm"
                    style={{ background: ['#F97316', '#3B82F6', '#10B981'][index] }}
                  >
                    {initials}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative z-10 mt-8 h-[390px] rounded-2xl border border-black/5 bg-white/70 p-5 shadow-inner">
              <div className="demo-connector demo-connector-one" />
              <div className="demo-connector demo-connector-two" />
              {demoCards.map((card) => (
                <article
                  key={card.title}
                  className={`demo-note absolute rounded-2xl border border-black/5 bg-white p-4 shadow-lg ${card.className}`}
                >
                  <div className="mb-4 h-2 w-12 rounded-full" style={{ background: card.color }} />
                  <h3 className="text-sm font-semibold">{card.title}</h3>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{card.meta}</p>
                </article>
              ))}
              <div className="demo-frame absolute rounded-2xl border-2 border-dashed border-amber-300/80" />
              <div className="demo-cursor demo-cursor-orange">
                <span>Riley</span>
              </div>
              <div className="demo-cursor demo-cursor-blue">
                <span>Mina</span>
              </div>
              <div className="demo-pulse-ring" />
            </div>
          </div>
        </section>
      </div>

      {authMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-8 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={authMode === 'login' ? 'Login to OpenJam' : 'Create an OpenJam account'}
            className="glass-elevated relative w-full max-w-md rounded-3xl p-6"
          >
            <button
              type="button"
              onClick={closeAuth}
              aria-label="Close login dialog"
              className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-xl text-xl font-medium transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              x
            </button>
            <AuthPage
              variant="modal"
              initialMode={authMode}
              onSuccess={() => {
                setAuthMode(null);
                onSuccess?.();
              }}
            />
            {authNext && (
              <p className="mt-4 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                You will continue after signing in.
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
