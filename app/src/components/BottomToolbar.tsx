import { useEffect, useRef, useState, type ReactNode } from 'react';
import WidgetsPanel from './WidgetsPanel';

export type ToolType =
  | 'select'
  | 'pan'
  | 'sticky'
  | 'shape'
  | 'text'
  | 'connector'
  | 'draw'
  | 'eraser'
  | 'frame'
  | 'stamp'
  | 'image'
  | 'marker';

export type ShapeType =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'circle'
  | 'diamond'
  | 'triangle'
  | 'parallelogram'
  | 'star'
  | 'ellipse'
  | 'hexagon';

export type StickyColor = 'yellow' | 'orange' | 'pink' | 'purple' | 'blue' | 'green' | 'gray';
export type ConnectorStyle = 'straight' | 'elbow' | 'curved';
export type ArrowHead = 'none' | 'arrow' | 'dot' | 'diamond';
export type EraserMode = 'stroke' | 'pixel';

interface ToolOptions {
  stickyColor: StickyColor;
  stickyShape: 'square' | 'rounded' | 'circle';
  shapeType: ShapeType;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  fontSize: number;
  connectorStyle: ConnectorStyle;
  arrowStart: ArrowHead;
  arrowEnd: ArrowHead;
  eraserMode: EraserMode;
  eraserSize: number;
}

interface BottomToolbarProps {
  currentTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  toolOptions: ToolOptions;
  onToolOptionsChange: (options: Partial<ToolOptions>) => void;
  onInsertImage: () => void;
  onInsertWidget: (widgetId: string) => void;
  selectedColor: string;
  onColorChange: (color: string) => void;
  onSelectStamp?: (emoji: string) => void;
}

type Popup = 'pen' | 'sticky' | 'shape' | 'connector' | 'drawExtras' | 'insert' | null;

const STICKY_COLORS: Record<StickyColor, string> = {
  yellow: '#FEF3C7',
  orange: '#FED7AA',
  pink: '#FBCFE8',
  purple: '#DDD6FE',
  blue: '#BFDBFE',
  green: '#BBF7D0',
  gray: '#E5E7EB',
};

const PEN_COLORS = [
  '#000000', '#374151', '#6B7280', '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#78716C', '#1E3A8A', '#7C2D12',
];

const MARKER_COLORS = [
  '#FBBF24', '#34D399', '#60A5FA', '#F472B6', '#A78BFA', '#FB923C', '#F87171',
  '#2DD4BF', '#818CF8', '#E879F9', '#4ADE80', '#FACC15', '#38BDF8', '#FB7185',
];

const SHAPE_OPTIONS: { type: ShapeType; icon: ReactNode }[] = [
  { type: 'rectangle', icon: <rect x="3" y="5" width="18" height="14" strokeWidth={2} /> },
  { type: 'rounded-rectangle', icon: <rect x="3" y="5" width="18" height="14" rx="3" strokeWidth={2} /> },
  { type: 'circle', icon: <circle cx="12" cy="12" r="9" strokeWidth={2} /> },
  { type: 'ellipse', icon: <ellipse cx="12" cy="12" rx="10" ry="6" strokeWidth={2} /> },
  { type: 'diamond', icon: <path d="M12 2l10 10-10 10L2 12 12 2z" strokeWidth={2} /> },
  { type: 'triangle', icon: <path d="M12 3l10 18H2L12 3z" strokeWidth={2} /> },
  { type: 'parallelogram', icon: <path d="M6 5h14l-4 14H2l4-14z" strokeWidth={2} /> },
  { type: 'hexagon', icon: <path d="M12 2l8 4v8l-8 4-8-4V6l8-4z" strokeWidth={2} /> },
  { type: 'star', icon: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeWidth={2} /> },
];

