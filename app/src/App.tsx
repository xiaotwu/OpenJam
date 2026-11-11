import { lazy, Suspense, useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth, AuthProvider } from './components/AuthContext';
import Dashboard from './components/Dashboard';
import BoardCredentialGate from './components/BoardCredentialGate';
import ErrorBoundary from './components/ErrorBoundary';
import WorkspaceDashboard from './components/WorkspaceDashboard';
import TeamInvitationGate from './components/TeamInvitationGate';
import type { User } from './lib/api';
import { useI18n } from './i18n';
import { boardCredentialFragment, readBoardCredential } from './lib/boardSharing';
import './App.css';

const OpenJamCanvas = lazy(() => import('./components/OpenJamCanvas'));

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--surface-canvas)]" role="status">
      <div className="flex flex-col items-center gap-4">
        <div className="h-9 w-9 rounded-full border-4 border-[var(--accent)] border-t-transparent motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium text-[var(--text-primary)]">{message}</p>
      </div>
    </div>
  );
}

function generateColor(): string {
  const colors = [
    '#F87171', '#FB923C', '#FBBF24', '#A3E635', '#34D399',
    '#22D3EE', '#60A5FA', '#A78BFA', '#F472B6', '#FB7185',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function AppContent() {
  const { user, isLoading, logout } = useAuth();
  const { messages: { workbench: { app: text } } } = useI18n();
  // Stabilize color so it doesn't change on every render
  const userColor = useMemo(() => generateColor(), []);

  if (isLoading) {
    return <LoadingScreen message={text.loading} />;
  }

  const handleLogout = async () => {
    await logout();
  };

  return (
    <Routes>
      <Route path="/" element={<HomeRoute user={user} onLogout={handleLogout} />} />
      <Route path="/auth" element={<AuthRoute user={user} />} />
      <Route path="/login" element={<Navigate to="/auth?mode=login" replace />} />
      <Route path="/register" element={<Navigate to="/auth?mode=register" replace />} />
      <Route path="/workplace" element={<WorkplaceRoute user={user} onLogout={handleLogout} />} />
      <Route path="/teams/:teamId/invite" element={<TeamInvitationRoute user={user} />} />
      <Route
        path="/board/:boardId"
        element={<BoardRoute user={user} fallbackColor={userColor} />}
      />
      <Route path="/room/:boardId" element={<LegacyRoomRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function HomeRoute({ user, onLogout }: { user: User | null; onLogout: () => Promise<void> }) {
  const location = useLocation();
  const navigate = useNavigate();
  const roomId = new URLSearchParams(location.search).get('room');

  if (roomId) {
    return <Navigate to={`/board/${encodeURIComponent(roomId)}`} replace />;
  }

  return (
    <Dashboard
      user={user}
      onLogout={onLogout}
      onSuccess={() => {
        navigate('/workplace', { replace: true });
      }}
    />
  );
}

function AuthRoute({ user }: { user: User | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const mode = searchParams.get('mode') === 'register' ? 'register' : 'login';
  const next = getSafeNextPath(searchParams.get('next'));
  const credential = readBoardCredential(location.hash);
  const acceptsCredential = next && (/^\/board\/[^/?#]+(?:\?[^#]*)?$/.test(next)
    || (credential?.kind === 'invite' && /^\/teams\/[^/?#]+\/invite$/.test(next)));
  const destination = next && credential && acceptsCredential
    ? `${next}${boardCredentialFragment(credential)}` : next || '/workplace';

  if (user) {
    return <Navigate to={destination} replace />;
  }

  return (
    <Dashboard
      user={null}
      initialMode={mode}
      onSuccess={() => {
        navigate(destination, { replace: true });
      }}
      onAuthClose={() => {
        navigate('/', { replace: true });
      }}
    />
  );
}

function WorkplaceRoute({ user, onLogout }: { user: User | null; onLogout: () => Promise<void> }) {
  const location = useLocation();

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth?mode=login&next=${next}`} replace />;
  }

  return <WorkspaceDashboard user={user} onLogout={onLogout} />;
}

function TeamInvitationRoute({ user }: { user: User | null }) {
  const { teamId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const credential = readBoardCredential(location.hash);
  const token = credential?.kind === 'invite' ? credential.token : '';

  if (!user) {
    const next = encodeURIComponent(location.pathname);
    const fragment = token ? boardCredentialFragment({ kind: 'invite', token }) : '';
    return <Navigate to={`/auth?mode=login&next=${next}${fragment}`} replace />;
  }

  return <TeamInvitationGate key={`${teamId}:${user.id}:${location.hash}`} teamId={teamId} token={token}
    email={user.email} onAccepted={() => navigate(`/workplace?section=teams&organization=${encodeURIComponent(teamId)}`, { replace: true })} />;
}

function LegacyRoomRoute() {
  const { boardId } = useParams();
  const location = useLocation();
  return <Navigate to={`/board/${encodeURIComponent(boardId || 'default')}${location.search}${location.hash}`} replace />;
}

function BoardRoute({ user, fallbackColor }: { user: User | null; fallbackColor: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { boardId } = useParams();
  const credential = readBoardCredential(location.hash);
  const { messages: { workbench: { app: text } } } = useI18n();

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    const fragment = credential ? boardCredentialFragment(credential) : '';
    return <Navigate to={`/auth?mode=login&next=${next}${fragment}`} replace />;
  }

  if (credential) {
    return <BoardCredentialGate key={`${boardId}:${user.id}:${location.hash}`} boardId={boardId || 'default'}
      credential={credential} email={user.email} onRedeemed={() => navigate(`${location.pathname}${location.search}`, { replace: true })} />;
  }

  return (
    <Suspense fallback={<LoadingScreen message={text.opening} />}>
      <OpenJamCanvas
        key={boardId}
        boardId={boardId || 'default'}
        userId={user.id}
        username={user.displayName}
        email={user.email}
        color={user.avatarColor || fallbackColor}
      />
    </Suspense>
  );
}

function getSafeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return null;
  }
  const destination = new URL(next, window.location.origin);
  return destination.origin === window.location.origin ? `${destination.pathname}${destination.search}` : null;
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
