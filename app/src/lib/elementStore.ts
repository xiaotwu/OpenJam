import type { Element, ElementType, Reaction, Comment } from './elements';
import { createDefaultElement, generateElementId } from './elements';

// Operation types for elements
export type ElementOperationType = 
  | 'add'       // Add new element
  | 'update'    // Update element properties
  | 'delete'    // Delete element
  | 'move'      // Move element (optimized)
  | 'resize'    // Resize element (optimized)
  | 'reorder'   // Change z-index
  | 'lock'      // Lock/unlock element
  | 'reaction'  // Add reaction
  | 'comment'   // Add/update comment
  | 'clear';    // Clear all

// Vector clock for CRDT ordering
export interface VectorClock {
  [userId: string]: number;
}

// Base operation interface
export interface BaseOperation {
  opId: string;
  opType: ElementOperationType;
  elementId: string;
  vectorClock: VectorClock;
  userId: string;
  timestamp: number;
}

// Add element operation
export interface AddOperation extends BaseOperation {
  opType: 'add';
  element: Element;
  restore?: boolean;
}

// Update element operation
export interface UpdateOperation extends BaseOperation {
  opType: 'update';
  changes: Partial<Element>;
  expected?: Record<string, unknown>;
}

// Delete element operation
export interface DeleteOperation extends BaseOperation {
  opType: 'delete';
  expected?: Element;
}

// Move element operation
export interface MoveOperation extends BaseOperation {
  opType: 'move';
  x: number;
  y: number;
}

// Resize element operation
export interface ResizeOperation extends BaseOperation {
  opType: 'resize';
  width: number;
  height: number;
  x?: number;  // Optional new position
  y?: number;
}

// Reorder operation
export interface ReorderOperation extends BaseOperation {
  opType: 'reorder';
  zIndex: number;
}

// Lock operation
export interface LockOperation extends BaseOperation {
  opType: 'lock';
  locked: boolean;
}

// Reaction operation
export interface ReactionOperation extends BaseOperation {
  opType: 'reaction';
  reaction: Reaction;
  action: 'add' | 'remove';
}

// Comment operation
export interface CommentOperation extends BaseOperation {
  opType: 'comment';
  comment: Comment;
  action: 'add' | 'update' | 'resolve' | 'delete';
}

// Clear operation
export interface ClearOperation extends BaseOperation {
  opType: 'clear';
}

// Union type for all operations
export type ElementOperation = 
  | AddOperation
  | UpdateOperation
  | DeleteOperation
  | MoveOperation
  | ResizeOperation
  | ReorderOperation
  | LockOperation
  | ReactionOperation
  | CommentOperation
  | ClearOperation;

// Generate unique operation ID
function generateOpId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Compare vector clocks for causality
function compareVectorClocks(a: VectorClock, b: VectorClock): -1 | 0 | 1 {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGreater = false;
  let bGreater = false;

  for (const key of allKeys) {
    const aVal = a[key] || 0;
    const bVal = b[key] || 0;
    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
  }

  if (aGreater && !bGreater) return 1;
  if (bGreater && !aGreater) return -1;
  return 0;
}

// Merge vector clocks
function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const key of Object.keys(b)) {
    result[key] = Math.max(result[key] || 0, b[key]);
  }
  return result;
}

type StoreEvents = {
  operation: (op: ElementOperation, previous?: Element) => void;
};

interface HistoryEntry {
  kind: 'add' | 'delete';
  element: Element;
}

function equalValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = Object.keys(b).filter(key => (b as Record<string, unknown>)[key] !== undefined);
  return left.length === right.length && left.every(([key, value]) => (
    Object.hasOwn(b, key) && equalValue(value, (b as Record<string, unknown>)[key])
  ));
}

// Element Store class
export class ElementStore {
  private elements: Map<string, Element> = new Map();
  private deletedIds: Set<string> = new Set();
  private operations: ElementOperation[] = [];
  private vectorClock: VectorClock = {};
  private userId: string;
  private listeners: Set<() => void> = new Set();
  private reactions: Map<string, Reaction> = new Map();
  private comments: Map<string, Comment> = new Map();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxZIndex = 0;
  private editable = true;
  private pageId?: string;
  private trackHistory = true;
  private editDepth = 0;
  private changed = false;

