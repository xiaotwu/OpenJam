import { useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAuth, AuthProvider } from './components/AuthContext';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';
import ErrorBoundary from './components/ErrorBoundary';
import OpenJamCanvas from './components/OpenJamCanvas';
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

  if (!user) {
    return <AuthPage />;
  }

  const handleLogout = async () => {
    await logout();
  };

  return (
    <Routes>
      <Route path="/" element={<HomeRoute user={user} onLogout={handleLogout} />} />
      <Route
        path="/board/:boardId"
        element={<BoardRoute userId={user.id} username={user.displayName} color={user.avatarColor || userColor} />}
      />
      <Route path="/room/:boardId" element={<LegacyRoomRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function HomeRoute({ user, onLogout }: { user: NonNullable<ReturnType<typeof useAuth>['user']>; onLogout: () => Promise<void> }) {
  const location = useLocation();
  const roomId = new URLSearchParams(location.search).get('room');

  if (roomId) {
    return <Navigate to={`/board/${encodeURIComponent(roomId)}`} replace />;
  }

  return <Dashboard user={user} onLogout={onLogout} />;
}

function LegacyRoomRoute() {
  const { boardId } = useParams();
  return <Navigate to={`/board/${encodeURIComponent(boardId || 'default')}`} replace />;
}

function BoardRoute({ userId, username, color }: { userId: string; username: string; color: string }) {
  const { boardId } = useParams();

  return (
    <OpenJamCanvas
      boardId={boardId || 'default'}
      userId={userId}
      username={username}
      color={color}
    />
  );
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
