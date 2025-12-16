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
  onAddPage: () => void;
  onRenamePage: (pageId: string, name: string) => void;
  onDuplicatePage: (pageId: string) => void;
  onDeletePage: (pageId: string) => void;
}

export default function PagesPanel({
  pages,
  currentPageId,
  onSelectPage,
  onAddPage,
  onRenamePage,
  onDuplicatePage,
  onDeletePage,
}: PagesPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ pageId: string; x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRename = (pageId: string) => {
    if (tempName.trim()) {
      onRenamePage(pageId, tempName.trim());
    }
    setEditingId(null);
    setContextMenu(null);
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-100 rounded transition-colors"
        title="Pages"
      >
        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Pages Panel Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-50">
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Pages</span>
            <button
              onClick={() => {
                onAddPage();
              }}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
              title="Add page"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Pages List */}
          <div className="max-h-64 overflow-y-auto py-1">
            {pages.map((page) => (
              <div
                key={page.id}
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  page.id === currentPageId ? 'bg-purple-50' : 'hover:bg-gray-50'
                }`}
                onClick={() => {
                  if (editingId !== page.id) {
                    onSelectPage(page.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ pageId: page.id, x: e.clientX, y: e.clientY });
                }}
              >
                {/* Page icon */}
                <div className={`w-6 h-6 rounded flex items-center justify-center text-xs ${
                  page.id === currentPageId ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'
                }`}>
                  {pages.indexOf(page) + 1}
                </div>

                {/* Page name */}
                {editingId === page.id ? (
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onBlur={() => handleRename(page.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(page.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 px-1 py-0.5 text-sm border border-purple-500 rounded focus:outline-none"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={`flex-1 text-sm truncate ${
                    page.id === currentPageId ? 'text-purple-700 font-medium' : 'text-gray-700'
                  }`}>
                    {page.name}
                  </span>
                )}

                {/* Context menu button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu({ pageId: page.id, x: e.clientX, y: e.clientY });
                  }}
                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-200 rounded transition-all"
                >
                  <svg className="w-3 h-3 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="6" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="18" r="2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-[60]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              const page = pages.find(p => p.id === contextMenu.pageId);
              if (page) {
                setEditingId(contextMenu.pageId);
                setTempName(page.name);
              }
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            Rename
          </button>
          <button
            onClick={() => {
              onDuplicatePage(contextMenu.pageId);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            Duplicate
          </button>
          {pages.length > 1 && (
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
