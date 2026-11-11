import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n, type MessageCatalog } from '../../i18n';
import { ApiError } from '../../lib/api';
import { newCommandId } from '../../lib/boardSyncSession';
import type { ResourceKind } from '../../lib/directory';
import {
  boardReviewAPI, type ReviewAnchor, type ReviewComment, type ReviewDraft, type ReviewFilter,
  type ReviewLocation, type ReviewNotification, type ReviewPerson, type ReviewThread,
  type ReviewThreadDetail, type ReviewThreadPage,
} from '../../lib/boardReview';
import WorkbenchIcon from '../workbench/WorkbenchIcon';

interface BoardReviewPanelProps {
  open: boolean;
  resourceKind?: ResourceKind;
  boardId: string;
  userId: string;
  canComment: boolean;
  online: boolean;
  epoch?: number;
  page: { id: string; name: string };
  selectedObject?: { id: string; label: string };
  pickedLocation?: ReviewLocation;
  pickingPoint: boolean;
  initialThreadId?: string;
  onPickPoint: () => void;
  onFocusAnchor: (anchor: ReviewAnchor) => void;
  onClose: () => void;
}

const emptyDraft: ReviewDraft = { body: '', mentionUserIds: [] };
const filters: ReviewFilter[] = ['open', 'resolved', 'mentioned', 'all'];
const smallButton = 'rounded-full px-2 py-1.5 text-xs font-semibold hover:bg-blue-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-45';
const accentButton = 'rounded-full bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-45';

function labelFor(anchor: ReviewAnchor, text: MessageCatalog['review']): string {
  switch (anchor.status) {
    case 'missing-page': return text.anchor.missingPage(anchor.pageName);
    case 'missing-object': return text.anchor.missingObject(anchor.pageName);
    case 'moved': return text.anchor.moved(anchor.pageName);
    default: return anchor.elementId ? text.anchor.object(anchor.pageName) : anchor.x !== undefined ? text.anchor.point(anchor.pageName) : anchor.pageName;
  }
}

function DraftEditor({ label, draft, people, onChange, onSubmit, submitLabel, disabled, children }: {
  label: string;
  draft: ReviewDraft;
  people: ReviewPerson[];
  onChange: (draft: ReviewDraft) => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled: boolean;
  children?: ReactNode;
}) {
  const { messages: { review: text } } = useI18n();
  const available = people.filter(person => !draft.mentionUserIds.includes(person.id));
  return (
    <form className="grid gap-2" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      {children}
      <textarea
        aria-label={label} placeholder={label} value={draft.body} maxLength={8_000}
        onChange={event => onChange({ ...draft, body: event.target.value })}
        className="min-h-20 w-full resize-y rounded-xl border px-3 py-2 text-sm outline-[var(--accent)]"
        style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-strong)' }}
      />
      {draft.mentionUserIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {draft.mentionUserIds.map(id => {
            const name = people.find(person => person.id === id)?.displayName ?? text.mentionedMember;
            return <button key={id} type="button" aria-label={text.removeMention(name)} className={smallButton + ' bg-blue-500/10'}
              onClick={() => onChange({ ...draft, mentionUserIds: draft.mentionUserIds.filter(item => item !== id) })}>@{name} ×</button>;
          })}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        {!!available.length && draft.mentionUserIds.length < 10 ? (
          <select aria-label={text.mentionLabel} value="" className="min-w-0 rounded-lg border px-2 py-1.5 text-xs"
            style={{ background: 'var(--surface-panel)', borderColor: 'var(--glass-border-strong)' }}
            onChange={event => { if (event.target.value) onChange({ ...draft, mentionUserIds: [...draft.mentionUserIds, event.target.value] }); }}>
            <option value="">{text.mentionPlaceholder}</option>
            {available.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}
          </select>
        ) : <span />}
        <button type="submit" className={accentButton} disabled={disabled || !draft.body.trim()}>{submitLabel}</button>
      </div>
    </form>
  );
}

