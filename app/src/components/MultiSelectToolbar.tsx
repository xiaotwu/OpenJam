import { useState } from 'react';

interface MultiSelectToolbarProps {
  selectedCount: number;
  onAlignLeft: () => void;
  onAlignCenter: () => void;
  onAlignRight: () => void;
  onAlignTop: () => void;
  onAlignMiddle: () => void;
  onAlignBottom: () => void;
  onDistributeH: () => void;
  onDistributeV: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  canUngroup: boolean;
}

export default function MultiSelectToolbar({
  selectedCount,
  onAlignLeft,
  onAlignCenter,
  onAlignRight,
  onAlignTop,
  onAlignMiddle,
  onAlignBottom,
  onDistributeH,
  onDistributeV,
  onGroup,
  onUngroup,
  onDelete,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  canUngroup,
}: MultiSelectToolbarProps) {
  const [showAlignMenu, setShowAlignMenu] = useState(false);

  if (selectedCount < 2) return null;

  return (
    <div className="absolute top-28 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 px-2 py-1.5 glass-elevated rounded-xl">
        {/* Selection count */}
        <span className="px-2 text-sm font-medium border-r mr-1" style={{ color: 'var(--text-secondary)', borderColor: 'var(--glass-border-strong)' }}>
          {selectedCount} selected
        </span>

        {/* Align dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowAlignMenu(!showAlignMenu)}
            className="glass-btn p-2 rounded hover:bg-white/10 transition-colors"
            title="Align"
          >
            <AlignLeftIcon />
          </button>

          {showAlignMenu && (
            <div className="absolute top-full left-0 mt-1 glass-elevated rounded-xl glass-panel-enter p-2 min-w-[200px]">
              <div className="text-xs font-medium uppercase px-2 mb-2" style={{ color: 'var(--text-secondary)' }}>
                Align
              </div>
              <div className="flex gap-1 mb-2">
                <ToolButton onClick={onAlignLeft} title="Align left">
                  <AlignLeftIcon />
                </ToolButton>
                <ToolButton onClick={onAlignCenter} title="Align center">
                  <AlignCenterIcon />
                </ToolButton>
                <ToolButton onClick={onAlignRight} title="Align right">
                  <AlignRightIcon />
                </ToolButton>
                <div className="w-px mx-1" style={{ background: 'var(--glass-border-strong)' }} />
                <ToolButton onClick={onAlignTop} title="Align top">
                  <AlignTopIcon />
                </ToolButton>
                <ToolButton onClick={onAlignMiddle} title="Align middle">
                  <AlignMiddleIcon />
                </ToolButton>
                <ToolButton onClick={onAlignBottom} title="Align bottom">
                  <AlignBottomIcon />
                </ToolButton>
              </div>

              <div className="text-xs font-medium uppercase px-2 mb-2 mt-3" style={{ color: 'var(--text-secondary)' }}>
                Distribute
              </div>
              <div className="flex gap-1">
                <ToolButton onClick={onDistributeH} title="Distribute horizontally">
                  <DistributeHIcon />
                </ToolButton>
                <ToolButton onClick={onDistributeV} title="Distribute vertically">
                  <DistributeVIcon />
                </ToolButton>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 mx-1" style={{ background: 'var(--glass-border-strong)' }} />

        {/* Group/Ungroup */}
        <button
          onClick={canUngroup ? onUngroup : onGroup}
          className="glass-btn p-2 rounded hover:bg-white/10 transition-colors"
          title={canUngroup ? 'Ungroup (Ctrl+Shift+G)' : 'Group (Ctrl+G)'}
        >
          <GroupIcon />
        </button>

        {/* Layer order */}
        <button
          onClick={onBringToFront}
          className="glass-btn p-2 rounded hover:bg-white/10 transition-colors"
          title="Bring to front (])"
        >
          <BringFrontIcon />
        </button>
        <button
          onClick={onSendToBack}
          className="glass-btn p-2 rounded hover:bg-white/10 transition-colors"
          title="Send to back ([)"
        >
          <SendBackIcon />
        </button>

        <div className="w-px h-6 mx-1" style={{ background: 'var(--glass-border-strong)' }} />

        {/* Duplicate */}
        <button
          onClick={onDuplicate}
          className="glass-btn p-2 rounded hover:bg-white/10 transition-colors"
          title="Duplicate (Ctrl+D)"
        >
          <DuplicateIcon />
        </button>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="glass-btn p-2 rounded hover:bg-white/10 text-red-600 transition-colors"
          title="Delete (Del)"
        >
          <DeleteIcon />
        </button>
      </div>
    </div>
  );
}

// Tool button wrapper
function ToolButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="glass-btn p-2 rounded hover:bg-white/10 transition-colors"
      title={title}
    >
      {children}
    </button>
  );
}

// Icons
function AlignLeftIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h14" />
    </svg>
  );
}

function AlignCenterIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M5 18h14" />
    </svg>
  );
}

function AlignRightIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M6 18h14" />
    </svg>
  );
}

function AlignTopIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16M12 8v12M8 12l4-4 4 4" />
    </svg>
  );
}

function AlignMiddleIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16M12 4v16" />
    </svg>
  );
}

function AlignBottomIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20h16M12 4v12M8 12l4 4 4-4" />
    </svg>
  );
}

function DistributeHIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v16M20 4v16M9 8h6M9 12h6M9 16h6" />
    </svg>
  );
}

function DistributeVIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16M4 20h16M8 9v6M12 9v6M16 9v6" />
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

function BringFrontIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11V7a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2h-4" />
      <rect x="3" y="11" width="10" height="10" rx="2" strokeWidth={2} fill="white" />
    </svg>
  );
}

function SendBackIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <rect x="3" y="3" width="10" height="10" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 13h6a2 2 0 012 2v4a2 2 0 01-2 2h-4" />
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

function DeleteIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
