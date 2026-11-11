import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { redeemBoardCredential, type BoardCredential } from '../lib/boardSharing';
import { useAuth } from './AuthContext';

interface BoardCredentialGateProps {
  boardId: string;
  credential: BoardCredential;
  email: string;
  onRedeemed: () => void;
}

export default function BoardCredentialGate({ boardId, credential, email, onRedeemed }: BoardCredentialGateProps) {
  const { logout } = useAuth();
  const action = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isInvite = credential.kind === 'invite';

  useEffect(() => () => action.current?.abort(), []);

  async function redeem() {
    if (action.current || !credential.token) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setError('');
    try {
      await redeemBoardCredential(boardId, credential, controller.signal);
      if (!controller.signal.aborted) onRedeemed();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not open this board.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      action.current = undefined;
    }
  }

  async function switchAccount() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await logout();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not switch accounts.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4" style={{ background: 'var(--surface-canvas)', color: 'var(--text-primary)' }}>
      <section className="w-full max-w-md rounded-2xl border px-5 py-6 shadow-xl sm:px-7" style={{ background: 'var(--surface-panel)', borderColor: 'var(--glass-border-strong)' }}>
        <h1 className="text-xl font-semibold">{isInvite ? 'Board invitation' : 'Shared board'}</h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {credential.token ? isInvite
            ? 'Accept the invitation with the email address the owner invited.'
            : 'Open this board with the access granted by its sharing link.'
            : 'This link is incomplete or invalid. Ask the board owner for a new link.'}
        </p>
        <p className="mt-4 break-all text-sm">Signed in as <strong>{email}</strong></p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          {credential.token && <button type="button" disabled={busy} onClick={() => void redeem()}
            className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-45">
            {busy ? 'Working…' : isInvite ? 'Accept invitation' : 'Open shared board'}</button>}
          <button type="button" disabled={busy} onClick={() => void switchAccount()} className="min-h-11 rounded-xl border px-4 text-sm font-medium hover:bg-black/5 disabled:opacity-45"
            style={{ borderColor: 'var(--glass-border-strong)' }}>Switch account</button>
        </div>
        <Link to="/workplace" className="mt-4 inline-flex min-h-9 items-center text-sm font-medium text-blue-500 hover:underline">Back to Workshop</Link>
      </section>
    </main>
  );
}
