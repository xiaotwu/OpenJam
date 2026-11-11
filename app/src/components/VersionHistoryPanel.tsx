import { useState, useEffect } from 'react';

interface Version {
  id: string;
  timestamp: Date;
  author: string;
  authorColor: string;
  description: string;
  isAutosave: boolean;
  isCurrent: boolean;
}

interface VersionHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  versions: Version[];
  onRestore: (versionId: string) => void;
  onPreview: (versionId: string) => void;
  onNameVersion: (versionId: string, name: string) => void;
}

export default function VersionHistoryPanel({
  isOpen,
  onClose,
  versions,
  onRestore,
  onPreview,
  onNameVersion,
}: VersionHistoryPanelProps) {
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
    
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleSaveName = (versionId: string) => {
    if (tempName.trim()) {
      onNameVersion(versionId, tempName.trim());
    }
    setEditingName(null);
  };

  // Group versions by date
  const groupedVersions = versions.reduce((acc, version) => {
    const dateKey = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(version.timestamp);
    
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(version);
    return acc;
  }, {} as Record<string, Version[]>);

  return (
    <div className="fixed inset-0 z-[100] flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 w-80 bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Version history</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-md transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto">
          {Object.entries(groupedVersions).map(([date, dateVersions]) => (
            <div key={date} className="border-b border-gray-100">
              <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                {date}
              </div>
              
              {dateVersions.map((version) => (
                <div
                  key={version.id}
                  className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors ${
                    selectedVersion === version.id ? 'bg-purple-50' : ''
                  }`}
                  onClick={() => {
                    setSelectedVersion(version.id);
                    onPreview(version.id);
                  }}
                >
                  <div className="flex items-start gap-3">
                    {/* Author avatar */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                      style={{ backgroundColor: version.authorColor }}
                    >
                      {getInitials(version.author)}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Version name or description */}
                      {editingName === version.id ? (
                        <input
                          type="text"
                          value={tempName}
                          onChange={(e) => setTempName(e.target.value)}
                          onBlur={() => handleSaveName(version.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveName(version.id);
                            if (e.key === 'Escape') setEditingName(null);
                          }}
                          className="w-full px-2 py-1 text-sm border border-purple-500 rounded focus:outline-none"
                          placeholder="Name this version..."
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {version.description}
                          {version.isCurrent && (
                            <span className="ml-2 text-xs text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded">
                              Current
                            </span>
                          )}
                          {version.isAutosave && (
                            <span className="ml-1 text-xs text-gray-400">(Autosave)</span>
                          )}
                        </p>
                      )}

                      {/* Meta info */}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500">{version.author}</span>
                        <span className="text-xs text-gray-400">•</span>
                        <span className="text-xs text-gray-400">{formatDate(version.timestamp)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions - show on selected */}
                  {selectedVersion === version.id && !version.isCurrent && (
                    <div className="flex items-center gap-2 mt-3 pl-11">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestore(version.id);
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-100 rounded transition-colors"
                      >
                        Restore
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingName(version.id);
                          setTempName(version.description);
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      >
                        Name version
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {versions.length === 0 && (
            <div className="px-4 py-8 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500">No version history yet</p>
              <p className="text-xs text-gray-400 mt-1">Changes will appear here</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
          <p className="text-xs text-gray-500 text-center">
            Version history is saved for 30 days
          </p>
        </div>
      </div>
    </div>
  );
}

// Generate mock version history for demo
// eslint-disable-next-line react-refresh/only-export-components
export function generateMockVersions(_userId: string, username: string, userColor: string): Version[] {
  const now = Date.now();
  return [
    {
      id: 'v1',
      timestamp: new Date(now - 5 * 60000),
      author: username,
      authorColor: userColor,
      description: 'Current version',
      isAutosave: true,
      isCurrent: true,
    },
    {
      id: 'v2',
      timestamp: new Date(now - 30 * 60000),
      author: username,
      authorColor: userColor,
      description: 'Added sticky notes',
      isAutosave: false,
      isCurrent: false,
    },
    {
      id: 'v3',
      timestamp: new Date(now - 2 * 3600000),
      author: username,
      authorColor: userColor,
      description: 'Initial board setup',
      isAutosave: false,
      isCurrent: false,
    },
    {
      id: 'v4',
      timestamp: new Date(now - 24 * 3600000),
      author: 'Collaborator',
      authorColor: '#F87171',
      description: 'Added diagrams',
      isAutosave: false,
      isCurrent: false,
    },
  ];
}
