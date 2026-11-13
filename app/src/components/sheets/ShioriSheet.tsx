import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../../lib/api';
import type { ReviewAnchor } from '../../lib/boardReview';
import { useBoardSync, type BoardDocument } from '../../lib/boardSync';
import { MAX_COMMAND_OPERATIONS } from '../../lib/boardSyncProtocol';
import { resourcePath } from '../../lib/directory';
import { newRequestId } from '../../lib/requestId';
import {
  asSheetCell, blankCell, cellAddress, cellEdit, cellValue, downloadSheet, editorText, inputFromEditor, maxCellBytes,
  nextCell, parseCellAddress, sheetColumns, sheetRows, sheetTabs, worksheets,
  type CellPosition, type CellValue, type SheetCell, type SheetFormat, type SheetTab,
} from '../../lib/sheets';
import { useTheme } from '../../lib/useTheme';
import { recordRecentBoard } from '../../lib/workshop';
import { useAuth } from '../AuthContext';
import BoardSharingDialog from '../BoardSharingDialog';
import BoardReviewPanel from '../collaboration/BoardReviewPanel';
import BoardSyncNotice from '../collaboration/BoardSyncNotice';
import BoardVersionsPanel from '../collaboration/BoardVersionsPanel';
import AccountPopover from '../workbench/AccountPopover';
import WorkbenchDialog from '../workbench/WorkbenchDialog';
import WorkbenchIcon from '../workbench/WorkbenchIcon';
import SheetGrid from './SheetGrid';
import '../docs/docs.css';
import './sheets.css';

const firstCell: CellPosition = { row: 0, col: 0 };
const emptyTabs: SheetTab[] = [];
const encoder = new TextEncoder();

type Draft = { text: string; expected: CellValue; position: CellPosition; tab: string; epoch?: number };

function cellsForTab(document: BoardDocument | undefined, tab: string | undefined) {
  const cells = new Map<string, SheetCell>();
  if (tab) {
    for (const element of document?.elements ?? []) {
      const cell = asSheetCell(element);
      if (cell?.pageId === tab) cells.set(cell.address, cell);
    }
  }
  return cells;
}

function SheetPreview({ document }: { document: BoardDocument }) {
  const tabs = worksheets(document.pages);
  const [tabId, setTabId] = useState(document.defaultPageId);
  const [position, setPosition] = useState(firstCell);
  const tab = tabs.find(candidate => candidate.id === tabId) ?? tabs[0];
  const cells = useMemo(() => cellsForTab(document, tab?.id), [document, tab?.id]);
  if (!tab) return null;
  return <section className="sheet-version-preview" aria-label="Spreadsheet Preview">
    <SheetGrid name={tab.name + ' Preview'} cells={cells} selection={position} onSelect={setPosition} />
    <div className="sheet-tabs" aria-label="Preview Worksheets">
      {tabs.map(item => <button type="button" key={item.id} aria-pressed={tab.id === item.id}
        onClick={() => { setTabId(item.id); setPosition(firstCell); }}>{item.name}</button>)}
    </div>
  </section>;
}

function previewVersion(document: BoardDocument) {
  return <SheetPreview key={document.defaultPageId + ':' + document.name} document={document} />;
}

