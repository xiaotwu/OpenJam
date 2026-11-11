import { useState, useRef, useEffect } from 'react';

export interface Page {
  id: string;
  name: string;
  thumbnail?: string;
}

interface PagesPanelProps {
  pages: Page[];
  currentPageId: string;
  onSelectPage: (pageId: string) => void;
  onAddPage?: () => void;
  onRenamePage?: (pageId: string, name: string, expectedName: string) => void;
  onDuplicatePage?: (pageId: string) => void;
  onDeletePage?: (pageId: string) => void;
  onReorderPage?: (pageId: string, position: number) => void;
  defaultPageId?: string;
  onDefaultPage?: (pageId: string) => void;
  onCopyPageLink?: (pageId: string) => Promise<boolean>;
  onMoveSelection?: (pageId: string) => void;
  sections?: { id: string; name: string }[];
  onSelectSection?: (elementId: string) => void;
  onCopySectionLink?: (elementId: string) => Promise<boolean>;
  onDismiss?: () => void;
}

export default function PagesPanel({
  pages,
  currentPageId,
  onSelectPage,
  onAddPage,
  onRenamePage,
  onDuplicatePage,
  onDeletePage,
  onReorderPage,
  defaultPageId,
  onDefaultPage,
  onCopyPageLink,
  onMoveSelection,
  sections,
  onSelectSection,
  onCopySectionLink,
  onDismiss,
}: PagesPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [contextMenu, setContextMenu] = useState<{ pageId: string; x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const renameStart = useRef<{ id: string; name: string } | null>(null);
  const hasActions = Boolean(onRenamePage || onDuplicatePage || onDeletePage || onCopyPageLink || onReorderPage || onDefaultPage || onMoveSelection);
  const query = search.trim().toLocaleLowerCase();
  const matchingPages = pages.filter(page => page.name.toLocaleLowerCase().includes(query));
  const matchingSections = sections?.filter(section => section.name.toLocaleLowerCase().includes(query));
  const contextIndex = contextMenu ? pages.findIndex(page => page.id === contextMenu.pageId) : -1;

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setContextMenu(null);
        onDismiss?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onDismiss]);

  const handleRename = (pageId: string) => {
    const original = renameStart.current;
    renameStart.current = null;
    const name = tempName.trim();
    if (name && original?.id === pageId && original.name !== name) onRenamePage?.(pageId, name, original.name);
    setEditingId(null);
    setContextMenu(null);
  };

  const showActions = (pageId: string, x: number, y: number) => {
    setContextMenu({ pageId, x: Math.max(8, Math.min(x, window.innerWidth - 205)), y: Math.max(8, Math.min(y, window.innerHeight - 330)) });
  };

  const runAction = (action: (pageId: string) => void) => {
    if (contextMenu) action(contextMenu.pageId);
    setContextMenu(null);
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Toggle Button */}
      {!onDismiss && <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setContextMenu(null);
          setStatus('');
        }}
        className="board-action-button"
        title="Pages"
        aria-label="Pages"
        aria-expanded={isOpen}
      >
        <svg className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      </button>}

      {/* Pages Panel Dropdown */}
      {(isOpen || onDismiss) && (
        <div className="board-chrome-popover fixed left-3 top-[4.25rem] z-50 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--glass-border-strong)] shadow-xl"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== 'Escape' || editingId) return;
            if (contextMenu) setContextMenu(null);
            else if (onDismiss) onDismiss();
            else setIsOpen(false);
          }}>
          {/* Header */}
          <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: 'var(--glass-border-strong)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Pages</span>
            {onAddPage && (
              <button type="button" onClick={onAddPage} className="rounded-full p-2 transition hover:bg-white/10" aria-label="Add page">
                <svg className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}
          </div>

          <div className="px-2 pt-2">
            <input type="search" aria-label="Find pages and sections" placeholder="Find pages and sections" value={search}
              onChange={event => { setSearch(event.target.value); setStatus(''); setContextMenu(null); }}
              className="w-full rounded-full border px-3 py-1.5 text-sm outline-[var(--accent)]"
              style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }} />
          </div>

          {/* Pages List */}
          <div className="max-h-64 overflow-y-auto py-1">
            {matchingPages.length === 0 && !matchingSections?.length && <p className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>No matching pages or sections</p>}
            {matchingPages.map((page) => (
              <div
                key={page.id}
                className="group flex items-center gap-1 px-2"
                onContextMenu={(e) => {
                  if (!hasActions) return;
                  e.preventDefault();
                  showActions(page.id, e.clientX, e.clientY);
                }}
              >
                {onRenamePage && editingId === page.id ? (
                  <input
                    type="text"
                    aria-label="Page name"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onBlur={() => handleRename(page.id)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === 'Enter') handleRename(page.id);
                      if (e.key === 'Escape') {
                        renameStart.current = null;
                        setEditingId(null);
                      }
                    }}
                    className="min-w-0 flex-1 rounded-full border px-3 py-1.5 text-sm outline-[var(--accent)]"
                    style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { onSelectPage(page.id); onDismiss?.(); }}
                    aria-current={page.id === currentPageId ? 'page' : undefined}
                    className={`min-w-0 flex-1 truncate rounded-full px-3 py-2 text-left text-sm transition hover:bg-[var(--badge-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${page.id === currentPageId ? 'bg-[var(--badge-bg)] font-semibold' : ''}`}
                  >
                    {page.name}
                    {page.id === defaultPageId && <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>Default</span>}
                  </button>
                )}

                {/* Context menu button */}
                {hasActions && <button
                  type="button"
                  onClick={(e) => {
                    const bounds = e.currentTarget.getBoundingClientRect();
                    if (contextMenu?.pageId === page.id) setContextMenu(null);
                    else showActions(page.id, bounds.left, bounds.bottom);
                  }}
                  aria-label={`Actions for ${page.name}`}
                  className="rounded-full p-2 opacity-60 transition hover:bg-white/15 hover:opacity-100 focus-visible:opacity-100"
                >
                  <svg className="w-3 h-3 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="6" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="18" r="2" />
                  </svg>
                </button>}
              </div>
            ))}
            {!!matchingSections?.length && onSelectSection && (
              <div className="mt-1 border-t px-2 pt-1" style={{ borderColor: 'var(--glass-border-strong)' }}>
                <p className="px-2 py-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Sections on this page</p>
                {matchingSections.map(section => <div className="flex items-center gap-1" key={section.id}>
                  <button type="button" aria-label={`Jump to ${section.name}`} onClick={() => { onSelectSection(section.id); setIsOpen(false); setContextMenu(null); onDismiss?.(); }}
                    className="min-w-0 flex-1 truncate rounded-full px-3 py-2 text-left text-sm hover:bg-[var(--badge-bg)]">{section.name}</button>
                  {onCopySectionLink && <button type="button" aria-label={`Copy link to ${section.name}`}
                    onClick={() => { void onCopySectionLink(section.id).then(copied => setStatus(copied ? 'Section link copied' : 'Could not copy the section link')); }}
                    className="rounded-lg px-2 py-2 text-xs hover:bg-blue-500/10">Copy link</button>}
                </div>)}
              </div>
            )}
          </div>
          {status && <p role="status" className="px-3 pb-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{status}</p>}
        </div>
      )}

      {/* Context Menu */}
      {hasActions && contextMenu && contextIndex >= 0 && (
        <div
          className="fixed w-48 max-h-[calc(100vh-1rem)] overflow-y-auto rounded-xl border py-1 shadow-xl z-[60]"
          style={{ left: contextMenu.x, top: contextMenu.y, background: 'var(--surface-panel)', borderColor: 'var(--glass-border-strong)' }}
          onKeyDown={event => { if (event.key === 'Escape') setContextMenu(null); }}
        >
          {onRenamePage && <button
            onClick={() => {
              const page = pages.find(p => p.id === contextMenu.pageId);
              if (page) {
                renameStart.current = { id: page.id, name: page.name };
                setEditingId(contextMenu.pageId);
                setTempName(page.name);
              }
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-white/10" style={{ color: 'var(--text-primary)' }}
          >
            Rename
          </button>}
          {onDuplicatePage && <button
            onClick={() => {
              onDuplicatePage(contextMenu.pageId);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-white/10" style={{ color: 'var(--text-primary)' }}
          >
            Duplicate
          </button>}
          {onReorderPage && contextIndex > 0 && (
            <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-blue-500/10"
              onClick={() => runAction(id => onReorderPage(id, contextIndex - 1))}>Move page up</button>
          )}
          {onReorderPage && contextIndex < pages.length - 1 && (
            <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-blue-500/10"
              onClick={() => runAction(id => onReorderPage(id, contextIndex + 1))}>Move page down</button>
          )}
          {onDefaultPage && contextMenu.pageId !== defaultPageId && (
            <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-blue-500/10"
              onClick={() => runAction(onDefaultPage)}>Set as default page</button>
          )}
          {onMoveSelection && contextMenu.pageId !== currentPageId && (
            <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-blue-500/10"
              onClick={() => runAction(onMoveSelection)}>Move selection here</button>
          )}
          {onCopyPageLink && (
            <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-blue-500/10"
              onClick={() => runAction(id => { void onCopyPageLink(id).then(copied => setStatus(copied ? 'Page link copied' : 'Could not copy the page link')); })}>Copy page link</button>
          )}
          {onDeletePage && pages.length > 1 && (
            <button
              onClick={() => {
                onDeletePage(contextMenu.pageId);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
