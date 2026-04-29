import { useEffect, useId, useState, type ReactNode } from 'react';

interface DialogFrameProps {
  isOpen: boolean;
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  tone?: 'default' | 'danger';
}

function DialogFrame({ isOpen, title, children, footer, onClose, tone = 'default' }: DialogFrameProps) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        style={{ background: 'var(--surface-overlay)' }}
        onClick={onClose}
        aria-label={`Close ${title}`}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          background: 'var(--surface-panel)',
          borderColor: tone === 'danger' ? 'rgba(239,68,68,0.38)' : 'var(--glass-border-strong)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="flex items-center justify-between gap-4 border-b px-5 py-4" style={{ borderColor: 'var(--glass-border-strong)' }}>
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            aria-label={`Close ${title}`}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-5 py-4 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
          {children}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--glass-border-strong)' }}>
          {footer}
        </div>
      </section>
    </div>
  );
}

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  isBusy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  isBusy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <DialogFrame
      isOpen={isOpen}
      title={title}
      tone={tone}
      onClose={isBusy ? () => {} : onClose}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="min-h-11 rounded-xl px-4 text-sm font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${tone === 'danger' ? 'bg-red-600 hover:bg-red-700 focus-visible:outline-red-500' : 'bg-blue-600 hover:bg-blue-700 focus-visible:outline-blue-500'}`}
          >
            {isBusy ? 'Working...' : confirmLabel}
          </button>
        </>
      )}
    >
      {message}
    </DialogFrame>
  );
}

interface TextInputDialogProps {
  isOpen: boolean;
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  isBusy?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}

export function TextInputDialog({
  isOpen,
  title,
  label,
  initialValue = '',
  placeholder,
  submitLabel = 'Save',
  isBusy = false,
  onSubmit,
  onClose,
}: TextInputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputId = useId();

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
    }
  }, [initialValue, isOpen]);

  const trimmedValue = value.trim();

  return (
    <DialogFrame
      isOpen={isOpen}
      title={title}
      onClose={isBusy ? () => {} : onClose}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="min-h-11 rounded-xl px-4 text-sm font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(trimmedValue)}
            disabled={isBusy || trimmedValue.length === 0}
            className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {isBusy ? 'Saving...' : submitLabel}
          </button>
        </>
      )}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmedValue && !isBusy) {
            onSubmit(trimmedValue);
          }
        }}
      >
        <label htmlFor={inputId} className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {label}
        </label>
        <input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="mt-3 min-h-11 w-full rounded-xl border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}
          autoFocus
        />
      </form>
    </DialogFrame>
  );
}

interface NoticeDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  onClose: () => void;
}

export function NoticeDialog({ isOpen, title, message, onClose }: NoticeDialogProps) {
  return (
    <DialogFrame
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      footer={(
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          OK
        </button>
      )}
    >
      {message}
    </DialogFrame>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
