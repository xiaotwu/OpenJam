import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { MemberPermission } from '../lib/api';
import {
  boardCredentialURL, closeLegacyBoardLink, getBoardSharing, getEffectiveBoardAccess, issueBoardInvitation,
  issueBoardShareLink, removeBoardMember, revokeBoardInvitation, revokeBoardShareLink, updateBoardMemberRole,
  type BoardSharing, type EffectiveBoardAccess, type ShareLinkPermission,
} from '../lib/boardSharing';

interface BoardSharingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  boardName: string;
}

const permissionLabels: Record<EffectiveBoardAccess['permission'], string> = {
  owner: 'Owner', edit: 'Can edit', comment: 'Can comment', view: 'Can view',
};
const sources: Record<EffectiveBoardAccess['source'], string> = {
  owner: 'Board ownership', member: 'Direct access', project: 'Project access', link: 'Redeemed sharing link', 'legacy-link': 'Legacy board link',
};
const field = 'min-h-10 min-w-0 rounded-lg border border-[var(--glass-border-strong)] bg-[var(--surface-panel)] px-2.5 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-45';
const secondary = 'min-h-10 rounded-lg border border-[var(--glass-border-strong)] px-3 text-sm font-semibold hover:bg-[var(--glass-bg-subtle)] focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-45';
const primary = 'min-h-10 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-45';
const line = 'rounded-xl border border-[var(--glass-border-strong)]';
const muted = 'text-sm text-[var(--text-secondary)]';

function PermissionOptions({ allowEdit }: { allowEdit: boolean }) {
  return <>
    <option value="view">{permissionLabels.view}</option>
    <option value="comment">{permissionLabels.comment}</option>
    {allowEdit && <option value="edit">{permissionLabels.edit}</option>}
  </>;
}

function ExpirationOptions() {
  return <><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option></>;
}

function expiry(date: string) {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not update board sharing.';
}

