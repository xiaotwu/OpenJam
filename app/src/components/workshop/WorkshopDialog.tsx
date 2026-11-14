import { useEffect, useId, useRef, useState } from 'react';
import WorkshopIcon from './WorkshopIcon';
import { useI18n } from '../../i18n';

export interface DialogField {
  label: string;
  value?: string;
  placeholder?: string;
  maxLength?: number;
}

export interface DialogSelection {
  label: string;
  value?: string;
  options: Array<{ id: string; label: string }>;
}

interface WorkshopDialogProps {
  title: string;
  submitLabel: string;
  field?: DialogField;
  selection?: DialogSelection;
  busy: boolean;
  error: string | null;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onSubmit: (name: string, selectionId: string) => void;
}

export default function WorkshopDialog({
  title, submitLabel, field, selection, busy, error, returnFocus, onClose, onSubmit,
}: WorkshopDialogProps) {
  const { messages: { workshop: { dialog: text } } } = useI18n();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(field?.value ?? '');
  const [selectionId, setSelectionId] = useState(selection?.value ?? selection?.options[0]?.id ?? '');
  const nameLength = Array.from(name.trim()).length;
  const maxLength = field?.maxLength ?? 120;
  const nameTooLong = nameLength > maxLength;
  const validName = !field || (nameLength > 0 && !nameTooLong);
  const validSelection = !selection || selection.options.some((option) => option.id === selectionId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    const control = dialog.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
    control?.focus();
    if (control instanceof HTMLInputElement) control.select();

    return () => {
      dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [returnFocus]);

  return (
    <dialog
      className="workshop-dialog"
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="workshop-dialog-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <button type="button" className="workshop-icon-button" aria-label={text.close} onClick={onClose} disabled={busy}>
          <WorkshopIcon name="close" />
        </button>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!busy && validName && validSelection) onSubmit(name.trim(), selectionId);
      }}>
        {field && (
          <label className="workshop-field">
            {field.label}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={field.placeholder}
              autoComplete="off"
              maxLength={maxLength * 2}
              aria-invalid={nameTooLong || undefined}
              aria-describedby={nameTooLong ? `${id}-length` : undefined}
              disabled={busy}
              required
            />
          </label>
        )}
        {nameTooLong && <p className="workshop-error-text" id={`${id}-length`}>{text.nameTooLong(maxLength)}</p>}
        {selection && (
          <label className="workshop-field">
            {selection.label}
            <select value={selectionId} onChange={(event) => setSelectionId(event.target.value)} disabled={busy} required>
              {selection.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        )}
        {error && <p className="workshop-error-text" role="alert">{error}</p>}
        <div className="workshop-dialog-actions">
          <button type="button" className="workshop-button workshop-button-secondary" onClick={onClose} disabled={busy}>{text.cancel}</button>
          <button type="submit" className="workshop-button workshop-button-primary" disabled={busy || !validName || !validSelection}>
            {busy ? text.saving : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
