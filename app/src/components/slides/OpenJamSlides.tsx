import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../../lib/api';
import type { ReviewAnchor } from '../../lib/boardReview';
import { useBoardSync, type BoardDocument, type DocumentMutation } from '../../lib/boardSync';
import { resourcePath } from '../../lib/directory';
import { newRequestId } from '../../lib/requestId';
import {
  addSlideObject, downloadPptx, isDarkSlideColor, maxSlideObjects, maxSlides, maxSlideTextBytes,
  newSlide, patchSlideObject, slideDefaultFont, slideItems, slidePages,
  type SlideBox, type SlideImage, type SlideObject, type SlidePage, type SlideText,
} from '../../lib/slides';
import { useTheme } from '../../lib/useTheme';
import { recordRecentBoard } from '../../lib/workshop';
import { ConfirmDialog } from '../AppDialog';
import { useAuth } from '../AuthContext';
import BoardSharingDialog from '../BoardSharingDialog';
import ImageUploadDialog, { type ImageUploadResult } from '../ImageUploadDialog';
import BoardReviewPanel from '../collaboration/BoardReviewPanel';
import BoardSyncNotice from '../collaboration/BoardSyncNotice';
import BoardVersionsPanel from '../collaboration/BoardVersionsPanel';
import AccountPopover from '../workbench/AccountPopover';
import WorkbenchDialog from '../workbench/WorkbenchDialog';
import WorkbenchIcon, { type WorkbenchIconName } from '../workbench/WorkbenchIcon';
import SlidePlayback from './SlidePlayback';
import SlideRail from './SlideRail';
import SlideSurface from './SlideSurface';
import SlideToolbar from './SlideToolbar';
import SlideVersionPreview from './SlideVersionPreview';
import { useSlideMedia } from './useSlideMedia';
import '../docs/docs.css';
import './slides.css';

const emptyPages: SlidePage[] = [];
const emptyItems: SlideObject[] = [];
const encoder = new TextEncoder();

type Draft = { id: string; page: string; epoch?: number; item: SlideText; value: string };
type ImageRequest = { page: string; epoch?: number; replace?: SlideImage };
type Gesture = {
  pointer: number; x: number; y: number; scale: number; epoch?: number;
  mode: 'move' | 'resize'; item: SlideObject; box: SlideBox; moved: boolean;
};

function clamp(value: number, from: number, to: number) {
  return Math.max(from, Math.min(to, value));
}

function layerMap(document: BoardDocument | undefined) {
  const map = new Map<string, SlideObject[]>();
  for (const item of document ? slideItems(document.elements) : emptyItems) {
    const items = map.get(item.pageId);
    if (items) items.push(item);
    else map.set(item.pageId, [item]);
  }
  return map;
}

function boxAfterDrag(drag: Gesture, page: SlidePage, dx: number, dy: number): SlideBox {
  const { item } = drag;
  if (drag.mode === 'move') {
    return { x: clamp(Math.round(item.x + dx), 16 - item.width, page.width - 16),
      y: clamp(Math.round(item.y + dy), 16 - item.height, page.height - 16),
      width: item.width, height: item.height, rotation: item.rotation };
  }
  const angle = item.rotation * Math.PI / 180;
  const alongX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const alongY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  let width = clamp(Math.round(item.width + alongX), 24, page.width * 2);
  let height = clamp(Math.round(item.height + alongY), 24, page.height * 2);
  if (item.type === 'image') {
    const xFactor = width / item.width;
    const yFactor = height / item.height;
    const factor = Math.abs(xFactor - 1) >= Math.abs(yFactor - 1) ? xFactor : yFactor;
    const safe = clamp(factor, Math.min(1, 24 / Math.min(item.width, item.height)),
      Math.min(15360 / item.width, 15360 / item.height, page.width * 2 / item.width, page.height * 2 / item.height));
    width = Math.max(1, Math.round(item.width * safe));
    height = Math.max(1, Math.round(item.height * safe));
  }
  return { x: item.x, y: item.y, width, height, rotation: item.rotation };
}

