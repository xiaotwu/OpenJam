// Sticky Note Component
import { useState, useRef, useEffect } from 'react';
import type { StickyElement, StickyColor } from '../../lib/elements';
import { STICKY_COLORS } from '../../lib/elements';

interface StickyNoteProps {
  element: StickyElement;
  isSelected: boolean;
  isEditing: boolean;
  scale: number;
  onSelect: (id: string, addToSelection: boolean) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
  onUpdate: (id: string, changes: Partial<StickyElement>) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
}

export default function StickyNote({
  element,
  isSelected,
  isEditing,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scale: _scale,
  onSelect,
  onStartEdit,
  onEndEdit,
  onUpdate,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onMove: _onMove,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onResize: _onResize,
}: StickyNoteProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localText, setLocalText] = useState(element.text);
  const colors = STICKY_COLORS[element.color];

  // Focus textarea when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  // Sync local text with element
  useEffect(() => {
    setLocalText(element.text);
  }, [element.text]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!element.locked) {
      onStartEdit(element.id);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(element.id, e.shiftKey);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalText(e.target.value);
  };

  const handleTextBlur = () => {
    if (localText !== element.text) {
      onUpdate(element.id, { text: localText });
    }
    onEndEdit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setLocalText(element.text);
      onEndEdit();
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
      {/* Sticky note body */}
      <div
        className="w-full h-full rounded-sm shadow-md transition-shadow duration-150"
        style={{
          backgroundColor: colors.bg,
          boxShadow: isSelected 
            ? '0 0 0 2px #3B82F6, 0 4px 12px rgba(0,0,0,0.15)' 
            : '0 2px 8px rgba(0,0,0,0.1)',
        }}
      >
        {/* Folded corner effect */}
        <div
          className="absolute top-0 right-0 w-6 h-6"
          style={{
            background: `linear-gradient(135deg, transparent 50%, ${colors.bg} 50%)`,
            filter: 'brightness(0.9)',
          }}
        />

        {/* Text content */}
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={localText}
            onChange={handleTextChange}
            onBlur={handleTextBlur}
            onKeyDown={handleKeyDown}
            className="w-full h-full p-3 bg-transparent border-none outline-none resize-none"
            style={{
              color: colors.text,
              fontSize: element.fontSize,
              textAlign: element.textAlign,
              fontFamily: 'inherit',
            }}
            placeholder="Type here..."
          />
        ) : (
          <div
            className="w-full h-full p-3 overflow-hidden"
            style={{
              color: colors.text,
              fontSize: element.fontSize,
              textAlign: element.textAlign,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}
          >
            {element.text || (
              <span className="opacity-50">Double-click to edit</span>
            )}
          </div>
        )}
      </div>

      {/* Resize handle */}
      {isSelected && !element.locked && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{
            background: '#3B82F6',
            borderRadius: '0 0 4px 0',
          }}
        />
      )}

      {/* Lock indicator */}
      {element.locked && (
        <div className="absolute top-1 left-1 text-xs opacity-50">
          🔒
        </div>
      )}
    </div>
  );
}

// Color picker for sticky notes
interface StickyColorPickerProps {
  currentColor: StickyColor;
  onColorChange: (color: StickyColor) => void;
}

export function StickyColorPicker({ currentColor, onColorChange }: StickyColorPickerProps) {
  const colorOptions: StickyColor[] = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'gray'];

  return (
    <div className="flex gap-1 p-1 bg-white rounded-lg shadow-lg border">
      {colorOptions.map((color) => (
        <button
          key={color}
          onClick={() => onColorChange(color)}
          className="w-6 h-6 rounded transition-transform hover:scale-110"
          style={{
            backgroundColor: STICKY_COLORS[color].bg,
            border: currentColor === color ? '2px solid #3B82F6' : '1px solid #E5E7EB',
          }}
          title={color}
        />
      ))}
    </div>
  );
}
