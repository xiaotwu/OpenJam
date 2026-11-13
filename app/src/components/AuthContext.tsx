import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../lib/api';
import { ApiError, SESSION_TOKEN_STORAGE_KEY, getMe, login as apiLogin, register as apiRegister, logout as apiLogout, updateProfile, getToken, clearToken } from '../lib/api';
import { countAccountPending, discardAccountPending } from '../lib/boardSyncQueue';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isLoading: boolean; // Alias for loading
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<boolean>;
  saveProfile: (displayName: string, avatarColor: string) => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    const checkAuth = async () => {
      const token = getToken();
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const { user } = await getMe();
        if (!disposed && getToken() === token) setUser(user);
      } catch (error) {
        if (!disposed && getToken() === token && error instanceof ApiError && error.status === 401) clearToken();
      } finally {
        if (!disposed && (getToken() === token || !getToken())) setLoading(false);
      }
    };
    const onTokenChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== SESSION_TOKEN_STORAGE_KEY && event.key !== null)) return;
      setUser(null);
      setLoading(!!getToken());
      void checkAuth();
    };

    void checkAuth();
    window.addEventListener('storage', onTokenChange);
    return () => {
      disposed = true;
      window.removeEventListener('storage', onTokenChange);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await apiLogin(email, password);
    setUser(user);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const { user } = await apiRegister(email, password, displayName);
    setUser(user);
  }, []);

  const saveProfile = useCallback(async (displayName: string, avatarColor: string) => {
    const token = getToken();
    const { user: updated } = await updateProfile(displayName, avatarColor);
    if (getToken() === token) setUser(current => current?.id === updated.id ? updated : current);
  }, []);

  const logout = useCallback(async () => {
    if (!user) return false;
    const token = getToken();
    const pending = await countAccountPending(user.id).catch(() => undefined);
    if (pending === undefined && !window.confirm('Shiori could not check for pending edits. Sign out and keep any drafts on this device?')) return false;
    if (pending && !window.confirm(`Discard ${pending} unsynced ${pending === 1 ? 'edit' : 'edits'} on this device and sign out? Cancel to return and sync your edits first.`)) return false;
    if (getToken() !== token) return false;

    await apiLogout();
    if (!getToken()) setUser(null);
    if (pending) await discardAccountPending(user.id);
    return true;
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isLoading: loading,
        login,
        register,
        logout,
        saveProfile,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export { AuthProvider, useAuth };
