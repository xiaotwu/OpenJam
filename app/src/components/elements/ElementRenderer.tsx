// Element renderer - renders all element types
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
  isSelected: boolean;
  isEditing: boolean;
  scale: number;
  onSelect: (id: string, addToSelection: boolean) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
  onUpdate: (id: string, changes: Partial<Element>) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  isPinned?: boolean;
}

export default function ElementRenderer({
  element,
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
          isSelected={isSelected}
          scale={scale}
          onSelect={onSelect}
        />
      );

    case 'frame':
      return (
        <FrameElement
          element={element}
          isSelected={isSelected}
          scale={scale}
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

// Image element component

interface ImageElementProps {
  element: ImageElementType;
  isSelected: boolean;
  scale: number;
  onSelect: (id: string, addToSelection: boolean) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ImageElement({ element, isSelected, scale: _scale, onSelect }: ImageElementProps) {
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
      {element.src ? (
        <img
          src={element.src}
          alt=""
          className="w-full h-full"
          style={{ objectFit: element.objectFit }}
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400">
          🖼️ No image
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

      {/* Resize handles */}
      {isSelected && !element.locked && (
        <>
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-nw-resize" />
          <div className="absolute -top-1 -right-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-ne-resize" />
          <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-sw-resize" />
          <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-se-resize" />
        </>
      )}
    </div>
  );
}

// Frame element component

interface FrameElementProps {
  element: FrameElementType;
  isSelected: boolean;
  scale: number;
  onSelect: (id: string, addToSelection: boolean) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
  onUpdate: (id: string, changes: Partial<FrameElementType>) => void;
}

function FrameElement({
  element,
  isSelected,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scale: _scale,
  onSelect,
  onStartEdit,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onEndEdit: _onEndEdit,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onUpdate: _onUpdate,
}: FrameElementProps) {
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
      {element.showName && (
        <div
          className="absolute -top-6 left-0 px-2 py-0.5 text-xs font-medium text-gray-600 bg-white rounded-t border border-b-0"
          style={{ borderColor: isSelected ? '#3B82F6' : '#E5E7EB' }}
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

      {/* Resize handles */}
      {isSelected && !element.locked && (
        <>
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-nw-resize" />
          <div className="absolute -top-1 -right-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-ne-resize" />
          <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-sw-resize" />
          <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-se-resize" />
        </>
      )}
    </div>
  );
}