export default function BoardReviewPanel({
  open, resourceKind = 'board', boardId, userId, canComment, online, epoch, page, selectedObject, pickedLocation, pickingPoint,
  initialThreadId, onPickPoint, onFocusAnchor, onClose,
}: BoardReviewPanelProps) {
  const { messages: { review: text }, formatNumber } = useI18n();
  const api = useMemo(() => boardReviewAPI(boardId), [boardId]);
  const [filter, setFilter] = useState<ReviewFilter>('open');
  const [threadId, setThreadId] = useState(initialThreadId);
  const [listing, setListing] = useState<ReviewThreadPage>();
  const [detail, setDetail] = useState<ReviewThreadDetail>();
  const [people, setPeople] = useState<ReviewPerson[]>([]);
  const [notifications, setNotifications] = useState<ReviewNotification[]>();
  const [showNotifications, setShowNotifications] = useState(false);
  const [composing, setComposing] = useState(false);
  const [anchorMode, setAnchorMode] = useState<'page' | 'object' | 'point'>('page');
  const [draftAnchor, setDraftAnchor] = useState<{ location: ReviewLocation; label: string }>();
  const [draft, setDraft] = useState<ReviewDraft>(emptyDraft);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, ReviewDraft>>({});
  const [editing, setEditing] = useState<{ original: ReviewComment; draft: ReviewDraft }>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);
  const initialFocus = useRef(Boolean(initialThreadId));
  const createAttempt = useRef<{ signature: string; id: string } | undefined>(undefined);
  const replyAttempt = useRef<{ signature: string; id: string } | undefined>(undefined);

  const report = useCallback((error: unknown, reading = false) => {
    if (error instanceof ApiError && (error.status === 401 || error.code === 'BOARD_NOT_FOUND' || (reading && error.status === 403))) {
      setListing(undefined);
      setDetail(undefined);
      setPeople([]);
      setNotifications(undefined);
    }
    setMessage(error instanceof Error ? error.message : text.loadError);
  }, [text.loadError]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    closeButton.current?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open || !online) return;
    const controller = new AbortController();
    let loading = false;
    const load = (force = false) => {
      if (loading || (!force && document.visibilityState === 'hidden')) return;
      loading = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6_500)]);
      void api.threads(filter, undefined, signal).then(next => {
        if (controller.signal.aborted) return;
        setListing(current => {
          if (current && next.nextCursor && current.threads.length > 30) {
            const ids = new Set(next.threads.map(thread => thread.id));
            return { ...next, threads: [...next.threads, ...current.threads.slice(30).filter(thread => !ids.has(thread.id))], nextCursor: current.nextCursor };
          }
          return next;
        });
      }).catch(error => { if (!controller.signal.aborted) report(error, true); }).finally(() => { loading = false; });
    };
    load(true);
    const visible = () => load();
    const timer = window.setInterval(visible, 8_000);
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [api, epoch, filter, online, open, refresh, report]);

  useEffect(() => {
    if (!open || !online || !threadId) return;
    const controller = new AbortController();
    let loading = false;
    const load = (force = false) => {
      if (loading || (!force && document.visibilityState === 'hidden')) return;
      loading = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6_500)]);
      void api.thread(threadId, undefined, signal).then(next => {
        if (controller.signal.aborted) return;
        setDetail(current => current?.thread.id === threadId && current.comments.length > 30 ? {
          ...next, comments: [...next.comments, ...current.comments.slice(30)], nextCursor: current.nextCursor,
        } : next);
      }).catch(error => { if (!controller.signal.aborted) report(error, true); }).finally(() => { loading = false; });
    };
    load(true);
    const visible = () => load();
    const timer = window.setInterval(visible, 8_000);
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [api, epoch, online, open, refresh, report, threadId]);

  useEffect(() => {
    if (!open || !online || !canComment) return;
    const controller = new AbortController();
    void api.people(controller.signal).then(({ people }) => {
      if (!controller.signal.aborted) setPeople(people);
    }).catch(error => { if (!controller.signal.aborted) report(error); });
    return () => controller.abort();
  }, [api, canComment, online, open, report]);

  useEffect(() => {
    if (!open || !online || !showNotifications) return;
    const controller = new AbortController();
    void api.notifications(controller.signal).then(({ notifications }) => {
      if (!controller.signal.aborted) setNotifications(notifications);
    }).catch(error => { if (!controller.signal.aborted) report(error); });
    return () => controller.abort();
  }, [api, online, open, refresh, report, showNotifications]);

  useEffect(() => {
    if (!initialFocus.current || !detail || detail.thread.id !== initialThreadId) return;
    initialFocus.current = false;
    onFocusAnchor(detail.thread.anchor);
  }, [detail, initialThreadId, onFocusAnchor]);

  const perform = async (action: () => Promise<void>) => {
    if (busy || !online) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };

  const reload = () => setRefresh(value => value + 1);

  const openThread = (id: string) => {
    setThreadId(id);
    setShowNotifications(false);
    setComposing(false);
    setMessage('');
  };

  const showComposer = () => {
    setComposing(true);
    setThreadId(undefined);
    setShowNotifications(false);
    if (!draft.body) {
      setAnchorMode(selectedObject ? 'object' : 'page');
      setDraftAnchor({ location: { pageId: page.id, elementId: selectedObject?.id }, label: selectedObject?.label ?? page.name });
    }
  };

  const composeAnchor: ReviewLocation = anchorMode === 'point' && pickedLocation ? pickedLocation
    : draftAnchor?.location ?? { pageId: page.id };

  const addThread = () => {
    if (!canComment || !draft.body.trim() || (anchorMode === 'point' && !pickedLocation)) return;
    void perform(async () => {
      const signature = JSON.stringify([composeAnchor, draft]);
      if (createAttempt.current?.signature !== signature) createAttempt.current = { signature, id: newCommandId() };
      const thread = await api.createThread(createAttempt.current.id, composeAnchor, draft);
      createAttempt.current = undefined;
      setDraft(emptyDraft);
      setDraftAnchor(undefined);
      openThread(thread.id);
      reload();
    });
  };

  const opened = threadId && detail?.thread.id === threadId ? detail : undefined;
  const replyDraft = threadId ? replyDrafts[threadId] ?? emptyDraft : emptyDraft;
  const addReply = () => {
    if (!threadId || !opened || !canComment || !replyDraft.body.trim()) return;
    void perform(async () => {
      const signature = JSON.stringify([threadId, replyDraft]);
      if (replyAttempt.current?.signature !== signature) replyAttempt.current = { signature, id: newCommandId() };
      const response = await api.reply(threadId, replyAttempt.current.id, replyDraft);
      replyAttempt.current = undefined;
      setReplyDrafts(previous => {
        const next = { ...previous };
        delete next[threadId];
        return next;
      });
      setDetail(previous => previous?.thread.id === threadId && !previous.comments.some(comment => comment.id === response.id)
        ? { ...previous, comments: [...previous.comments, response] } : previous);
      reload();
    });
  };

  const copyThreadLink = async (thread: ReviewThread) => {
    try {
      const url = new URL(`/${resourceKind}/${encodeURIComponent(boardId)}`, window.location.origin);
      url.searchParams.set('thread', thread.id);
      if (thread.anchor.currentPageId) {
        const page = { board: 'page', doc: 'block', sheet: 'sheet', slides: 'slide' }[resourceKind];
        url.searchParams.set(page, thread.anchor.currentPageId);
        if (resourceKind === 'sheet' && thread.anchor.elementId?.startsWith(thread.anchor.currentPageId + ':')) {
          url.searchParams.set('cell', thread.anchor.elementId.split(':')[1]);
        }
      }
      await navigator.clipboard.writeText(url.toString());
      setMessage(text.linkCopied);
    } catch {
      setMessage(text.copyFailed);
    }
  };

  if (!open) return null;
  return (
    <aside aria-label={text.panel} className="board-side-panel absolute bottom-24 right-3 z-[65] flex w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-[var(--glass-border-strong)] text-[var(--text-primary)] shadow-2xl sm:bottom-6"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); onClose(); }
      }}>
      <header className="flex min-h-12 items-center justify-between gap-1 border-b px-3 py-2" style={{ borderColor: 'var(--glass-border-strong)' }}>
        <h2 className="text-sm font-semibold">{text.comments}</h2>
        <div className="flex items-center">
          <button type="button" className={smallButton} aria-pressed={showNotifications} onClick={() => {
            setShowNotifications(value => !value);
            setThreadId(undefined);
            setComposing(false);
          }}>{text.notifications(listing?.unreadCount ? formatNumber(listing.unreadCount) : undefined)}</button>
          <button ref={closeButton} type="button" className="board-action-button" aria-label={text.close} onClick={onClose}><span className="size-4"><WorkbenchIcon name="close" /></span></button>
        </div>
      </header>
      {!online && <p role="status" className="border-b px-3 py-2 text-xs" style={{ borderColor: 'var(--glass-border-strong)', color: 'var(--text-secondary)' }}>
        {text.offline}
      </p>}
      {message && <p role="status" className="border-b px-3 py-2 text-xs break-words" style={{ borderColor: 'var(--glass-border-strong)', color: 'var(--text-secondary)' }}>{message}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {showNotifications ? (
          <div className="grid gap-2">
            {notifications?.length === 0 && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{text.emptyNotifications}</p>}
            {notifications?.map(item => <button key={item.commentId} type="button"
              className="rounded-xl border p-2.5 text-left text-sm hover:bg-blue-500/10"
              style={{ borderColor: 'var(--glass-border-strong)' }}
              onClick={() => {
                openThread(item.threadId);
                if (!item.readAt) void perform(async () => { await api.markRead(item.commentId); reload(); });
              }}>
              <strong className="text-xs">{item.readAt ? item.authorName : text.unreadAuthor(item.authorName)}</strong>
              <p className="mt-0.5 break-words">{item.preview}</p>
            </button>)}
          </div>
        ) : threadId ? (
          <div className="grid gap-2">
            <button type="button" className={smallButton + ' justify-self-start'} onClick={() => { setThreadId(undefined); setMessage(''); }}>{text.allThreads}</button>
            {opened ? <>
              <div className="flex flex-wrap items-center justify-between gap-1 rounded-xl border p-2" style={{ borderColor: 'var(--glass-border-strong)' }}>
                <button type="button" className={smallButton} disabled={!opened.thread.anchor.currentPageId}
                  onClick={() => onFocusAnchor(opened.thread.anchor)}>{labelFor(opened.thread.anchor, text)}</button>
                <button type="button" className={smallButton} onClick={() => { void copyThreadLink(opened.thread); }}>{text.copyLink}</button>
              </div>
              {opened.thread.canResolve && <button type="button" className={smallButton + ' justify-self-end'} disabled={busy || !online}
                onClick={() => { void perform(async () => {
                  const thread = await api.resolve(threadId, !opened.thread.resolvedAt);
                  setDetail(previous => previous?.thread.id === threadId ? { ...previous, thread } : previous);
                  reload();
                }); }}>{opened.thread.resolvedAt ? text.reopen : text.resolve}</button>}
              {opened.comments.map(comment => <article key={comment.id} className="rounded-xl border p-2.5"
                style={{ borderColor: 'var(--glass-border-strong)' }}>
                <div className="mb-1 flex items-center justify-between gap-1">
                  <strong className="min-w-0 truncate text-xs">{comment.authorName}</strong>
                  {canComment && comment.authorId === userId && editing?.original.id !== comment.id && (
                    <button type="button" className={smallButton} onClick={() => setEditing({ original: comment, draft: {
                      body: comment.body, mentionUserIds: comment.mentionUserIds ?? [],
                    } })}>{text.edit}</button>
                  )}
                </div>
                {editing?.original.id === comment.id ? <DraftEditor label={text.editComment} draft={editing.draft} people={people} disabled={busy || !online}
                  submitLabel={text.saveComment} onChange={next => setEditing({ ...editing, draft: next })}
                  onSubmit={() => { void perform(async () => {
                    const edited = await api.edit(threadId, editing.original, editing.draft);
                    setDetail(previous => previous?.thread.id === threadId ? {
                      ...previous, comments: previous.comments.map(current => current.id === edited.id ? edited : current),
                    } : previous);
                    setEditing(undefined);
                    reload();
                  }); }}>
                  <button type="button" className={smallButton + ' justify-self-end'} onClick={() => setEditing(undefined)}>{text.cancelEdit}</button>
                </DraftEditor> : <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>}
              </article>)}
              {opened.nextCursor && <button type="button" className={smallButton} disabled={busy || !online} onClick={() => {
                void perform(async () => {
                  const next = await api.thread(threadId, opened.nextCursor, AbortSignal.timeout(12_000));
                  setDetail(previous => previous?.thread.id === threadId ? { ...next, comments: [
                    ...previous.comments, ...next.comments.filter(comment => !previous.comments.some(item => item.id === comment.id)),
                  ] } : previous);
                });
              }}>{text.moreReplies}</button>}
              {opened.thread.resolvedAt ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{text.resolved}</p>
                : canComment && <DraftEditor label={text.writeReply} draft={replyDraft} people={people} disabled={busy || !online} submitLabel={text.reply}
                    onChange={next => setReplyDrafts(previous => Object.fromEntries([...Object.entries(previous).filter(([id]) => id !== threadId).slice(-29), [threadId, next]]))}
                    onSubmit={addReply} />}
            </> : <p role="status" className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message ? text.threadUnavailable : text.loadingThread}</p>}
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-1" aria-label={text.filters}>
              {filters.map(value => <button type="button" key={value} aria-pressed={filter === value}
                className={smallButton + (filter === value ? ' bg-blue-500/15' : '')} onClick={() => {
                  if (value !== filter) { setFilter(value); setListing(undefined); }
                }}>{text.filterNames[value]}</button>)}
              {canComment && !composing && <button type="button" className={accentButton + ' ml-auto'} onClick={showComposer}>{text.newThread}</button>}
            </div>
            {composing && canComment && <DraftEditor label={text.writeComment} draft={draft} people={people}
              disabled={busy || !online || pickingPoint || (anchorMode === 'point' && !pickedLocation)} submitLabel={text.post} onChange={setDraft} onSubmit={addThread}>
              <div className="flex flex-wrap gap-1">
                <button type="button" aria-pressed={anchorMode === 'page'} className={smallButton} onClick={() => {
                  setAnchorMode('page'); setDraftAnchor({ location: { pageId: page.id }, label: page.name });
                }}>{{ board: text.thisPage, doc: 'This Block', sheet: 'This Worksheet', slides: 'This Slide' }[resourceKind]}</button>
                {selectedObject && <button type="button" aria-pressed={anchorMode === 'object'} className={smallButton}
                  onClick={() => { setAnchorMode('object'); setDraftAnchor({ location: { pageId: page.id, elementId: selectedObject.id }, label: selectedObject.label }); }}>{resourceKind === 'sheet' ? 'Selected Cell' : text.selectedObject}</button>}
                {resourceKind === 'board' && <button type="button" aria-pressed={anchorMode === 'point'} className={smallButton}
                  onClick={() => { setAnchorMode('point'); onPickPoint(); }}>{text.pickPoint}</button>}
              </div>
              <p className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                {pickingPoint ? text.pickHint : anchorMode === 'point' && pickedLocation ? text.pointOnCanvas : draftAnchor?.label ?? page.name}
              </p>
            </DraftEditor>}
            {!listing && online && !message && <p role="status" className="text-sm" style={{ color: 'var(--text-secondary)' }}>{text.loading}</p>}
            {listing?.threads.length === 0 && !composing && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{text.emptyThreads[filter]}</p>}
            {listing?.threads.map(thread => <button type="button" key={thread.id} onClick={() => openThread(thread.id)}
              className="rounded-xl border p-2.5 text-left hover:bg-blue-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              style={{ borderColor: 'var(--glass-border-strong)' }}>
              <span className="flex justify-between gap-1 text-xs"><strong>{thread.authorName}</strong>
                <span style={{ color: 'var(--text-secondary)' }}>{thread.resolvedAt ? text.filterNames.resolved : labelFor(thread.anchor, text)}</span></span>
              <span className="mt-1 block max-h-16 overflow-hidden whitespace-pre-wrap break-words text-sm">{thread.body}</span>
              <span className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>{text.replies(thread.commentCount - 1, formatNumber(thread.commentCount - 1))}</span>
            </button>)}
            {listing?.nextCursor && <button type="button" className={smallButton} disabled={busy || !online} onClick={() => {
              void perform(async () => {
                const next = await api.threads(filter, listing.nextCursor, AbortSignal.timeout(12_000));
                setListing(previous => ({ ...next, threads: [...(previous?.threads ?? []), ...next.threads] }));
              });
            }}>{text.moreThreads}</button>}
          </div>
        )}
      </div>
      {!canComment && <p className="border-t px-3 py-2 text-xs" style={{ borderColor: 'var(--glass-border-strong)', color: 'var(--text-secondary)' }}>{text.readOnly}</p>}
    </aside>
  );
}