function BoardSharingPanel({ onClose, boardId, boardName }: Omit<BoardSharingDialogProps, 'isOpen'>) {
  const heading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const copyField = useRef<HTMLInputElement>(null);
  const lifecycle = useRef<AbortController | undefined>(undefined);
  const acting = useRef(false);
  const [access, setAccess] = useState<EffectiveBoardAccess>();
  const [sharing, setSharing] = useState<BoardSharing>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [email, setEmail] = useState('');
  const [invitePermission, setInvitePermission] = useState<MemberPermission>('view');
  const [inviteDays, setInviteDays] = useState(7);
  const [linkPermission, setLinkPermission] = useState<ShareLinkPermission>('view');
  const [linkDays, setLinkDays] = useState(7);
  const [issued, setIssued] = useState<{ id: string; label: string; url: string }>();
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    const { signal } = controller;
    async function read() {
      try {
        const result = await getEffectiveBoardAccess(boardId, signal);
        if (signal.aborted) return;
        setAccess(result);
        const settings = result.capabilities.canManage ? await getBoardSharing(boardId, signal) : undefined;
        if (!signal.aborted) setSharing(settings);
      } catch (failure) {
        if (!signal.aborted) setError(failureMessage(failure));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    void read();
    return () => controller.abort();
  }, [boardId, reload]);

  async function mutate(work: (signal: AbortSignal) => Promise<void>) {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted || acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    try {
      await work(signal);
      if (!signal.aborted) setSharing(await getBoardSharing(boardId, signal));
    } catch (failure) {
      if (!signal.aborted) setError(failureMessage(failure));
    } finally {
      acting.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  function showLink(id: string, label: string, kind: 'invite' | 'share', token: string) {
    setCopied('');
    setIssued({ id, label, url: boardCredentialURL(boardId, { kind, token }) });
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    void mutate(async signal => {
      const { invitation, token } = await issueBoardInvitation(boardId, email.trim(), invitePermission, inviteDays, signal);
      if (signal.aborted) return;
      showLink(invitation.id, `Invitation link for ${invitation.email}`, 'invite', token);
      setEmail('');
    });
  }

  function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(async signal => {
      const { link, token } = await issueBoardShareLink(boardId, linkPermission, linkDays, signal);
      if (!signal.aborted) showLink(link.id, 'New sharing link', 'share', token);
    });
  }

  function revoke(id: string, kind: 'invite' | 'share') {
    const action = kind === 'invite' ? revokeBoardInvitation : revokeBoardShareLink;
    void mutate(async signal => {
      await action(boardId, id, signal);
      if (!signal.aborted) setIssued(current => current?.id === id ? undefined : current);
    });
  }

  async function copyLink() {
    if (!issued) return;
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(issued.url);
      setCopied('Link copied.');
    } catch {
      copyField.current?.focus();
      copyField.current?.select();
      setCopied('Link selected. Use your browser’s copy shortcut.');
    }
  }

  const invitations = sharing?.invitations ?? [];
  const links = sharing?.links ?? [];
  return (
    <dialog ref={dialog} aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      className="board-chrome-popover m-auto max-h-[86dvh] w-[min(94vw,42rem)] overflow-auto rounded-2xl border border-[var(--glass-border-strong)] text-[var(--text-primary)] shadow-2xl backdrop:bg-black/45">
      <section className="p-4 sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={heading} className="truncate text-xl font-semibold">Share {boardName || 'board'}</h2>
            {access && <p className={`${muted} mt-1`}>{permissionLabels[access.permission]} · {sources[access.source]}</p>}
          </div>
          <button type="button" onClick={onClose} className={secondary}>Close</button>
        </header>
        {loading && <p role="status" className={`${muted} mt-4`}>Loading sharing…</p>}
        {error && <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
          {!loading && !busy && <button type="button" onClick={() => { setError(''); setLoading(true); setReload(count => count + 1); }}
            className="font-semibold underline">Refresh sharing</button>}
        </div>}

        {access?.capabilities.canManage && sharing && (
          <div className="mt-5 space-y-5" aria-busy={busy}>
            <section aria-label="Invite people" className={`${line} p-3.5`}>
              <h3 className="font-semibold">Invite by email</h3>
              <form onSubmit={invite} className="mt-3 flex flex-wrap items-end gap-2">
                <label className={`${muted} flex min-w-44 flex-1 flex-col gap-1`}>
                  Email address
                  <input required type="email" maxLength={254} className={field} placeholder="teammate@example.com" value={email}
                    disabled={busy} onChange={event => setEmail(event.target.value)} />
                </label>
                <label className={`${muted} flex flex-col gap-1`}>
                  Invite role
                  <select className={field} value={invitePermission} disabled={busy} onChange={event => setInvitePermission(event.target.value as MemberPermission)}>
                    <PermissionOptions allowEdit />
                  </select>
                </label>
                <label className={`${muted} flex flex-col gap-1`}>
                  Invite expiry
                  <select className={field} value={inviteDays} disabled={busy} onChange={event => setInviteDays(Number(event.target.value))}>
                    <ExpirationOptions />
                  </select>
                </label>
                <button type="submit" disabled={busy || !email.trim()} className={primary}>Create invitation</button>
              </form>
              {invitations.length > 0 && <ul className="mt-3 divide-y divide-[var(--glass-border-strong)]">
                {invitations.map(item => {
                  const status = item.revokedAt ? 'Revoked' : item.acceptedAt ? 'Accepted' : new Date(item.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Pending';
                  return <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium">{item.email}</p>
                      <p className={muted}>{permissionLabels[item.permission]} · {status}{status === 'Pending' ? ` · expires ${expiry(item.expiresAt)}` : ''}</p>
                    </div>
                    {status === 'Pending' && <button type="button" aria-label={`Revoke invitation for ${item.email}`} disabled={busy} className={secondary}
                      onClick={() => revoke(item.id, 'invite')}>Revoke</button>}
                  </li>;
                })}
              </ul>}
            </section>

            <section aria-label="Sharing links" className={`${line} p-3.5`}>
              <h3 className="font-semibold">Sharing links</h3>
              <p className={`${muted} mt-1`}>Signed-in people can redeem a link until it expires or you revoke it.</p>
              <form onSubmit={createLink} className="mt-3 flex flex-wrap items-end gap-2">
                <label className={`${muted} flex flex-col gap-1`}>
                  Link role
                  <select className={field} value={linkPermission} disabled={busy} onChange={event => setLinkPermission(event.target.value as ShareLinkPermission)}>
                    <PermissionOptions allowEdit={false} />
                  </select>
                </label>
                <label className={`${muted} flex flex-col gap-1`}>
                  Link expiry
                  <select className={field} value={linkDays} disabled={busy} onChange={event => setLinkDays(Number(event.target.value))}>
                    <ExpirationOptions />
                  </select>
                </label>
                <button type="submit" className={primary} disabled={busy}>Create sharing link</button>
              </form>
              {links.length > 0 && <ul className="mt-3 divide-y divide-[var(--glass-border-strong)]">
                {links.map(item => {
                  const status = item.revokedAt ? 'Revoked' : new Date(item.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Active';
                  return <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <p className="text-sm font-medium">{permissionLabels[item.permission]} · {status}</p>
                      <p className={muted}>{item.redemptionCount} redeemed · expires {expiry(item.expiresAt)}</p>
                    </div>
                    {status === 'Active' && <button type="button" className={secondary} disabled={busy} aria-label={`Revoke ${item.permission} link created ${expiry(item.createdAt)}`}
                      onClick={() => revoke(item.id, 'share')}>Revoke</button>}
                  </li>;
                })}
              </ul>}
              {sharing.legacyLink && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--glass-border-strong)] pt-3">
                <p className={muted}>Legacy board link expires {expiry(sharing.legacyLink.expiresAt)}.</p>
                <button type="button" className={secondary} disabled={busy} onClick={() => void mutate(signal => closeLegacyBoardLink(boardId, signal))}>Close legacy link</button>
              </div>}
            </section>

            {issued && <section className={`${line} p-3.5`} aria-label="Copy new link">
              <label className="text-sm font-semibold">
                {issued.label}
                <input ref={copyField} className={`${field} mt-2 block w-full`} value={issued.url} readOnly />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className={primary} onClick={() => void copyLink()}>Copy link</button>
                <span role="status" className={muted}>{copied || 'Copy before closing. The credential is shown once.'}</span>
              </div>
            </section>}

            <section aria-label="Direct board access" className={`${line} p-3.5`}>
              <h3 className="font-semibold">People with direct access</h3>
              {(sharing.members ?? []).length === 0 ? <p className={`${muted} mt-2`}>No direct members yet.</p> : (
                <ul className="mt-2 divide-y divide-[var(--glass-border-strong)]">
                  {sharing.members.map(member => <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{member.displayName}</p>
                      <p className={`${muted} break-all`}>{member.email}</p>
                    </div>
                    <select className={field} value={member.permission} disabled={busy} aria-label={`Role for ${member.displayName}`}
                      onChange={event => { const permission = event.target.value as MemberPermission; void mutate(async signal => { await updateBoardMemberRole(boardId, member.userId, permission, signal); }); }}>
                      <PermissionOptions allowEdit />
                    </select>
                    <button type="button" className={secondary} disabled={busy} aria-label={`Remove direct access for ${member.displayName}`}
                      onClick={() => void mutate(signal => removeBoardMember(boardId, member.userId, signal))}>Remove</button>
                  </li>)}
                </ul>
              )}
            </section>
          </div>
        )}
      </section>
    </dialog>
  );
}

export default function BoardSharingDialog({ isOpen, ...props }: BoardSharingDialogProps) {
  return isOpen ? <BoardSharingPanel key={props.boardId} {...props} /> : null;
}
