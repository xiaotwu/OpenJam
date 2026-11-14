// Element renderer - renders all element types
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../i18n';
import type { BoardImages } from '../../lib/boardImages';
import type { Element, ImageElement as ImageElementType, FrameElement as FrameElementType, DrawingElement } from '../../lib/elements';
import StickyNote from './StickyNote';
import Shape from './Shape';
import TextBox from './TextBox';
import Connector from './Connector';
import Drawing from './Drawing';

// Helper to calculate drawing bounds from points
function getDrawingBounds(element: DrawingElement) {
  if (element.points.length === 0) {
    return { x: element.x, y: element.y, width: 0, height: 0 };
  }
  
  const xs = element.points.map(p => p.x);
  const ys = element.points.map(p => p.y);
  
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  
  const padding = element.strokeWidth / 2 + 2;
  
  return {
    x: element.x + minX - padding,
    y: element.y + minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

interface ElementRendererProps {
  element: Element;
  boardImages?: BoardImages;
  isSelected: boolean;
  isEditing: boolean;
  scale: number;
  onSelect: (id: string, addToSelection: boolean) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
  onUpdate: (id: string, changes: Partial<Element>, expected?: Record<string, unknown>) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  isPinned?: boolean;
}

function ElementRenderer({
  element,
  boardImages,
  isSelected,
  isEditing,
  scale,
  onSelect,
  onStartEdit,
  onEndEdit,
  onUpdate,
  onMove,
  onResize,
  isPinned = false,
}: ElementRendererProps) {
  // Render element with optional pin indicator
  const renderElement = () => {
    switch (element.type) {
    case 'sticky':
      return (
        <StickyNote
          element={element}
          isSelected={isSelected}
          isEditing={isEditing}
          scale={scale}
          onSelect={onSelect}
          onStartEdit={onStartEdit}
          onEndEdit={onEndEdit}
          onUpdate={onUpdate}
          onMove={onMove}
          onResize={onResize}
        />
      );

    case 'shape':
      return (
        <Shape
          element={element}
          isSelected={isSelected}
          isEditing={isEditing}
          scale={scale}
          onSelect={onSelect}
          onStartEdit={onStartEdit}
          onEndEdit={onEndEdit}
          onUpdate={onUpdate}
        />
      );

    case 'text':
      return (
        <TextBox
          element={element}
          isSelected={isSelected}
          isEditing={isEditing}
          scale={scale}
          onSelect={onSelect}
          onStartEdit={onStartEdit}
          onEndEdit={onEndEdit}
          onUpdate={onUpdate}
        />
      );

    case 'connector':
      return (
        <Connector
          element={element}
          isSelected={isSelected}
          scale={scale}
          onSelect={onSelect}
          onUpdate={onUpdate}
        />
      );

    case 'drawing':
      return (
        <Drawing
          element={element}
          isSelected={isSelected}
          scale={scale}
          onSelect={onSelect}
        />
      );

    case 'image':
      return (
        <ImageElement
          element={element}
          boardImages={boardImages}
          isSelected={isSelected}
          onSelect={onSelect}
        />
      );

    case 'frame':
      return (
        <FrameElement
          element={element}
          isSelected={isSelected}
          isEditing={isEditing}
          onSelect={onSelect}
          onStartEdit={onStartEdit}
          onEndEdit={onEndEdit}
          onUpdate={onUpdate}
        />
      );

    default:
      return null;
    }
  };

  const rendered = renderElement();
  
  // Add pin indicator if pinned
  if (isPinned && rendered) {
    // Calculate bounds - for drawings, use actual point bounds
    let bounds = {
      x: element.x - 4,
      y: element.y - 4,
      width: (element.width || 100) + 8,
      height: (element.height || 100) + 8,
    };
    
    if (element.type === 'drawing') {
      const drawingBounds = getDrawingBounds(element);
      bounds = {
        x: drawingBounds.x - 4,
        y: drawingBounds.y - 4,
        width: drawingBounds.width + 8,
        height: drawingBounds.height + 8,
      };
    }
    
    return (
      <>
        {rendered}
        <div
          className="absolute border-2 border-dashed border-purple-500 rounded-lg pointer-events-none"
          style={{
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
            zIndex: element.zIndex + 1000,
          }}
        />
      </>
    );
  }
  
  return rendered;
}

export default memo(ElementRenderer);

// Image element component

interface ImageElementProps {
  element: ImageElementType;
  boardImages?: BoardImages;
  isSelected: boolean;
  onSelect: (id: string, addToSelection: boolean) => void;
}

function ImageElement({ element, boardImages, isSelected, onSelect }: ImageElementProps) {
  const { messages: { images: text } } = useI18n();
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(element.id, e.shiftKey);
  };

  return (
    <div
      className="absolute cursor-move select-none"
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        transform: `rotate(${element.rotation}deg)`,
        opacity: element.opacity,
        zIndex: element.zIndex,
      }}
      onClick={handleClick}
    >
      {boardImages && element.assetId ? (
        <PrivateImage key={element.assetId} images={boardImages} assetId={element.assetId} fit={element.objectFit} />
      ) : element.src ? (
        <img
          src={element.src}
          alt=""
          className="w-full h-full"
          style={{ objectFit: element.objectFit }}
          draggable={false}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[var(--badge-bg)] text-sm text-[var(--text-secondary)]">
          {element.assetId ? text.unavailable : text.noImage}
        </div>
      )}

      {/* Selection border */}
      {isSelected && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            border: '2px solid #3B82F6',
          }}
        />
      )}

    </div>
  );
}

