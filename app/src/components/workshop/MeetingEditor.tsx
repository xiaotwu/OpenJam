import { useEffect, useRef, useState } from 'react';
import { newRequestId } from '../../lib/requestId';
import { meetingEndpoint, writeWorkshop, type MeetingDraft } from '../../lib/workshop';
import WorkshopIcon from './WorkshopIcon';

interface MeetingScope {
  value: string;
  label: string;
}

function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function MeetingEditor({ scopes, initialScope, date, onClose, onCreated }: {
  scopes: MeetingScope[];
  initialScope?: string;
  date?: Date;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const draft = useRef<{ id: string; signature: string }>(null);
  const [scope, setScope] = useState<MeetingScope | undefined>(scopes.find(option => option.value === initialScope) ?? scopes[0]);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(date ? 'schedule' : 'now');
  const [start, setStart] = useState(() => {
    const nextSlot = new Date(Math.ceil((Date.now() + 60_000) / 900_000) * 900_000);
    const morning = date && new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9);
    return localInput(morning && morning > nextSlot ? morning : nextSlot);
  });
  const [end, setEnd] = useState(() => localInput(new Date(new Date(start).getTime() + 30 * 60_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  async function save() {
    if (!scope || busy || !title.trim()) return;
    setError('');
    const input: MeetingDraft = { title: title.trim() };
    if (scope.value.startsWith('team:')) input.teamId = scope.value.slice(5);
    else input.projectId = scope.value.slice(8);
    if (when === 'schedule') {
      const startsAt = new Date(start);
      const endsAt = new Date(end);
      if (!(endsAt > startsAt) || endsAt.getTime() <= Date.now() || endsAt.getTime() - startsAt.getTime() > 86_400_000) {
        setError('Choose a meeting that ends in the future and lasts up to 24 hours.');
        return;
      }
      input.startsAt = startsAt.toISOString();
      input.endsAt = endsAt.toISOString();
    }
    const signature = JSON.stringify(input);
    if (draft.current?.signature !== signature) draft.current = { signature, id: newRequestId() };
    const id = draft.current.id;
    setBusy(true);
    try {
      await writeWorkshop(meetingEndpoint(id), 'PUT', input);
      onCreated(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the meeting.');
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="workshop-dialog workshop-agenda-dialog" aria-labelledby="meeting-editor-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="workshop-dialog-heading">
      <h2 id="meeting-editor-title">New Meeting</h2>
      <button type="button" className="workshop-icon-button" aria-label="Close" onClick={onClose} disabled={busy}><WorkshopIcon name="close" /></button>
    </header>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="workshop-meeting-mode">
        <div className="workshop-segmented" role="group" aria-label="Meeting Time">
          <button type="button" aria-pressed={when === 'now'} disabled={busy} onClick={() => setWhen('now')}>Meet Now</button>
          <button type="button" aria-pressed={when === 'schedule'} disabled={busy} onClick={() => setWhen('schedule')}>Schedule</button>
        </div>
      </div>
      <label className="workshop-field">Title<input autoFocus required value={title} maxLength={140}
        onChange={event => setTitle(event.target.value)} disabled={busy} /></label>
      {scopes.length === 1 ? <p className="workshop-meeting-scope"><WorkshopIcon name="calendar" />{scope?.label}</p> :
        <label className="workshop-field">Calendar<select value={scope?.value ?? ''} required disabled={busy}
          onChange={event => setScope(scopes.find(option => option.value === event.target.value))}>
          {scopes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>}
      {when === 'schedule' && <div className="workshop-form-grid">
        <label className="workshop-field">Starts<input type="datetime-local" required disabled={busy} value={start}
          onChange={event => {
            const value = event.target.value;
            setStart(value);
            const timestamp = new Date(value).getTime();
            if (Number.isFinite(timestamp) && timestamp >= new Date(end).getTime()) {
              setEnd(localInput(new Date(timestamp + 30 * 60_000)));
            }
          }} /></label>
        <label className="workshop-field">Ends<input type="datetime-local" required disabled={busy} value={end}
          onChange={event => setEnd(event.target.value)} /></label>
      </div>}
      {error && <p className="workshop-error-text" role="alert">{error}</p>}
      <footer className="workshop-dialog-actions">
        <button type="submit" className="workshop-button workshop-button-primary" disabled={busy || !scope || !title.trim()}>
          <WorkshopIcon name={when === 'now' ? 'camera' : 'calendar'} />{when === 'now' ? 'Start Meeting' : 'Schedule Meeting'}
        </button>
      </footer>
    </form>
  </dialog>;
}
