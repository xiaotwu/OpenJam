// Text Box Component
import { useState, useRef, useEffect } from 'react';
import type { TextElement } from '../../lib/elements';

interface TextBoxProps {
  element: TextElement;
  isSelected: boolean;
  isEditing: boolean;
  scale: number;
  onSelect: (id: string, addToSelection: boolean) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
  onUpdate: (id: string, changes: Partial<TextElement>) => void;
}

export default function TextBox({
  element,
  isSelected,
  isEditing,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scale: _scale,
  onSelect,
  onStartEdit,
  onEndEdit,
  onUpdate,
}: TextBoxProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [localText, setLocalText] = useState(element.text);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Sync local text with element
  useEffect(() => {
    setLocalText(element.text);
  }, [element.text]);

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

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalText(e.target.value);
    
    // Auto-resize height based on content
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
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
        minWidth: element.width,
        minHeight: element.height,
        transform: `rotate(${element.rotation}deg)`,
        opacity: element.opacity,
        zIndex: element.zIndex,
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Selection border */}
      {isSelected && (
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            border: '2px solid #3B82F6',
            borderRadius: '2px',
            margin: '-2px',
          }}
        />
      )}

      {/* Text content */}
      {isEditing ? (
        <textarea
          ref={inputRef}
          value={localText}
          onChange={handleTextChange}
          onBlur={handleTextBlur}
          onKeyDown={handleKeyDown}
          className="bg-transparent border-none outline-none resize-none overflow-hidden p-1"
          style={{
            width: element.width,
            height: element.height,
            minWidth: element.width,
            minHeight: element.height,
            fontFamily: element.fontFamily,
            fontSize: element.fontSize,
            fontWeight: element.fontWeight,
            fontStyle: element.fontStyle,
            color: element.color,
            textAlign: element.textAlign,
            backgroundColor: element.backgroundColor || 'transparent',
          }}
          placeholder="Type text..."
        />
      ) : (
        <div
          className="whitespace-pre-wrap"
          style={{
            fontFamily: element.fontFamily,
            fontSize: element.fontSize,
            fontWeight: element.fontWeight,
            fontStyle: element.fontStyle,
            color: element.color,
            textAlign: element.textAlign,
            backgroundColor: element.backgroundColor || 'transparent',
            padding: '4px',
            minWidth: element.width,
          }}
        >
          {element.text || (
            <span className="opacity-30">Double-click to edit</span>
          )}
        </div>
      )}

      {/* Resize handles */}
      {isSelected && !element.locked && (
        <>
          <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-e-resize" />
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-s-resize" />
          <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-white border-2 border-blue-500 rounded-full cursor-se-resize" />
        </>
      )}

      {/* Lock indicator */}
      {element.locked && (
        <div className="absolute -top-4 left-0 text-xs opacity-50">
          🔒
        </div>
      )}
    </div>
  );
}

// Font size picker
interface FontSizePickerProps {
  currentSize: number;
  onSizeChange: (size: number) => void;
}

export function FontSizePicker({ currentSize, onSizeChange }: FontSizePickerProps) {
  const sizes = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96];

  return (
    <select
      value={currentSize}
      onChange={(e) => onSizeChange(Number(e.target.value))}
      className="px-2 py-1 border rounded text-sm"
    >
      {sizes.map((size) => (
        <option key={size} value={size}>
          {size}px
        </option>
      ))}
    </select>
  );
}

// Text formatting toolbar
interface TextFormatToolbarProps {
  element: TextElement;
  onUpdate: (changes: Partial<TextElement>) => void;
}

export function TextFormatToolbar({ element, onUpdate }: TextFormatToolbarProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-white rounded-lg shadow-lg border">
      {/* Bold */}
      <button
        onClick={() => onUpdate({ fontWeight: element.fontWeight === 'bold' ? 'normal' : 'bold' })}
        className={`w-8 h-8 flex items-center justify-center rounded font-bold ${
          element.fontWeight === 'bold' ? 'bg-gray-200' : 'hover:bg-gray-100'
        }`}
        title="Bold"
      >
        B
      </button>

      {/* Italic */}
      <button
        onClick={() => onUpdate({ fontStyle: element.fontStyle === 'italic' ? 'normal' : 'italic' })}
        className={`w-8 h-8 flex items-center justify-center rounded italic ${
          element.fontStyle === 'italic' ? 'bg-gray-200' : 'hover:bg-gray-100'
        }`}
        title="Italic"
      >
        I
      </button>

      <div className="w-px h-6 bg-gray-200" />

      {/* Align left */}
      <button
        onClick={() => onUpdate({ textAlign: 'left' })}
        className={`w-8 h-8 flex items-center justify-center rounded ${
          element.textAlign === 'left' ? 'bg-gray-200' : 'hover:bg-gray-100'
        }`}
        title="Align left"
      >
        ≡
      </button>

      {/* Align center */}
      <button
        onClick={() => onUpdate({ textAlign: 'center' })}
        className={`w-8 h-8 flex items-center justify-center rounded ${
          element.textAlign === 'center' ? 'bg-gray-200' : 'hover:bg-gray-100'
        }`}
        title="Align center"
      >
        ≡
      </button>

      {/* Align right */}
      <button
        onClick={() => onUpdate({ textAlign: 'right' })}
        className={`w-8 h-8 flex items-center justify-center rounded ${
          element.textAlign === 'right' ? 'bg-gray-200' : 'hover:bg-gray-100'
        }`}
        title="Align right"
      >
        ≡
      </button>

      <div className="w-px h-6 bg-gray-200" />

      {/* Font size */}
      <FontSizePicker
        currentSize={element.fontSize}
        onSizeChange={(fontSize) => onUpdate({ fontSize })}
      />
    </div>
  );
}
