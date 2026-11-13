import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useI18n } from '../i18n';
import ShioriMark from './ShioriMark';

interface AuthPageProps {
  onSuccess?: () => void;
  initialMode?: 'login' | 'register';
  variant?: 'page' | 'modal';
}

export default function AuthPage({ onSuccess, initialMode = 'login', variant = 'page' }: AuthPageProps) {
  const { login, register } = useAuth();
  const { messages: { workbench: { auth: text } } } = useI18n();
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const id = useId();

  useEffect(() => {
    setMode(initialMode);
    setError(null);
  }, [initialMode]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName);
      onSuccess?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.error);
    } finally {
      setLoading(false);
    }
  };

  const form = (
    <div className="shell-auth-form">
      <div className="shell-auth-brand">
        {variant === 'page' ? (
          <Link to="/" aria-label={text.home}><ShioriMark size={34} /></Link>
        ) : <ShioriMark size={34} />}
        <strong>Shiori</strong>
      </div>
      <div className="shell-auth-modes" role="group" aria-label={mode === 'login' ? text.signIn : text.createAccount}>
        <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>{text.signIn}</button>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>{text.createAccount}</button>
      </div>

      {error && <p role="alert" className="shell-account-error">{error}</p>}
      <form onSubmit={handleSubmit}>
        {mode === 'register' && (
          <label htmlFor={`${id}-name`}>
            {text.displayName}
            <input
              id={`${id}-name`}
              type="text"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              autoComplete="name"
              placeholder={text.displayNamePlaceholder}
              required
            />
          </label>
        )}
        <label htmlFor={`${id}-email`}>
          {text.email}
          <input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </label>
        <label htmlFor={`${id}-password`}>
          {text.password}
          <input
            id={`${id}-password`}
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            minLength={6}
            required
          />
        </label>
        <button type="submit" disabled={loading} className="shell-pill shell-pill-primary">
          {loading ? text.processing : mode === 'login' ? text.signIn : text.createAccount}
        </button>
      </form>
    </div>
  );

  return variant === 'modal' ? form : <div className="shell-auth-page"><div className="shell-popover">{form}</div></div>;
}
