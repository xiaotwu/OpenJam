import { useState, useRef, useEffect } from 'react';

interface DocumentMenuProps {
  onMoveToProject: () => void;
  onVersionHistory: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onExportPNG: () => void;
  onExportJPG: () => void;
  onExportPDF: () => void;
  onExportJSON: () => void;
  onDelete: () => void;
  onShowInfo: () => void;
}

interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  danger?: boolean;
  divider?: boolean;
  submenu?: { label: string; action: () => void }[];
}

export default function DocumentMenu({
  onMoveToProject,
  onVersionHistory,
  onDuplicate,
  onRename,
  onExportPNG,
  onExportJPG,
  onExportPDF,
  onExportJSON,
  onDelete,
  onShowInfo,
}: DocumentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showExportSubmenu, setShowExportSubmenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowExportSubmenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const menuItems: MenuItem[] = [
    {
      label: 'Move to project...',
      icon: <FolderIcon />,
      action: onMoveToProject,
    },
    {
      label: 'Version history',
      icon: <HistoryIcon />,
      action: onVersionHistory,
    },
    {
      label: 'Duplicate',
      icon: <DuplicateIcon />,
      shortcut: 'Ctrl+Shift+D',
      action: onDuplicate,
    },
    {
      label: 'Rename',
      icon: <RenameIcon />,
      shortcut: 'F2',
      action: onRename,
    },
    { label: '', divider: true, action: () => {} },
    {
      label: 'Export',
      icon: <ExportIcon />,
      action: () => {},
      submenu: [
        { label: 'PNG Image', action: onExportPNG },
        { label: 'JPG Image', action: onExportJPG },
        { label: 'PDF Document', action: onExportPDF },
        { label: 'JSON Data', action: onExportJSON },
      ],
    },
    { label: '', divider: true, action: () => {} },
    {
      label: 'File info',
      icon: <InfoIcon />,
      action: onShowInfo,
    },
    { label: '', divider: true, action: () => {} },
    {
      label: 'Delete file',
      icon: <DeleteIcon />,
      action: onDelete,
      danger: true,
    },
  ];

  const handleItemClick = (item: MenuItem) => {
    if (item.submenu) {
      setShowExportSubmenu(!showExportSubmenu);
      return;
    }
    item.action();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
        title="Document menu"
      >
        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
          {menuItems.map((item, index) =>
            item.divider ? (
              <div key={index} className="border-t border-gray-200 my-1" />
            ) : (
              <div key={index} className="relative">
                <button
                  onClick={() => handleItemClick(item)}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-gray-50 ${
                    item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'
                  }`}
                >
                  <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <span className="text-xs text-gray-400">{item.shortcut}</span>
                  )}
                  {item.submenu && (
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>

                {/* Export submenu */}
                {item.submenu && showExportSubmenu && (
                  <div className="absolute left-full top-0 ml-1 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1">
                    {item.submenu.map((subItem, subIndex) => (
                      <button
                        key={subIndex}
                        onClick={() => {
                          subItem.action();
                          setIsOpen(false);
                          setShowExportSubmenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        {subItem.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Icons
function FolderIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
