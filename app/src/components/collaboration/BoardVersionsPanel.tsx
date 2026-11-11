import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useI18n, type MessageCatalog } from '../../i18n';
import { ConfirmDialog } from '../AppDialog';
import { ApiError, request } from '../../lib/api';
import type { BoardDocument, BoardElement, DocumentPermission } from '../../lib/boardSyncProtocol';
import { newCommandId } from '../../lib/boardSyncSession';
import WorkbenchIcon from '../workbench/WorkbenchIcon';

interface VersionSummary {
  id: string;
  name: string;
  kind: 'checkpoint' | 'named' | 'before_restore' | 'restored';
  epoch: number;
  seq: number;
  hash: string;
  createdAt: string;
  author?: string;
  participants?: string[];
}

interface VersionList {
  versions: VersionSummary[];
  nextCursor?: string;
}

interface VersionPreview {
  version: VersionSummary;
  document: BoardDocument;
}

interface RestorePlan {
  version: VersionSummary;
  expectedEpoch: number;
  expectedSeq: number;
  requestId: string;
}

interface BoardVersionsPanelProps {
  boardId: string;
  permission?: DocumentPermission;
  epoch?: number;
  seq?: number;
  pendingCount: number;
  online: boolean;
  onClose: () => void;
  onRestore?: () => void | Promise<void>;
  onOpenBoard?: (id: string) => void;
}

const buttonClass = 'min-h-9 rounded-lg border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50';
const inputClass = 'min-h-9 min-w-0 rounded-lg border border-[var(--glass-border-strong)] bg-[var(--badge-bg)] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';
const sectionBorder = 'border-[var(--glass-border-strong)]';
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function itemLabel(element: BoardElement, text: MessageCatalog['versions']): string {
  if ('text' in element && typeof element.text === 'string') return element.text;
  if (element.type === 'frame' && typeof element.name === 'string') return element.name;
  if (element.type === 'widget') return typeof element.widgetType === 'string' ? element.widgetType.replaceAll('-', ' ') : text.widget;
  return element.type === 'image' ? text.image : '';
}

function itemColor(element: BoardElement): string {
  if (element.type === 'sticky') return '#fae6a7';
  if (element.type === 'shape' && typeof element.fill === 'string' && element.fill) return element.fill;
  if (element.type === 'widget') return 'var(--glass-bg-elevated)';
  return 'var(--badge-bg)';
}

function previewNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-10_000_000, Math.min(value, 10_000_000)) : fallback;
}

