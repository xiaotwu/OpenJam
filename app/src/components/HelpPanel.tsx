import { useState, useEffect } from 'react';

interface HelpPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const KEYBOARD_SHORTCUTS = [
  {
    category: 'Tools',
    shortcuts: [
      { key: 'V', description: 'Cursor tool' },
      { key: 'H', description: 'Pan tool' },
      { key: 'S', description: 'Sticky note' },
      { key: 'R', description: 'Shape tool' },
      { key: 'T', description: 'Text tool' },
      { key: 'C', description: 'Connector' },
      { key: 'P', description: 'Pen tool' },
      { key: 'M', description: 'Marker tool' },
      { key: 'X', description: 'Eraser tool' },
      { key: 'E', description: 'Stamp/Emoji tool' },
      { key: 'F', description: 'Frame tool' },
    ],
  },
  {
    category: 'Edit',
    shortcuts: [
      { key: 'Ctrl+Z', description: 'Undo' },
      { key: 'Ctrl+Shift+Z', description: 'Redo' },
      { key: 'Ctrl+C', description: 'Copy' },
      { key: 'Ctrl+V', description: 'Paste' },
      { key: 'Ctrl+D', description: 'Duplicate' },
      { key: 'Ctrl+A', description: 'Select all' },
      { key: 'Delete', description: 'Delete selection' },
      { key: 'Escape', description: 'Deselect / Cancel' },
    ],
  },
  {
    category: 'View',
    shortcuts: [
      { key: 'Ctrl++', description: 'Zoom in' },
      { key: 'Ctrl+-', description: 'Zoom out' },
      { key: 'Ctrl+0', description: 'Reset zoom to 100%' },
      { key: 'Ctrl+1', description: 'Zoom to fit' },
      { key: 'Space+Drag', description: 'Pan canvas' },
      { key: 'Scroll', description: 'Pan vertically' },
      { key: 'Ctrl+Scroll', description: 'Zoom in/out' },
    ],
  },
  {
    category: 'Objects',
    shortcuts: [
      { key: ']', description: 'Bring to front' },
      { key: '[', description: 'Send to back' },
      { key: 'Ctrl+G', description: 'Group' },
      { key: 'Ctrl+Shift+G', description: 'Ungroup' },
      { key: 'Ctrl+Shift+L', description: 'Lock/Unlock' },
    ],
  },
  {
    category: 'Canvas',
    shortcuts: [
      { key: 'Ctrl+K', description: 'Command palette' },
      { key: 'Ctrl+N', description: 'New board' },
      { key: 'F2', description: 'Rename board' },
    ],
  },
];

export default function HelpPanel({ isOpen, onClose }: HelpPanelProps) {
  const [activeTab, setActiveTab] = useState<'shortcuts' | 'help' | 'about'>('shortcuts');

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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] mx-4 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Help & Resources</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-md transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 border-b border-gray-200">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('shortcuts')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'shortcuts'
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Keyboard Shortcuts
            </button>
            <button
              onClick={() => setActiveTab('help')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'help'
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Help Center
            </button>
            <button
              onClick={() => setActiveTab('about')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'about'
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              About
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'shortcuts' && (
            <div className="space-y-6">
              {KEYBOARD_SHORTCUTS.map((section) => (
                <div key={section.category}>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    {section.category}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {section.shortcuts.map((shortcut) => (
                      <div
                        key={shortcut.key}
                        className="flex items-center justify-between py-1.5 px-3 rounded bg-gray-50"
                      >
                        <span className="text-sm text-gray-600">
                          {shortcut.description}
                        </span>
                        <kbd className="px-2 py-0.5 text-xs font-mono bg-white border border-gray-300 rounded shadow-sm">
                          {shortcut.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'help' && (
            <div className="space-y-4">
              <a
                href="#"
                className="block p-4 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Getting Started Guide</h4>
                    <p className="text-sm text-gray-500 mt-1">
                      Learn the basics of using OpenJam
                    </p>
                  </div>
                </div>
              </a>

              <a
                href="#"
                className="block p-4 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Community Forum</h4>
                    <p className="text-sm text-gray-500 mt-1">
                      Ask questions and share ideas with the community
                    </p>
                  </div>
                </div>
              </a>
            </div>
          )}

          {activeTab === 'about' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-pink-500 rounded-2xl flex items-center justify-center text-white mx-auto mb-4">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/>
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                OpenJam
              </h3>
              <p className="text-gray-500 mb-4">Version 1.0.0</p>
              <p className="text-sm text-gray-600 max-w-md mx-auto mb-4">
                An open-source collaborative whiteboard for teams to brainstorm, plan, and create together in real-time.
              </p>
              <div className="bg-gray-50 rounded-lg p-4 max-w-md mx-auto mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  <span className="text-sm font-medium text-gray-700">Open Source</span>
                </div>
                <p className="text-xs text-gray-500">
                  OpenJam is free and open-source software released under the MIT License. 
                  Contributions are welcome!
                </p>
              </div>
              <div className="flex items-center justify-center gap-4">
                <a href="#" className="text-sm text-purple-600 hover:underline">
                  MIT License
                </a>
                <span className="text-gray-300">•</span>
                <a href="#" className="text-sm text-purple-600 hover:underline">
                  GitHub Repository
                </a>
                <span className="text-gray-300">•</span>
                <a href="#" className="text-sm text-purple-600 hover:underline">
                  Contribute
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Help button component for bottom-right corner
export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 bg-white rounded-lg shadow-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
      title="Help & shortcuts"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
  );
}
