import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../../lib/api';
import { boardFonts, useBoardFont } from '../../lib/boardFonts';
import { useBoardSync, type BoardDocument, type DocumentMutation } from '../../lib/boardSync';
import { docBlocks, downloadDoc, maxDocBlockBytes, maxDocBlocks, newDocBlock, type DocBlock, type DocFormat } from '../../lib/docs';
import { resourcePath } from '../../lib/directory';
import { useTheme } from '../../lib/useTheme';
import { recordRecentBoard } from '../../lib/workshop';
import { useAuth } from '../AuthContext';
import AccountPopover from '../workbench/AccountPopover';
import WorkbenchIcon from '../workbench/WorkbenchIcon';
import BoardSharingDialog from '../BoardSharingDialog';
import BoardReviewPanel from '../collaboration/BoardReviewPanel';
import BoardSyncNotice from '../collaboration/BoardSyncNotice';
import BoardVersionsPanel from '../collaboration/BoardVersionsPanel';
import DocMarkup from './DocMarkup';
import './docs.css';

const emptyPages: BoardDocument['pages'] = [];
const encoder = new TextEncoder();

interface Draft {
  id: string;
  value: string;
  expected: string;
  epoch?: number;
}

function textPatch(id: string, value: string, expected: string): DocumentMutation {
  return { kind: 'patch', collection: 'pages', id, fields: { text: value }, expected: { text: expected } };
}

function blockType(text: string) {
  const head = /^(#{1,6}) +/.exec(text);
  if (head) return 'h' + head[1].length;
  if (/^\s*[-*+] /.test(text)) return 'bullet';
  if (/^\s*\d+[.)] /.test(text)) return 'ordered';
  if (/^> ?/.test(text)) return 'quote';
  if (/^`{3,}/.test(text)) return 'code';
  return 'paragraph';
}

function withBlockType(text: string, style: string) {
  const stripped = text.replace(/^(?:#{1,6} +|[-*+] +|\d+[.)] +|> ?)/, '')
    .replace(/^`{3,}[^\n]*\n([\s\S]*?)\n`{3,}$/, '$1');
  switch (style) {
    case 'bullet': return '- ' + stripped;
    case 'ordered': return '1. ' + stripped;
    case 'quote': return '> ' + stripped;
    case 'code': {
      const runs = [...stripped.matchAll(/`+/g)].map(match => match[0].length);
      const fence = '`'.repeat(Math.max(3, ...runs.map(length => length + 1)));
      return fence + '\n' + stripped + '\n' + fence;
    }
    default: return /^h[1-6]$/.test(style) ? '#'.repeat(Number(style[1])) + ' ' + stripped : stripped;
  }
}

function Title({ name, editable, onSave, setDirty }: {
  name: string; editable: boolean; onSave: (value: string, expected: string) => void; setDirty: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState<{ text: string; expected: string }>();
  const cancelled = useRef(false);
  return <h1 className="doc-title">{editable ? <input
    aria-label="Document Title" value={draft?.text ?? name} maxLength={255}
    onChange={event => { setDraft({ text: event.target.value, expected: draft?.expected ?? name }); setDirty(true); }}
    onBlur={() => {
      if (!cancelled.current && draft?.text.trim() && draft.text.trim() !== draft.expected) onSave(draft.text.trim(), draft.expected);
      cancelled.current = false;
      setDraft(undefined);
      setDirty(false);
    }}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        cancelled.current = event.key === 'Escape';
        event.currentTarget.blur();
      }
    }} /> : name}</h1>;
}

function BlockInput({ block, number, value, onChange, onBlur, onKeyDown, inputRef }: {
  block: DocBlock; number: number; value: string; onChange: (text: string) => void;
  onBlur: () => void; onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const fontFamily = useBoardFont(block.fontFamily);
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    const measure = () => {
      const top = node.scrollTop;
      node.style.height = 'auto';
      node.style.height = Math.min(600, node.scrollHeight + 2) + 'px';
      node.scrollTop = top;
    };
    measure();
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== width) { width = node.clientWidth; measure(); }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [inputRef, value, fontFamily]);
  return <textarea className="doc-block-input" ref={inputRef} rows={1} style={{ fontFamily }} value={value}
    aria-label={`Block ${number}`} placeholder="Start writing…" onChange={event => onChange(event.target.value)}
    onBlur={onBlur} onKeyDown={onKeyDown} />;
}

function versionPreview(document: BoardDocument) {
  return <div className="doc-version-preview">{docBlocks(document.pages).map(block => <DocMarkup key={block.id} block={block} />)}</div>;
}

