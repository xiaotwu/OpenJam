import { useEffect } from 'react';

interface UseKeyboardShortcutsOptions {
  editingId: string | null;
  editable: boolean;
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
  onHelp: () => void;
  onSetTool: (tool: string) => void;
  onEscape: () => void;
  onSave: () => void;
  onCut: () => void;
  onToggleLock: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onNudge?: (dx: number, dy: number) => void;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      const key = e.key.toLowerCase();

      // Command palette (Ctrl+K)
      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault();
        options.onCommandPalette();
        return;
      }

      if (options.editable && (e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        options.onSave();
        return;
      }

      // Don't handle shortcuts when editing
      if (options.editingId) return;

      // Keyboard shortcuts dialog
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        options.onHelp();
        return;
      }

      // Delete selected elements
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (options.editable) {
          e.preventDefault();
          options.onDelete();
        }
        return;
      }

      // Duplicate (Ctrl+D)
      if (options.editable && (e.ctrlKey || e.metaKey) && key === 'd') {
        e.preventDefault();
        options.onDuplicate();
        return;
      }

      // Copy (Ctrl+C)
      if ((e.ctrlKey || e.metaKey) && key === 'c') {
        if (window.getSelection()?.isCollapsed === false) return;
        e.preventDefault();
        options.onCopy();
        return;
      }

      // Paste (Ctrl+V)
      if (options.editable && (e.ctrlKey || e.metaKey) && key === 'v') {
        e.preventDefault();
        options.onPaste();
        return;
      }

      // Undo (Ctrl+Z)
      if (options.editable && (e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        options.onUndo();
        return;
      }

      // Redo (Ctrl+Shift+Z or Ctrl+Y)
      if (options.editable && (e.ctrlKey || e.metaKey) && ((key === 'z' && e.shiftKey) || key === 'y')) {
        e.preventDefault();
        options.onRedo();
        return;
      }

      // Select all (Ctrl+A)
      if ((e.ctrlKey || e.metaKey) && key === 'a') {
        e.preventDefault();
        options.onSelectAll();
        return;
      }

      // Cut (Ctrl+X)
      if (options.editable && (e.ctrlKey || e.metaKey) && key === 'x') {
        e.preventDefault();
        options.onCut();
        return;
      }

      // Lock/Unlock (Ctrl+Shift+L)
      if (options.editable && (e.ctrlKey || e.metaKey) && e.shiftKey && key === 'l') {
        e.preventDefault();
        options.onToggleLock();
        return;
      }

      // Ungroup (Ctrl+Shift+G) - must be before Ctrl+G
      if (options.editable && (e.ctrlKey || e.metaKey) && e.shiftKey && key === 'g') {
        e.preventDefault();
        options.onUngroup();
        return;
      }

      // Group (Ctrl+G)
      if (options.editable && (e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'g') {
        e.preventDefault();
        options.onGroup();
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
      if (e.ctrlKey || e.metaKey) return;
      if (!options.editable && key !== 'v' && key !== 'h' && key !== 'escape') return;
      const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      const direction = arrows[key];
      if (direction && options.onNudge && options.editable && !e.repeat) {
        const step = e.shiftKey ? 10 : 1;
        e.preventDefault();
        options.onNudge(direction[0] * step, direction[1] * step);
        return;
      }
      if (key === ']') {
        options.onBringToFront();
        return;
      }
      if (key === '[') {
        options.onSendToBack();
        return;
      }

      // Tool shortcuts
      switch (key) {
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