  constructor(userId: string) {
    this.userId = userId;
    this.vectorClock[userId] = 0;
  }

  // --- Event emitter for collaboration ---
  private operationListeners: Set<StoreEvents['operation']> = new Set();

  on<K extends keyof StoreEvents>(event: K, fn: StoreEvents[K]): () => void {
    if (event === 'operation') {
      const listener = fn as StoreEvents['operation'];
      this.operationListeners.add(listener);
      return () => { this.operationListeners.delete(listener); };
    }
    return () => {};
  }

  private emit<K extends keyof StoreEvents>(event: K, ...args: Parameters<StoreEvents[K]>): void {
    if (event === 'operation') {
      this.operationListeners.forEach(fn => fn(...args as Parameters<StoreEvents['operation']>));
    }
  }

  // Subscribe to changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    if (this.editDepth) {
      this.changed = true;
      return;
    }
    this.listeners.forEach(l => l());
  }

  batch(edit: () => void): void {
    this.editDepth++;
    try {
      edit();
    } finally {
      this.editDepth--;
      if (!this.editDepth && this.changed) {
        this.changed = false;
        this.notify();
      }
    }
  }

  // Get current user ID
  getUserId(): string {
    return this.userId;
  }

  setEditingContext(editable: boolean, pageId?: string, trackHistory = true): void {
    this.editable = editable;
    this.pageId = pageId;
    this.trackHistory = trackHistory;
  }

  private isEditableElement(element: Element | undefined): element is Element {
    return Boolean(this.editable && element && (!this.pageId || element.pageId === this.pageId));
  }

  // Get all elements
  getElements(): Element[] {
    return Array.from(this.elements.values())
      .sort((a, b) => a.zIndex - b.zIndex);
  }

  // Get element by ID
  getElementById(id: string): Element | undefined {
    return this.elements.get(id);
  }

  // Get all reactions
  getReactions(): Reaction[] {
    return Array.from(this.reactions.values());
  }

  // Get all comments
  getComments(): Comment[] {
    return Array.from(this.comments.values());
  }

  // Get all operations for sync
  getOperations(): ElementOperation[] {
    return [...this.operations];
  }

  // Get next z-index
  getNextZIndex(): number {
    return ++this.maxZIndex;
  }

  // Increment vector clock and create operation
  private createOperation<T extends ElementOperation>(
    opType: T['opType'],
    elementId: string,
    data: Omit<T, keyof BaseOperation>
  ): T {
    this.vectorClock[this.userId] = (this.vectorClock[this.userId] || 0) + 1;
    
    return {
      opId: generateOpId(),
      opType,
      elementId,
      vectorClock: { ...this.vectorClock },
      userId: this.userId,
      timestamp: Date.now(),
      ...data,
    } as T;
  }

  // Add element by type
  addElement(typeOrElement: ElementType | Element, x?: number, y?: number, overrides?: Partial<Element>): AddOperation {
    let element: Element;
    
    if (typeof typeOrElement === 'string') {
      element = createDefaultElement(typeOrElement, x ?? 0, y ?? 0, this.userId);
      if (overrides) {
        Object.assign(element, overrides);
      }
      element.zIndex = this.getNextZIndex();
    } else {
      element = { ...typeOrElement };
      this.maxZIndex = Math.max(this.maxZIndex, element.zIndex || 0);
    }

    if (this.pageId) element.pageId = this.pageId;
    const op = this.createOperation<AddOperation>('add', element.id, { element });
    if (!this.editable) return op;
    this.applyOperation(op);
    this.recordHistory({ kind: 'add', element });
    this.emit('operation', op);
    return op;
  }

  // Clear all elements without creating operation (for loading saved data)
  clear(): void {
    this.elements.clear();
    this.deletedIds.clear();
    this.reactions.clear();
    this.comments.clear();
    this.operations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.maxZIndex = 0;
    this.notify();
  }

  // Load saved elements directly without creating operations (for restoring from database)
  loadSavedElements(elements: Element[]): void {
    this.elements.clear();
    this.deletedIds.clear();
    this.reactions.clear();
    this.comments.clear();
    this.operations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.maxZIndex = 0;

    for (const el of elements) {
      this.elements.set(el.id, { ...el });
      this.maxZIndex = Math.max(this.maxZIndex, el.zIndex || 0);
    }
    this.notify();
  }

  replaceSyncedElements(elements: Element[]): void {
    this.elements = new Map(elements.map(element => [element.id, { ...element }]));
    this.maxZIndex = elements.reduce((max, element) => Math.max(max, element.zIndex || 0), 0);
    this.notify();
  }

  resetHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private recordHistory(entry: HistoryEntry): void {
    if (!this.trackHistory) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private patchElement(id: string, changes: Partial<Element>): void {
    const previous = this.elements.get(id);
    if (!previous) return;
    const element = { ...previous, ...changes } as Element;
    this.elements.set(id, element);
    this.maxZIndex = Math.max(this.maxZIndex, element.zIndex);
    if (!this.pageId || !this.trackHistory) return;
    // An inverse delete may include subsequent local edits, provided the
    // projection still matches our history before those edits.
    for (const entry of [...this.undoStack, ...this.redoStack]) {
      if (entry.element.id === id && equalValue(entry.element, previous)) entry.element = element;
    }
  }

  // Update element
  updateElement(elementId: string, changes: Partial<Element>, expected?: Record<string, unknown>): UpdateOperation | null {
    const previous = this.elements.get(elementId);
    if (!this.isEditableElement(previous)) return null;

    const op = this.createOperation<UpdateOperation>('update', elementId, { changes, expected });
    this.applyOperation(op);
    this.emit('operation', op, previous);
    return op;
  }

  // Delete element
  deleteElement(elementId: string): DeleteOperation | null {
    const element = this.elements.get(elementId);
    if (!this.isEditableElement(element)) return null;

    const op = this.createOperation<DeleteOperation>('delete', elementId, this.pageId ? { expected: element } : {});
    this.applyOperation(op);
    this.recordHistory({ kind: 'delete', element });
    this.emit('operation', op);
    return op;
  }

  // Move element
  moveElement(elementId: string, x: number, y: number): MoveOperation | null {
    const element = this.elements.get(elementId);
    if (!this.isEditableElement(element) || (element.x === x && element.y === y)) return null;

    const op = this.createOperation<MoveOperation>('move', elementId, { x, y });
    this.applyOperation(op);
    this.emit('operation', op);
    return op;
  }

  // Resize element
  resizeElement(
    elementId: string, 
    width: number, 
    height: number, 
    x?: number, 
    y?: number
  ): ResizeOperation | null {
    if (!this.isEditableElement(this.elements.get(elementId))) return null;
    
    const op = this.createOperation<ResizeOperation>('resize', elementId, { width, height, x, y });
    this.applyOperation(op);
    this.emit('operation', op);
    return op;
  }

  // Reorder element (bring to front, send to back)
  reorderElement(elementId: string, zIndex: number): ReorderOperation | null {
    if (!this.isEditableElement(this.elements.get(elementId))) return null;
    
    const op = this.createOperation<ReorderOperation>('reorder', elementId, { zIndex });
    this.applyOperation(op);
    this.emit('operation', op);
    return op;
  }

  // Lock/unlock element
  lockElement(elementId: string, locked: boolean): LockOperation | null {
    if (!this.isEditableElement(this.elements.get(elementId))) return null;
    
    const op = this.createOperation<LockOperation>('lock', elementId, { locked });
    this.applyOperation(op);
    this.emit('operation', op);
    return op;
  }

  // Add reaction
  addReaction(x: number, y: number, type: Reaction['type']): ReactionOperation {
    const reaction: Reaction = {
      id: generateElementId(),
      type,
      x,
      y,
      userId: this.userId,
      createdAt: Date.now(),
    };
    
    const op = this.createOperation<ReactionOperation>('reaction', reaction.id, {
      reaction,
      action: 'add',
    });
    this.applyOperation(op);
    this.emit('operation', op);
    return op;
  }

  // Add comment
  addComment(x: number, y: number, text: string, userName: string, userColor: string): CommentOperation {
    const comment: Comment = {
      id: generateElementId(),
      text,
      x,
      y,
      userId: this.userId,
      userName,
      userColor,
      createdAt: Date.now(),
      resolved: false,
      replies: [],
    };
    
    const op = this.createOperation<CommentOperation>('comment', comment.id, {
      comment,
      action: 'add',
    });
    this.applyOperation(op);
    this.emit('operation', op);
    return op;
  }

  // Clear all elements
  clearAll(): ClearOperation {
    const op = this.createOperation<ClearOperation>('clear', '*', {});
    this.applyOperation(op);
    this.emit('operation', op);
    return op;
  }

  // Apply operation locally
  private applyOperation(op: ElementOperation): void {
    if (!this.pageId) this.operations.push(op);
    this.vectorClock = mergeVectorClocks(this.vectorClock, op.vectorClock);

    switch (op.opType) {
      case 'add': {
        const addOp = op as AddOperation;
        this.elements.set(addOp.element.id, { ...addOp.element });
        this.deletedIds.delete(addOp.element.id);
        this.maxZIndex = Math.max(this.maxZIndex, addOp.element.zIndex);
        break;
      }
      
      case 'update': {
        const updateOp = op as UpdateOperation;
        this.patchElement(op.elementId, { ...updateOp.changes, updatedAt: op.timestamp });
        break;
      }
      
      case 'delete': {
        this.elements.delete(op.elementId);
        if (!this.pageId) this.deletedIds.add(op.elementId);
        break;
      }
      
      case 'move': {
        const moveOp = op as MoveOperation;
        const { x, y } = moveOp;
        const element = this.elements.get(op.elementId);
        const changes: Partial<Element> = { x, y, updatedAt: op.timestamp };
        if (element?.type === 'connector') {
          const move = (point: { x: number; y: number }) => ({
            x: point.x + x - element.x,
            y: point.y + y - element.y,
          });
          Object.assign(changes, {
            startPoint: move(element.startPoint),
            endPoint: move(element.endPoint),
            ...(element.controlPoints ? { controlPoints: element.controlPoints.map(move) } : {}),
          });
        }
        this.patchElement(op.elementId, changes);
        break;
      }
      
      case 'resize': {
        const resizeOp = op as ResizeOperation;
        const { width, height, x, y } = resizeOp;
        this.patchElement(op.elementId, {
          width, height, updatedAt: op.timestamp,
          ...(x !== undefined ? { x } : {}),
          ...(y !== undefined ? { y } : {}),
        });
        break;
      }
      
      case 'reorder': {
        const reorderOp = op as ReorderOperation;
        this.patchElement(op.elementId, { zIndex: reorderOp.zIndex, updatedAt: op.timestamp });
        break;
      }
      
      case 'lock': {
        const lockOp = op as LockOperation;
        this.patchElement(op.elementId, { locked: lockOp.locked, updatedAt: op.timestamp });
        break;
      }
      
      case 'reaction': {
        const reactionOp = op as ReactionOperation;
        if (reactionOp.action === 'add') {
          this.reactions.set(reactionOp.reaction.id, reactionOp.reaction);
        } else {
          this.reactions.delete(reactionOp.reaction.id);
        }
        break;
      }
      
      case 'comment': {
        const commentOp = op as CommentOperation;
        if (commentOp.action === 'add' || commentOp.action === 'update') {
          this.comments.set(commentOp.comment.id, commentOp.comment);
        } else if (commentOp.action === 'delete') {
          this.comments.delete(commentOp.comment.id);
        } else if (commentOp.action === 'resolve') {
          const existing = this.comments.get(commentOp.comment.id);
          if (existing) {
            existing.resolved = true;
          }
        }
        break;
      }
      
      case 'clear': {
        this.elements.clear();
        this.reactions.clear();
        break;
      }
    }

    this.notify();
  }

  // Apply remote operation
  applyRemote(op: ElementOperation): void {
    // Skip if we already have this operation
    if (this.operations.some(o => o.opId === op.opId)) return;
    
    // Skip if element was already deleted (for non-add operations)
    if (op.opType !== 'add' && op.opType !== 'clear' && this.deletedIds.has(op.elementId)) {
      return;
    }

    this.applyOperation(op);
  }

  // Load from sync
  loadFromSync(ops: ElementOperation[]): void {
    // Sort by vector clock and timestamp
    const sorted = [...ops].sort((a, b) => {
      const cmp = compareVectorClocks(a.vectorClock, b.vectorClock);
      if (cmp !== 0) return cmp;
      return a.timestamp - b.timestamp;
    });

    for (const op of sorted) {
      if (!this.operations.some(o => o.opId === op.opId)) {
        this.applyOperation(op);
      }
    }
  }

  private historyIndex(stack: HistoryEntry[]): number {
    if (!this.editable) return -1;
    for (let index = stack.length - 1; index >= 0; index--) {
      if (!this.pageId || stack[index].element.pageId === this.pageId) return index;
    }
    return -1;
  }

  private replayHistory(undo: boolean): ElementOperation | null {
    const source = undo ? this.undoStack : this.redoStack;
    const index = this.historyIndex(source);
    if (index < 0) return null;
    const entry = source[index];
    const { element } = entry;
    const restore = undo ? entry.kind === 'delete' : entry.kind === 'add';
    const current = this.elements.get(element.id);
    if (restore ? current : !current || (this.pageId && !equalValue(element, current))) {
      source.splice(index, 1);
      return null;
    }
    const target = undo ? this.redoStack : this.undoStack;
    source.splice(index, 1);
    target.push(entry);
    const op = restore
      ? this.createOperation<AddOperation>('add', element.id, { element, restore: true })
      : this.createOperation<DeleteOperation>('delete', element.id, this.pageId ? { expected: element } : {});
    this.applyOperation(op);
    this.emit('operation', op);
    return op;
  }

  undo(): ElementOperation | null {
    return this.replayHistory(true);
  }

  redo(): ElementOperation | null {
    return this.replayHistory(false);
  }

  // Check if can undo
  canUndo(): boolean {
    return this.historyIndex(this.undoStack) >= 0;
  }

  // Check if can redo
  canRedo(): boolean {
    return this.historyIndex(this.redoStack) >= 0;
  }

  // Duplicate element
  duplicateElement(elementId: string, offsetX = 20, offsetY = 20): AddOperation | null {
    const element = this.elements.get(elementId);
    if (!this.isEditableElement(element)) return null;
    return this.copyElement(element, offsetX, offsetY);
  }

  copyElement(element: Element, offsetX = 20, offsetY = 20): AddOperation | null {
    if (!this.editable) return null;
    const newElement: Element = {
      ...element,
      id: generateElementId(),
      x: element.x + offsetX,
      y: element.y + offsetY,
      zIndex: this.getNextZIndex(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: this.userId,
    };
    if (newElement.type === 'connector') {
      const move = ({ x, y }: { x: number; y: number }) => ({ x: x + offsetX, y: y + offsetY });
      newElement.startPoint = move(newElement.startPoint);
      newElement.endPoint = move(newElement.endPoint);
      if (newElement.controlPoints) newElement.controlPoints = newElement.controlPoints.map(move);
    }

    return this.addElement(newElement);
  }

  // Group elements
  groupElements(elementIds: string[]): AddOperation | null {
    if (elementIds.length < 2) return null;

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const id of elementIds) {
      const el = this.elements.get(id);
      if (!el) continue;
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }

    // Create frame containing these elements
    return this.addElement('frame', minX - 20, minY - 40, {
      width: maxX - minX + 40,
      height: maxY - minY + 60,
      childIds: elementIds,
    } as Partial<Element>);
  }
}

// Export singleton-like factory
export function createElementStore(userId: string): ElementStore {
  return new ElementStore(userId);
}
