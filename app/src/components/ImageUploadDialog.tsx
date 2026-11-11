import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { uploadBoardAsset } from '../lib/boardFiles';
import WorkbenchIcon from './workbench/WorkbenchIcon';

interface ImageUploadResult {
  assetId?: string;
  url: string;
  width: number;
  height: number;
  name: string;
}

interface ImageUploadDialogProps {
  isOpen: boolean;
  boardId?: string;
  onClose: () => void;
  onUpload: (imageData: ImageUploadResult) => void;
}

const privateTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const buttonClass = 'inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50';

export default function ImageUploadDialog({ isOpen, ...props }: ImageUploadDialogProps) {
  return isOpen ? <ImageUploadForm key={props.boardId ?? 'legacy'} {...props} /> : null;
}

function ImageUploadForm({ boardId, onClose, onUpload }: Omit<ImageUploadDialogProps, 'isOpen'>) {
  const { messages: { images: text } } = useI18n();
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [urlInput, setUrlInput] = useState('');
  const [dragging, setDragging] = useState(false);
  const [lastFile, setLastFile] = useState<File>();
  const [task, setTask] = useState<{ name: string; progress: number | null }>();
  const [error, setError] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const titleId = useId();
  const urlId = useId();
  const sizeMiB = boardId ? 8 : 10;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      const pending = active.current;
      active.current = null;
      pending?.abort();
      dialog?.close();
    };
  }, []);

  const close = () => {
    active.current?.abort();
    onClose();
  };

  const run = async (name: string, work: (signal: AbortSignal, progress: (ratio: number) => void) => Promise<ImageUploadResult>) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setError('');
    setCancelled(false);
    setTask({ name, progress: boardId ? 0 : null });
    try {
      const result = await work(controller.signal, ratio => {
        if (!controller.signal.aborted) setTask({ name, progress: Math.min(100, Math.round(ratio * 100)) });
      });
      if (!controller.signal.aborted) {
        onUpload(result);
        onClose();
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : text.addFailed);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setTask(undefined);
        setCancelled(controller.signal.aborted);
      }
    }
  };

  const handleFile = (file: File) => {
    if (active.current) return;
    setLastFile(undefined);
    setCancelled(false);
    if (file.type && (boardId ? !privateTypes.has(file.type) : !file.type.startsWith('image/'))) {
      setError(boardId ? text.invalidPrivate : text.invalid);
      return;
    }
    if (!file.size || file.size > sizeMiB * 1024 * 1024) {
      setError(file.size ? text.sizeLimit(sizeMiB) : text.empty);
      return;
    }
    setLastFile(file);
    void run(file.name, async (signal, progress) => {
      if (boardId) {
        const image = await uploadBoardAsset(boardId, file, signal, progress);
        return { assetId: image.id, url: '', width: image.width, height: image.height, name: file.name };
      }
      const url = await readFileAsDataURL(file, signal, text.readFailed);
      return { url, ...await getImageDimensions(url, signal, text.loadFailed), name: file.name };
    });
  };

  const handleUrl = () => {
    const url = urlInput.trim();
    if (!url || boardId || active.current) return;
    setLastFile(undefined);
    void run(text.imageFromUrl, async signal => ({ url, ...await getImageDimensions(url, signal, text.loadFailed), name: text.defaultName }));
  };

  const selectTab = (next: 'file' | 'url') => {
    setTab(next);
    setError('');
    setCancelled(false);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}
      onPaste={event => {
        if (active.current) return;
        const file = Array.from(event.clipboardData.files).find(item => item.type.startsWith('image/'));
        if (!file) return;
        event.preventDefault();
        setTab('file');
        handleFile(file);
      }}
      className="board-chrome-popover fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md overflow-auto rounded-2xl border border-[var(--glass-border-strong)] text-[var(--text-primary)] shadow-2xl backdrop:bg-[var(--surface-overlay)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--glass-border-strong)] px-5 py-3">
        <h2 id={titleId} className="text-base font-semibold">{text.add}</h2>
        <button type="button" onClick={close} className="board-action-button grid place-items-center" aria-label={text.close}>
          <span className="size-4"><WorkbenchIcon name="close" /></span>
        </button>
      </header>

      <div className="space-y-4 p-5">
        {!boardId && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--badge-bg)] p-1" aria-label={text.source}>
            <button type="button" disabled={Boolean(task)} aria-pressed={tab === 'file'} onClick={() => selectTab('file')} className={buttonClass + ' aria-pressed:bg-[var(--surface-float)]'}>{text.upload}</button>
            <button type="button" disabled={Boolean(task)} aria-pressed={tab === 'url'} onClick={() => selectTab('url')} className={buttonClass + ' aria-pressed:bg-[var(--surface-float)]'}>{text.fromUrl}</button>
          </div>
        )}

        {tab === 'file' ? (
          <div
            className={'rounded-2xl border border-dashed p-6 text-center transition-colors ' + (dragging ? 'border-[var(--accent)] bg-[var(--badge-bg)]' : 'border-[var(--glass-border-strong)]')}
            onDragOver={event => { event.preventDefault(); if (!task) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <span className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-[var(--badge-bg)] text-[var(--text-primary)]">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 16l4.5-4.5 3 3 3-4 5.5 6.5M5 20h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
                <circle cx="15.5" cy="8" r="1" />
              </svg>
            </span>
            <p className="mb-3 text-sm text-[var(--text-secondary)]">{text.paste}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept={boardId ? Array.from(privateTypes).join(',') : 'image/*'}
              aria-label={text.imageFile}
              className="hidden"
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) handleFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={Boolean(task)}
              className={buttonClass + ' bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]'}
              autoFocus
            >
              {text.browse}
            </button>
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              {boardId ? text.privateFormats : text.legacyLimit}
            </p>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={event => { event.preventDefault(); handleUrl(); }}>
            <label className="block text-sm font-medium" htmlFor={urlId}>{text.imageUrl}</label>
            <input id={urlId} type="url" value={urlInput} onChange={event => setUrlInput(event.target.value)} disabled={Boolean(task)}
              placeholder="https://example.com/image.png"
              className="min-h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-[var(--badge-bg)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" />
            <button type="submit" disabled={Boolean(task) || !urlInput.trim()} className={buttonClass + ' bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]'}>{text.add}</button>
          </form>
        )}

        {task && (
          <div className="space-y-2 rounded-xl border border-[var(--glass-border-strong)] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium" title={task.name}>{task.name}</span>
              <span role="status" className="shrink-0 text-xs text-[var(--text-secondary)]">
                {task.progress === null || task.progress === 100 ? text.checking : text.uploading(task.progress)}
              </span>
            </div>
            <progress className="h-2 w-full align-top accent-[var(--accent)]" max={100} value={task.progress ?? undefined} aria-label={text.progress} />
            <button type="button" onClick={() => active.current?.abort()} className={buttonClass + ' border border-[var(--glass-border-strong)] hover:bg-[var(--badge-bg)]'}>{text.cancel}</button>
          </div>
        )}

        {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">{error}</p>}
        {cancelled && <p role="status" className="text-sm text-[var(--text-secondary)]">{text.cancelled}</p>}
        {!task && tab === 'file' && lastFile && (error || cancelled) && (
          <button type="button" onClick={() => handleFile(lastFile)} className={buttonClass + ' border border-[var(--glass-border-strong)] hover:bg-[var(--badge-bg)]'}>{text.retryUpload}</button>
        )}
      </div>
    </dialog>
  );
}

function abortError() {
  return new DOMException('', 'AbortError');
}

function readFileAsDataURL(file: File, signal: AbortSignal, errorMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal.addEventListener('abort', abort, { once: true });
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(errorMessage));
    reader.onabort = () => reject(abortError());
    reader.onloadend = () => signal.removeEventListener('abort', abort);
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(url: string, signal: AbortSignal, errorMessage: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      image.removeAttribute('src');
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    image.onload = () => {
      cleanup();
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(errorMessage));
    };
    image.src = url;
  });
}
