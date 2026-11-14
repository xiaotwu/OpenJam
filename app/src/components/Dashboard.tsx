import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import boardsPreview from '../assets/home/boards.webp';
import docsPreview from '../assets/home/docs.webp';
import present from '../assets/home/present.webp';
import projectPreview from '../assets/home/project.webp';
import review from '../assets/home/review.webp';
import sheetsPreview from '../assets/home/sheets.webp';
import sketch from '../assets/home/sketch.webp';
import slidesPreview from '../assets/home/slides.webp';
import welcome from '../assets/home/welcome.webp';
import { useI18n } from '../i18n';
import type { User } from '../lib/api';
import { useTheme } from '../lib/useTheme';
import AuthPage from './AuthPage';
import ShioriMark from './ShioriMark';
import AccountPopover from './workshop/AccountPopover';
import WorkshopIcon from './workshop/WorkshopIcon';
import './home.css';

type AuthMode = 'login' | 'register';

interface DashboardProps {
  user: User | null;
  onLogout?: () => void | Promise<void>;
  initialMode?: AuthMode | null;
  onSuccess?: () => void;
  onAuthClose?: () => void;
}

const features = [
  { id: 'boards', mascot: sketch, preview: boardsPreview },
  { id: 'docs', mascot: review, preview: docsPreview },
  { id: 'sheets', mascot: review, preview: sheetsPreview },
  { id: 'slides', mascot: present, preview: slidesPreview },
] as const;

function HomeFeatures() {
  const { messages: { workshop: { home: text } } } = useI18n();
  const [selected, setSelected] = useState<number>(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % features.length; break;
      case 'ArrowLeft': next = (index + features.length - 1) % features.length; break;
      case 'Home': next = 0; break;
      case 'End': next = features.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }

  return (
    <section id="features" className="home-features" aria-labelledby="home-features-title">
      <h2 id="home-features-title">{text.featuresTitle}</h2>
      <div className="home-feature-tabs" role="tablist" aria-labelledby="home-features-title">
        {features.map(({ id }, index) => (
          <button
            key={id}
            ref={button => { tabs.current[index] = button; }}
            id={`home-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={index === selected}
            aria-controls={`home-panel-${id}`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={event => moveTab(event, index)}
          >
            {text.features[id].name}
          </button>
        ))}
      </div>
      {features.map(({ id, mascot, preview }, index) => (
        <article
          key={id}
          id={`home-panel-${id}`}
          className="home-feature-panel"
          role="tabpanel"
          aria-labelledby={`home-tab-${id}`}
          tabIndex={0}
          hidden={index !== selected}
        >
          <div className="home-feature-copy">
            <div>
              <h3>{text.features[id].title}</h3>
              <p>{text.features[id].description}</p>
            </div>
            <img className="home-feature-mascot" src={mascot} alt="" width={300} height={375} loading="lazy" />
          </div>
          <figure className="home-product">
            <img src={preview} alt={text.features[id].previewAlt} width={1280} height={720} loading="lazy" />
          </figure>
        </article>
      ))}
    </section>
  );
}

function AuthDialog({ mode, onClose, onSuccess }: { mode: AuthMode; onClose: () => void; onSuccess: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { messages: { workshop: { auth: text } } } = useI18n();

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
        <WorkshopIcon name="close" />
      </button>
      <AuthPage variant="modal" initialMode={mode} onSuccess={onSuccess} />
    </dialog>
  );
}

export default function Dashboard({
  user, onLogout, initialMode = null, onSuccess, onAuthClose,
}: DashboardProps) {
  const [authMode, setAuthMode] = useState<AuthMode | null>(initialMode);
  const { theme, setTheme, isDark } = useTheme();
  const { messages: { workshop: { home: text } } } = useI18n();
  const home = useRef<HTMLDivElement>(null);

  useEffect(() => { setAuthMode(initialMode); }, [initialMode]);
  useEffect(() => {
    if (window.location.hash === '#features') document.getElementById('features')?.scrollIntoView();
  }, []);

  return (
    <div className="shiori-home" ref={home}>
      <header className="home-header home-shell">
        <Link to="/" className="home-brand" aria-label={text.brandHome}
          onClick={() => home.current?.scrollTo({ top: 0 })}>
          <ShioriMark size={34} />
          <span>Shiori</span>
        </Link>
        <nav className="home-nav" aria-label={text.navigation}>
          <a href="#features">{text.featuresLink}</a>
          <button className="home-theme-toggle" type="button" aria-label={isDark ? text.lightMode : text.darkMode}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}>
            <WorkshopIcon name={isDark ? 'sun' : 'moon'} />
            <span>{isDark ? text.lightMode : text.darkMode}</span>
          </button>
          {user && <AccountPopover user={user} onLogout={onLogout} theme={theme} setTheme={setTheme} />}
        </nav>
      </header>

      <main className="home-shell">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-copy">
            <div className="home-heading">
              <div className="home-mascot" aria-hidden="true">
                <img src={welcome} alt="" width={300} height={375} />
              </div>
              <h1 id="home-title"><span>{text.title}</span>{' '}<span>{text.titleContinuation}</span></h1>
            </div>
            <p>{text.description}</p>
            <div className="home-actions">
              <a className="home-primary" href="#features">{text.explore}</a>
              {user ? (
                <Link to="/workplace" className="home-entry">{text.openWorkplace}</Link>
              ) : (
                <button type="button" className="home-entry" onClick={() => setAuthMode('login')}>{text.signIn}</button>
              )}
            </div>
          </div>
          <figure className="home-product">
            <img src={projectPreview} alt={text.previewAlt} width={1280} height={720} fetchPriority="high" />
          </figure>
        </section>
        <HomeFeatures />
      </main>

      {authMode && (
        <AuthDialog
          mode={authMode}
          onClose={() => { setAuthMode(null); onAuthClose?.(); }}
          onSuccess={() => { setAuthMode(null); onSuccess?.(); }}
        />
      )}
    </div>
  );
}