export default function ShioriSheet({ sheetId, user }: { sheetId: string; user: User }) {
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedTab = params.get('sheet');
  const requestedCell = params.get('cell');
  const initialThread = params.get('thread') ?? undefined;
  const returnPath = typeof location.state?.workshop === 'string' && /^\/workplace(?:\?|$)/.test(location.state.workshop)
    ? location.state.workshop : '/workplace?view=recents';

  const [documentState, setDocument] = useState<BoardDocument>();
  const acceptDocument = useCallback((document: BoardDocument) => setDocument(document), []);
  const sync = useBoardSync({ boardId: sheetId, userId: user.id, onDocument: acceptDocument });
  const tabs = useMemo(() => documentState ? worksheets(documentState.pages) : emptyTabs, [documentState]);
  const [selection, setSelection] = useState({ tab: requestedTab ?? '', position: parseCellAddress(requestedCell) ?? firstCell });
  const tab = tabs.find(candidate => candidate.id === selection.tab) ?? tabs.find(candidate => candidate.id === documentState?.defaultPageId) ?? tabs[0];
  const cells = useMemo(() => cellsForTab(documentState, tab?.id), [documentState, tab?.id]);
  const address = cellAddress(selection.position);
  const selectedCell = cells.get(address);
  const [draft, setDraft] = useState<Draft>();
  const draftRef = useRef<Draft | undefined>(undefined);
  const grid = useRef<HTMLDivElement>(null);
  const formula = useRef<HTMLTextAreaElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const recordedRecent = useRef(false);
  const anchorApplied = useRef<string | null>(null);
  const [panel, setPanel] = useState<'history' | 'comments' | 'share' | null>(initialThread ? 'comments' : null);
  const [dialog, setDialog] = useState<{ mode: 'rename' | 'add'; trigger: HTMLElement | null }>();
  const [dialogError, setDialogError] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const canShow = sync.resourceKind === 'sheet' && !!tab && sync.status !== 'revoked';
  const canEdit = canShow && sync.canEdit;
  const dirty = !!draft && draft.text !== editorText(draft.expected);
  const draftNeedsReview = dirty && (!canEdit || draft.epoch !== sync.epoch || !tabs.some(candidate => candidate.id === draft.tab));
  const canWrite = canEdit && !draftNeedsReview;
  const selectedSource = Boolean(requestedCell && tab?.id === requestedTab && address === requestedCell.toUpperCase());
  const status = sync.status === 'synced' ? 'Saved' : sync.status === 'offline' ? 'Offline'
    : sync.status === 'conflict' ? 'Review Needed'
      : sync.status === 'error' ? 'Unavailable' : 'Syncing…';

  const updateDraft = useCallback((value: Draft | undefined) => {
    draftRef.current = value;
    setDraft(value);
  }, []);

  useEffect(() => {
    if (sync.status === 'revoked') updateDraft(undefined);
  }, [sync.status, updateDraft]);

  useEffect(() => {
    if (!canShow || recordedRecent.current) return;
    recordedRecent.current = true;
    void recordRecentBoard(sheetId).catch(() => { recordedRecent.current = false; });
  }, [canShow, sheetId]);

  useEffect(() => {
    if (!canShow || !requestedTab || anchorApplied.current === location.key) return;
    const target = tabs.find(candidate => candidate.id === requestedTab);
    if (!target) return;
    anchorApplied.current = location.key;
    setSelection({ tab: target.id, position: parseCellAddress(requestedCell) ?? firstCell });
    grid.current?.focus({ preventScroll: true });
  }, [canShow, location.key, requestedCell, requestedTab, tabs]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      const edit = draftRef.current;
      if (edit && edit.text !== editorText(edit.expected)) event.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  function flushDraft(): Promise<boolean> {
    const current = draftRef.current;
    if (!current) return Promise.resolve(true);
    if (current.text === editorText(current.expected)) {
      updateDraft(undefined);
      return Promise.resolve(true);
    }
    if (!canWrite || current.epoch !== sync.epoch) return Promise.resolve(false);
    const value = inputFromEditor(current.text);
    if (encoder.encode(value.input).length > maxCellBytes) {
      setError('A cell can contain up to 1,024 bytes.');
      return Promise.resolve(false);
    }
    updateDraft(undefined);
    setError('');
    return sync.enqueue([cellEdit(current.tab, cellAddress(current.position), value, current.expected)]);
  }

  function select(position: CellPosition, page = tab?.id) {
    if (!page) return;
    if (!draftRef.current) {
      setSelection({ tab: page, position });
      return;
    }
    void flushDraft().then(saved => { if (saved) setSelection({ tab: page, position }); });
  }

  function edit(position: CellPosition, replacement?: string) {
    if (!canWrite || !tab) return;
    const expected = cellValue(cells.get(cellAddress(position)));
    const current = draftRef.current;
    if (current && current.tab === tab.id && cellAddress(current.position) === cellAddress(position)) {
      if (replacement !== undefined) updateDraft({ ...current, text: replacement });
      return;
    }
    setSelection({ tab: tab.id, position });
    updateDraft({ text: replacement ?? editorText(expected), expected, position, tab: tab.id, epoch: sync.epoch });
  }

  function editFromGrid(position: CellPosition, replacement?: string) {
    const current = draftRef.current;
    if (current && (current.tab !== tab?.id || cellAddress(current.position) !== cellAddress(position))) return;
    edit(position, replacement);
    requestAnimationFrame(() => {
      const control = formula.current;
      control?.focus({ preventScroll: true });
      if (control) control.setSelectionRange(control.value.length, control.value.length);
    });
  }

  function formulaKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      updateDraft(undefined);
      setError('');
      grid.current?.focus({ preventScroll: true });
    } else if (event.key === 'Enter' && !event.shiftKey || event.key === 'Tab' && !!draftRef.current) {
      event.preventDefault();
      const position = event.key === 'Enter' ? nextCell(selection.position, 1, 0)
        : nextCell(selection.position, 0, event.shiftKey ? -1 : 1);
      void flushDraft().then(saved => {
        if (!saved) return;
        select(position);
        grid.current?.focus({ preventScroll: true });
      });
    }
  }

  function clearCell() {
    if (canWrite && tab && selectedCell) void sync.enqueue([cellEdit(tab.id, address, blankCell, cellValue(selectedCell))]);
  }

  function paste(text: string) {
    if (!canWrite || !tab || draftRef.current) return;
    const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(row => row.split('\t'));
    if (rows.reduce((count, row) => count + row.length, 0) > MAX_COMMAND_OPERATIONS) {
      setError('Paste up to 256 cells at a time.');
      return;
    }
    const start = selection.position;
    const edits = [];
    for (const [r, row] of rows.entries()) {
      for (const [c, text] of row.entries()) {
        if (start.row + r >= sheetRows || start.col + c >= sheetColumns) {
          setError('The pasted cells must fit within A1:AZ1000.');
          return;
        }
        const destination = cellAddress({ row: start.row + r, col: start.col + c });
        const value = inputFromEditor(text);
        if (encoder.encode(value.input).length > maxCellBytes) {
          setError('A pasted cell exceeds 1,024 bytes.');
          return;
        }
        const expected = cellValue(cells.get(destination));
        if (value.input !== expected.input || value.valueType !== expected.valueType) edits.push(cellEdit(tab.id, destination, value, expected));
      }
    }
    setError('');
    if (edits.length) void sync.enqueue(edits);
  }

  async function exportFile(format: SheetFormat) {
    if (sync.status !== 'synced' || !documentState || !tab || dirty || exporting) return;
    if (exportMenu.current) exportMenu.current.open = false;
    setExporting(true);
    setError('');
    try {
      await downloadSheet(sheetId, documentState.name, format, tab.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Export could not be downloaded.');
    } finally {
      setExporting(false);
    }
  }

  async function copyCellLink() {
    if (!tab) return;
    const url = new URL(resourcePath('sheet', sheetId), window.location.origin);
    url.search = new URLSearchParams({ sheet: tab.id, cell: address }).toString();
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice('Cell link copied.');
    } catch {
      setNotice(url.href);
    }
  }

  function showDialog(mode: 'rename' | 'add', trigger: HTMLElement) {
    setDialogError('');
    setDialog({ mode, trigger });
  }

  async function submitDialog(name: string) {
    if (!dialog || !documentState || !canWrite) return;
    setDialogBusy(true);
    setDialogError('');
    try {
      if (dialog.mode === 'add') {
        if (name.length > 31 || Array.from(name).some(char => '[]:*?/\\'.includes(char)) || name.startsWith("'") || name.endsWith("'")) {
          setDialogError('Use 1–31 characters without Excel’s reserved characters.');
          return;
        }
        if (tabs.some(tab => tab.name.toLowerCase() === name.toLowerCase())) {
          setDialogError('A worksheet already uses that name.');
          return;
        }
        const tab: SheetTab = { id: newRequestId(), name, sheetTab: true };
        if (!await sync.enqueue([{ kind: 'add', collection: 'pages', id: tab.id, value: tab }])) return;
        select(firstCell, tab.id);
      } else if (name !== documentState.name &&
        !await sync.enqueue([{ kind: 'rename', value: name, expected: { name: documentState.name } }])) {
        return;
      }
      setDialog(undefined);
    } finally {
      setDialogBusy(false);
    }
  }

  function focusAnchor(anchor: ReviewAnchor) {
    const target = anchor.currentPageId;
    if (!target) return;
    const reference = anchor.elementId?.startsWith(target + ':') ? anchor.elementId.split(':')[1] : null;
    select(parseCellAddress(reference) ?? firstCell, target);
    grid.current?.focus({ preventScroll: true });
  }

  if (sync.resourceKind && sync.resourceKind !== 'sheet') {
    return <Navigate replace to={resourcePath(sync.resourceKind, sheetId) + location.search} />;
  }
  const readyToExport = sync.status === 'synced' && !dirty && !exporting;
  const title = canShow ? documentState?.name ?? 'Spreadsheet' : 'Spreadsheet';
  const formulaText = draft?.tab === tab?.id && draft ? draft.text : editorText(cellValue(selectedCell));
  let suggestedTab = tabs.length + 1;
  while (tabs.some(tab => tab.name.toLowerCase() === 'sheet' + suggestedTab)) suggestedTab++;

  return <main className="shiori-doc shiori-sheet" aria-label="Spreadsheet Editor">
    <header className="doc-header">
      <Link className="doc-icon" aria-label="Back to Workshop" title="Back to Workshop" to={returnPath}
        onClick={event => {
          if (!draftRef.current) return;
          event.preventDefault();
          void flushDraft().then(saved => { if (saved) navigate(returnPath); });
        }}><WorkbenchIcon name="back" /></Link>
      <div className="doc-crumb">
        <WorkbenchIcon name="sheet" />
        {canWrite ? <button type="button" className="sheet-title" aria-label="Rename Spreadsheet"
          title="Rename Spreadsheet" onClick={event => showDialog('rename', event.currentTarget)}>{title}</button>
          : <span>{title}</span>}
      </div>
      {canShow && <>
        <span className="doc-sync" role="status" data-state={dirty ? 'editing' : sync.status}
          title={dirty ? 'Editing…' : status}><i /><span>{dirty ? 'Editing…' : status}</span></span>
        <div className="doc-presence" aria-label="Collaborators">
          {sync.collaborators.slice(0, 4).map(person => <span className="doc-avatar" key={person.id}
            title={person.displayName} aria-label={person.displayName} role="img" style={{ backgroundColor: person.avatarColor }}>
            {person.displayName.slice(0, 1).toUpperCase()}
          </span>)}
          {sync.collaborators.length > 4 && <span className="doc-avatar">+{sync.collaborators.length - 4}</span>}
        </div>
        <div className="doc-top-actions">
          <button type="button" className="doc-icon" aria-label="Comments" title="Comments" aria-pressed={panel === 'comments'}
            onClick={() => setPanel(panel === 'comments' ? null : 'comments')}><WorkbenchIcon name="message" /></button>
          <button type="button" className="doc-icon" aria-label="Spreadsheet History" title="History" aria-pressed={panel === 'history'}
            onClick={() => setPanel(panel === 'history' ? null : 'history')}><WorkbenchIcon name="recent" /></button>
          <details className="doc-dropdown" ref={exportMenu}>
            <summary className="doc-icon" aria-label="Export Spreadsheet" title="Export"><WorkbenchIcon name="download" /></summary>
            <div className="doc-menu">
              <button type="button" disabled={!readyToExport} onClick={() => void exportFile('xlsx')}>Excel (.xlsx)</button>
              <button type="button" disabled={!readyToExport} onClick={() => void exportFile('csv')}>Current Sheet (.csv)</button>
              {!readyToExport && <span className="doc-muted">Available when saved.</span>}
            </div>
          </details>
          <button type="button" className="doc-icon" aria-label="Share Spreadsheet" title="Share"
            onClick={() => setPanel('share')}><WorkbenchIcon name="shared" /></button>
        </div>
      </>}
      <AccountPopover user={user} theme={theme} setTheme={setTheme}
        onLogout={async () => {
          if (!await flushDraft()) throw new Error('Copy or discard the current cell draft before signing out.');
          await logout();
        }} />
    </header>
    <BoardSyncNotice state={sync} resourceKind="sheet" onRetry={() => void sync.retry()} onExportDraft={sync.exportDraft}
      onDiscard={() => { updateDraft(undefined); void sync.discardConflict(sync.conflict?.commandId); }} />
    {!canShow && (sync.status === 'loading' || sync.status === 'catching-up') && <p className="doc-empty" role="status">Opening spreadsheet…</p>}
    {canShow && tab && <div className="sheet-workspace">
      {draftNeedsReview && draft && <div className="doc-draft-review" role="alert">
        <p>The workbook changed while you were editing {cellAddress(draft.position)}. You can copy your draft.</p>
        <textarea aria-label="Unsaved Cell" readOnly value={draft.text} rows={2} />
        <button type="button" className="doc-edit-action" onClick={() => updateDraft(undefined)}>Discard Draft</button>
      </div>}
      <div className="sheet-controls">
        {canEdit && <div className="sheet-toolset" aria-label="Edit History">
          <button type="button" className="doc-tool" aria-label="Undo" title="Undo" disabled={!sync.canUndo || dirty}
            onClick={() => void sync.undo()}><WorkbenchIcon name="undo" /></button>
          <button type="button" className="doc-tool" aria-label="Redo" title="Redo" disabled={!sync.canRedo || dirty}
            onClick={() => void sync.redo()}><WorkbenchIcon name="redo" /></button>
        </div>}
        <form className="sheet-address" onSubmit={event => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem('address') as HTMLInputElement;
          const target = parseCellAddress(input.value.trim());
          if (target) {
            setError('');
            input.value = cellAddress(target);
            select(target);
            grid.current?.focus({ preventScroll: true });
          } else {
            setError('Enter a cell address from A1 to AZ1000.');
            input.select();
          }
        }}>
          <input key={tab.id + ':' + address} name="address" aria-label="Go to Cell" defaultValue={address} maxLength={6} autoComplete="off" />
        </form>
        <div className="sheet-formula">
          <span title="Start a formula with =. Try =SUM(B2:B8)."><WorkbenchIcon name="formula" /></span>
          <textarea ref={formula} aria-label="Cell Input" value={formulaText} rows={1} spellCheck={false} readOnly={!canWrite}
            placeholder={canWrite ? 'Enter a value or formula' : undefined}
            onFocus={() => { if (!draftRef.current) edit(selection.position); }}
            onChange={event => edit(selection.position, event.target.value)}
            onBlur={() => void flushDraft()} onKeyDown={formulaKey} />
        </div>
        <button type="button" className="doc-tool sheet-copy" aria-label="Copy Cell Link" title="Copy Cell Link"
          onClick={() => void copyCellLink()}><WorkbenchIcon name="link" /></button>
      </div>
      <div className="sheet-frame">
        <SheetGrid name={tab.name} cells={cells} selection={selection.position} source={selectedSource} gridRef={grid}
          onSelect={select} onEdit={canWrite ? editFromGrid : undefined} onClear={canWrite ? clearCell : undefined} onPaste={canWrite ? paste : undefined} />
        <div className="sheet-bottom">
          <nav className="sheet-tabs" aria-label="Worksheets">
            {tabs.map(item => <button type="button" key={item.id} aria-pressed={tab.id === item.id}
              onClick={() => select(firstCell, item.id)}>{item.name}</button>)}
          </nav>
          {canWrite && <button type="button" className="doc-tool" aria-label="Add Worksheet" title="Add Worksheet"
            disabled={tabs.length >= sheetTabs} onClick={event => showDialog('add', event.currentTarget)}><WorkbenchIcon name="plus" /></button>}
        </div>
      </div>
      {(error || sync.historyNotice || notice) && <p className="sheet-message" role={error ? 'alert' : 'status'}>{error || sync.historyNotice || notice}</p>}
    </div>}
    {canShow && tab && panel === 'comments' && <BoardReviewPanel open resourceKind="sheet" boardId={sheetId} userId={user.id}
      canComment={sync.permission !== 'view'} online={sync.status !== 'offline'} epoch={sync.epoch} page={tab}
      selectedObject={selectedCell ? { id: selectedCell.id, label: tab.name + '!' + address } : undefined}
      pickingPoint={false} initialThreadId={initialThread} onPickPoint={() => undefined} onFocusAnchor={focusAnchor} onClose={() => setPanel(null)} />}
    {canShow && panel === 'history' && <BoardVersionsPanel boardId={sheetId} resourceKind="sheet" renderPreview={previewVersion}
      permission={sync.permission} epoch={sync.epoch} seq={sync.seq} pendingCount={sync.pendingCount}
      online={sync.status === 'synced' && !dirty} onRestore={sync.retry} onOpenBoard={id => navigate(resourcePath('sheet', id))} onClose={() => setPanel(null)} />}
    {canShow && panel === 'share' && <BoardSharingDialog isOpen resourceKind="sheet" boardId={sheetId} boardName={title} onClose={() => setPanel(null)} />}
    {canShow && dialog && <WorkbenchDialog title={dialog.mode === 'add' ? 'New Worksheet' : 'Rename Spreadsheet'}
      submitLabel={dialog.mode === 'add' ? 'Add' : 'Save'} field={dialog.mode === 'add'
        ? { label: 'Worksheet Name', value: 'Sheet' + suggestedTab, maxLength: 31 }
        : { label: 'Spreadsheet Name', value: title, maxLength: 255 }}
      busy={dialogBusy} error={dialogError || null} returnFocus={dialog.trigger} onClose={() => setDialog(undefined)}
      onSubmit={name => void submitDialog(name)} />}
  </main>;
}
