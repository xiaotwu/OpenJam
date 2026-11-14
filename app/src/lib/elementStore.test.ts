import { describe, it, expect } from 'vitest';
import { ElementStore, type ElementOperation } from './elementStore';
import type { Element } from './elements';

function createStore(userId = 'user-a'): ElementStore {
  return new ElementStore(userId);
}

describe('ElementStore', () => {
  it('adds elements via addElement', () => {
    const store = createStore();
    const op = store.addElement('sticky', 10, 20);
    expect(op.opType).toBe('add');
    expect(store.getElements()).toHaveLength(1);
    const el = store.getElements()[0];
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.type).toBe('sticky');
  });

  it('updates element properties', () => {
    const store = createStore();
    const op = store.addElement('sticky', 0, 0);
    const id = op.element.id;
    store.updateElement(id, { width: 300 } as Partial<Element>);
    expect(store.getElementById(id)?.width).toBe(300);
  });

  it('deletes elements', () => {
    const store = createStore();
    const op = store.addElement('shape', 0, 0);
    store.deleteElement(op.element.id);
    expect(store.getElements()).toHaveLength(0);
  });

  it('moves elements', () => {
    const store = createStore();
    const op = store.addElement('text', 5, 5);
    store.moveElement(op.element.id, 100, 200);
    expect(store.getElementById(op.element.id)?.x).toBe(100);
    expect(store.getElementById(op.element.id)?.y).toBe(200);
  });

  it('does not emit changes when a batch moves objects to their current positions', () => {
    const store = createStore();
    const { element: first } = store.addElement('sticky', 20, 40);
    const { element: second } = store.addElement('sticky', 80, 40);
    const operations: ElementOperation[] = [];
    store.on('operation', operation => operations.push(operation));

    store.batch(() => {
      store.moveElement(first.id, first.x, first.y);
      store.moveElement(second.id, second.x, second.y);
    });

    expect(operations).toEqual([]);
    expect(store.getElements()).toEqual([first, second]);
  });

  it('projects a synced edit without emitting it and preserves guarded undo and restore', () => {
    const store = createStore();
    const operations: ElementOperation[] = [];
    store.on('operation', operation => operations.push(operation));
    store.setEditingContext(true, 'page-a');
    const { element } = store.addElement('sticky', 5, 5);
    store.updateElement(element.id, { text: 'Local text' });
    const [edited] = store.getElements();
    store.replaceSyncedElements([structuredClone(edited)]);
    expect(operations).toHaveLength(2);
    expect(edited).toMatchObject({ pageId: 'page-a', text: 'Local text' });
    expect(store.undo()).toMatchObject({ opType: 'delete', expected: edited });
    expect(store.redo()).toMatchObject({ opType: 'add', element: edited, restore: true });
  });

  it('keeps a remotely changed object when undoing a local creation', () => {
    const store = createStore();
    store.setEditingContext(true, 'page-a');
    const { element } = store.addElement('shape', 5, 5);
    const remote = { ...element, groupId: 'another-editor-group' };
    store.replaceSyncedElements([remote]);
    expect(store.undo()).toBeNull();
    expect(store.getElements()).toEqual([remote]);
  });

  it('restores the deleted snapshot and guards edits on other pages and in view mode', () => {
    const store = createStore();
    store.setEditingContext(true, 'page-a');
    const { element } = store.addElement('sticky', 5, 5);
    store.setEditingContext(true, 'page-b');
    expect(store.deleteElement(element.id)).toBeNull();
    const { element: copy } = store.copyElement(element)!;
    expect(copy.id).not.toBe(element.id);
    expect(copy).toMatchObject({ pageId: 'page-b', x: 25, y: 25 });
    store.updateElement(copy.id, { text: 'Restore this text' });
    const deleted = store.getElementById(copy.id);
    store.deleteElement(copy.id);
    expect(store.undo()).toMatchObject({ opType: 'add', element: deleted, restore: true });
    expect(store.redo()).toMatchObject({ opType: 'delete', expected: deleted });
    store.setEditingContext(false, 'page-a');
    expect(store.moveElement(element.id, 10, 10)).toBeNull();
    expect(store.undo()).toBeNull();
  });

  describe('applyRemote dedup', () => {
    it('skips duplicate operations by opId', () => {
      const store = createStore();
      const addOp = store.addElement('sticky', 0, 0);
      // Simulate the same op arriving again from sync
      const remoteOp: ElementOperation = {
        ...addOp,
      };
      store.applyRemote(remoteOp);
      expect(store.getElements()).toHaveLength(1);
    });

    it('applies remote operations from other users', () => {
      const store = createStore('user-a');
      const remoteAdd: ElementOperation = {
        opId: 'op_remote_1',
        opType: 'add',
        elementId: 'el_remote_1',
        vectorClock: { 'user-b': 1 },
        userId: 'user-b',
        timestamp: Date.now(),
        element: {
          id: 'el_remote_1',
          type: 'sticky',
          x: 50,
          y: 50,
          width: 200,
          height: 200,
          rotation: 0,
          zIndex: 1,
          locked: false,
          opacity: 1,
          createdBy: 'user-b',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          text: 'remote',
          color: 'yellow',
          fontSize: 16,
          textAlign: 'center',
        } as Element,
      };
      store.applyRemote(remoteAdd);
      expect(store.getElements()).toHaveLength(1);
      expect(store.getElementById('el_remote_1')?.x).toBe(50);
    });
  });

  describe('loadFromSync', () => {
    it('applies operations in causal order without duplicates', () => {
      const store = createStore('user-a');
      const ops: ElementOperation[] = [
        {
          opId: 'op_1',
          opType: 'add',
          elementId: 'el_1',
          vectorClock: { 'user-b': 1 },
          userId: 'user-b',
          timestamp: 100,
          element: {
            id: 'el_1',
            type: 'sticky',
            x: 0, y: 0, width: 200, height: 200,
            rotation: 0, zIndex: 1, locked: false, opacity: 1,
            createdBy: 'user-b', createdAt: 100, updatedAt: 100,
            text: '', color: 'yellow', fontSize: 16, textAlign: 'center',
          } as Element,
        },
        {
          opId: 'op_2',
          opType: 'move',
          elementId: 'el_1',
          vectorClock: { 'user-b': 2 },
          userId: 'user-b',
          timestamp: 200,
          x: 100,
          y: 100,
        },
      ];
      store.loadFromSync(ops);
      expect(store.getElements()).toHaveLength(1);
      expect(store.getElementById('el_1')?.x).toBe(100);
      expect(store.getElementById('el_1')?.y).toBe(100);
    });
  });

  describe('undo/redo', () => {
    it('undoes an add by removing the element', () => {
      const store = createStore();
      store.addElement('sticky', 0, 0);
      expect(store.canUndo()).toBe(true);
      store.undo();
      expect(store.getElements()).toHaveLength(0);
    });

    it('redoes an undone add', () => {
      const store = createStore();
      const op = store.addElement('sticky', 0, 0);
      store.undo();
      expect(store.canRedo()).toBe(true);
      store.redo();
      expect(store.getElements()).toHaveLength(1);
      expect(store.getElementById(op.element.id)).toBeDefined();
    });
  });

  describe('clear', () => {
    it('clears all state without creating operations', () => {
      const store = createStore();
      store.addElement('sticky', 0, 0);
      store.addElement('shape', 10, 10);
      store.clear();
      expect(store.getElements()).toHaveLength(0);
      expect(store.getOperations()).toHaveLength(0);
    });
  });

  describe('duplicateElement', () => {
    it('creates a copy with a new id', () => {
      const store = createStore();
      const op = store.addElement('sticky', 0, 0);
      const dupOp = store.duplicateElement(op.element.id);
      expect(dupOp).not.toBeNull();
      expect(store.getElements()).toHaveLength(2);
      expect(dupOp!.element.id).not.toBe(op.element.id);
      expect(dupOp!.element.x).toBe(20); // offset 20
    });
  });
});
