export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export type OperationType = 'draw' | 'erase' | 'undo' | 'clear';

export interface Point {
  x: number;
  y: number;
}

export interface DrawOperation {
  opId: string;
  opType: 'draw';
  data: {
    pathId: string;
    color: string;
    width: number;
    points: Point[];
  };
  vectorClock: VectorClock;
  userId: string;
  timestamp: number;
}

export interface EraseOperation {
  opId: string;
  opType: 'erase';
  data: {
    pathId: string;
    width: number;
    points: Point[];
  };
  vectorClock: VectorClock;
  userId: string;
  timestamp: number;
}

export interface UndoOperation {
  opId: string;
  opType: 'undo';
  data: {
    targetOpId: string;
  };
  vectorClock: VectorClock;
  userId: string;
  timestamp: number;
}

export interface ClearOperation {
  opId: string;
  opType: 'clear';
  data: Record<string, never>;
  vectorClock: VectorClock;
  userId: string;
  timestamp: number;
}

export type Operation = DrawOperation | EraseOperation | UndoOperation | ClearOperation;

export type VectorClock = Record<string, number>;

/* Returns: -1 if a < b, 1 if a > b, 0 if concurrent */
function compareVectorClocks(a: VectorClock, b: VectorClock): number {
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

function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [key, value] of Object.entries(b)) {
    result[key] = Math.max(result[key] || 0, value);
  }
  return result;
}

export class CRDTStore {
  private operations: Map<string, Operation> = new Map();
  private vectorClock: VectorClock = {};
  private userId: string;
  private undoStack: string[] = [];
  private listeners: Set<() => void> = new Set();

  constructor(userId: string) {
    this.userId = userId;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  private createOperation<T extends Operation>(
    opType: T['opType'],
    data: T['data']
  ): T {
    this.vectorClock[this.userId] = (this.vectorClock[this.userId] || 0) + 1;

    return {
      opId: generateId(),
      opType,
      data,
      vectorClock: { ...this.vectorClock },
      userId: this.userId,
      timestamp: Date.now(),
    } as T;
  }

  applyRemote(op: Operation): boolean {
    if (this.operations.has(op.opId)) {
      return false;
    }

    this.vectorClock = mergeVectorClocks(this.vectorClock, op.vectorClock);
    this.operations.set(op.opId, op);

    this.notify();
    return true;
  }

  draw(pathId: string, color: string, width: number, points: Point[]): DrawOperation {
    const op = this.createOperation<DrawOperation>('draw', {
      pathId,
      color,
      width,
      points,
    });

    this.operations.set(op.opId, op);
    this.undoStack.push(op.opId);
    this.notify();

    return op;
  }

  erase(pathId: string, width: number, points: Point[]): EraseOperation {
    const op = this.createOperation<EraseOperation>('erase', {
      pathId,
      width,
      points,
    });

    this.operations.set(op.opId, op);
    this.undoStack.push(op.opId);
    this.notify();

    return op;
  }

  undo(): UndoOperation | null {
    const targetOpId = this.undoStack.pop();
    if (!targetOpId) return null;

    const op = this.createOperation<UndoOperation>('undo', {
      targetOpId,
    });

    this.operations.set(op.opId, op);
    this.notify();

    return op;
  }

  clear(): ClearOperation {
    const op = this.createOperation<ClearOperation>('clear', {});

    this.operations.set(op.opId, op);
    this.undoStack = [];
    this.notify();

    return op;
  }

  getOperations(): Operation[] {
    const ops = Array.from(this.operations.values());

    return ops.sort((a, b) => {
      const cmp = compareVectorClocks(a.vectorClock, b.vectorClock);
      if (cmp !== 0) return cmp;
      return a.timestamp - b.timestamp;
    });
  }

  getVisibleOperations(): (DrawOperation | EraseOperation)[] {
    const ops = this.getOperations();

    let lastClearIndex = -1;
    for (let i = ops.length - 1; i >= 0; i--) {
      if (ops[i].opType === 'clear') {
        lastClearIndex = i;
        break;
      }
    }

    const undoneOpIds = new Set<string>();
    for (let i = lastClearIndex + 1; i < ops.length; i++) {
      const op = ops[i];
      if (op.opType === 'undo') {
        undoneOpIds.add(op.data.targetOpId);
      }
    }

    const visible: (DrawOperation | EraseOperation)[] = [];
    for (let i = lastClearIndex + 1; i < ops.length; i++) {
      const op = ops[i];
      if ((op.opType === 'draw' || op.opType === 'erase') && !undoneOpIds.has(op.opId)) {
        visible.push(op);
      }
    }

    return visible;
  }

  loadFromSync(operations: Operation[]) {
    for (const op of operations) {
      if (!this.operations.has(op.opId)) {
        this.operations.set(op.opId, op);
        this.vectorClock = mergeVectorClocks(this.vectorClock, op.vectorClock);
      }
    }

    this.undoStack = [];
    const undoneOpIds = new Set<string>();

    for (const op of this.getOperations()) {
      if (op.opType === 'undo') {
        undoneOpIds.add(op.data.targetOpId);
      } else if (op.opType === 'clear') {
        this.undoStack = [];
        undoneOpIds.clear();
      } else if (op.userId === this.userId && !undoneOpIds.has(op.opId)) {
        this.undoStack.push(op.opId);
      }
    }

    this.notify();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  reset() {
    this.operations.clear();
    this.undoStack = [];
    this.vectorClock = {};
    this.notify();
  }
}