function blockElement(id: string) {
  return document.getElementById('doc-block-' + id);
}

export default function OpenJamDoc({ docId, user }: { docId: string; user: User }) {
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedBlock = params.get('block') ?? params.get('page');
  const initialThread = params.get('thread') ?? undefined;
  const returnPath = typeof location.state?.workshop === 'string' && /^\/workplace(?:\?|$)/.test(location.state.workshop)
    ? location.state.workshop : '/workplace?view=recents';
  const [documentState, setDocument] = useState<BoardDocument>();
  const acceptDocument = useCallback((value: BoardDocument) => setDocument(value), []);
  const sync = useBoardSync({ boardId: docId, userId: user.id, onDocument: acceptDocument });
  const { enqueue, epoch } = sync;
  const pages = documentState?.pages ?? emptyPages;
  const blocks = useMemo(() => docBlocks(pages), [pages]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedBlock);
  const [preview, setPreview] = useState(false);
  const [panel, setPanel] = useState<'history' | 'comments' | 'share' | null>(initialThread ? 'comments' : null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const draftRef = useRef<Draft | undefined>(undefined);
  const titleDirty = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const focusBlock = useRef<string | null>(null);
  const lastAnchor = useRef<string | null>(null);
  const recorded = useRef(false);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const blockMenu = useRef<HTMLDetailsElement>(null);
  const active = blocks.find(block => block.id === selectedId) ?? blocks[0];
  const index = active ? blocks.indexOf(active) : -1;
  const canEdit = sync.canEdit && sync.resourceKind === 'doc';
  const canShow = sync.resourceKind === 'doc' && blocks.length > 0 && sync.status !== 'revoked';
  const draftNeedsReview = Boolean(draft && canShow &&
    (!canEdit || draft.epoch !== epoch || !blocks.some(block => block.id === draft.id)));
  const canWrite = canEdit && !draftNeedsReview;
  const contentReady = sync.status === 'synced' && !draft && !exporting;
  const status = sync.status === 'synced' ? 'Saved'
    : sync.status === 'offline' ? 'Offline'
      : sync.status === 'conflict' ? 'Review Needed'
        : sync.status === 'error' || sync.status === 'revoked' ? 'Unavailable' : 'Syncing…';

  const clearDraft = useCallback(() => {
    draftRef.current = undefined;
    setDraft(undefined);
  }, []);

  const flush = useCallback(async () => {
    const pending = draftRef.current;
    if (!pending) return true;
    if (!canWrite || pending.epoch !== epoch) return false;
    clearDraft();
    if (pending.value === pending.expected) return true;
    return enqueue([textPatch(pending.id, pending.value, pending.expected)]);
  }, [canWrite, clearDraft, enqueue, epoch]);

  useEffect(() => {
    if (!draft) return;
    const timer = window.setTimeout(() => void flush(), 520);
    return () => window.clearTimeout(timer);
  }, [draft, flush]);

  useEffect(() => {
    if (sync.status === 'revoked') clearDraft();
  }, [clearDraft, sync.status]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (draftRef.current || titleDirty.current) event.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    if (!canShow || recorded.current) return;
    recorded.current = true;
    void recordRecentBoard(docId).catch(() => { recorded.current = false; });
  }, [canShow, docId]);

  useEffect(() => {
    if (!requestedBlock || requestedBlock === lastAnchor.current || !blocks.some(block => block.id === requestedBlock)) return;
    const node = blockElement(requestedBlock);
    if (!node) return;
    lastAnchor.current = requestedBlock;
    node.scrollIntoView({ block: 'center' });
  }, [blocks, requestedBlock]);

  useLayoutEffect(() => {
    if (!active || focusBlock.current !== active.id || !input.current) return;
    focusBlock.current = null;
    input.current.focus();
    input.current.setSelectionRange(0, 0);
  }, [active, preview]);

  function select(block: DocBlock, focus = false) {
    void flush();
    setSelectedId(block.id);
    if (focus && canWrite) {
      if (active?.id === block.id && !preview && input.current) input.current.focus();
      else focusBlock.current = block.id;
      setPreview(false);
    }
  }

  function change(block: DocBlock, value: string) {
    if (encoder.encode(value).byteLength > maxDocBlockBytes) {
      setActionError('This block is full. Add another block to continue.');
      return;
    }
    setActionError('');
    const previous = draftRef.current;
    const pending = {
      id: block.id, value, expected: previous?.id === block.id ? previous.expected : block.text,
      epoch: sync.epoch,
    };
    draftRef.current = pending;
    setDraft(pending);
  }

  async function addBlock(splitAt?: [number, number]) {
    if (!active || !canWrite || blocks.length >= maxDocBlocks) return;
    const staged = draftRef.current;
    const value = staged?.id === active.id ? staged.value : active.text;
    const expected = staged?.id === active.id ? staged.expected : active.text;
    const next = newDocBlock(splitAt ? value.slice(splitAt[1]) : '', active.fontFamily);
    const operations: DocumentMutation[] = [];
    if (splitAt) {
      if (staged && staged.epoch !== sync.epoch) return;
      const left = value.slice(0, splitAt[0]);
      if (left !== expected) operations.push(textPatch(active.id, left, expected));
      clearDraft();
    } else if (!await flush()) return;
    operations.push({ kind: 'add', collection: 'pages', id: next.id, value: next, position: index + 1 });
    focusBlock.current = next.id;
    setSelectedId(next.id);
    await sync.enqueue(operations);
  }

  async function adjustBlock(direction: -1 | 1 | 'delete') {
    blockMenu.current?.removeAttribute('open');
    if (!active || !canWrite || !await flush()) return;
    if (direction === 'delete') {
      if (blocks.length <= 1) return;
      const expected = { ...active, text: draft?.id === active.id ? draft.value : active.text };
      setSelectedId(blocks[index + 1]?.id ?? blocks[index - 1].id);
      await sync.enqueue([{ kind: 'delete', collection: 'pages', id: active.id, expected }]);
    } else if (index + direction >= 0 && index + direction < blocks.length) {
      await sync.enqueue([{ kind: 'reorder', collection: 'pages', id: active.id,
        position: index + direction, expected: { order: blocks.map(block => block.id) } }]);
    }
  }

  function applyInline(marker: string) {
    if (!active || !input.current) return;
    const node = input.current;
    const { selectionStart: start, selectionEnd: end, value } = node;
    change(active, value.slice(0, start) + marker + value.slice(start, end) + marker + value.slice(end));
    requestAnimationFrame(() => {
      if (!node.isConnected) return;
      node.focus();
      node.setSelectionRange(start + marker.length, end + marker.length);
    });
  }

  async function exportFile(format: DocFormat) {
    exportMenu.current?.removeAttribute('open');
    if (!contentReady || !documentState) return;
    setExporting(true);
    setActionError('');
    try {
      await downloadDoc(docId, documentState.name, format);
      setNotice('Export downloaded.');
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'The export could not be downloaded.');
    } finally {
      setExporting(false);
    }
  }

  function focusSource(id: string) {
    const target = blocks.find(block => block.id === id);
    if (!target) return;
    select(target);
    blockElement(id)?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }

  if (sync.resourceKind && sync.resourceKind !== 'doc') return <Navigate replace to={resourcePath(sync.resourceKind, docId) + location.search} />;

  const activeText = active && (draft?.id === active.id ? draft.value : active.text);
  const outline = blocks.flatMap(block => {
    const heading = /^(#{1,6}) +([^\n]+)/.exec(block.text);
    return heading ? [{ id: block.id, label: heading[2], level: heading[1].length }] : [];
  });

  return <main className="openjam-doc" aria-label="Document Editor">
    <header className="doc-header">
      <Link className="doc-icon" aria-label="Back to Workshop" title="Back to Workshop" to={returnPath} onClick={event => {
        if (draftRef.current) {
          event.preventDefault();
          void flush().then(saved => { if (saved) navigate(returnPath); });
        }
      }}><WorkbenchIcon name="back" /></Link>
      <span className="doc-crumb"><WorkbenchIcon name="document" /><span>{canShow ? documentState?.name : 'Document'}</span></span>
      {canShow && <>
        <span className="doc-sync" role="status" data-state={sync.status}>
          <i />{draft ? 'Editing…' : status}
        </span>
        <div className="doc-presence" aria-label="Collaborators">
          {sync.collaborators.slice(0, 4).map(person => <span className="doc-avatar" key={person.id} title={person.displayName}
            aria-label={person.displayName} role="img" style={{ backgroundColor: person.avatarColor }}>{person.displayName.slice(0, 1).toUpperCase()}</span>)}
          {sync.collaborators.length > 4 && <span className="doc-avatar">+{sync.collaborators.length - 4}</span>}
        </div>
        <div className="doc-top-actions">
          <button type="button" className="doc-icon" aria-label="Comments" title="Comments" aria-pressed={panel === 'comments'}
            onClick={() => setPanel(current => current === 'comments' ? null : 'comments')}><WorkbenchIcon name="message" /></button>
          <button type="button" className="doc-icon" aria-label="Document History" title="History" aria-pressed={panel === 'history'}
            onClick={() => { void flush(); setPanel(current => current === 'history' ? null : 'history'); }}><WorkbenchIcon name="recent" /></button>
          <details className="doc-dropdown" ref={exportMenu}>
            <summary className="doc-icon" aria-label="Export Document" title="Export"><WorkbenchIcon name="download" /></summary>
            <div className="doc-menu">
              <button type="button" disabled={!contentReady} onClick={() => void exportFile('md')}>Markdown</button>
              <button type="button" disabled={!contentReady} onClick={() => void exportFile('docx')}>Word (.docx)</button>
              {!contentReady && <span className="doc-muted">Available when saved.</span>}
            </div>
          </details>
          <button type="button" className="doc-icon" aria-label="Share Document" title="Share" onClick={() => setPanel('share')}><WorkbenchIcon name="shared" /></button>
        </div>
      </>}
      <AccountPopover user={user} theme={theme} setTheme={setTheme}
        onLogout={async () => {
          if (draftRef.current && !await flush()) throw new Error('Copy or discard the current draft before signing out.');
          await logout();
        }} />
    </header>

    <BoardSyncNotice state={sync} resourceKind="doc" onRetry={() => void sync.retry()} onExportDraft={sync.exportDraft}
      onDiscard={() => { clearDraft(); void sync.discardConflict(sync.conflict?.commandId); }} />
    {!canShow && (sync.status === 'loading' || sync.status === 'catching-up') && <p className="doc-empty" role="status">Opening document…</p>}
    {canShow && active && <div className="doc-scroll">
      {canWrite && <div className="doc-tools" role="toolbar" aria-label="Document Tools">
        {preview ? <button type="button" className="doc-edit-action" aria-label="Edit Document" onClick={() => setPreview(false)}>
          <WorkbenchIcon name="pencil" />Edit
        </button> : <>
        <button type="button" className="doc-tool" aria-label="Undo" title="Undo" disabled={!sync.canUndo && !draft}
          onClick={() => void flush().then(saved => saved && sync.undo())}><WorkbenchIcon name="undo" /></button>
        <button type="button" className="doc-tool" aria-label="Redo" title="Redo" disabled={!sync.canRedo}
          onClick={() => void flush().then(saved => saved && sync.redo())}><WorkbenchIcon name="redo" /></button>
        <span className="doc-tools-divider" aria-hidden="true" />
        <select className="doc-select" aria-label="Block Style" title="Block Style" value={blockType(activeText ?? '')} disabled={preview}
          onChange={event => { change(active, withBlockType(activeText ?? '', event.target.value)); input.current?.focus(); }}>
          <option value="paragraph">Paragraph</option>
          {[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={'h' + level}>Heading {level}</option>)}
          <option value="bullet">Bullet List</option><option value="ordered">Numbered List</option>
          <option value="quote">Quote</option><option value="code">Code</option>
        </select>
        <select className="doc-select doc-font" aria-label="Font Family" title="Font Family" value={active.fontFamily} disabled={preview}
          onChange={event => void sync.enqueue([{ kind: 'patch', collection: 'pages', id: active.id,
            fields: { fontFamily: event.target.value }, expected: { fontFamily: active.fontFamily } }])}>
          {boardFonts.map(font => <option key={font.family} value={font.family}>{font.label}</option>)}
        </select>
        <button type="button" className="doc-tool doc-bold" aria-label="Bold" title="Bold" disabled={preview}
          onPointerDown={event => event.preventDefault()} onClick={() => applyInline('**')}>B</button>
        <button type="button" className="doc-tool doc-italic" aria-label="Italic" title="Italic" disabled={preview}
          onPointerDown={event => event.preventDefault()} onClick={() => applyInline('*')}>I</button>
        <span className="doc-tools-divider" aria-hidden="true" />
        <button type="button" className="doc-tool" aria-label="Preview Document" title="Preview"
          onClick={() => void flush().then(saved => { if (saved) setPreview(true); })}>
          <WorkbenchIcon name="preview" />
        </button>
        <button type="button" className="doc-tool" aria-label="Add Block" title="Add Block" disabled={blocks.length >= maxDocBlocks || preview}
          onClick={() => void addBlock()}><WorkbenchIcon name="plus" /></button>
        <details className="doc-dropdown" ref={blockMenu}>
          <summary className="doc-tool" aria-label="Block Actions" title="Block Actions"><WorkbenchIcon name="more" /></summary>
          <div className="doc-menu">
            <button type="button" disabled={preview || index < 1} onClick={() => void adjustBlock(-1)}><WorkbenchIcon name="up" />Move Up</button>
            <button type="button" disabled={preview || index === blocks.length - 1} onClick={() => void adjustBlock(1)}><WorkbenchIcon name="down" />Move Down</button>
            <button type="button" disabled={preview || blocks.length < 2} onClick={() => void adjustBlock('delete')}><WorkbenchIcon name="trash" />Delete Block</button>
          </div>
        </details>
        </>}
      </div>}
      {draftNeedsReview && draft && <div className="doc-draft-review" role="alert">
        <p>The document changed while you were editing. Your draft is still on this device.</p>
        <textarea aria-label="Unsaved Block" readOnly value={draft.value} rows={3} />
        <button type="button" className="doc-edit-action" onClick={clearDraft}>Discard Draft</button>
      </div>}
      {actionError && <p className="doc-feedback" role="alert">{actionError}</p>}
      {notice && <p className="doc-feedback" role="status">{notice}</p>}
      <div className="doc-reading" data-outline={outline.length > 0}>
        {outline.length > 0 && <nav className="doc-outline" aria-label="Document Outline">
          {outline.map(item => <button key={item.id} type="button" data-level={item.level}
            onClick={() => focusSource(item.id)}>{item.label}</button>)}
        </nav>}
        <article className="doc-sheet" aria-label="Document Content">
          <Title name={documentState?.name ?? ''} editable={canWrite && !preview}
            setDirty={value => { titleDirty.current = value; }}
            onSave={(value, expected) => { void sync.enqueue([{ kind: 'rename', value, expected: { name: expected } }]); }} />
          {blocks.map((block, position) => {
            const focused = active.id === block.id;
            const editing = focused && canWrite && !preview;
            return <section key={block.id} id={'doc-block-' + block.id} className="doc-block"
              data-active={focused && !preview} data-source={block.id === requestedBlock}
              onClick={event => {
                if (!editing && !(event.target instanceof Element && event.target.closest('a, button'))) select(block, canWrite && !preview);
              }}>
              {!editing && <DocMarkup block={block} />}
              {editing && <BlockInput block={block} number={position + 1} value={activeText ?? ''} inputRef={input}
                onChange={value => change(block, value)} onBlur={() => void flush()}
                onKeyDown={event => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || blocks.length >= maxDocBlocks) return;
                  event.preventDefault();
                  const { selectionStart, selectionEnd } = event.currentTarget;
                  void addBlock([selectionStart, selectionEnd]);
                }} />}
              {!editing && <button type="button" className="doc-block-select" aria-label={(canWrite && !preview ? 'Edit' : 'Select') + ` Block ${position + 1}`}
                title={canWrite && !preview ? 'Edit Block' : 'Select Block'} onClick={() => select(block, canWrite && !preview)}>
                <WorkbenchIcon name={canWrite && !preview ? 'pencil' : 'text'} />
              </button>}
            </section>;
          })}
        </article>
      </div>
    </div>}
    {canShow && active && panel === 'comments' && <BoardReviewPanel open boardId={docId} userId={user.id}
      resourceKind="doc" canComment={sync.permission !== 'view'} online={sync.status !== 'offline'}
      epoch={sync.epoch} page={{ id: active.id, name: `Block ${index + 1}` }} pickingPoint={false}
      initialThreadId={initialThread} onPickPoint={() => undefined} onFocusAnchor={anchor => {
        if (anchor.currentPageId) focusSource(anchor.currentPageId);
      }} onClose={() => setPanel(null)} />}
    {canShow && panel === 'history' && <BoardVersionsPanel boardId={docId} resourceKind="doc" renderPreview={versionPreview}
      permission={sync.permission} epoch={sync.epoch} seq={sync.seq} pendingCount={sync.pendingCount}
      online={sync.status === 'synced'} onRestore={sync.retry} onOpenBoard={id => navigate(resourcePath('doc', id))}
      onClose={() => setPanel(null)} />}
    {canShow && panel === 'share' && <BoardSharingDialog isOpen resourceKind="doc" boardId={docId}
      boardName={documentState?.name ?? ''} onClose={() => setPanel(null)} />}
  </main>;
}
