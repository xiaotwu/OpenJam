import { useAuth, AuthProvider } from './components/AuthContext';
import AuthPage from './components/AuthPage';
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
  const { user, isLoading } = useAuth();

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

  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room') || window.location.pathname.split('/room/')[1] || 'default';

  return (
    <OpenJamCanvas
      boardId={roomId}
      userId={user.id}
      username={user.displayName}
      color={generateColor()}
    />
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
