import { useState, useEffect, useRef } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${y - rect.height}px`;
      }
    }
  }, [x, y]);

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.disabled) return;
    if (item.submenu) {
      setActiveSubmenu(activeSubmenu === item.id ? null : item.id);
      return;
    }
    item.action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] glass-elevated rounded-xl glass-panel-enter py-1 min-w-[200px]"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) =>
        item.divider ? (
          <div key={index} className="border-t my-1" style={{ borderColor: 'var(--glass-border-strong)' }} />
        ) : (
          <div key={item.id} className="relative">
            <button
              onClick={() => handleItemClick(item)}
              onMouseEnter={() => item.submenu && setActiveSubmenu(item.id)}
              disabled={item.disabled}
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 ${
                item.disabled
                  ? 'cursor-not-allowed opacity-50'
                  : item.danger
                  ? 'text-red-600 hover:bg-red-50/10'
                  : 'hover:bg-white/10'
              }`}
              style={item.disabled ? { color: 'var(--text-tertiary)' } : (!item.danger ? { color: 'var(--text-primary)' } : undefined)}
            >
              {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{item.shortcut}</span>
              )}
              {item.submenu && (
                <svg className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>

            {/* Submenu */}
            {item.submenu && activeSubmenu === item.id && (
              <div className="absolute left-full top-0 ml-1 glass-elevated rounded-xl glass-panel-enter py-1 min-w-[160px]">
                {item.submenu.map((subItem) =>
                  subItem.divider ? (
                    <div key={subItem.id} className="border-t my-1" style={{ borderColor: 'var(--glass-border-strong)' }} />
                  ) : (
                    <button
                      key={subItem.id}
                      onClick={() => {
                        if (!subItem.disabled) {
                          subItem.action();
                          onClose();
                        }
                      }}
                      disabled={subItem.disabled}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 ${
                        subItem.disabled
                          ? 'cursor-not-allowed opacity-50'
                          : 'hover:bg-white/10'
                      }`}
                      style={{ color: subItem.disabled ? 'var(--text-tertiary)' : 'var(--text-primary)' }}
                    >
                      {subItem.icon && <span className="w-4 h-4">{subItem.icon}</span>}
                      <span className="flex-1">{subItem.label}</span>
                      {subItem.shortcut && (
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{subItem.shortcut}</span>
                      )}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

// Pre-built context menu configurations
// eslint-disable-next-line react-refresh/only-export-components
export function getElementContextMenuItems(
  _onDuplicate: () => void,
  onDelete: () => void,
  onCopy: () => void,
  onCut: () => void,
  onBringToFront: () => void,
  onSendToBack: () => void,
  onLock: () => void,
  onGroup: () => void,
  onUngroup: () => void,
  isGrouped: boolean,
  isLocked: boolean
): ContextMenuItem[] {
  void _onDuplicate; // Keep parameter for backward compatibility
  return [
    {
      id: 'cut',
      label: 'Cut',
      shortcut: 'Ctrl+X',
      action: onCut,
      icon: <CutIcon />,
    },
    {
      id: 'copy',
      label: 'Copy',
      shortcut: 'Ctrl+C',
      action: onCopy,
      icon: <CopyIcon />,
    },
    { id: 'div1', label: '', divider: true, action: () => {} },
    {
      id: 'arrange',
      label: 'Arrange',
      action: () => {},
      icon: <LayerIcon />,
      submenu: [
        { id: 'front', label: 'Bring to front', shortcut: ']', action: onBringToFront },
        { id: 'back', label: 'Send to back', shortcut: '[', action: onSendToBack },
      ],
    },
    {
      id: 'group',
      label: isGrouped ? 'Ungroup' : 'Group',
      shortcut: isGrouped ? 'Ctrl+Shift+G' : 'Ctrl+G',
      action: isGrouped ? onUngroup : onGroup,
      icon: <GroupIcon />,
    },
    {
      id: 'lock',
      label: isLocked ? 'Unlock' : 'Lock',
      shortcut: 'Ctrl+Shift+L',
      action: onLock,
      icon: isLocked ? <UnlockIcon /> : <LockIcon />,
    },
    { id: 'div2', label: '', divider: true, action: () => {} },
    {
      id: 'delete',
      label: 'Delete',
      shortcut: 'Del',
      action: onDelete,
      icon: <DeleteIcon />,
      danger: true,
    },
  ];
}

// eslint-disable-next-line react-refresh/only-export-components
export function getCanvasContextMenuItems(
  onPaste: () => void,
  onSelectAll: () => void,
  onZoomIn: () => void,
  onZoomOut: () => void,
  onZoomFit: () => void,
  canPaste: boolean,
  onUndo?: () => void,
  onRedo?: () => void
): ContextMenuItem[] {
  return [
    {
      id: 'undo',
      label: 'Undo',
      shortcut: 'Ctrl+Z',
      action: onUndo || (() => {}),
      icon: <UndoIcon />,
      disabled: !onUndo,
    },
    {
      id: 'redo',
      label: 'Redo',
      shortcut: 'Ctrl+Shift+Z',
      action: onRedo || (() => {}),
      icon: <RedoIcon />,
      disabled: !onRedo,
    },
    { id: 'div0', label: '', divider: true, action: () => {} },
    {
      id: 'paste',
      label: 'Paste',
      shortcut: 'Ctrl+V',
      action: onPaste,
      icon: <PasteIcon />,
      disabled: !canPaste,
    },
    { id: 'div1', label: '', divider: true, action: () => {} },
    {
      id: 'selectAll',
      label: 'Select all',
      shortcut: 'Ctrl+A',
      action: onSelectAll,
      icon: <SelectAllIcon />,
    },
    { id: 'div2', label: '', divider: true, action: () => {} },
    {
      id: 'zoom',
      label: 'Zoom',
      action: () => {},
      icon: <ZoomIcon />,
      submenu: [
        { id: 'zoomIn', label: 'Zoom in', shortcut: 'Ctrl++', action: onZoomIn },
        { id: 'zoomOut', label: 'Zoom out', shortcut: 'Ctrl+-', action: onZoomOut },
        { id: 'zoomFit', label: 'Zoom to fit', shortcut: 'Ctrl+1', action: onZoomFit },
      ],
    },
  ];
}

// Icons
function CutIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function LayerIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function SelectAllIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
    </svg>
  );
}