function PrivateImage({ images, assetId, fit }: { images: BoardImages; assetId: string; fit: ImageElementType['objectFit'] }) {
  const { messages: { images: text } } = useI18n();
  const subscribe = useCallback((listener: () => void) => images.subscribe(assetId, listener), [images, assetId]);
  const snapshot = useCallback(() => images.snapshot(assetId), [images, assetId]);
  const image = useSyncExternalStore(subscribe, snapshot);
  const [brokenUrl, setBrokenUrl] = useState<string>();

  if (image.status === 'ready' && image.url !== brokenUrl) {
    return <img src={image.url} alt="" className="h-full w-full" style={{ objectFit: fit }} draggable={false}
      onError={() => setBrokenUrl(image.url)} />;
  }
  const failed = image.status !== 'loading';
  return (
    <div className="grid h-full w-full place-content-center gap-1 overflow-hidden bg-[var(--badge-bg)] px-1 text-center text-xs text-[var(--text-secondary)]">
      <span>{failed ? text.unavailable : text.loading}</span>
      {failed && (
        <button
          type="button"
          aria-label={text.retryLoad}
          className="rounded-md px-2 py-1 text-[var(--text-primary)] underline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            images.retry(assetId);
          }}
        >
          {text.retry}
        </button>
      )}
    </div>
  );
}

// Frame element component

interface FrameElementProps {
  element: FrameElementType;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: (id: string, addToSelection: boolean) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
  onUpdate: (id: string, changes: Partial<FrameElementType>, expected?: Record<string, unknown>) => void;
}

function FrameElement({
  element,
  isSelected,
  isEditing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onUpdate,
}: FrameElementProps) {
  const original = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(element.name);
  useEffect(() => {
    if (!isEditing) original.current = null;
    else if (original.current === null) {
      original.current = element.name;
      setName(element.name);
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    }
  }, [element.name, isEditing]);

  const finishRename = () => {
    const previous = original.current;
    original.current = null;
    const next = name.trim();
    if (next && previous !== null && next !== previous) onUpdate(element.id, { name: next }, { name: previous });
    onEndEdit();
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(element.id, e.shiftKey);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!element.locked) {
      onStartEdit(element.id);
    }
  };

  return (
    <div
      className="absolute cursor-move select-none"
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        transform: `rotate(${element.rotation}deg)`,
        opacity: element.opacity,
        zIndex: element.zIndex,
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Frame name */}
      {isEditing ? <input ref={input} value={name} aria-label="Section name" maxLength={160} onChange={event => setName(event.target.value)}
        onBlur={finishRename} onClick={event => event.stopPropagation()} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') input.current?.blur();
          if (event.key === 'Escape') { original.current = null; onEndEdit(); }
        }} className="absolute -top-7 left-0 min-w-24 rounded border px-2 py-1 text-xs outline-[var(--accent)]"
        style={{ background: 'var(--surface-panel)', color: 'var(--text-primary)', borderColor: 'var(--glass-border-strong)' }} />
        : element.showName && (
        <div
          className="absolute -top-6 left-0 rounded-t border border-b-0 px-2 py-0.5 text-xs font-medium"
          style={{ borderColor: isSelected ? '#3B82F6' : 'var(--glass-border-strong)', background: 'var(--surface-panel)', color: 'var(--text-secondary)' }}
        >
          {element.name}
        </div>
      )}

      {/* Frame body */}
      <div
        className="w-full h-full rounded"
        style={{
          backgroundColor: element.backgroundColor,
          border: `1px ${isSelected ? 'solid #3B82F6' : 'dashed #D1D5DB'}`,
        }}
      />

    </div>
  );
}
