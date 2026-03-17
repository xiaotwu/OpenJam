import { useEffect } from 'react';

interface UseKeyboardShortcutsOptions {
  editingId: string | null;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomFit: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onCommandPalette: () => void;
  onSetTool: (tool: string) => void;
  onEscape: () => void;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command palette (Ctrl+K)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        options.onCommandPalette();
        return;
      }

      // Don't handle shortcuts when editing
      if (options.editingId) return;

      // Delete selected elements
      if (e.key === 'Delete' || e.key === 'Backspace') {
        options.onDelete();
        return;
      }

      // Duplicate (Ctrl+D)
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        options.onDuplicate();
        return;
      }

      // Copy (Ctrl+C)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        options.onCopy();
        return;
      }

      // Paste (Ctrl+V)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        options.onPaste();
        return;
      }

      // Undo (Ctrl+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        options.onUndo();
        return;
      }

      // Redo (Ctrl+Shift+Z or Ctrl+Y)
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        options.onRedo();
        return;
      }

      // Select all (Ctrl+A)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        options.onSelectAll();
        return;
      }

      // Zoom shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        options.onZoomIn();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        options.onZoomOut();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        options.onZoomReset();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        options.onZoomFit();
        return;
      }

      // Layer order
      if (e.key === ']') {
        options.onBringToFront();
        return;
      }
      if (e.key === '[') {
        options.onSendToBack();
        return;
      }

      // Tool shortcuts
      switch (e.key.toLowerCase()) {
        case 'v':
        case 'escape':
          options.onEscape();
          break;
        case 'h':
          options.onSetTool('pan');
          break;
        case 's':
          options.onSetTool('sticky');
          break;
        case 'r':
          options.onSetTool('shape');
          break;
        case 't':
          options.onSetTool('text');
          break;
        case 'c':
          if (!e.ctrlKey && !e.metaKey) {
            options.onSetTool('connector');
          }
          break;
        case 'p':
          options.onSetTool('draw');
          break;
        case 'm':
          options.onSetTool('marker');
          break;
        case 'f':
          options.onSetTool('frame');
          break;
        case 'e':
          options.onSetTool('stamp');
          break;
        case 'x':
          options.onSetTool('eraser');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [options]);
}
