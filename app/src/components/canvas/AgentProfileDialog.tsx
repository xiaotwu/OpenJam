import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { agentGlyphs, normalizeAgentArtwork, saveAgentProfile, type AgentProfile } from '../../lib/agentIdentity';
import WorkbenchIcon from '../workbench/WorkbenchIcon';
import AgentCharacter from './AgentCharacter';
import '../workbench/workbench.css';

export default function AgentProfileDialog({ profile, onClose, onSave }: {
  profile: AgentProfile;
  onClose: () => void;
  onSave: (value: AgentProfile) => void;
}) {
  const { messages: { agentIdentity: text, workbench: { dialog } } } = useI18n();
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controller = useRef(new AbortController());
  const title = useId();
  const validName = Array.from(draft.name.trim()).length <= 48;

  useEffect(() => {
    const node = dialogRef.current;
    const previous = document.activeElement;
    const session = new AbortController();
    controller.current = session;
    node?.showModal();
    return () => {
      session.abort();
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  async function importArtwork(file?: File) {
    if (!file) return;
    const { signal } = controller.current;
    setBusy(true);
    setError('');
    try {
      const artwork = await normalizeAgentArtwork(file);
      if (!signal.aborted) setDraft(value => ({ name: value.name, ...artwork }));
    } catch {
      if (!signal.aborted) setError(text.artworkError);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  async function save() {
    const { signal } = controller.current;
    setBusy(true);
    setError('');
    try {
      const updated = await saveAgentProfile(draft, signal);
      if (!signal.aborted) onSave(updated);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : text.saveError);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="wb-dialog agent-profile-dialog" aria-labelledby={title} onCancel={event => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
      <div className="wb-dialog-heading">
        <h2 id={title}>{text.title}</h2>
        <button type="button" className="wb-icon-button" disabled={busy} onClick={onClose} aria-label={dialog.close}><WorkbenchIcon name="close" /></button>
      </div>
      <form onSubmit={event => { event.preventDefault(); if (!busy && validName) void save(); }}>
        <div className="agent-profile-poses" aria-hidden="true">
          {(['idle', 'working', 'waiting', 'reviewing'] as const).map(pose => (
            <div key={pose}><AgentCharacter profile={draft} pose={pose} /><span>{text[pose]}</span></div>
          ))}
        </div>
        <label className="wb-field">
          {text.name}
          <input value={draft.name} disabled={busy} placeholder={text.defaultName} maxLength={96} aria-invalid={!validName || undefined}
            onChange={event => setDraft({ ...draft, name: event.currentTarget.value })} />
        </label>
        <fieldset className="agent-profile-style">
          <legend>{text.style}</legend>
          <div className="agent-profile-glyphs">
            <button type="button" className="board-action-button" aria-label={text.ring} title={text.ring} aria-pressed={draft.kind === 'ring'} disabled={busy}
              onClick={() => setDraft({ name: draft.name, kind: 'ring' })}><AgentCharacter /></button>
            {agentGlyphs.map(glyph => <button key={glyph} type="button" className="board-action-button" title={text.glyphs[glyph]} aria-label={text.glyphs[glyph]}
              aria-pressed={draft.kind === 'glyph' && draft.glyph === glyph} disabled={busy}
              onClick={() => setDraft({ name: draft.name, kind: 'glyph', glyph })}><AgentCharacter profile={{ name: '', kind: 'glyph', glyph }} /></button>)}
          </div>
          <label className="wb-field">
            {text.importArt}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
              void importArtwork(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }} />
          </label>
          <p className="text-xs text-[var(--text-secondary)]">{text.formats}</p>
        </fieldset>
        {error && <p className="wb-error-text" role="alert">{error}</p>}
        <div className="wb-dialog-actions">
          <button type="button" className="wb-button wb-button-secondary" disabled={busy} onClick={onClose}>{dialog.cancel}</button>
          <button type="submit" className="wb-button wb-button-primary" disabled={busy || !validName}>{busy ? dialog.saving : text.save}</button>
        </div>
      </form>
    </dialog>
  );
}
