import { useLayoutEffect, useRef, useState } from 'react';
import { boardFontOption, boardFonts } from '../lib/boardFonts';
import type { Element, ShapeElement, StickyColor, StickyElement, TextElement } from '../lib/elements';

interface FloatingObjectToolbarProps {
  element: Element | null;
  scale: number;
  offset: { x: number; y: number };
  onUpdate: (id: string, changes: Partial<Element>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const stickyColors: Record<StickyColor, string> = {
  yellow: '#FEF3C7',
  orange: '#FFEDD5',
  pink: '#FCE7F3',
  purple: '#EDE9FE',
  blue: '#DBEAFE',
  green: '#D1FAE5',
  gray: '#F3F4F6',
};

const strokeWidths = [1, 2, 4, 6, 8];
const fontSizes = [12, 16, 20, 24, 32];

export default function FloatingObjectToolbar({
  element,
  scale,
  offset,
  onUpdate,
  onDuplicate,
  onDelete,
}: FloatingObjectToolbarProps) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [halfWidth, setHalfWidth] = useState(0);
  const kind = element?.type;

  useLayoutEffect(() => {
    const node = toolbar.current;
    if (!node) return;
    const measure = () => setHalfWidth(node.offsetWidth / 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [kind]);

  if (!element || (element.type !== 'sticky' && element.type !== 'shape' && element.type !== 'text')) {
    return null;
  }

  const left = offset.x + (element.x + element.width / 2) * scale;
  const top = Math.max(72, offset.y + element.y * scale - 60);
  const margin = halfWidth + 8;

  return (
    <div
      ref={toolbar}
      className="glass-elevated glass-panel-enter absolute z-50 flex w-max max-w-[calc(100vw-20px)] flex-wrap items-center justify-center gap-1 rounded-2xl px-2 py-1.5 shadow-xl"
      style={{ left: `clamp(min(${margin}px, 50vw), ${left}px, max(calc(100vw - ${margin}px), 50vw))`, top, transform: 'translateX(-50%)' }}
      role="toolbar"
      aria-label={`${element.type} controls`}
    >
      {element.type === 'sticky' && (
        <StickyControls element={element as StickyElement} onUpdate={onUpdate} />
      )}
      {element.type === 'shape' && (
        <ShapeControls element={element as ShapeElement} onUpdate={onUpdate} />
      )}
      {element.type === 'text' && (
        <TextControls element={element as TextElement} onUpdate={onUpdate} />
      )}

      <FontFamilySelect value={element.fontFamily} onChange={fontFamily => onUpdate(element.id, { fontFamily })} />

      <Divider />
      <IconButton label="Duplicate selected object" onClick={onDuplicate}>
        <DuplicateIcon />
      </IconButton>
      <IconButton label="Delete selected object" onClick={onDelete} danger>
        <TrashIcon />
      </IconButton>
    </div>
  );
}

function StickyControls({ element, onUpdate }: { element: StickyElement; onUpdate: (id: string, changes: Partial<Element>) => void }) {
  return (
    <>
      <div className="flex flex-wrap justify-center gap-1">
        {(Object.keys(stickyColors) as StickyColor[]).map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onUpdate(element.id, { color } as Partial<Element>)}
            className={`min-h-9 min-w-9 rounded-lg transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${element.color === color ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
            style={{ backgroundColor: stickyColors[color] }}
            aria-label={`${color} sticky color`}
            title={`${color} sticky color`}
          />
        ))}
      </div>
      <Divider />
      <FontSizeSelect value={element.fontSize} onChange={(fontSize) => onUpdate(element.id, { fontSize } as Partial<Element>)} />
    </>
  );
}

function ShapeControls({ element, onUpdate }: { element: ShapeElement; onUpdate: (id: string, changes: Partial<Element>) => void }) {
  return (
    <>
      <ColorInput label="Shape fill" value={element.fill} onChange={(fill) => onUpdate(element.id, { fill } as Partial<Element>)} />
      <ColorInput label="Shape stroke" value={element.stroke} onChange={(stroke) => onUpdate(element.id, { stroke } as Partial<Element>)} />
      <div className="flex items-center gap-1">
        {strokeWidths.map((strokeWidth) => (
          <button
            key={strokeWidth}
            type="button"
            onClick={() => onUpdate(element.id, { strokeWidth } as Partial<Element>)}
            className={`flex min-h-9 min-w-9 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${element.strokeWidth === strokeWidth ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/15'}`}
            style={element.strokeWidth === strokeWidth ? undefined : { color: 'var(--text-primary)' }}
            aria-label={`Stroke width ${strokeWidth}`}
            title={`Stroke width ${strokeWidth}`}
          >
            <span className="w-5 rounded-full bg-current" style={{ height: Math.max(1, strokeWidth) }} />
          </button>
        ))}
      </div>
    </>
  );
}

function TextControls({ element, onUpdate }: { element: TextElement; onUpdate: (id: string, changes: Partial<Element>) => void }) {
  return (
    <>
      <FontSizeSelect value={element.fontSize} onChange={(fontSize) => onUpdate(element.id, { fontSize } as Partial<Element>)} />
      <ColorInput label="Text color" value={element.color} onChange={(color) => onUpdate(element.id, { color } as Partial<Element>)} />
      <IconButton
        label="Bold"
        active={element.fontWeight === 'bold'}
        onClick={() => onUpdate(element.id, { fontWeight: element.fontWeight === 'bold' ? 'normal' : 'bold' } as Partial<Element>)}
      >
        <span className="text-sm font-bold">B</span>
      </IconButton>
      <IconButton
        label="Italic"
        active={element.fontStyle === 'italic'}
        onClick={() => onUpdate(element.id, { fontStyle: element.fontStyle === 'italic' ? 'normal' : 'italic' } as Partial<Element>)}
      >
        <span className="text-sm italic">I</span>
      </IconButton>
    </>
  );
}

function FontFamilySelect({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const selected = boardFontOption(value)?.family ?? (value || boardFonts[0].family);
  const known = boardFonts.some(font => font.family === selected);

  return (
    <label className="relative grid min-h-9 min-w-9 place-items-center rounded-lg hover:bg-[var(--badge-bg)] focus-within:outline-2 focus-within:outline-[var(--focus-ring)]">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <path d="M5 5h14M12 5v14M8 19h8M5 5v3M19 5v3" />
      </svg>
      <select className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Font Family" title="Font Family"
        value={selected} onChange={event => onChange(event.target.value)}>
        {!known && <option value={selected}>{selected.split(',')[0]}</option>}
        {boardFonts.map(font => <option key={font.family} value={font.family}>{font.label}</option>)}
      </select>
    </label>
  );
}

function FontSizeSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="min-h-9 rounded-lg border px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      style={{ background: 'var(--glass-bg-subtle)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}
      aria-label="Text size"
      title="Text size"
    >
      {fontSizes.map((size) => (
        <option key={size} value={size}>{size}px</option>
      ))}
    </select>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex min-h-9 min-w-9 items-center justify-center rounded-lg hover:bg-white/15" title={label}>
      <span className="sr-only">{label}</span>
      <input
        type="color"
        value={value === 'transparent' ? '#ffffff' : value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-7 rounded"
        aria-label={label}
      />
    </label>
  );
}

function IconButton({ label, active, danger, onClick, children }: { label: string; active?: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-9 min-w-9 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${active ? 'bg-blue-100 text-blue-700' : 'hover:bg-white/15'}`}
      style={active ? undefined : { color: danger ? '#EF4444' : 'var(--text-primary)' }}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px" style={{ background: 'var(--glass-border-strong)' }} />;
}

function DuplicateIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1" /></svg>;
}

function TrashIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3m-8 0h10" /></svg>;
}