export default function OpenJamSlides({ presentationId, user }: { presentationId: string; user: User }) {
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get('slide');
  const initialThread = params.get('thread') ?? undefined;
  const returnPath = typeof location.state?.workshop === 'string' && /^\/workplace(?:\?|$)/.test(location.state.workshop)
    ? location.state.workshop : '/workplace?view=recents';
  const [warnings, setWarnings] = useState<string[]>(() => Array.isArray(location.state?.warnings)
    ? location.state.warnings.filter((value: unknown) => typeof value === 'string') : []);

  const [documentState, setDocument] = useState<BoardDocument>();
  const accept = useCallback((document: BoardDocument) => setDocument(document), []);
  const sync = useBoardSync({ boardId: presentationId, userId: user.id, onDocument: accept });
  const pages = useMemo(() => documentState ? slidePages(documentState.pages) : emptyPages, [documentState]);
  const layers = useMemo(() => layerMap(documentState), [documentState]);
  const [pageId, setPageId] = useState<string | null>(requested);
  const page = pages.find(item => item.id === pageId) ?? pages[0];
  const pageIndex = page ? pages.indexOf(page) : -1;
  const items = page && layers.get(page.id) || emptyItems;
  const [selectedId, setSelectedId] = useState('');
  const selected = items.find(item => item.id === selectedId);
  const [draft, setDraft] = useState<Draft>();
  const draftRef = useRef<Draft | undefined>(undefined);
  const gesture = useRef<Gesture | undefined>(undefined);
  const [moving, setMoving] = useState<{ id: string; box: SlideBox }>();
  const root = useRef<HTMLElement>(null);
  const presentButton = useRef<HTMLButtonElement>(null);
  const anchored = useRef<string | null>(null);
  const recorded = useRef(false);
  const exportTask = useRef<AbortController | undefined>(undefined);
  const [panel, setPanel] = useState<'history' | 'comments' | 'share' | null>(initialThread ? 'comments' : null);
  const [imageRequest, setImageRequest] = useState<ImageRequest>();
  const [rename, setRename] = useState<HTMLElement>();
  const [deleting, setDeleting] = useState(false);
  const [visibleSlides, setVisibleSlides] = useState<Set<string>>(() => new Set());
  const [playbackId, setPlaybackId] = useState<string>();
  const playbackRef = useRef<string | undefined>(undefined);
  const native = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const canShow = sync.resourceKind === 'slides' && !!page && sync.status !== 'revoked';
  const canEdit = canShow && sync.canEdit;
  const dirty = !!draft && draft.value !== (draft.item.text ?? '');
  const draftNeedsReview = dirty && (!canEdit || draft.epoch !== sync.epoch || !layers.get(draft.page)?.some(item => item.id === draft.id));
  const canWrite = canEdit && !draftNeedsReview;
  const playback = playbackId ? pages.find(item => item.id === playbackId) ?? pages[0] : undefined;
  const playbackIndex = playback ? pages.indexOf(playback) : -1;
  const pictureIds = useMemo(() => {
    if (!canShow) return [];
    const visible = new Set(playbackIndex >= 0 ? [] : visibleSlides);
    const center = playbackIndex >= 0 ? playbackIndex : pageIndex;
    for (const nearby of pages.slice(Math.max(0, center - 1), center + 2)) visible.add(nearby.id);
    return [...visible].flatMap(id => (layers.get(id) ?? emptyItems).flatMap(item => item.type === 'image' ? [item.assetId] : []));
  }, [canShow, layers, pageIndex, pages, playbackIndex, visibleSlides]);
  const images = useSlideMedia(presentationId, pictureIds, sync.isConnected);

  const updateDraft = useCallback((value: Draft | undefined) => {
    draftRef.current = value;
    setDraft(value);
  }, []);

  const changeVisibility = useCallback((id: string, visible: boolean) => {
    setVisibleSlides(current => {
      if (current.has(id) === visible) return current;
      const next = new Set(current);
      if (visible) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const endPlayback = useCallback((keepSlide = true) => {
    const active = playbackRef.current;
    playbackRef.current = undefined;
    setPlaybackId(undefined);
    native.current = false;
    if (keepSlide && active) setPageId(active);
    if (window.document.fullscreenElement === root.current) void window.document.exitFullscreen?.().catch(() => {});
    requestAnimationFrame(() => presentButton.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    const currentRoot = root.current;
    const change = () => {
      if (window.document.fullscreenElement === currentRoot) {
        if (playbackRef.current) native.current = true;
        else void window.document.exitFullscreen?.().catch(() => {});
      } else if (native.current) {
        endPlayback();
      }
    };
    window.document.addEventListener('fullscreenchange', change);
    return () => {
      window.document.removeEventListener('fullscreenchange', change);
      if (currentRoot && window.document.fullscreenElement === currentRoot) void window.document.exitFullscreen?.().catch(() => {});
      exportTask.current?.abort();
    };
  }, [endPlayback]);

  useEffect(() => {
    if (sync.status !== 'revoked') return;
    updateDraft(undefined);
    exportTask.current?.abort();
    gesture.current = undefined;
    setMoving(undefined);
    setImageRequest(undefined);
    setPanel(null);
    if (playbackRef.current) endPlayback(false);
  }, [endPlayback, sync.status, updateDraft]);

  useEffect(() => {
    if (!canShow || recorded.current) return;
    recorded.current = true;
    void recordRecentBoard(presentationId).catch(() => { recorded.current = false; });
  }, [canShow, presentationId]);

  useEffect(() => {
    if (!canShow || !requested || anchored.current === location.key || !pages.some(item => item.id === requested)) return;
    anchored.current = location.key;
    setPageId(requested);
    setSelectedId('');
  }, [canShow, location.key, pages, requested]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const current = draftRef.current;
      if (current && current.value !== (current.item.text ?? '')) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  function finishDraft(): Promise<boolean> {
    const edit = draftRef.current;
    if (!edit) return Promise.resolve(true);
    if (edit.value === (edit.item.text ?? '')) {
      updateDraft(undefined);
      return Promise.resolve(true);
    }
    if (!canWrite || edit.epoch !== sync.epoch) return Promise.resolve(false);
    if (encoder.encode(edit.value).length > maxSlideTextBytes) {
      setError('A text box can contain up to 16,000 bytes.');
      return Promise.resolve(false);
    }
    const mutation = patchSlideObject(edit.item, { text: edit.value });
    updateDraft(undefined);
    setError('');
    return sync.enqueue([mutation]);
  }

  function selectPage(id: string) {
    if (id === page?.id) return;
    const select = () => {
      setPageId(id);
      setSelectedId('');
      gesture.current = undefined;
      setMoving(undefined);
    };
    if (draftRef.current) void finishDraft().then(saved => { if (saved) select(); });
    else select();
  }

  function selectObject(item: SlideObject) {
    if (draftRef.current && draftRef.current.id !== item.id) {
      void finishDraft().then(saved => { if (saved) setSelectedId(item.id); });
    } else setSelectedId(item.id);
  }

  function beginEdit(item: SlideText) {
    if (!canWrite || draftRef.current?.id === item.id) return;
    const edit = () => {
      setSelectedId(item.id);
      setError('');
      updateDraft({ id: item.id, page: item.pageId, epoch: sync.epoch, item, value: item.text ?? '' });
    };
    if (draftRef.current) void finishDraft().then(saved => { if (saved) edit(); });
    else edit();
  }

  function patchObject(item: SlideObject, values: Record<string, unknown>, unset: string[] = []) {
    if (!canWrite) return;
    const mutation = patchSlideObject(item, values, unset);
    if (mutation.kind === 'patch' && (Object.keys(mutation.fields ?? {}).length || unset.length)) void sync.enqueue([mutation]);
  }

  async function addText() {
    if (!canWrite || !page || items.length >= maxSlideObjects || !await finishDraft()) return;
    const item: SlideText = {
      id: newRequestId(), pageId: page.id, type: 'text', text: '', x: Math.round(page.width * .075),
      y: Math.round(page.height * (.11 + (items.length % 5) * .13)), width: Math.round(page.width * .85),
      height: Math.round(page.height * .18), rotation: 0, fontFamily: slideDefaultFont,
      fontSize: Math.round(clamp(page.width / 26, 22, 72)), fontWeight: items.length ? 'normal' : 'bold',
      fontStyle: 'normal', textAlign: 'left', color: isDarkSlideColor(page.background) ? '#ffffff' : '#202124',
    };
    if (await sync.enqueue([addSlideObject(item)])) beginEdit(item);
  }

  function applyImage(result: ImageUploadResult) {
    const target = imageRequest && pages.find(item => item.id === imageRequest.page);
    if (!canWrite || !target || !result.assetId || imageRequest?.epoch !== sync.epoch) return;
    if (imageRequest.replace) {
      const prior = imageRequest.replace;
      patchObject(prior, { assetId: result.assetId, originalWidth: result.width, originalHeight: result.height, caption: result.name.slice(0, 255) },
        prior.crop ? ['crop'] : []);
      return;
    }
    const scale = Math.min(target.width * .53 / result.width, target.height * .58 / result.height);
    const width = Math.max(1, Math.round(result.width * scale));
    const height = Math.max(1, Math.round(result.height * scale));
    const item: SlideImage = {
      id: newRequestId(), pageId: target.id, type: 'image', x: Math.round((target.width - width) / 2),
      y: Math.round((target.height - height) / 2), width, height, rotation: 0, assetId: result.assetId,
      originalWidth: result.width, originalHeight: result.height, caption: result.name.slice(0, 255),
    };
    void sync.enqueue([addSlideObject(item)]).then(saved => { if (saved) setSelectedId(item.id); });
  }

  async function addPage() {
    if (!canWrite || !page || pages.length >= maxSlides || !await finishDraft()) return;
    const next = newSlide(page);
    if (await sync.enqueue([{ kind: 'add', collection: 'pages', id: next.id, value: next }])) selectPage(next.id);
  }

  async function reorder(id: string, index: number) {
    if (!canWrite || index < 0 || index >= pages.length || pages[index].id === id || !pages.some(item => item.id === id)
      || !await finishDraft()) return;
    void sync.enqueue([{ kind: 'reorder', collection: 'pages', id, position: index, expected: { order: pages.map(item => item.id) } }]);
  }

  function deleteObject() {
    if (!canWrite || !selected || draftRef.current) return;
    void sync.enqueue([{ kind: 'delete', collection: 'elements', id: selected.id, expected: { ...selected } }]);
    setSelectedId('');
  }

  function deletePage() {
    if (!canWrite || !page || pages.length <= 1 || draftRef.current) return;
    const operations: DocumentMutation[] = items.map(item => ({ kind: 'delete', collection: 'elements', id: item.id, expected: { ...item } }));
    operations.push({ kind: 'delete', collection: 'pages', id: page.id, expected: { ...page } });
    void sync.enqueue(operations).then(saved => {
      if (saved) selectPage(pages[pageIndex === 0 ? 1 : pageIndex - 1].id);
    });
    setDeleting(false);
  }

  function dragStart(event: PointerEvent<HTMLElement>, item: SlideObject, mode: Gesture['mode'], scale: number) {
    if (event.button !== 0 || !canWrite || draftRef.current || gesture.current || scale <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    setSelectedId(item.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, scale, item, mode, box: item, moved: false, epoch: sync.epoch };
  }

  function dragMove(event: PointerEvent<HTMLElement>) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId || !page) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    drag.box = boxAfterDrag(drag, page, dx / drag.scale, dy / drag.scale);
    setMoving({ id: drag.item.id, box: drag.box });
  }

  function dragEnd(event: PointerEvent<HTMLElement>, cancel: boolean) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    gesture.current = undefined;
    setMoving(undefined);
    if (!cancel && drag.moved && drag.epoch === sync.epoch) patchObject(drag.item, { ...drag.box });
  }

  function stageKeys(event: KeyboardEvent<HTMLElement>) {
    if (!canWrite || !selected || !page || event.target instanceof HTMLButtonElement || draftRef.current) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteObject();
      return;
    }
    const step = event.shiftKey ? 16 : 2;
    const delta = event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowRight' ? [step, 0]
      : event.key === 'ArrowUp' ? [0, -step] : event.key === 'ArrowDown' ? [0, step] : undefined;
    if (delta) {
      event.preventDefault();
      patchObject(selected, {
        x: clamp(selected.x + delta[0], 16 - selected.width, page.width - 16),
        y: clamp(selected.y + delta[1], 16 - selected.height, page.height - 16),
      });
    }
    if (event.key === 'Escape') setSelectedId('');
  }

  function beginPlayback() {
    if (!canShow || !page || dirty) return;
    if (draftRef.current) updateDraft(undefined);
    setPanel(null);
    playbackRef.current = page.id;
    setPlaybackId(page.id);
    void root.current?.requestFullscreen?.().catch(() => {});
  }

  function goPlayback(index: number) {
    const target = pages[index];
    if (!target) return;
    playbackRef.current = target.id;
    setPlaybackId(target.id);
  }

  async function exportFile() {
    if (sync.status !== 'synced' || !documentState || dirty || exporting) return;
    const controller = new AbortController();
    exportTask.current = controller;
    setExporting(true);
    setError('');
    try {
      await downloadPptx(presentationId, documentState.name, controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The presentation could not be downloaded.');
    } finally {
      if (exportTask.current === controller) {
        exportTask.current = undefined;
        setExporting(false);
      }
    }
  }

  async function copyLink() {
    if (!page) return;
    const link = new URL(resourcePath('slides', presentationId), window.location.origin);
    link.searchParams.set('slide', page.id);
    try {
      await navigator.clipboard.writeText(link.href);
      setNotice('Slide link copied.');
    } catch {
      setNotice(link.href);
    }
  }

  function focusReview(anchor: ReviewAnchor) {
    if (!anchor.currentPageId) return;
    selectPage(anchor.currentPageId);
    if (anchor.elementId && anchor.status === 'live') setSelectedId(anchor.elementId);
  }

  if (sync.resourceKind && sync.resourceKind !== 'slides') return <Navigate replace to={resourcePath(sync.resourceKind, presentationId) + location.search} />;
  const title = canShow ? documentState?.name ?? 'Presentation' : 'Presentation';
  const status = sync.status === 'synced' ? 'Saved' : sync.status === 'offline' ? 'Offline'
    : sync.status === 'conflict' ? 'Review Needed' : sync.status === 'error' ? 'Unavailable' : 'Syncing…';
  const playbackOpen = canShow && playback;
  const fileActions: { label: string; icon: WorkbenchIconName; run: () => void; active?: boolean; disabled?: boolean }[] = [
    { label: 'Comments', icon: 'message', run: () => setPanel(panel === 'comments' ? null : 'comments'), active: panel === 'comments' },
    { label: 'Presentation History', icon: 'recent', run: () => setPanel(panel === 'history' ? null : 'history'), active: panel === 'history' },
    { label: 'Export PowerPoint', icon: 'download', run: () => void exportFile(), disabled: sync.status !== 'synced' || dirty || exporting },
    { label: 'Share Presentation', icon: 'shared', run: () => setPanel('share') },
  ];

  return <main ref={root} className="openjam-doc openjam-slides" aria-label="Presentation Editor">
    {playbackOpen ? <SlidePlayback page={playback} items={layers.get(playback.id) ?? emptyItems} images={images}
      index={playbackIndex} count={pages.length} onGo={goPlayback} onExit={() => endPlayback()} /> : <>
      <header className="doc-header">
        <Link className="doc-icon" aria-label="Back to Workshop" title="Back to Workshop" to={returnPath}
          onClick={event => {
            if (!draftRef.current) return;
            event.preventDefault();
            void finishDraft().then(saved => { if (saved) navigate(returnPath); });
          }}><WorkbenchIcon name="back" /></Link>
        <div className="doc-crumb">
          <WorkbenchIcon name="slides" />
          {canWrite ? <button type="button" className="slide-title" aria-label="Rename Presentation" title="Rename Presentation"
            onClick={event => setRename(event.currentTarget)}>{title}</button> : <span>{title}</span>}
        </div>
        {canShow && <>
          <span className="doc-sync" role="status" data-state={dirty ? 'editing' : sync.status} title={dirty ? 'Editing…' : status}>
            <i /><span>{dirty ? 'Editing…' : status}</span>
          </span>
          <div className="doc-presence" aria-label="Collaborators">
            {sync.collaborators.slice(0, 4).map(person => <span className="doc-avatar" key={person.id} role="img"
              aria-label={person.displayName} title={person.displayName} style={{ backgroundColor: person.avatarColor }}>
              {person.displayName.slice(0, 1).toUpperCase()}
            </span>)}
            {sync.collaborators.length > 4 && <span className="doc-avatar">+{sync.collaborators.length - 4}</span>}
          </div>
          <div className="doc-top-actions slide-desktop-actions">
            {fileActions.map(action => <button type="button" key={action.label} className="doc-icon" aria-label={action.label}
              title={action.label} aria-pressed={action.active} disabled={action.disabled} onClick={action.run}>
              <WorkbenchIcon name={action.icon} />
            </button>)}
          </div>
          <details className="doc-dropdown slide-compact-actions" onKeyDown={event => {
            if (event.key !== 'Escape' || !event.currentTarget.open) return;
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }}>
            <summary className="doc-icon" aria-label="Presentation Actions" title="Presentation Actions"><WorkbenchIcon name="more" /></summary>
            <div className="doc-menu">
              {fileActions.map(action => <button type="button" key={action.label} disabled={action.disabled} onClick={event => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                action.run();
              }}><WorkbenchIcon name={action.icon} />{action.label}</button>)}
            </div>
          </details>
          <button ref={presentButton} type="button" className="slide-present" aria-label="Present" title="Present"
            disabled={dirty} onClick={beginPlayback}><WorkbenchIcon name="play" /><span>Present</span></button>
        </>}
        <AccountPopover user={user} theme={theme} setTheme={setTheme}
          onLogout={async () => {
            if (!await finishDraft()) throw new Error('Copy or discard your text draft before signing out.');
            await logout();
          }} />
      </header>
      <BoardSyncNotice state={sync} resourceKind="slides" onRetry={() => void sync.retry()} onExportDraft={sync.exportDraft}
        onDiscard={() => { updateDraft(undefined); void sync.discardConflict(sync.conflict?.commandId); }} />
      {!canShow && (sync.status === 'loading' || sync.status === 'catching-up') && <p className="doc-empty" role="status">Opening presentation…</p>}
      {canShow && page && <div className="slide-workspace">
        <SlideRail pages={pages} layers={layers} images={images} active={pageIndex} editable={canWrite} canAdd={pages.length < maxSlides}
          onSelect={selectPage} onReorder={(id, position) => void reorder(id, position)} onAdd={() => void addPage()}
          onDelete={() => setDeleting(true)} onVisible={changeVisibility} />
        <section className="slide-editor" aria-label="Slide Editing Area" onKeyDown={stageKeys}>
          <SlideToolbar editable={canWrite} canInsert={items.length < maxSlideObjects} canUndo={sync.canUndo && !dirty}
            canRedo={sync.canRedo && !dirty} selected={selected} background={page.background}
            onUndo={() => void sync.undo()} onRedo={() => void sync.redo()} onAddText={() => void addText()}
            onAddImage={() => setImageRequest({ page: page.id, epoch: sync.epoch })}
            onEditText={() => { if (selected?.type === 'text') beginEdit(selected); }}
            onReplaceImage={() => { if (selected?.type === 'image') setImageRequest({ page: page.id, epoch: sync.epoch, replace: selected }); }}
            onDelete={deleteObject} onPatch={changes => { if (selected) patchObject(selected, changes); }}
            onBackground={color => { if (color !== page.background) void sync.enqueue([{ kind: 'patch', collection: 'pages',
              id: page.id, fields: { background: color }, expected: { background: page.background } }]); }}
            onCopyLink={() => void copyLink()} />
          {warnings.length > 0 && <div className="slide-import-warning" role="status">
            <span>{warnings.join(' ')}</span>
            <button type="button" className="doc-tool" aria-label="Dismiss Import Notice" onClick={() => setWarnings([])}><WorkbenchIcon name="close" /></button>
          </div>}
          {draftNeedsReview && draft && <div className="doc-draft-review" role="alert">
            <p>The presentation changed while you were editing. Your draft is still available to copy.</p>
            <textarea aria-label="Unsaved Slide Text" readOnly value={draft.value} rows={2} />
            <button type="button" className="doc-edit-action" onClick={() => updateDraft(undefined)}>Discard Draft</button>
          </div>}
          <div className="slide-canvas-zone">
            <SlideSurface page={page} items={items} images={images} label={'Slide ' + (pageIndex + 1) + ' Canvas'}
              onEmpty={canWrite ? () => void addText() : undefined}
              interaction={canWrite ? {
                selected: selectedId, drag: moving,
                edit: draft?.page === page.id ? {
                  id: draft.id, value: draft.value, onChange: value => updateDraft({ ...draft, value }),
                  onFinish: () => void finishDraft(), onCancel: () => { updateDraft(undefined); setError(''); },
                } : undefined,
                onClear: () => { if (!draftRef.current) setSelectedId(''); },
                onSelect: selectObject, onEditText: beginEdit, onDragStart: dragStart, onDragMove: dragMove, onDragEnd: dragEnd,
              } : undefined} />
          </div>
          <footer className="slide-statusbar">
            <span aria-live="polite">Slide {pageIndex + 1} of {pages.length}</span>
            {(error || sync.historyNotice || notice) && <span role={error ? 'alert' : 'status'}>{error || sync.historyNotice || notice}</span>}
          </footer>
        </section>
      </div>}
      {canShow && page && panel === 'comments' && <BoardReviewPanel open resourceKind="slides" boardId={presentationId} userId={user.id}
        canComment={sync.permission !== 'view'} online={sync.status !== 'offline'} epoch={sync.epoch} page={{ id: page.id, name: 'Slide ' + (pageIndex + 1) }}
        selectedObject={selected ? { id: selected.id, label: selected.type === 'image' ? 'Image' : 'Text Box' } : undefined}
        pickingPoint={false} initialThreadId={initialThread} onPickPoint={() => undefined} onFocusAnchor={focusReview} onClose={() => setPanel(null)} />}
      {canShow && panel === 'history' && <BoardVersionsPanel boardId={presentationId} resourceKind="slides"
        renderPreview={document => <SlideVersionPreview document={document} deckId={presentationId} />}
        permission={sync.permission} epoch={sync.epoch} seq={sync.seq} pendingCount={sync.pendingCount}
        online={sync.status === 'synced' && !dirty} onRestore={sync.retry} onOpenBoard={id => navigate(resourcePath('slides', id))}
        onClose={() => setPanel(null)} />}
      {canShow && panel === 'share' && <BoardSharingDialog isOpen resourceKind="slides" boardId={presentationId} boardName={title}
        onClose={() => setPanel(null)} />}
      {canShow && imageRequest && <ImageUploadDialog isOpen boardId={presentationId}
        presentation={imageRequest.replace ? 'replace' : 'insert'} onClose={() => setImageRequest(undefined)} onUpload={applyImage} />}
      {canShow && rename && <WorkbenchDialog title="Rename Presentation" submitLabel="Save"
        field={{ label: 'Presentation Name', value: title, maxLength: 255 }} busy={false} error={null} returnFocus={rename}
        onClose={() => setRename(undefined)} onSubmit={name => {
          if (name !== title) void sync.enqueue([{ kind: 'rename', value: name, expected: { name: title } }]);
          setRename(undefined);
        }} />}
      {canShow && page && deleting && <ConfirmDialog isOpen title={'Delete Slide ' + (pageIndex + 1)}
        message="Remove this slide and its objects from the presentation?"
        confirmLabel="Delete Slide" tone="danger" onConfirm={deletePage} onClose={() => setDeleting(false)} />}
    </>}
  </main>;
}
