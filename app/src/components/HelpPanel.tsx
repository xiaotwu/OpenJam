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
      { key: '?', description: 'Open keyboard shortcuts' },
      { key: 'Ctrl+K', description: 'Command palette' },
      { key: 'Ctrl+N', description: 'New board' },
      { key: 'F2', description: 'Rename board' },
    ],
  },
];

export default function HelpPanel({ isOpen, onClose }: HelpPanelProps) {
  const [activeTab, setActiveTab] = useState<'shortcuts' | 'help' | 'about'>('shortcuts');

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
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: 'var(--surface-overlay)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative glass-elevated rounded-2xl w-full max-w-2xl max-h-[80vh] mx-4 overflow-hidden flex flex-col glass-panel-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--glass-border-strong)' }}
        >
          <h2 id="help-dialog-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Help & Resources
          </h2>
          <button
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-lg transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Close help dialog"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3" style={{ borderBottom: '1px solid var(--glass-border-strong)' }}>
          <div className="flex gap-6">
            {(['shortcuts', 'help', 'about'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="border-b-2 pb-3 text-sm font-medium transition-colors"
                style={{
                  borderColor: activeTab === tab ? 'var(--accent)' : 'transparent',
                  color: activeTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {tab === 'shortcuts' ? 'Keyboard Shortcuts' : tab === 'help' ? 'Help Center' : 'About'}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'shortcuts' && (
            <div className="space-y-6">
              {KEYBOARD_SHORTCUTS.map((section) => (
                <div key={section.category}>
                  <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                    {section.category}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {section.shortcuts.map((shortcut) => (
                      <div
                        key={shortcut.key}
                        className="flex items-center justify-between py-1.5 px-3 rounded-lg"
                        style={{ background: 'var(--glass-bg-subtle)' }}
                      >
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {shortcut.description}
                        </span>
                        <kbd
                          className="px-2 py-0.5 text-xs font-mono rounded-md"
                          style={{
                            background: 'var(--badge-bg)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--glass-border-strong)',
                          }}
                        >
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
            <div className="space-y-3">
              {[
                {
                  href: 'https://xiaotwu.github.io/OpenJam/guide/getting-started.html',
                  icon: (
                    <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  ),
                  iconBg: 'rgba(147, 51, 234, 0.08)',
                  title: 'Getting Started Guide',
                  desc: 'Learn the basics of using OpenJam',
                },
                {
                  href: 'https://xiaotwu.github.io/OpenJam/reference/architecture.html',
                  icon: (
                    <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  ),
                  iconBg: 'rgba(234, 88, 12, 0.08)',
                  title: 'Architecture & API Reference',
                  desc: 'Technical architecture, WebSocket API, and CRDT details',
                },
                {
                  href: 'https://github.com/xiaotwu/OpenJam/issues',
                  icon: (
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  ),
                  iconBg: 'rgba(22, 163, 74, 0.08)',
                  title: 'Report Issues & Feedback',
                  desc: 'Report bugs, request features, or ask questions on GitHub',
                },
              ].map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 rounded-xl transition-all"
                  style={{
                    background: 'rgba(255, 255, 255, 0.5)',
                    border: '1px solid rgba(0, 0, 0, 0.04)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)';
                    e.currentTarget.style.borderColor = 'rgba(147, 51, 234, 0.2)';
                    e.currentTarget.style.boxShadow = '0 2px 12px rgba(0, 0, 0, 0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)';
                    e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: item.iconBg }}
                    >
                      {item.icon}
                    </div>
                    <div>
                      <h4 className="font-medium" style={{ color: 'rgba(0, 0, 0, 0.85)' }}>
                        {item.title}
                      </h4>
                      <p className="text-sm mt-0.5" style={{ color: 'rgba(0, 0, 0, 0.5)' }}>
                        {item.desc}
                      </p>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}

          {activeTab === 'about' && (
            <div className="text-center py-6">
              <img
                src="/icons/openjam.png"
                alt="OpenJam"
                className="w-20 h-20 rounded-[22px] mx-auto mb-5"
                style={{
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)',
                }}
              />
              <h3 className="text-xl font-bold mb-1" style={{ color: 'rgba(0, 0, 0, 0.87)' }}>
                OpenJam
              </h3>
              <p className="text-sm mb-5" style={{ color: 'rgba(0, 0, 0, 0.4)' }}>Version 1.0.0</p>
              <p className="text-sm max-w-md mx-auto mb-6" style={{ color: 'rgba(0, 0, 0, 0.55)' }}>
                An open-source collaborative whiteboard for teams to brainstorm, plan, and create together in real-time.
              </p>
              <div
                className="rounded-xl p-4 max-w-md mx-auto mb-6"
                style={{
                  background: 'rgba(255, 255, 255, 0.5)',
                  border: '1px solid rgba(0, 0, 0, 0.04)',
                }}
              >
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg className="w-5 h-5" style={{ color: 'rgba(0, 0, 0, 0.75)' }} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  <span className="text-sm font-medium" style={{ color: 'rgba(0, 0, 0, 0.75)' }}>Open Source</span>
                </div>
                <p className="text-xs" style={{ color: 'rgba(0, 0, 0, 0.45)' }}>
                  OpenJam is free and open-source software released under the MIT License.
                  Contributions are welcome!
                </p>
              </div>
              <div className="flex items-center justify-center gap-4">
                <a href="https://github.com/xiaotwu/OpenJam/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="text-sm text-purple-600 hover:text-purple-700 hover:underline transition-colors">
                  MIT License
                </a>
                <span style={{ color: 'rgba(0, 0, 0, 0.15)' }}>·</span>
                <a href="https://github.com/xiaotwu/OpenJam" target="_blank" rel="noopener noreferrer" className="text-sm text-purple-600 hover:text-purple-700 hover:underline transition-colors">
                  GitHub Repository
                </a>
                <span style={{ color: 'rgba(0, 0, 0, 0.15)' }}>·</span>
                <a href="https://github.com/xiaotwu/OpenJam/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer" className="text-sm text-purple-600 hover:text-purple-700 hover:underline transition-colors">
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
      className="glass flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors hover:bg-white/10" style={{ color: 'var(--text-secondary)' }}
      title="Help & shortcuts"
      aria-label="Help and keyboard shortcuts"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
  );
}
