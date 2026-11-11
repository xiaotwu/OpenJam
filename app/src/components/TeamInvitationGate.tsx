import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { acceptTeamInvitation } from '../lib/directory';
import { useAuth } from './AuthContext';

interface TeamInvitationGateProps {
  teamId: string;
  token: string;
  email: string;
  onAccepted: () => void;
}

export default function TeamInvitationGate({ teamId, token, email, onAccepted }: TeamInvitationGateProps) {
  const { logout } = useAuth();
  const { messages: { workbench: { teams: text } } } = useI18n();
  const request = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => request.current?.abort(), []);

  async function accept() {
    if (!token || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      await acceptTeamInvitation(teamId, token, controller.signal);
      if (!controller.signal.aborted) onAccepted();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : text.actionError);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      request.current = undefined;
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4" style={{ background: 'var(--surface-canvas)', color: 'var(--text-primary)' }}>
      <section className="wb-team-panel w-full max-w-md">
        <h1 className="text-xl font-semibold">{text.invitation}</h1>
        <p>{token ? text.invitationDescription : text.invalidInvitation}</p>
        <p className="break-all">{text.signedInAs} <strong>{email}</strong></p>
        {error && <p className="wb-error-text" role="alert">{error}</p>}
        <div className="wb-team-actions">
          {token && <button type="button" className="wb-button wb-button-primary" disabled={busy} onClick={() => void accept()}>
            {busy ? text.working : text.accept}
          </button>}
          <button type="button" className="wb-button wb-button-secondary" disabled={busy} onClick={() => {
            void logout().catch(failure => setError(failure instanceof Error ? failure.message : text.actionError));
          }}>{text.switchAccount}</button>
        </div>
        <Link to="/workplace" className="wb-team-link">{text.back}</Link>
      </section>
    </main>
  );
}