function SnapshotPreview({ preview }: { preview: VersionPreview }) {
  const { messages: { versions: text }, formatNumber } = useI18n();
  const doc = preview.document;
  const [pageId, setPageId] = useState(doc.defaultPageId);
  const pageLabel = useId();
  const pageElements = doc.elements.filter((element) => element.pageId === pageId);
  const pageStamps = doc.stamps.filter((stamp) => stamp.pageId === pageId);
  const tiles = [...pageElements.slice(0, 200).map((element) => ({
    id: element.id, x: previewNumber(element.x, 0), y: previewNumber(element.y, 0),
    width: Math.max(8, previewNumber(element.width, 100)), height: Math.max(8, previewNumber(element.height, 64)),
    label: itemLabel(element, text).slice(0, 160), color: itemColor(element), isSticky: element.type === 'sticky',
    isFrame: element.type === 'frame', layer: previewNumber(element.zIndex, 0),
  })), ...pageStamps.slice(0, 100).map((stamp) => ({
    id: `stamp-${stamp.id}`, x: previewNumber(stamp.x, 0), y: previewNumber(stamp.y, 0),
    width: 38, height: 38, label: typeof stamp.emoji === 'string' ? stamp.emoji : '', color: 'transparent',
    isSticky: false, isFrame: false, layer: Number.MAX_SAFE_INTEGER,
  }))].sort((a, b) => a.layer - b.layer);
  const x = tiles.length ? Math.min(...tiles.map((tile) => tile.x)) : 0;
  const y = tiles.length ? Math.min(...tiles.map((tile) => tile.y)) : 0;
  const width = Math.max(x + 160, ...tiles.map((tile) => tile.x + tile.width)) - x;
  const height = Math.max(y + 80, ...tiles.map((tile) => tile.y + tile.height)) - y;
  const scale = Math.min(288 / width, 120 / height);
  const offsetX = (320 - width * scale) / 2;
  const offsetY = (150 - height * scale) / 2;
  const items = pageElements.length + pageStamps.length;

  return (
    <div className="space-y-2">
      <label htmlFor={pageLabel} className="flex items-center justify-between gap-3 text-sm">
        <span>{text.previewPage}</span>
        <select id={pageLabel} value={pageId} onChange={(event) => setPageId(event.target.value)} className={`${inputClass} max-w-[64%]`}>
          {doc.pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
        </select>
      </label>
      <div
        aria-label={text.snapshotOf(doc.pages.find(page => page.id === pageId)?.name ?? text.pageFallback, items, formatNumber(items))}
        className={`relative aspect-[32/15] overflow-hidden rounded-xl border ${sectionBorder} bg-[var(--surface-canvas)]`}
        role="img"
      >
        {tiles.length === 0 && <span className="absolute inset-0 grid place-items-center text-xs text-[var(--text-secondary)]">{text.emptyPage}</span>}
        {tiles.map((tile) => (
          <div
            key={tile.id}
            className={`absolute overflow-hidden rounded-sm border border-[var(--glass-border-strong)] p-0.5 text-[8px] leading-tight ${tile.isFrame ? 'border-dashed' : ''}`}
            style={{
              left: `${((tile.x - x) * scale + offsetX) / 3.2}%`,
              top: `${((tile.y - y) * scale + offsetY) / 1.5}%`,
              width: `${tile.width * scale / 3.2}%`,
              height: `${tile.height * scale / 1.5}%`,
              backgroundColor: tile.color,
              color: tile.isSticky ? '#422006' : 'var(--text-primary)',
            }}
          >
            <span className="line-clamp-2 break-words">{tile.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--text-secondary)]">{text.pageItemCount(items, formatNumber(items), items > tiles.length)}</p>
    </div>
  );
}

export default function BoardVersionsPanel({
  boardId, permission, epoch, seq, pendingCount, online, onClose, onRestore, onOpenBoard,
}: BoardVersionsPanelProps) {
  const { messages: { versions: text }, formatDate, formatNumber } = useI18n();
  const path = `/api/v2/boards/${encodeURIComponent(boardId)}/versions`;
  const [list, setList] = useState<VersionList>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [preview, setPreview] = useState<VersionPreview>();
  const [name, setName] = useState('');
  const [copyName, setCopyName] = useState('');
  const [restorePlan, setRestorePlan] = useState<RestorePlan>();
  const [copyPlan, setCopyPlan] = useState<VersionSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const copyNameId = useId();
  const canEdit = permission === 'owner' || permission === 'edit';
  const canCaptureHead = canEdit && online && pendingCount === 0 && epoch !== undefined && seq !== undefined;

  useEffect(() => {
    const before = window.document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!canEdit) return;
    const controller = new AbortController();
    void request<VersionList>(path, { cache: 'no-store', signal: controller.signal }).then((response) => {
      setList(response);
      setLoading(false);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) {
        setError(errorMessage(failure, text.loadError));
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [canEdit, path, refreshKey, text.loadError]);

  useEffect(() => {
    if (!selectedId || !canEdit) return;
    const controller = new AbortController();
    void request<VersionPreview>(`${path}/${encodeURIComponent(selectedId)}`, {
      cache: 'no-store', signal: controller.signal,
    }).then(setPreview).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(failure, text.loadError));
    });
    return () => controller.abort();
  }, [canEdit, path, selectedId, text.loadError]);

  const refresh = () => {
    setLoading(true);
    setError('');
    setRefreshKey((key) => key + 1);
  };

  const loadMore = async () => {
    if (!list?.nextCursor || loading) return;
    setLoading(true);
    setError('');
    try {
      const page = await request<VersionList>(`${path}?before=${encodeURIComponent(list.nextCursor)}`, { cache: 'no-store' });
      setList({ ...page, versions: [...list.versions, ...page.versions] });
    } catch (failure) {
      setError(errorMessage(failure, text.loadError));
    } finally {
      setLoading(false);
    }
  };

  const saveVersion = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCaptureHead || busy || !name.trim()) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const version = await request<VersionSummary>(path, {
        method: 'POST', body: JSON.stringify({ name: name.trim(), expectedEpoch: epoch, expectedSeq: seq }),
      });
      refresh();
      setName('');
      setStatus(text.saved(version.name));
      setSelectedId(version.id);
    } catch (failure) {
      setError(errorMessage(failure, text.loadError));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!restorePlan || busy || permission !== 'owner') return;
    if (!online || pendingCount !== 0) {
      setError(text.waitForRestore);
      return;
    }
    setBusy(true);
    setError('');
    setStatus('');
    const { version, ...body } = restorePlan;
    try {
      await request(`${path}/${encodeURIComponent(version.id)}/restore`, { method: 'POST', body: JSON.stringify(body) });
      setRestorePlan(undefined);
      refresh();
      setStatus(text.restored);
      await onRestore?.();
    } catch (failure) {
      setError(errorMessage(failure, text.loadError));
      if (failure instanceof ApiError && failure.status < 500) setRestorePlan(undefined);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!copyPlan || busy || !canEdit) return;
    if (!online || !copyName.trim()) {
      setError(online ? text.copyNameRequired : text.copyOffline);
      return;
    }
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const board = await request<{ boardId: string }>(`${path}/${encodeURIComponent(copyPlan.id)}/copy`, {
        method: 'POST', body: JSON.stringify({ name: copyName.trim() }),
      });
      setCopyPlan(undefined);
      if (onOpenBoard) onOpenBoard(board.boardId);
      else window.location.assign(`/board/${encodeURIComponent(board.boardId)}`);
    } catch (failure) {
      setError(errorMessage(failure, text.loadError));
    } finally {
      setBusy(false);
    }
  };

  const selected = preview?.version.id === selectedId ? preview : undefined;
  return (
    <aside
      aria-labelledby={titleId}
      className={`board-side-panel absolute inset-x-3 bottom-20 z-[65] flex flex-col rounded-2xl border ${sectionBorder} text-[var(--text-primary)] shadow-2xl sm:left-auto sm:w-[360px]`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !restorePlan && !copyPlan && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className={`flex items-center justify-between gap-3 border-b ${sectionBorder} px-4 py-3`}>
        <h2 id={titleId} className="font-semibold">{text.title}</h2>
        <button ref={closeButton} type="button" aria-label={text.close} onClick={onClose} disabled={busy} className="board-action-button"><span className="size-4"><WorkbenchIcon name="close" /></span></button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
        {!canEdit && <p className="text-sm">{text.access}</p>}
        {canEdit && (
          <>
            <form onSubmit={saveVersion} className="flex items-center gap-2">
              <input aria-label={text.name} placeholder={text.namePlaceholder} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={`${inputClass} flex-1`} />
              <button type="submit" className={buttonClass} disabled={!canCaptureHead || busy || !name.trim()}>{text.save}</button>
            </form>
            {!canCaptureHead && <p className="text-xs text-[var(--text-secondary)]">{text.waitForSync}</p>}
            {status && <p role="status" className="text-sm">{status}</p>}
            {error && <p role="alert" className="text-sm text-[var(--text-secondary)]">{error}</p>}
            <section className="space-y-1.5" aria-label={text.list}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">{text.list}</h3>
                <button type="button" className={buttonClass} onClick={refresh} disabled={loading || busy}>{text.refresh}</button>
              </div>
              {loading && <p role="status" className="text-xs text-[var(--text-secondary)]">{text.loading}</p>}
              {!loading && !list?.versions.length && !error && <p className="text-sm text-[var(--text-secondary)]">{text.empty}</p>}
              {list?.versions.map((version) => (
                <button key={version.id} type="button" aria-pressed={selectedId === version.id}
                  className={`flex w-full flex-col gap-0.5 rounded-lg border p-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${selectedId === version.id ? 'border-[var(--accent)]' : sectionBorder}`}
                  onClick={() => { setSelectedId(version.id); setError(''); }}>
                  <span className="w-full truncate text-sm font-semibold">{version.name}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{text.versionMeta(text.kinds[version.kind], formatNumber(version.seq), formatDate(version.createdAt))}</span>
                  {(version.author || !!version.participants?.length) && <span className="w-full truncate text-xs text-[var(--text-secondary)]">{version.author || version.participants?.join(', ')}</span>}
                </button>
              ))}
              {list?.nextCursor && <button type="button" onClick={() => void loadMore()} disabled={loading} className={buttonClass}>{text.older}</button>}
            </section>
            {!!selectedId && !selected && !error && <p role="status" className="text-xs text-[var(--text-secondary)]">{text.loadingPreview}</p>}
            {selected && (
              <section aria-label={text.preview} className={`space-y-2 border-t ${sectionBorder} pt-3`}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold">{selected.version.name}</h3>
                  <span title={selected.version.hash} className="font-mono text-xs text-[var(--text-secondary)]">{selected.version.hash.slice(0, 10)}</span>
                </div>
                <SnapshotPreview key={selected.version.id} preview={selected} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!online || busy} className={buttonClass} onClick={() => {
                    setCopyName(text.copyName(selected.document.name).slice(0, 255));
                    setCopyPlan(selected.version);
                  }}>{text.copy}</button>
                  {permission === 'owner' && (
                    <button type="button" disabled={!canCaptureHead || busy} className={buttonClass} onClick={() => {
                      if (epoch !== undefined && seq !== undefined) {
                        setRestorePlan({ version: selected.version, expectedEpoch: epoch, expectedSeq: seq, requestId: newCommandId() });
                      }
                    }}>{text.restore}</button>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      {restorePlan && permission === 'owner' && (
        <ConfirmDialog
          isOpen title={text.restoreConfirm} tone="danger" confirmLabel={text.restoreButton}
          isBusy={busy} onClose={() => setRestorePlan(undefined)} onConfirm={restore}
          message={<>
            <p>{text.restoreExplanation(restorePlan.version.name)}</p>
            <p>{text.restoreCheckpoint}</p>
            {error && <p role="alert">{error}</p>}
          </>}
        />
      )}
      {copyPlan && canEdit && (
        <ConfirmDialog
          isOpen title={text.copyConfirm} confirmLabel={text.createCopy}
          isBusy={busy} onClose={() => setCopyPlan(undefined)} onConfirm={copy}
          message={<>
            <label htmlFor={copyNameId} className="block font-medium">{text.newBoardName}</label>
            <input id={copyNameId} className={`${inputClass} my-2 w-full`} maxLength={255} value={copyName} onChange={(event) => setCopyName(event.target.value)} />
            <p>{text.copyLocation}</p>
            {error && <p role="alert">{error}</p>}
          </>}
        />
      )}
    </aside>
  );
}
