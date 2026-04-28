import { useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth, AuthProvider } from './components/AuthContext';
import Dashboard from './components/Dashboard';
import ErrorBoundary from './components/ErrorBoundary';
import OpenJamCanvas from './components/OpenJamCanvas';
import WorkspaceDashboard from './components/WorkspaceDashboard';
import type { User } from './lib/api';
import './App.css';

function generateColor(): string {
  const colors = [
    '#F87171', '#FB923C', '#FBBF24', '#A3E635', '#34D399',
    '#22D3EE', '#60A5FA', '#A78BFA', '#F472B6', '#FB7185',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function AppContent() {
  const { user, isLoading, logout } = useAuth();
  // Stabilize color so it doesn't change on every render
  const userColor = useMemo(() => generateColor(), []);

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-amber-100 via-yellow-100 to-orange-100">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-amber-300/50 border-t-amber-500 animate-spin" />
          <p className="text-amber-700/80 text-lg font-medium">Loading...</p>
        </div>
      </div>
    );
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

  if (user) {
    return <Navigate to={next || '/workplace'} replace />;
  }

  return (
    <Dashboard
      user={null}
      initialMode={mode}
      authNext={next}
      onSuccess={() => {
        navigate(next || '/workplace', { replace: true });
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

function LegacyRoomRoute() {
  const { boardId } = useParams();
  return <Navigate to={`/board/${encodeURIComponent(boardId || 'default')}`} replace />;
}

function BoardRoute({ user, fallbackColor }: { user: User | null; fallbackColor: string }) {
  const location = useLocation();
  const { boardId } = useParams();

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth?mode=login&next=${next}`} replace />;
  }

  return (
    <OpenJamCanvas
      boardId={boardId || 'default'}
      userId={user.id}
      username={user.displayName}
      color={user.avatarColor || fallbackColor}
    />
  );
}

function getSafeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return null;
  }

  return next;
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
