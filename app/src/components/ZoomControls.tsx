interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomFit: () => void;
  onHelp?: () => void;
}

export default function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onZoomFit: _onZoomFit,
  onHelp,
}: ZoomControlsProps) {
  return (
    <div className="flex items-center gap-1 glass rounded-xl p-1">
      <button
        onClick={onZoomOut}
        className="glass-btn p-2 rounded transition-colors"
        title="Zoom out (Ctrl+-)"
      >
        <svg className="w-4 h-4" style={{ color: 'var(--text-primary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
        </svg>
      </button>

      <button
        onClick={onZoomReset}
        className="glass-btn px-2 py-1 min-w-[60px] text-sm rounded transition-colors"
        style={{ color: 'var(--text-primary)' }}
        title="Reset zoom (Ctrl+0)"
      >
        {Math.round(scale * 100)}%
      </button>

      <button
        onClick={onZoomIn}
        className="glass-btn p-2 rounded transition-colors"
        title="Zoom in (Ctrl++)"
      >
        <svg className="w-4 h-4" style={{ color: 'var(--text-primary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {onHelp && (
        <>
          <div className="w-px h-6 mx-1" style={{ background: 'var(--glass-border-strong)' }} />
          <button
            onClick={onHelp}
            className="glass-btn p-2 rounded transition-colors"
            title="Help & Shortcuts (?)"
          >
            <svg className="w-4 h-4" style={{ color: 'var(--text-primary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
