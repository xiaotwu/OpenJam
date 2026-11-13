import { useEffect, useId, useRef, useState } from 'react';
import type { User } from '../../lib/api';
import type { useTheme } from '../../lib/useTheme';
import { useI18n } from '../../i18n';
import { useAuth } from '../AuthContext';
import { useAppearance, type InboxBadgeStyle } from '../../lib/useAppearance';
import WorkbenchIcon, { type WorkbenchIconName } from './WorkbenchIcon';

type ThemeControls = Pick<ReturnType<typeof useTheme>, 'theme' | 'setTheme'>;

interface AccountPopoverProps extends ThemeControls {
  user?: User;
  onLogout?: () => void | Promise<void>;
  side?: 'above' | 'below';
  expanded?: boolean;
}

const themeOptions: Array<{ value: ThemeControls['theme']; icon: WorkbenchIconName }> = [
  { value: 'system', icon: 'monitor' },
  { value: 'light', icon: 'sun' },
  { value: 'dark', icon: 'moon' },
];

export default function AccountPopover({
  user, onLogout, theme, setTheme, side = 'below', expanded = false,
}: AccountPopoverProps) {
  const { messages: { workbench: { account: text, auth, dialog } } } = useI18n();
  const { saveProfile } = useAuth();
  const { appearance, updateAppearance } = useAppearance(user?.id);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState('#64748b');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const currentTheme = useRef<HTMLButtonElement>(null);
  const profileName = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const name = user?.displayName.trim();
  const initial = name ? Array.from(name)[0].toUpperCase() : 'S';
  const label = user ? text.title : text.appearance;

  useEffect(() => {
    if (!open) return;
    currentTheme.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (editing) profileName.current?.focus();
  }, [editing]);

  function stopEditing() {
    setEditing(false);
    setError('');
    requestAnimationFrame(() => editButton.current?.focus());
  }

  async function updateAccount() {
    const nextName = draftName.trim();
    if (!nextName || working) return;
    setWorking(true);
    setError('');
    try {
      await saveProfile(nextName, draftColor);
      stopEditing();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.saveProfileError);
    } finally {
      setWorking(false);
    }
  }

  async function signOut() {
    setWorking(true);
    setError('');
    try {
      await onLogout?.();
      setOpen(false);
      trigger.current?.focus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.signOutError);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      className={`shell-account ${expanded ? 'shell-account-expanded' : ''}`}
      data-side={side}
      ref={wrapper}
      onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={event => {
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className={user && !expanded ? 'shell-account-trigger shell-account-avatar-trigger' : 'shell-island shell-account-trigger'}
        ref={trigger}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => { setOpen(current => !current); setEditing(false); setError(''); }}
      >
        {user ? <span className="shell-avatar" aria-hidden="true">{initial}</span> : <WorkbenchIcon name="settings" />}
        {expanded && user && <><span className="shell-account-name">{name}</span><WorkbenchIcon name="more" /></>}
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={label} className="shell-popover shell-account-popover">
          {user && (
            <div className="shell-account-identity">
              <span className="shell-avatar" aria-hidden="true">{initial}</span>
              <div><strong title={name}>{name}</strong><span title={user.email}>{user.email}</span></div>
            </div>
          )}
          {editing ? (
            <form className="shell-profile-form" onSubmit={event => { event.preventDefault(); void updateAccount(); }}>
              <label htmlFor={`${id}-name`}>{auth.displayName}</label>
              <input id={`${id}-name`} ref={profileName} value={draftName} onChange={event => setDraftName(event.target.value)} maxLength={255} required />
              <label className="shell-profile-color">{text.avatarColor}<input type="color" value={draftColor} onChange={event => setDraftColor(event.target.value)} /></label>
              <div className="shell-profile-actions">
                <button type="button" className="shell-pill" disabled={working} onClick={stopEditing}>{dialog.cancel}</button>
                <button type="submit" className="shell-pill shell-pill-primary" disabled={working || !draftName.trim()}>{working ? dialog.saving : text.saveProfile}</button>
              </div>
            </form>
          ) : <div className="shell-theme-section">
            <p>{text.appearance}</p>
            <div role="group" aria-label={text.appearance} className="shell-theme-options">
              {themeOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  ref={theme === option.value ? currentTheme : undefined}
                  aria-pressed={theme === option.value}
                  onClick={() => setTheme(option.value)}
                >
                  <WorkbenchIcon name={option.icon} />
                  {text.themes[option.value]}
                </button>
              ))}
            </div>
            <div className="shell-appearance-options">
              <label>{text.textSize}
                <select value={appearance.textSize} onChange={event => updateAppearance({ textSize: Number(event.target.value) })}>
                  {[13, 14, 15, 16, 17].map(size => <option key={size} value={size}>{size} px</option>)}
                </select>
              </label>
              {user && <label>{text.inboxBadge}
                <select value={appearance.inboxBadge}
                  onChange={event => updateAppearance({ inboxBadge: event.target.value as InboxBadgeStyle })}>
                  <option value="count">{text.badgeCount}</option>
                  <option value="dot">{text.badgeDot}</option>
                  <option value="hidden">{text.badgeHidden}</option>
                </select>
              </label>}
            </div>
          </div>}
          {user && !editing && (
            <button
              type="button"
              className="shell-account-signout"
              ref={editButton}
              onClick={() => {
                setDraftName(name || '');
                setDraftColor(/^#[0-9a-f]{6}$/i.test(user.avatarColor) ? user.avatarColor : '#64748b');
                setEditing(true);
              }}
            >
              <WorkbenchIcon name="pencil" /> {text.editProfile}
            </button>
          )}
          {user && onLogout && !editing && (
            <button type="button" className="shell-account-signout" disabled={working} onClick={() => void signOut()}>
              <WorkbenchIcon name="logout" /> {text.signOut}
            </button>
          )}
          {error && <p role="alert" className="shell-account-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
