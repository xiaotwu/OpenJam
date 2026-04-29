import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { LinkPermission, MemberPermission, RoomMember } from '../lib/api';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  boardName: string;
  shareLink: string;
  linkPermission: LinkPermission;
  members?: RoomMember[];
  isLoading?: boolean;
  isSaving?: boolean;
  error?: string | null;
  onChangeLinkPermission: (permission: LinkPermission) => void | Promise<void>;
  onInvite: (email: string, permission: MemberPermission) => void | Promise<void>;
  onRemoveMember?: (userId: string) => void | Promise<void>;
  onCopyLink: () => void;
}

const linkPermissionOptions: Array<{ value: LinkPermission; label: string; description: string }> = [
  { value: 'restricted', label: 'Restricted', description: 'Only invited people can open this board.' },
  { value: 'anyone-view', label: 'Signed-in link viewers', description: 'Authenticated people with the link can view.' },
  { value: 'anyone-comment', label: 'Signed-in link commenters', description: 'Authenticated people with the link can comment.' },
  { value: 'anyone-edit', label: 'Signed-in link editors', description: 'Authenticated people with the link can edit.' },
];

const memberPermissionLabels: Record<MemberPermission, string> = {
  view: 'Can view',
  comment: 'Can comment',
  edit: 'Can edit',
};

