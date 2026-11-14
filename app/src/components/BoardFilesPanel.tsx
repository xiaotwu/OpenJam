import { useEffect, useRef, useState } from 'react';
import { changeFileJob, downloadFileJob, enqueueExport, enqueueImport, getFileJob, listFileJobs, type ExportRequest, type FileJob } from '../lib/boardFiles';
import { useI18n } from '../i18n';
import { newCommandId } from '../lib/boardSyncSession';
import { ApiError } from '../lib/api';

interface BoardFilesPanelProps {
  boardId?: string;
  pageId?: string;
  elementIds?: string[];
  stampIds?: string[];
  canExport?: boolean;
  theme?: ExportRequest['theme'];
  onClose: () => void;
  onOpenBoard?: (id: string) => void;
}

const actionClass = 'min-h-9 rounded-full border border-[var(--glass-border-strong)] px-3 text-xs font-semibold hover:bg-[var(--badge-bg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50';
const primaryAction = 'min-h-10 rounded-full bg-[var(--text-primary)] px-3 text-sm font-semibold text-[var(--surface-canvas)] hover:opacity-90 disabled:opacity-50';

export default function BoardFilesPanel({ boardId, pageId, elementIds = [], stampIds = [], canExport, theme, onClose, onOpenBoard }: BoardFilesPanelProps) {
  const { messages: { files: text }, formatDate, formatNumber } = useI18n();
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [format, setFormat] = useState<ExportRequest['format']>('png');
  const [scope, setScope] = useState<ExportRequest['scope']>(pageId ? 'page' : 'board');
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [file, setFile] = useState<File>();
  const [refresh, setRefresh] = useState(0);
  const upload = useRef<AbortController | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const hasSelection = elementIds.length + stampIds.length > 0;
  const effectiveScope = scope === 'selection' && !hasSelection ? 'page' : scope;

  useEffect(() => {
    close.current?.focus();
    return () => upload.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const rows = await listFileJobs(boardId, controller.signal);
        if (controller.signal.aborted) return;
        setLoadError('');
        setJobs(rows ?? []);
        const active = rows?.some(job => job.status === 'queued' || job.status === 'running');
        timeout = setTimeout(read, active ? 850 : 3500);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : text.listError);
        if (!(error instanceof ApiError && [401, 403, 404].includes(error.status))) timeout = setTimeout(read, 3500);
      }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [boardId, refresh, text.listError]);

  const jobAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setRefresh(value => value + 1);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessage(error instanceof Error ? error.message : text.actionError);
      }
    } finally {
      setBusy(false);
      setProgress(undefined);
      upload.current = null;
    }
  };

  const requestId = (key: string) => {
    if (request.current?.key !== key) request.current = { key, id: newCommandId() };
    return request.current.id;
  };

  const createExport = () => {
    if (!boardId || !canExport) return;
    const settings: Omit<ExportRequest, 'requestId'> = {
      format,
      scope: effectiveScope,
      ...(format === 'png' && { theme }),
      ...(effectiveScope !== 'board' && { pageId }),
      ...(effectiveScope === 'selection' && { elementIds, stampIds }),
    };
    void jobAction(async () => {
      await enqueueExport(boardId, { ...settings, requestId: requestId(JSON.stringify(settings)) });
      request.current = null;
    });
  };

  const createImport = () => {
    if (!file) return;
    if (!/\.(json|zip)$/i.test(file.name) || file.size > 32 * 1024 * 1024) {
      setMessage(text.packageLimit);
      return;
    }
    void jobAction(async () => {
      const controller = new AbortController();
      upload.current = controller;
      setProgress(0);
      await enqueueImport(file, requestId(`${file.name}:${file.lastModified}:${file.size}`), controller.signal, setProgress);
      request.current = null;
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
    });
  };

  return (
    <aside aria-label={boardId ? text.exportPanel : text.importPanel} className={`board-side-panel ${boardId ? 'absolute' : 'fixed'} bottom-20 right-3 z-[75] flex w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-[var(--glass-border-strong)] text-[var(--text-primary)] shadow-2xl sm:bottom-6`}
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); onClose(); } }}>
      <header className="flex items-center justify-between border-b border-[var(--glass-border-strong)] px-4 py-2">
        <h2 className="text-sm font-semibold">{boardId ? text.exportPanel : text.import}</h2>
        <button ref={close} className="board-action-button" type="button" aria-label={text.close} title={text.closeTitle} onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        {boardId ? (
          <form className="grid grid-cols-2 gap-2" onSubmit={event => { event.preventDefault(); createExport(); }}>
            <label className="flex flex-col gap-1 text-xs">{text.format}
              <select className={actionClass} value={format} disabled={busy} onChange={event => setFormat(event.target.value as ExportRequest['format'])}>
                <option value="png">{text.formats.png}</option><option value="zip">{text.formats.zip}</option><option value="json">{text.formats.json}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">{text.scope}
              <select className={actionClass} value={effectiveScope} disabled={busy} onChange={event => setScope(event.target.value as ExportRequest['scope'])}>
                <option value="board">{text.scopes.board}</option><option value="page" disabled={!pageId}>{text.scopes.page}</option><option value="selection" disabled={!hasSelection}>{text.scopes.selection}</option>
              </select>
            </label>
            <button type="submit" className={`col-span-2 ${primaryAction}`} disabled={busy || !canExport}>{text.export}</button>
            {!canExport && <p className="col-span-2 text-xs text-[var(--text-secondary)]">{text.exportPending}</p>}
          </form>
        ) : (
          <form className="space-y-3" onSubmit={event => { event.preventDefault(); createImport(); }}>
            <label className="block text-xs font-semibold">{text.packageFile}
              <input ref={fileInput} aria-label={text.packageFile} type="file" accept=".json,.zip,application/json,application/zip" disabled={busy} className="mt-1 block max-w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-[var(--badge-bg)] file:px-2 file:py-1 file:text-[var(--text-primary)]" onChange={event => { setFile(event.currentTarget.files?.[0]); request.current = null; }} />
            </label>
            {progress !== undefined && <progress className="w-full" max={1} value={progress} aria-label={text.packageUpload} />}
            <div className="flex gap-2">
              <button type="submit" className={primaryAction} disabled={!file || busy}>{text.privateImport}</button>
              {progress !== undefined && <button type="button" className={actionClass} onClick={() => upload.current?.abort()}>{text.cancelUpload}</button>}
            </div>
          </form>
        )}

        {(message || loadError) && <p role="status" className="text-xs text-[var(--text-secondary)]">{message || loadError}</p>}
        <section aria-label={text.recentFileTasks} className="space-y-2">
          <h3 className="text-xs font-semibold">{text.recentTasks}</h3>
          {!jobs.length && <p className="text-xs text-[var(--text-secondary)]">{text.emptyTasks}</p>}
          {jobs.map(job => (
            <div key={job.id} className="rounded-xl border border-[var(--glass-border-strong)] p-3 text-xs">
              <div className="flex justify-between gap-2"><strong>{job.kind === 'board_import' ? text.boardImport : text.boardExport}</strong><span role="status">{text.statuses[job.status]}</span></div>
              <div className="mt-1 text-[var(--text-secondary)]">{formatDate(job.createdAt)}{job.attempt > 1 && ' · ' + text.attempt(formatNumber(job.attempt))}</div>
              {job.status === 'failed' && <p className="mt-2 text-[var(--text-secondary)]">{text.errors[job.errorCode ?? ''] ?? text.failed}</p>}
              <div className="mt-2 flex flex-wrap gap-2 empty:hidden">
                {job.artifactAvailable && <button className={actionClass} type="button" disabled={busy} onClick={() => void jobAction(() => downloadFileJob(job.id))}>{text.download}</button>}
                {job.kind === 'board_import' && job.status === 'succeeded' && onOpenBoard && <button className={actionClass} type="button" disabled={busy} onClick={() => void jobAction(async () => {
                  const detail = await getFileJob(job.id);
                  if (!detail.result?.boardId) throw new Error(text.unavailable);
                  onOpenBoard(detail.result.boardId);
                })}>{text.openBoard}</button>}
                {(job.status === 'queued' || job.status === 'running') && <button className={actionClass} type="button" disabled={busy} onClick={() => void jobAction(() => changeFileJob(job.id, 'cancel'))}>{text.cancelTask}</button>}
                {job.status === 'failed' && job.manualRetries < 2 && <button className={actionClass} type="button" disabled={busy} onClick={() => void jobAction(() => changeFileJob(job.id, 'retry'))}>{text.retry}</button>}
              </div>
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg>;
}