export default function BottomToolbar({
  currentTool,
  onToolChange,
  toolOptions,
  onToolOptionsChange,
  onInsertImage,
  onInsertWidget,
  selectedColor,
  onColorChange,
  onSelectStamp,
}: BottomToolbarProps) {
  const [popup, setPopup] = useState<Popup>(null);
  const [showWidgets, setShowWidgets] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setPopup(null);
        setShowWidgets(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const togglePopup = (next: Popup) => {
    setShowWidgets(false);
    setPopup((current) => current === next ? null : next);
  };

  const chooseTool = (tool: ToolType) => {
    onToolChange(tool);
  };

  return (
    <div ref={toolbarRef} className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2">
      <div className="glass-elevated flex items-center gap-0.5 rounded-2xl px-1.5 py-1.5">
        <ToolButton active={currentTool === 'select'} label="Select tool (V)" onClick={() => chooseTool('select')}>
          <CursorIcon />
        </ToolButton>
        <ToolButton active={currentTool === 'pan'} label="Pan tool (H)" onClick={() => chooseTool('pan')}>
          <HandIcon />
        </ToolButton>

        <ToolDivider />

        <div className="relative">
          <ToolButton active={currentTool === 'draw' || popup === 'pen'} label="Pen tool (P)" onClick={() => { chooseTool('draw'); togglePopup('pen'); }}>
            <PenIcon />
          </ToolButton>
          {popup === 'pen' && (
            <PopupPanel>
              <ColorGrid
                label="Pen color"
                colors={PEN_COLORS}
                selectedColor={selectedColor}
                onSelect={(color) => {
                  onColorChange(color);
                  onToolOptionsChange({ strokeColor: color });
                  chooseTool('draw');
                }}
              />
              <SizeRow label="Pen size" values={[2, 4, 6, 8, 12]} selected={toolOptions.strokeWidth} onSelect={(strokeWidth) => onToolOptionsChange({ strokeWidth })} />
            </PopupPanel>
          )}
        </div>

        <div className="relative">
          <ToolButton active={currentTool === 'sticky' || popup === 'sticky'} label="Sticky note tool (S)" onClick={() => { chooseTool('sticky'); togglePopup('sticky'); }}>
            <StickyIcon color={STICKY_COLORS[toolOptions.stickyColor]} />
          </ToolButton>
          {popup === 'sticky' && (
            <PopupPanel>
              <div className="grid w-[188px] grid-cols-4 gap-1" aria-label="Sticky colors">
                {(Object.keys(STICKY_COLORS) as StickyColor[]).map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onToolOptionsChange({ stickyColor: color })}
                    className={`min-h-11 min-w-11 rounded-lg transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${toolOptions.stickyColor === color ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                    style={{ backgroundColor: STICKY_COLORS[color] }}
                    aria-label={`${color} sticky note`}
                    title={`${color} sticky note`}
                  />
                ))}
              </div>
            </PopupPanel>
          )}
        </div>

        <div className="relative">
          <ToolButton active={currentTool === 'shape' || popup === 'shape'} label="Shape tool (R)" onClick={() => { chooseTool('shape'); togglePopup('shape'); }}>
            <ShapeIcon />
          </ToolButton>
          {popup === 'shape' && (
            <PopupPanel>
              <div className="grid w-[140px] grid-cols-3 gap-1" aria-label="Shapes">
                {SHAPE_OPTIONS.map(({ type, icon }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      onToolOptionsChange({ shapeType: type });
                      chooseTool('shape');
                    }}
                    className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${toolOptions.shapeType === type ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/15'}`}
                    aria-label={`${type} shape`}
                    title={type}
                  >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">{icon}</svg>
                  </button>
                ))}
              </div>
            </PopupPanel>
          )}
        </div>

        <ToolButton active={currentTool === 'text'} label="Text tool (T)" onClick={() => chooseTool('text')}>
          <TextIcon />
        </ToolButton>

        <div className="relative">
          <ToolButton active={currentTool === 'connector' || popup === 'connector'} label="Connector tool (C)" onClick={() => { chooseTool('connector'); togglePopup('connector'); }}>
            <ConnectorIcon />
          </ToolButton>
          {popup === 'connector' && <ConnectorOptionsPopup toolOptions={toolOptions} onToolOptionsChange={onToolOptionsChange} />}
        </div>

        <ToolButton active={currentTool === 'frame'} label="Frame tool (F)" onClick={() => chooseTool('frame')}>
          <FrameIcon />
        </ToolButton>

        <ToolDivider />

        <div className="relative">
          <ToolButton active={currentTool === 'marker' || currentTool === 'eraser' || popup === 'drawExtras'} label="Drawing extras" onClick={() => togglePopup('drawExtras')}>
            <SparkIcon />
          </ToolButton>
          {popup === 'drawExtras' && (
            <PopupPanel width="w-64">
              <ToolMenuItem active={currentTool === 'marker'} label="Marker" shortcut="M" onClick={() => chooseTool('marker')} icon={<MarkerIcon />} />
              <ToolMenuItem active={currentTool === 'eraser'} label="Eraser" shortcut="X" onClick={() => chooseTool('eraser')} icon={<EraserIcon />} />
              <div className="my-2 border-t" style={{ borderColor: 'var(--glass-border-strong)' }} />
              <ColorGrid
                label="Marker color"
                colors={MARKER_COLORS}
                selectedColor={selectedColor}
                onSelect={(color) => {
                  onColorChange(color);
                  onToolOptionsChange({ strokeColor: color });
                  chooseTool('marker');
                }}
              />
              <SizeRow label="Marker size" values={[4, 8, 12, 16, 20]} selected={toolOptions.strokeWidth} onSelect={(strokeWidth) => onToolOptionsChange({ strokeWidth })} />
              <SizeRow label="Eraser size" values={[10, 20, 30, 40, 50]} selected={toolOptions.eraserSize} onSelect={(eraserSize) => onToolOptionsChange({ eraserSize })} />
            </PopupPanel>
          )}
        </div>

        <div className="relative">
          <ToolButton active={currentTool === 'stamp' || popup === 'insert'} label="Insert tools" onClick={() => togglePopup('insert')}>
            <PlusIcon />
          </ToolButton>
          {popup === 'insert' && (
            <PopupPanel width="w-52" align="right">
              <ToolMenuItem label="Image" onClick={() => { onInsertImage(); setPopup(null); }} icon={<ImageIcon />} />
              <ToolMenuItem label="Widgets" onClick={() => { setShowWidgets(true); }} icon={<WidgetIcon />} />
              <div className="my-2 border-t" style={{ borderColor: 'var(--glass-border-strong)' }} />
              <div className="mb-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Stamps</div>
              <StampGrid
                onSelect={(emoji) => {
                  onSelectStamp?.(emoji);
                  chooseTool('stamp');
                  setPopup(null);
                }}
              />
            </PopupPanel>
          )}
          {showWidgets && (
            <div className="absolute bottom-full right-0 mb-2">
              <WidgetsPanel isOpen={showWidgets} onClose={() => setShowWidgets(false)} onInsertWidget={(widgetId) => { onInsertWidget(widgetId); setShowWidgets(false); setPopup(null); }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-btn flex min-h-11 min-w-11 items-center justify-center rounded-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${active ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/15'}`}
      style={active ? undefined : { color: 'var(--text-primary)' }}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function ToolMenuItem({ active, label, shortcut, icon, onClick }: { active?: boolean; label: string; shortcut?: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${active ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/15'}`}
      style={active ? undefined : { color: 'var(--text-primary)' }}
    >
      <span className="flex items-center gap-2">{icon}{label}</span>
      {shortcut && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{shortcut}</span>}
    </button>
  );
}

function PopupPanel({ children, width = 'w-auto', align = 'left' }: { children: ReactNode; width?: string; align?: 'left' | 'right' }) {
  return (
    <div className={`glass-elevated glass-panel-enter absolute bottom-full mb-2 rounded-2xl p-2 shadow-xl ${width} ${align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>
      {children}
    </div>
  );
}

function ColorGrid({ label, colors, selectedColor, onSelect }: { label: string; colors: string[]; selectedColor: string; onSelect: (color: string) => void }) {
  return (
    <>
      <div className="mb-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="mb-3 grid grid-cols-6 gap-0.5">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onSelect(color)}
            className={`min-h-8 min-w-8 rounded-full transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${selectedColor === color ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
            style={{ backgroundColor: color }}
            aria-label={`Use ${color}`}
            title={color}
          />
        ))}
      </div>
    </>
  );
}

function SizeRow({ label, values, selected, onSelect }: { label: string; values: number[]; selected: number; onSelect: (value: number) => void }) {
  return (
    <>
      <div className="mb-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="mb-3 flex gap-1">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${selected === value ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/15'}`}
            style={selected === value ? undefined : { color: 'var(--text-primary)' }}
            aria-label={`${label} ${value}`}
            title={`${value}`}
          >
            <span className="rounded-full bg-current" style={{ width: Math.min(value * 1.2, 18), height: Math.min(value * 1.2, 18) }} />
          </button>
        ))}
      </div>
    </>
  );
}

function StampGrid({ onSelect }: { onSelect: (emoji: string) => void }) {
  const stamps = ['👍', '👎', '❤️', '🎉', '🤔', '👀', '🔥', '⭐', '✅', '❌', '💡', '🚀'];
  return (
    <div className="grid grid-cols-4 gap-1">
      {stamps.map((stamp) => (
        <button
          key={stamp}
          type="button"
          onClick={() => onSelect(stamp)}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          aria-label={`Stamp ${stamp}`}
          title={`Stamp ${stamp}`}
        >
          {stamp}
        </button>
      ))}
    </div>
  );
}

function ToolDivider() {
  return <div className="mx-0.5 h-7 w-px" style={{ background: 'var(--glass-border-strong)' }} />;
}

function ConnectorOptionsPopup({ toolOptions, onToolOptionsChange }: { toolOptions: ToolOptions; onToolOptionsChange: (options: Partial<ToolOptions>) => void }) {
  return (
    <PopupPanel width="w-56">
      <div className="mb-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Line style</div>
      <div className="mb-3 flex gap-1">
        {(['straight', 'elbow', 'curved'] as const).map((style) => (
          <button
            key={style}
            type="button"
            onClick={() => onToolOptionsChange({ connectorStyle: style })}
            className={`flex min-h-11 flex-1 items-center justify-center rounded-lg capitalize transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${toolOptions.connectorStyle === style ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/15'}`}
            style={toolOptions.connectorStyle === style ? undefined : { color: 'var(--text-primary)' }}
            aria-label={`${style} connector`}
            title={style}
          >
            {style[0].toUpperCase()}
          </button>
        ))}
      </div>
      <div className="mb-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Arrow end</div>
      <div className="flex gap-1">
        {(['none', 'arrow', 'dot', 'diamond'] as const).map((head) => (
          <button
            key={head}
            type="button"
            onClick={() => onToolOptionsChange({ arrowEnd: head })}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${toolOptions.arrowEnd === head ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/15'}`}
            style={toolOptions.arrowEnd === head ? undefined : { color: 'var(--text-primary)' }}
            aria-label={`${head} arrow end`}
            title={head}
          >
            {head === 'none' ? '-' : head[0].toUpperCase()}
          </button>
        ))}
      </div>
    </PopupPanel>
  );
}

function CursorIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2z" /></svg>;
}
function HandIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" /></svg>;
}
function PenIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>;
}
function StickyIcon({ color }: { color: string }) {
  return <svg className="h-5 w-5" fill={color} viewBox="0 0 24 24" stroke="currentColor"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h8l6-6V5a2 2 0 00-2-2zm-1 12h-4a2 2 0 00-2 2v4H5V5h14v10z" /></svg>;
}
function ShapeIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} /></svg>;
}
function TextIcon() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4v3h5.5v12h3V7H19V4H5z" /></svg>;
}
function ConnectorIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>;
}
function FrameIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2" /></svg>;
}
function SparkIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 3l1.6 4.4L19 9l-4.4 1.6L13 15l-1.6-4.4L7 9l4.4-1.6L13 3zM6 14l.9 2.1L9 17l-2.1.9L6 20l-.9-2.1L3 17l2.1-.9L6 14z" /></svg>;
}
function MarkerIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M18 3L6 15l-3 6 6-3L21 6l-3-3z" /><path d="M15 6l3 3" /></svg>;
}
function EraserIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8l10-10c.8-.8 2-.8 2.8 0l5.2 5.2c.8.8.8 2 0 2.8L12 20" /><path d="M6 11l5 5" /></svg>;
}
function PlusIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" /></svg>;
}
function ImageIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
}
function WidgetIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" /></svg>;
}
