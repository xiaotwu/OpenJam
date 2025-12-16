import { useEffect } from 'react';

interface FileInfo {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  size: string;
  elementsCount: number;
}

interface Collaborator {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  color: string;
  lastEdited?: Date;
}

interface FileInfoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fileInfo: FileInfo;
  collaborators: Collaborator[];
}

export default function FileInfoDialog({
  isOpen,
  onClose,
  fileInfo,
  collaborators,
}: FileInfoDialogProps) {
  // Close on escape
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
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">File Information</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-md transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6">
          {/* File name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
              Name
            </label>
            <p className="text-gray-900 font-medium">{fileInfo.name}</p>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                Created
              </label>
              <p className="text-sm text-gray-700">{formatDate(fileInfo.createdAt)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                Last modified
              </label>
              <p className="text-sm text-gray-700">{formatDate(fileInfo.updatedAt)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                Created by
              </label>
              <p className="text-sm text-gray-700">{fileInfo.createdBy}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                Elements
              </label>
              <p className="text-sm text-gray-700">{fileInfo.elementsCount}</p>
            </div>
          </div>

          {/* File ID */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
              File ID
            </label>
            <div className="flex items-center gap-2">
              <code className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded font-mono flex-1 truncate">
                {fileInfo.id}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(fileInfo.id)}
                className="p-1 hover:bg-gray-100 rounded"
                title="Copy ID"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Collaborators */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
              Collaborators ({collaborators.length})
            </label>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {collaborators.map((collab) => (
                <div
                  key={collab.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50"
                >
                  {collab.avatarUrl ? (
                    <img
                      src={collab.avatarUrl}
                      alt={collab.name}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                      style={{ backgroundColor: collab.color }}
                    >
                      {getInitials(collab.name)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {collab.name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{collab.email}</p>
                  </div>
                  {collab.lastEdited && (
                    <span className="text-xs text-gray-400">
                      {formatDate(collab.lastEdited)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
