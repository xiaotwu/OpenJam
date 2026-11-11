import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '../lib/api';
import { useTheme } from '../lib/useTheme';
import { useI18n } from '../i18n';
import AuthPage from './AuthPage';
import AccountPopover from './workbench/AccountPopover';
import WorkbenchIcon from './workbench/WorkbenchIcon';

type AuthMode = 'login' | 'register';

interface DashboardProps {
  user: User | null;
  onLogout?: () => void | Promise<void>;
  initialMode?: AuthMode | null;
  onSuccess?: () => void;
  onAuthClose?: () => void;
}

function AuthDialog({ mode, onClose, onSuccess }: { mode: AuthMode; onClose: () => void; onSuccess: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { messages: { workbench: { auth: text } } } = useI18n();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement;
    element.showModal();
    element.querySelector('input')?.focus();
    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      className="shell-popover home-auth-dialog"
      ref={dialog}
      aria-label={text.title}
      onCancel={event => { event.preventDefault(); onClose(); }}
    >
      <button type="button" className="shell-icon-button home-auth-close" onClick={onClose} aria-label={text.close}>
        <WorkbenchIcon name="close" />
      </button>
      <AuthPage variant="modal" initialMode={mode} onSuccess={onSuccess} />
    </dialog>
  );
}

export default function Dashboard({
  user, onLogout, initialMode = null, onSuccess, onAuthClose,
}: DashboardProps) {
  const [authMode, setAuthMode] = useState<AuthMode | null>(initialMode);
  const { theme, setTheme } = useTheme();
  const { messages: { workbench: { home: text } } } = useI18n();

  useEffect(() => { setAuthMode(initialMode); }, [initialMode]);

  return (
    <main className="openjam-home">
      <div className="home-frame">
        <header className="home-header">
          <Link to="/" className="home-brand">
            <img src="/icons/openjam.png" alt="" width="28" height="28" />
            <span>OpenJam</span>
          </Link>
          <AccountPopover user={user ?? undefined} onLogout={onLogout} theme={theme} setTheme={setTheme} />
        </header>
        <section className="home-content">
          <div className="home-copy">
            <h1>{text.title}</h1>
            <p>{text.description}</p>
            <div className="home-actions">
              {user ? (
                <Link to="/workplace" className="shell-pill shell-pill-primary">
                  {text.openWorkplace} <WorkbenchIcon name="arrow" />
                </Link>
              ) : (
                <>
                  <button type="button" className="shell-pill shell-pill-primary" onClick={() => setAuthMode('login')}>
                    {text.signIn} <WorkbenchIcon name="arrow" />
                  </button>
                  <button type="button" className="shell-pill" onClick={() => setAuthMode('register')}>
                    {text.createAccount}
                  </button>
                </>
              )}
            </div>
          </div>

          <figure className="home-preview" aria-label={text.demoTitle}>
            <figcaption className="home-preview-top">
              <span className="shell-island home-preview-title"><WorkbenchIcon name="board" /> {text.demoTitle}</span>
              <span className="shell-island home-preview-people" aria-hidden="true">
                <span>AM</span><span>JT</span><span>SK</span>
              </span>
            </figcaption>
            <div className="home-preview-notes">
              {text.demoNotes.map(note => (
                <div className="home-preview-note" key={note.title}>
                  <strong>{note.title}</strong>
                  <p>{note.body}</p>
                </div>
              ))}
            </div>
          </figure>
        </section>
      </div>

      {authMode && (
        <AuthDialog
          mode={authMode}
          onClose={() => { setAuthMode(null); onAuthClose?.(); }}
          onSuccess={() => { setAuthMode(null); onSuccess?.(); }}
        />
      )}
    </main>
  );
}
