import { useState, useRef, useEffect } from 'react';
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

// Additional marker colors (highlighter-style)
const MARKER_COLORS = [
  '#FBBF24', // Yellow highlighter
  '#34D399', // Green highlighter
  '#60A5FA', // Blue highlighter
  '#F472B6', // Pink highlighter
  '#A78BFA', // Purple highlighter
  '#FB923C', // Orange highlighter
  '#F87171', // Red highlighter
  '#2DD4BF', // Teal highlighter
  '#818CF8', // Indigo highlighter
  '#E879F9', // Fuchsia highlighter
  '#4ADE80', // Lime highlighter
  '#FACC15', // Amber highlighter
  '#38BDF8', // Sky highlighter
  '#FB7185', // Rose highlighter
];

const SHAPE_OPTIONS: { type: ShapeType; icon: React.ReactNode }[] = [
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
  const [showStickyOptions, setShowStickyOptions] = useState(false);
  const [showShapeOptions, setShowShapeOptions] = useState(false);
  const [showConnectorOptions, setShowConnectorOptions] = useState(false);
  const [showWidgets, setShowWidgets] = useState(false);
  const [showStampPicker, setShowStampPicker] = useState(false);
  const [showPenOptions, setShowPenOptions] = useState(false);
  const [showMarkerOptions, setShowMarkerOptions] = useState(false);
  const [showEraserOptions, setShowEraserOptions] = useState(false);
  const [showMoreTools, setShowMoreTools] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const closeAllPopups = () => {
    setShowStickyOptions(false);
    setShowShapeOptions(false);
    setShowConnectorOptions(false);
    setShowWidgets(false);
    setShowStampPicker(false);
    setShowPenOptions(false);
    setShowMarkerOptions(false);
    setShowEraserOptions(false);
    setShowMoreTools(false);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        closeAllPopups();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={toolbarRef} className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
      <div className="flex items-center gap-0.5 px-2 py-1.5 glass-elevated rounded-2xl">
        {/* Group 1: Cursor & Pan */}
        <div className="flex items-center rounded-lg p-0.5">
          <ToolButton
            active={currentTool === 'select'}
            onClick={() => { closeAllPopups(); onToolChange('select'); }}
            title="Cursor (V)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2z" />
            </svg>
          </ToolButton>
          <ToolButton
            active={currentTool === 'pan'}
            onClick={() => { closeAllPopups(); onToolChange('pan'); }}
            title="Pan (H)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
            </svg>
          </ToolButton>
        </div>

        <ToolDivider />

        {/* Group 2: Pen, Marker & Eraser */}
        <div className="flex items-center rounded-lg p-0.5">
          {/* Pen Tool */}
          <div className="relative">
            <ToolButton
              active={currentTool === 'draw'}
              onClick={() => { closeAllPopups(); onToolChange('draw'); setShowPenOptions(!showPenOptions); }}
              title="Pen (P)"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </ToolButton>
            {showPenOptions && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 glass-elevated rounded-xl glass-panel-enter min-w-[200px]">
                <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Color</div>
                <div className="grid grid-cols-7 gap-1 mb-3">
                  {PEN_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => { onColorChange(color); onToolOptionsChange({ strokeColor: color }); onToolChange('draw'); }}
                      className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${selectedColor === color ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Size</div>
                <div className="flex gap-1">
                  {[2, 4, 6, 8, 12].map((width) => (
                    <button
                      key={width}
                      onClick={() => onToolOptionsChange({ strokeWidth: width })}
                      className={`w-8 h-8 rounded flex items-center justify-center ${toolOptions.strokeWidth === width ? 'bg-blue-100' : 'hover:bg-white/10'}`}
                    >
                      <div className="rounded-full bg-current" style={{ width: Math.min(width * 1.5, 16), height: Math.min(width * 1.5, 16) }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Marker Tool with color options */}
          <div className="relative">
            <ToolButton
              active={currentTool === 'marker'}
              onClick={() => { 
                closeAllPopups(); 
                onToolChange('marker'); 
                setShowMarkerOptions(!showMarkerOptions);
              }}
              title="Marker (M)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 3L6 15l-3 6 6-3L21 6l-3-3z" />
                <path d="M15 6l3 3" />
              </svg>
            </ToolButton>
            {showMarkerOptions && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 glass-elevated rounded-xl glass-panel-enter min-w-[220px]">
                <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Highlighter Colors</div>
                <div className="grid grid-cols-7 gap-1 mb-3">
                  {MARKER_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => { onColorChange(color); onToolOptionsChange({ strokeColor: color }); onToolChange('marker'); }}
                      className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${selectedColor === color ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Size</div>
                <div className="flex gap-1">
                  {[4, 8, 12, 16, 20].map((width) => (
                    <button
                      key={width}
                      onClick={() => onToolOptionsChange({ strokeWidth: width })}
                      className={`w-8 h-8 rounded flex items-center justify-center ${toolOptions.strokeWidth === width ? 'bg-blue-100' : 'hover:bg-white/10'}`}
                    >
                      <div className="rounded-full bg-current" style={{ width: Math.min(width * 0.8, 16), height: Math.min(width * 0.8, 16) }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Eraser Tool */}
          <div className="relative">
            <ToolButton
              active={currentTool === 'eraser'}
              onClick={() => { closeAllPopups(); onToolChange('eraser'); setShowEraserOptions(!showEraserOptions); }}
              title="Eraser (X)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8l10-10c.8-.8 2-.8 2.8 0l5.2 5.2c.8.8.8 2 0 2.8L12 20" />
                <path d="M6 11l5 5" />
              </svg>
            </ToolButton>
            {showEraserOptions && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 glass-elevated rounded-xl glass-panel-enter min-w-[200px]">
                <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Mode</div>
                <div className="flex gap-1 mb-3">
                  <button
                    onClick={() => onToolOptionsChange({ eraserMode: 'stroke' })}
                    className={`flex-1 py-2 px-3 text-xs rounded flex flex-col items-center gap-1 ${toolOptions.eraserMode === 'stroke' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'hover:bg-white/10 border border-white/10'}`}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M3 6h18M3 12h18M3 18h18" /><path d="M19 6l-4 4M19 12l-4 4" strokeLinecap="round" />
                    </svg>
                    <span>Stroke</span>
                  </button>
                  <button
                    onClick={() => onToolOptionsChange({ eraserMode: 'pixel' })}
                    className={`flex-1 py-2 px-3 text-xs rounded flex flex-col items-center gap-1 ${toolOptions.eraserMode === 'pixel' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'hover:bg-white/10 border border-white/10'}`}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="8" strokeDasharray="4 2" /><circle cx="12" cy="12" r="3" fill="currentColor" />
                    </svg>
                    <span>Pixel</span>
                  </button>
                </div>
                <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Size</div>
                <div className="flex gap-1">
                  {[10, 20, 30, 40, 50].map((size) => (
                    <button
                      key={size}
                      onClick={() => onToolOptionsChange({ eraserSize: size })}
                      className={`w-8 h-8 rounded flex items-center justify-center ${toolOptions.eraserSize === size ? 'bg-blue-100' : 'hover:bg-white/10'}`}
                    >
                      <div className="rounded-full bg-gray-400" style={{ width: Math.min(size * 0.4, 20), height: Math.min(size * 0.4, 20) }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <ToolDivider />

        {/* Group 3: Shapes & Connectors */}
        <div className="flex items-center rounded-lg p-0.5">
          {/* Shape Tool */}
          <div className="relative">
            <ToolButton
              active={currentTool === 'shape'}
              onClick={() => { closeAllPopups(); onToolChange('shape'); setShowShapeOptions(!showShapeOptions); }}
              title="Shape (R)"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} />
              </svg>
            </ToolButton>
            {showShapeOptions && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 glass-elevated rounded-xl glass-panel-enter">
                <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Shapes</div>
                <div className="grid grid-cols-3 gap-1" style={{ width: '140px' }}>
                  {SHAPE_OPTIONS.map(({ type, icon }) => (
                    <button
                      key={type}
                      onClick={() => { onToolOptionsChange({ shapeType: type }); onToolChange('shape'); }}
                      className={`w-10 h-10 rounded flex items-center justify-center ${toolOptions.shapeType === type ? 'bg-blue-100' : 'hover:bg-white/10'}`}
                      title={type}
                    >
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">{icon}</svg>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Connector Tool */}
          <div className="relative">
            <ToolButton
              active={currentTool === 'connector'}
              onClick={() => { closeAllPopups(); onToolChange('connector'); setShowConnectorOptions(!showConnectorOptions); }}
              title="Connector (C)"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </ToolButton>
            {showConnectorOptions && <ConnectorOptionsPopup toolOptions={toolOptions} onToolOptionsChange={onToolOptionsChange} />}
          </div>
        </div>

        <ToolDivider />

        {/* Group 4: Sticky Notes */}
        <div className="relative">
          <ToolButton
            active={currentTool === 'sticky'}
            onClick={() => { closeAllPopups(); onToolChange('sticky'); setShowStickyOptions(!showStickyOptions); }}
            title="Sticky Note (S)"
          >
            <div className="relative">
              <svg className="w-5 h-5" fill={STICKY_COLORS[toolOptions.stickyColor]} viewBox="0 0 24 24" stroke="currentColor">
                <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h8l6-6V5a2 2 0 00-2-2zm-1 12h-4a2 2 0 00-2 2v4H5V5h14v10z" />
              </svg>
            </div>
          </ToolButton>
          {showStickyOptions && (
            <div className="absolute bottom-full left-0 mb-2 p-3 glass-elevated rounded-xl glass-panel-enter min-w-[200px]">
              <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Color</div>
              <div className="flex gap-1 mb-3">
                {(Object.keys(STICKY_COLORS) as StickyColor[]).map((color) => (
                  <button
                    key={color}
                    onClick={() => onToolOptionsChange({ stickyColor: color })}
                    className={`w-6 h-6 rounded ${toolOptions.stickyColor === color ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                    style={{ backgroundColor: STICKY_COLORS[color] }}
                  />
                ))}
              </div>
              <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Shape</div>
              <div className="flex gap-1">
                {(['square', 'rounded', 'circle'] as const).map((shape) => (
                  <button
                    key={shape}
                    onClick={() => onToolOptionsChange({ stickyShape: shape })}
                    className={`w-8 h-8 border rounded flex items-center justify-center ${toolOptions.stickyShape === shape ? 'border-blue-500 bg-blue-50' : 'border-white/10 hover:bg-white/10'}`}
                  >
                    {shape === 'square' && <div className="w-4 h-4 bg-yellow-200" />}
                    {shape === 'rounded' && <div className="w-4 h-4 bg-yellow-200 rounded" />}
                    {shape === 'circle' && <div className="w-4 h-4 bg-yellow-200 rounded-full" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <ToolDivider />

        {/* Group 5: Text */}
        <ToolButton
          active={currentTool === 'text'}
          onClick={() => { closeAllPopups(); onToolChange('text'); }}
          title="Text (T)"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 4v3h5.5v12h3V7H19V4H5z" />
          </svg>
        </ToolButton>

        <ToolDivider />

        {/* Group 6: Frame */}
        <ToolButton
          active={currentTool === 'frame'}
          onClick={() => { closeAllPopups(); onToolChange('frame'); }}
          title="Frame (F)"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2" />
          </svg>
        </ToolButton>

        <ToolDivider />

        {/* Group 7: Stamp */}
        <div className="relative">
          <ToolButton
            active={currentTool === 'stamp'}
            onClick={() => { closeAllPopups(); onToolChange('stamp'); setShowStampPicker(!showStampPicker); }}
            title="Stamp (E)"
          >
            <span className="text-lg">😀</span>
          </ToolButton>
          {showStampPicker && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2">
              <StampPickerDropdown onSelect={(emoji) => { onSelectStamp?.(emoji); setShowStampPicker(false); }} />
            </div>
          )}
        </div>

        <ToolDivider />

        {/* Group 8: More Tools (Image, Widgets) */}
        <div className="relative">
          <ToolButton
            active={showMoreTools}
            onClick={() => { closeAllPopups(); setShowMoreTools(!showMoreTools); }}
            title="More tools"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
            </svg>
          </ToolButton>
          {showMoreTools && (
            <div className="absolute bottom-full right-0 mb-2 p-2 glass-elevated rounded-xl glass-panel-enter min-w-[160px]">
              <button
                onClick={() => { onInsertImage(); setShowMoreTools(false); }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-white/10 rounded flex items-center gap-2" style={{ color: 'var(--text-primary)' }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Insert Image
              </button>
              <button
                onClick={() => { setShowMoreTools(false); setShowWidgets(true); }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-white/10 rounded flex items-center gap-2" style={{ color: 'var(--text-primary)' }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                </svg>
                Components
              </button>
            </div>
          )}
        </div>

        {/* Widgets Panel */}
        {showWidgets && (
          <div className="absolute bottom-full right-0 mb-2">
            <WidgetsPanel isOpen={showWidgets} onClose={() => setShowWidgets(false)} onInsertWidget={onInsertWidget} />
          </div>
        )}
      </div>
    </div>
  );
}


interface ToolButtonProps {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}

function ToolButton({ active, onClick, title, children }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`glass-btn p-2 rounded-lg transition-all ${active ? 'bg-blue-100 text-blue-600' : 'hover:bg-white/10'}`}
      style={active ? undefined : { color: 'var(--text-primary)' }}
      title={title}
    >
      {children}
    </button>
  );
}

function ToolDivider() {
  return <div className="w-px h-6 mx-1" style={{ background: 'var(--glass-border-strong)' }} />;
}

function StampPickerDropdown({ onSelect }: { onSelect: (emoji: string) => void }) {
  const stamps = ['👍', '👎', '❤️', '🎉', '🤔', '👀', '🔥', '⭐', '✅', '❌', '💡', '🚀'];
  return (
    <div className="glass-elevated rounded-xl glass-panel-enter p-2 w-48">
      <div className="grid grid-cols-6 gap-1">
        {stamps.map((stamp) => (
          <button key={stamp} onClick={() => onSelect(stamp)} className="w-7 h-7 flex items-center justify-center text-lg hover:bg-white/10 rounded transition-colors">
            {stamp}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConnectorOptionsPopup({ toolOptions, onToolOptionsChange }: { toolOptions: ToolOptions; onToolOptionsChange: (options: Partial<ToolOptions>) => void }) {
  return (
    <div className="absolute bottom-full left-0 mb-2 p-3 glass-elevated rounded-xl glass-panel-enter min-w-[200px]">
      <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Line Style</div>
      <div className="flex gap-1 mb-3">
        <button onClick={() => onToolOptionsChange({ connectorStyle: 'straight' })} className={`flex-1 p-2 rounded flex items-center justify-center ${toolOptions.connectorStyle === 'straight' ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/10'}`} style={toolOptions.connectorStyle !== 'straight' ? { color: 'var(--text-primary)' } : undefined} title="Straight">
          <svg className="w-6 h-4" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth={2}><line x1="2" y1="8" x2="22" y2="8" /></svg>
        </button>
        <button onClick={() => onToolOptionsChange({ connectorStyle: 'elbow' })} className={`flex-1 p-2 rounded flex items-center justify-center ${toolOptions.connectorStyle === 'elbow' ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/10'}`} style={toolOptions.connectorStyle !== 'elbow' ? { color: 'var(--text-primary)' } : undefined} title="Elbow">
          <svg className="w-6 h-4" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth={2}><path d="M2 12 L12 12 L12 4 L22 4" fill="none" /></svg>
        </button>
        <button onClick={() => onToolOptionsChange({ connectorStyle: 'curved' })} className={`flex-1 p-2 rounded flex items-center justify-center ${toolOptions.connectorStyle === 'curved' ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/10'}`} style={toolOptions.connectorStyle !== 'curved' ? { color: 'var(--text-primary)' } : undefined} title="Curved">
          <svg className="w-6 h-4" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth={2}><path d="M2 12 Q12 12 12 8 Q12 4 22 4" fill="none" /></svg>
        </button>
      </div>
      <div className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>Arrows</div>
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5">
          {(['none', 'arrow', 'dot', 'diamond'] as const).map((head) => (
            <button key={`start-${head}`} onClick={() => onToolOptionsChange({ arrowStart: head })} className={`w-7 h-7 rounded flex items-center justify-center ${toolOptions.arrowStart === head ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/10'}`} style={toolOptions.arrowStart !== head ? { color: 'var(--text-primary)' } : undefined} title={head}>
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" strokeWidth={1}>
                {head === 'none' && <line x1="2" y1="8" x2="14" y2="8" strokeWidth={2} />}
                {head === 'arrow' && <path d="M14 8 L6 4 L6 12 Z" />}
                {head === 'dot' && <><circle cx="4" cy="8" r="3" /><line x1="7" y1="8" x2="14" y2="8" strokeWidth={2} /></>}
                {head === 'diamond' && <><path d="M2 8 L6 4 L10 8 L6 12 Z" /><line x1="10" y1="8" x2="14" y2="8" strokeWidth={2} /></>}
              </svg>
            </button>
          ))}
        </div>
        <span className="text-gray-300 text-lg">→</span>
        <div className="flex gap-0.5">
          {(['none', 'arrow', 'dot', 'diamond'] as const).map((head) => (
            <button key={`end-${head}`} onClick={() => onToolOptionsChange({ arrowEnd: head })} className={`w-7 h-7 rounded flex items-center justify-center ${toolOptions.arrowEnd === head ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/10'}`} style={toolOptions.arrowEnd !== head ? { color: 'var(--text-primary)' } : undefined} title={head}>
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" strokeWidth={1}>
                {head === 'none' && <line x1="2" y1="8" x2="14" y2="8" strokeWidth={2} />}
                {head === 'arrow' && <path d="M2 8 L10 4 L10 12 Z" transform="rotate(180 8 8)" />}
                {head === 'dot' && <><line x1="2" y1="8" x2="9" y2="8" strokeWidth={2} /><circle cx="12" cy="8" r="3" /></>}
                {head === 'diamond' && <><line x1="2" y1="8" x2="6" y2="8" strokeWidth={2} /><path d="M6 8 L10 4 L14 8 L10 12 Z" /></>}
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