export default function ShareDialog({
  isOpen,
  onClose,
  boardName,
  shareLink,
  linkPermission,
  members = [],
  isLoading = false,
  isSaving = false,
  error,
  onChangeLinkPermission,
  onInvite,
  onRemoveMember,
  onCopyLink,
}: ShareDialogProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePermission, setInvitePermission] = useState<MemberPermission>('edit');
  const [copied, setCopied] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selectedPermission = linkPermissionOptions.find((option) => option.value === linkPermission) || linkPermissionOptions[0];

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    onCopyLink();
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;

    let invited = false;
    setInviteBusy(true);
    try {
      await onInvite(email, invitePermission);
      invited = true;
    } catch {
      invited = false;
    } finally {
      setInviteBusy(false);
    }

    if (invited) {
      setInviteEmail('');
    }
  };

  const handleChangeLinkPermission = async (permission: LinkPermission) => {
    try {
      await onChangeLinkPermission(permission);
    } catch {
      // The parent surfaces the API error inline.
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!onRemoveMember) return;

    setRemovingId(userId);
    try {
      await onRemoveMember(userId);
    } catch {
      // The parent surfaces the API error inline.
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <button className="absolute inset-0 cursor-default" style={{ background: 'var(--surface-overlay)' }} onClick={onClose} aria-label="Close share dialog" />

      <section className="relative w-full max-w-2xl overflow-hidden rounded-2xl border shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" style={{ background: 'var(--surface-panel)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}>
        <header className="flex items-center justify-between gap-4 border-b px-6 py-4" style={{ borderColor: 'var(--glass-border-strong)' }}>
          <div className="min-w-0">
            <h2 id="share-dialog-title" className="truncate text-lg font-semibold">Share "{boardName}"</h2>
          </div>
          <button
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            aria-label="Close share dialog"
            type="button"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="max-h-[72vh] overflow-auto px-6 py-5">
          {error && (
            <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleInvite} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]" aria-label="Invite people">
            <label className="sr-only" htmlFor="share-invite-email">Email address</label>
            <input
              id="share-invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@example.com"
              className="min-h-11 rounded-xl border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}
            />
            <label className="sr-only" htmlFor="share-invite-permission">Invite permission</label>
            <select
              id="share-invite-permission"
              value={invitePermission}
              onChange={(event) => setInvitePermission(event.target.value as MemberPermission)}
              className="min-h-11 rounded-xl border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}
            >
              <option value="view">Can view</option>
              <option value="comment">Can comment</option>
              <option value="edit">Can edit</option>
            </select>
            <button
              type="submit"
              disabled={!inviteEmail.trim() || inviteBusy || isLoading}
              className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              {inviteBusy ? 'Inviting...' : 'Invite'}
            </button>
          </form>

          <section className="mt-6 rounded-2xl border p-4" style={{ borderColor: 'var(--glass-border-strong)', background: 'var(--glass-bg-subtle)' }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Board link</h3>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{selectedPermission.description}</p>
              </div>
              <select
                value={linkPermission}
                onChange={(event) => void handleChangeLinkPermission(event.target.value as LinkPermission)}
                disabled={isSaving || isLoading}
                className="min-h-11 rounded-xl border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ background: 'var(--surface-panel)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}
                aria-label="Link permission"
              >
                {linkPermissionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                type="text"
                value={shareLink}
                readOnly
                className="min-h-11 rounded-xl border px-3 text-sm"
                style={{ background: 'var(--surface-panel)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-secondary)' }}
                aria-label="Share link"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-600 px-4 text-sm font-semibold text-blue-600 transition hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </section>

          <section className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">People with access</h3>
              {isLoading && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Loading...</span>}
            </div>

            <div className="mt-3 space-y-2">
              {members.length === 0 && !isLoading ? (
                <div className="rounded-xl border px-3 py-4 text-sm" style={{ borderColor: 'var(--glass-border-strong)', color: 'var(--text-secondary)' }}>
                  No invited people yet.
                </div>
              ) : (
                members.map((member) => (
                  <div key={member.userId} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border px-3" style={{ borderColor: 'var(--glass-border-strong)' }}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: member.avatarColor }}>
                        {member.displayName.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{member.displayName}</span>
                        <span className="block truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{member.email}</span>
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ background: 'var(--badge-bg)', color: 'var(--text-secondary)' }}>
                        {memberPermissionLabels[member.permission]}
                      </span>
                      {onRemoveMember && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member.userId)}
                          disabled={removingId === member.userId}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                          aria-label={`Remove ${member.displayName}`}
                          title="Remove"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="mt-6 flex items-center gap-2" role="toolbar" aria-label="Quick share">
            <button
              type="button"
              onClick={() => window.open(`mailto:?subject=${encodeURIComponent(`Check out "${boardName}" on OpenJam`)}&body=${encodeURIComponent(`I'd like to share this board with you: ${shareLink}`)}`)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              title="Email"
              aria-label="Share by email"
            >
              <MailIcon />
            </button>
            <button
              type="button"
              onClick={() => window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareLink)}`, '_blank')}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              title="LinkedIn"
              aria-label="Share on LinkedIn"
            >
              <LinkedInIcon />
            </button>
            <button
              type="button"
              onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out "${boardName}" on OpenJam`)}&url=${encodeURIComponent(shareLink)}`, '_blank')}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              title="Twitter/X"
              aria-label="Share on Twitter or X"
            >
              <XIcon />
            </button>
          </div>
        </div>

        <footer className="flex justify-end border-t px-6 py-4" style={{ borderColor: 'var(--glass-border-strong)' }}>
          <button
            onClick={onClose}
            className="min-h-11 rounded-xl px-4 text-sm font-semibold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            style={{ color: 'var(--text-primary)' }}
            type="button"
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}

function IconBase({ children, color = 'currentColor' }: { children: ReactNode; color?: string }) {
  return (
    <svg className="h-5 w-5" style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

function CloseIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
    </IconBase>
  );
}

function CopyIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" />
    </IconBase>
  );
}

function CheckIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m5 13 4 4L19 7" />
    </IconBase>
  );
}

function TrashIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.228 5.79 18.16 19.673A2.25 2.25 0 0 1 15.916 21H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .397c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5.165V4.477c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </IconBase>
  );
}

function MailIcon() {
  return (
    <IconBase color="var(--text-secondary)">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21.75 6.75-8.69 5.16a2.25 2.25 0 0 1-2.12 0L2.25 6.75M4.5 19.5h15A2.25 2.25 0 0 0 21.75 17.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15A2.25 2.25 0 0 0 2.25 6.75v10.5A2.25 2.25 0 0 0 4.5 19.5z" />
    </IconBase>
  );
}

function LinkedInIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
