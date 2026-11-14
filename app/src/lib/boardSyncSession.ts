import { newRequestId } from './requestId';
import { ApiError } from './api';
import type { ResourceKind } from './directory';
import {
  applyCanonicalChange, applyPendingCommand, editablePermission, MAX_COMMAND_OPERATIONS, validPermission, validSequence,
  type BoardDocument, type BoardSnapshot, type BoardTransport, type DocumentAck,
  type DocumentChange, type DocumentCommand, type DocumentMutation, type DocumentPermission,
} from './boardSyncProtocol';
import {
  BoardQueueCapacityError, COMMAND_MAX_AGE_MS, MAX_BOARD_BYTES, MAX_BOARD_COMMANDS,
  type BoardQueue, type QueuedCommand,
} from './boardSyncQueue';
import { invertDocumentMutations } from './documentHistory';

const MAX_CATCHUP_PAGES = 12;
const MAX_COMMANDS_PER_REFRESH = 8;
const MAX_COMMAND_BYTES = 25 * 1024 * 1024;
const MAX_CONFLICT_VALUE_BYTES = 8192;
const MAX_HISTORY_ENTRIES = 100;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const EMPTY_DOCUMENT: BoardDocument = { name: '', defaultPageId: '', pages: [], elements: [], stamps: [] };

export type BoardSyncMode = 'loading' | 'active' | 'legacy' | 'error';
export type BoardSyncStatus = 'loading' | 'catching-up' | 'synced' | 'saving-local' | 'pending' | 'offline' | 'conflict' | 'error' | 'revoked';
export type RefreshResult = 'idle' | 'more' | 'retry' | 'stop';

export interface BoardSyncConflict {
  code: string;
  message: string;
  commandId: string;
  details?: Record<string, unknown>;
  local?: unknown;
}

export interface BoardSyncState {
  mode: BoardSyncMode;
  status: BoardSyncStatus;
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  historyNotice?: string;
  permission?: DocumentPermission;
  resourceKind?: ResourceKind;
  epoch?: number;
  seq?: number;
  pendingCount: number;
  pendingVoteIds?: string[];
  hasDraft?: boolean;
  error?: string;
  conflict?: BoardSyncConflict;
}

export const initialBoardSyncState: BoardSyncState = {
  mode: 'loading', status: 'loading', canEdit: false, canUndo: false, canRedo: false, pendingCount: 0,
};

interface PendingWrite {
  body: string;
  bytes: number;
  createdAt: number;
  command: DocumentCommand;
  localOrder?: number;
}

interface StoredWrite extends PendingWrite {
  order: number;
}

interface HistoryEntry {
  groupId: string;
  sourceCommandId: string;
  operations: DocumentMutation[];
  bytes: number;
}

type HistoryDirection = 'undo' | 'redo';

interface HistoryReplay {
  direction: HistoryDirection;
  entry: HistoryEntry;
  inverse: DocumentMutation[];
}

interface SessionOptions {
  boardId: string;
  userId: string;
  clientId: string;
  transport: BoardTransport;
  queue: BoardQueue;
  onState: (state: BoardSyncState) => void;
  onDocument: (document: BoardDocument, epoch?: number) => void;
  wake: () => void;
  now?: () => number;
}

class FeedGap extends Error {}

type ChangeReceipt = Pick<DocumentChange, 'epoch' | 'seq' | 'clientId' | 'commandId' | 'actorId'>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to synchronize this board.';
}

function sameCommand(
  left: Pick<DocumentCommand, 'epoch' | 'clientId' | 'commandId'>,
  right: Pick<DocumentCommand, 'epoch' | 'clientId' | 'commandId'>,
): boolean {
  return left.epoch === right.epoch && left.clientId === right.clientId && left.commandId === right.commandId;
}

function localConflictValue(command: DocumentCommand, details: Record<string, unknown> | undefined): unknown {
  if (!details || typeof details.field !== 'string') return;
  const field = details.field;
  const mutation = command.operations.find((item) => (
    item.kind === 'rename' ? !details.collection && field === 'name'
      : item.kind === 'patch' && item.collection === details.collection && item.id === details.id
  ));
  const value = mutation?.kind === 'rename' ? mutation.value : mutation?.kind === 'patch'
    ? (mutation.unset?.includes(field) ? null : mutation.fields?.[field]) : undefined;
  if (value !== undefined && new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_CONFLICT_VALUE_BYTES) return value;
}

export { newRequestId as newCommandId };

export class BoardSyncSession {
  private readonly options: SessionOptions;
  private readonly now: () => number;
  private confirmed: BoardSnapshot | undefined;
  private projected: BoardDocument | undefined;
  private snapshotSeq = -1;
  private readonly recentReceipts = new Map<number, ChangeReceipt>();
  private persisted: StoredWrite[] = [];
  private readonly writing = new Set<PendingWrite>();
  private readonly consumed = new Set<number>();
  private queueTail: Promise<void> = Promise.resolve();
  private running: Promise<RefreshResult> | undefined;
  private blocked: { order: number; conflict: BoardSyncConflict } | undefined;
  private mode: BoardSyncMode = 'loading';
  private needsSnapshot = true;
  private catchingUp = false;
  private projectionDirty = false;
  private queueAvailable = false;
  private networkError: string | undefined;
  private storageError: string | undefined;
  private rejectedEdit: string | undefined;
  private rejectedWrites: PendingWrite[] = [];
  private nextLocalOrder = 0;
  private fatalError: string | undefined;
  private authExpired = false;
  private revoked = false;
  private disposed = false;
  private legacyConfirmed = false;
  private gapAt: { epoch: number; seq: number } | undefined;
  private authorizedAt: number | undefined;
  private leaseLocked = false;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly pendingHistory = new Map<string, string>();
  private readonly adoptedHistory = new Set<string>();
  private replayingHistory = false;
  private historyNotice: string | undefined;

  constructor(options: SessionOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  subscription(): { boardId: string; epoch: number; afterSeq: number } | undefined {
    if (this.mode !== 'active' || this.legacyConfirmed || !this.confirmed || this.offlineAuthorizationExpired()) return;
    return { boardId: this.options.boardId, epoch: this.confirmed.epoch, afterSeq: this.confirmed.seq };
  }

  dispose(): void {
    this.disposed = true;
  }

  refresh(): Promise<RefreshResult> {
    if (this.running) return this.running;
    if (this.disposed || this.revoked || this.authExpired || this.mode === 'legacy') return Promise.resolve('stop');
    this.running = this.runRefresh().finally(() => { this.running = undefined; });
    return this.running;
  }

  retry(): Promise<RefreshResult> {
    if (!this.rejectedWrites.length) this.rejectedEdit = undefined;
    this.fatalError = undefined;
    this.gapAt = undefined;
    this.authExpired = false;
    if (this.mode === 'error' && !this.revoked) this.mode = this.confirmed ? 'active' : 'loading';
    return this.refresh();
  }

  enqueue(operations: DocumentMutation[]): Promise<boolean> {
    return this.enqueueWrite(operations);
  }

  undo(commandId?: string): Promise<boolean> {
    return this.replayHistory('undo', commandId);
  }

  redo(): Promise<boolean> {
    return this.replayHistory('redo');
  }

  // Agent application creates an additive batch on the server. Adopt its
  // canonical receipt as a local history action without submitting it again.
  async adoptAdditions(ack: DocumentAck): Promise<boolean> {
    const change = ack.change;
    if (this.disposed || !this.canEdit() || ack.boardId !== this.options.boardId
      || ack.clientId !== this.options.clientId || !change || change.actorId !== this.options.userId
      || !sameCommand(ack, change) || !validSequence(ack.seq, 1) || !this.validChange(change, ack.epoch, ack.seq)
      || change.defaultPageId || change.operations.length > MAX_COMMAND_OPERATIONS) return false;

    const inverse: DocumentMutation[] = [];
    const seen = new Set<string>();
    for (const operation of change.operations) {
      if (operation.kind !== 'upsert') return false;
      const key = `${operation.collection}/${operation.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      inverse.unshift({ kind: 'delete', collection: operation.collection, id: operation.id, expected: { ...operation.value } });
    }
    if (!inverse.length) return false;

    for (let tries = 0; tries < 3 && this.confirmed?.epoch === ack.epoch && this.confirmed.seq < ack.seq; tries++) {
      if (!['idle', 'more'].includes(await this.refresh())) break;
    }
    if (this.disposed || !this.canEdit() || this.confirmed?.epoch !== ack.epoch || this.confirmed.seq < ack.seq) return false;
    if (this.adoptedHistory.has(ack.commandId)) return true;
    const receipt = this.recentReceipts.get(ack.seq);
    if (receipt && (!sameCommand(receipt, ack) || receipt.actorId !== this.options.userId)) return false;
    const entry = this.historyEntry(ack.commandId, inverse);
    this.recordHistory(ack.commandId, entry, undefined, true);
    this.pendingHistory.delete(ack.commandId);
    this.adoptedHistory.add(ack.commandId);
    if (this.adoptedHistory.size > MAX_HISTORY_ENTRIES * 2) {
      const oldest = this.adoptedHistory.values().next().value;
      if (oldest) this.adoptedHistory.delete(oldest);
    }
    this.publish();
    return Boolean(entry);
  }

  private enqueueWrite(operations: DocumentMutation[], replay?: HistoryReplay): Promise<boolean> {
    if (!operations.length) return Promise.resolve(true);
    if (!this.confirmed || !this.canEdit()) {
      this.projectionDirty = true;
      this.publish();
      return Promise.resolve(false);
    }

    let write: PendingWrite | undefined;
    try {
      const body = JSON.stringify({
        protocolVersion: 2,
        epoch: this.confirmed.epoch,
        baseSeq: this.confirmed.seq,
        clientId: this.options.clientId,
        commandId: newRequestId(),
        ...(replay ? { dependsOn: replay.entry.sourceCommandId } : {}),
        operations,
      } satisfies DocumentCommand);
      const bytes = new TextEncoder().encode(body).byteLength;
      if (bytes <= MAX_BOARD_BYTES) write = {
        body, bytes, createdAt: this.now(), command: JSON.parse(body), localOrder: ++this.nextLocalOrder,
      };
      if (!write || bytes > MAX_COMMAND_BYTES) throw new Error('This edit exceeds the 25 MiB command limit.');
      if (operations.length > MAX_COMMAND_OPERATIONS) throw new Error(`An edit can contain up to ${MAX_COMMAND_OPERATIONS} changes.`);
      const pending = this.pending();
      if (pending.length >= MAX_BOARD_COMMANDS || bytes + pending.reduce((sum, item) => sum + item.bytes, 0) > MAX_BOARD_BYTES) {
        throw new BoardQueueCapacityError();
      }
    } catch (error) {
      this.rejectLocalEdit(error, write);
      return Promise.resolve(false);
    }

    const track = !write.command.operations.some((operation) => operation.kind === 'vote');
    const before = track && !replay ? this.projectDocument(this.pending()) : undefined;
    const inverse = before && invertDocumentMutations(before, write.command.operations, this.options.userId);
    const historyOperations = replay?.inverse ?? (inverse && 'operations' in inverse ? inverse.operations : []);
    const entry = this.historyEntry(write.command.commandId, historyOperations, replay?.entry.groupId);
    // Register the edit before waiting for IndexedDB so an incoming change can
    // reconcile against it even while its local transaction is outstanding.
    this.writing.add(write);
    this.projectionDirty = true;
    this.publish();
    const accepted = write;
    return this.withQueue(async () => {
      try {
        if (this.rejectedWrites.some((rejected) => (rejected.localOrder ?? 0) < (accepted.localOrder ?? 0))) {
          throw new Error('An earlier edit in this tab could not be saved.');
        }
        const saved = await this.options.queue.append(accepted.body, accepted.bytes, accepted.createdAt);
        this.writing.delete(accepted);
        if (this.revoked) return false;
        if (this.authExpired || this.disposed) return true;
        this.persisted.push({ ...accepted, order: saved.order });
        if (track && this.confirmed?.epoch === accepted.command.epoch) {
          this.recordHistory(accepted.command.commandId, entry, replay, historyOperations.length > 0);
        }
        this.publish();
        this.options.wake();
        return true;
      } catch (error) {
        this.writing.delete(accepted);
        this.rejectLocalEdit(error, accepted);
        return false;
      }
    });
  }

  private async replayHistory(direction: HistoryDirection, commandId?: string): Promise<boolean> {
    if (this.replayingHistory || !this.canEdit()) return false;
    this.replayingHistory = true;
    try {
      // A click can follow another edit before its local storage transaction
      // finishes. Use the most recent successfully enqueued action.
      await this.queueTail;
      if (!this.canEdit()) return false;
      const stack = direction === 'undo' ? this.undoStack : this.redoStack;
      const entry = stack.at(-1);
      const document = this.projectDocument(this.pending());
      if (!entry || !document || (commandId !== undefined && entry.sourceCommandId !== commandId)) return false;
      const result = invertDocumentMutations(document, entry.operations, this.options.userId);
      if ('reason' in result) {
        stack.pop();
        this.historyNotice = `Could not ${direction} this edit. ${result.reason}`;
        return false;
      }
      return await this.enqueueWrite(entry.operations, { direction, entry, inverse: result.operations });
    } finally {
      this.replayingHistory = false;
      this.publish();
    }
  }

  private historyEntry(sourceCommandId: string, operations: DocumentMutation[], groupId = sourceCommandId): HistoryEntry | undefined {
    if (!operations.length || operations.length > MAX_COMMAND_OPERATIONS) return;
    const bytes = new TextEncoder().encode(JSON.stringify(operations)).byteLength;
    if (bytes > MAX_HISTORY_BYTES) return;
    return { groupId, sourceCommandId, operations, bytes };
  }

  private recordHistory(commandId: string, entry: HistoryEntry | undefined, replay: HistoryReplay | undefined, hadInverse: boolean): void {
    this.historyNotice = undefined;
    if (replay) {
      const source = replay.direction === 'undo' ? this.undoStack : this.redoStack;
      const target = replay.direction === 'undo' ? this.redoStack : this.undoStack;
      const index = source.findIndex((item) => item.sourceCommandId === replay.entry.sourceCommandId);
      if (index === -1) return;
      source.splice(index, 1);
      if (entry) target.push(entry);
      this.pendingHistory.set(commandId, replay.entry.groupId);
    } else if (hadInverse) {
      this.redoStack = [];
      if (entry) {
        this.undoStack.push(entry);
        this.pendingHistory.set(commandId, entry.groupId);
      }
    }
    if (!entry && hadInverse) this.historyNotice = 'This edit exceeds the session history limit.';
    this.trimHistory();
  }

  private trimHistory(): void {
    const total = [...this.undoStack, ...this.redoStack];
    let bytes = total.reduce((sum, item) => sum + item.bytes, 0);
    let count = total.length;
    while (count > MAX_HISTORY_ENTRIES || bytes > MAX_HISTORY_BYTES) {
      const removed = this.undoStack.shift() ?? this.redoStack.shift();
      if (!removed) break;
      bytes -= removed.bytes;
      count -= 1;
    }
  }

  private invalidateHistory(commandId: string): void {
    const groupId = this.pendingHistory.get(commandId);
    if (!groupId) return;
    this.undoStack = this.undoStack.filter((entry) => entry.groupId !== groupId);
    this.redoStack = this.redoStack.filter((entry) => entry.groupId !== groupId);
    this.pendingHistory.delete(commandId);
  }

  private resetHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingHistory.clear();
    this.adoptedHistory.clear();
    this.historyNotice = undefined;
  }

  private confirmHistory(change: DocumentChange, before: BoardDocument, write?: StoredWrite): void {
    if (!this.pendingHistory.delete(change.commandId) || !write) return;
    const stack = this.undoStack.some((entry) => entry.sourceCommandId === change.commandId) ? this.undoStack : this.redoStack;
    const index = stack.findIndex((entry) => entry.sourceCommandId === change.commandId);
    if (index < 0) return;
    const plan = invertDocumentMutations(before, write.command.operations, this.options.userId, change.operations);
    if ('reason' in plan) return;
    const confirmed = this.historyEntry(change.commandId, plan.operations, stack[index].groupId);
    if (confirmed) stack[index] = confirmed;
    else stack.splice(index, 1);
    this.trimHistory();
  }

  async discardConflict(commandId?: string): Promise<void> {
    const blocked = this.blocked;
    const order = blocked?.order;
    if (this.disposed || this.revoked || this.authExpired || this.offlineAuthorizationExpired()) return;
    if (commandId !== undefined && commandId !== (blocked?.conflict.commandId ?? this.rejectedWrites[0]?.command.commandId)) return;
    if (order === undefined) {
      this.rejectedWrites.shift();
      if (!this.rejectedWrites.length) this.rejectedEdit = undefined;
      this.publish();
      return;
    }
    try {
      await this.removeWrites([order]);
      if (blocked) this.invalidateHistory(blocked.conflict.commandId);
      this.publish();
      this.options.wake();
    } catch (error) {
      this.storageError = errorMessage(error);
      this.publish();
    }
  }

  draft(): string | undefined {
    if (!this.canExportDraft()) return;
    const writes = this.pending();
    if (!writes.length && !this.rejectedWrites.length) return;
    const describe = (write: PendingWrite) => ({ queuedAt: new Date(write.createdAt).toISOString(), ...write.command });
    return JSON.stringify({
      format: 'openjam-pending-commands',
      boardId: this.options.boardId,
      commands: writes.map(describe),
      rejectedEdits: this.rejectedWrites.length ? this.rejectedWrites.map(describe) : undefined,
    }, null, 2);
  }

  private offlineAuthorizationExpired(): boolean {
    return this.authorizedAt !== undefined && this.now() - this.authorizedAt >= COMMAND_MAX_AGE_MS;
  }

  private canExportDraft(): boolean {
    return !this.disposed && !this.revoked && !this.authExpired && !this.offlineAuthorizationExpired()
      && (!!this.confirmed || this.legacyConfirmed);
  }

  private canEdit(): boolean {
    return !this.disposed && !this.revoked && !this.authExpired && !this.legacyConfirmed && this.mode === 'active'
      && editablePermission(this.confirmed?.permission) && this.queueAvailable
      && !this.blocked && !this.storageError && !this.rejectedEdit && !this.offlineAuthorizationExpired();
  }

  private pending(): PendingWrite[] {
    return [...this.persisted.filter((item) => !this.consumed.has(item.order)), ...this.writing];
  }

  private projectDocument(pending: PendingWrite[]): BoardDocument | undefined {
    const confirmed = this.confirmed;
    if (!confirmed) return;
    if (!this.projectionDirty && this.projected) return this.projected;
    let document = confirmed.document;
    const blocked = this.blocked?.order;
    if (editablePermission(confirmed.permission) && !this.legacyConfirmed) {
      for (const write of pending) {
        if (blocked !== undefined && (!('order' in write) || Number(write.order) >= blocked)) break;
        if (write.command.epoch === confirmed.epoch && !this.expired(write)) {
          document = applyPendingCommand(document, write.command, this.options.userId);
        }
      }
    }
    return document;
  }

  private publish(): void {
    if (this.disposed || this.revoked || this.authExpired) return;
    const pending = this.pending();
    const leaseExpired = this.offlineAuthorizationExpired();
    if (leaseExpired !== this.leaseLocked) {
      this.leaseLocked = leaseExpired;
      this.projectionDirty = true;
      if (leaseExpired) this.options.onDocument(structuredClone(EMPTY_DOCUMENT));
    }
    if (this.projectionDirty && this.confirmed && !leaseExpired) {
      this.projected = this.projectDocument(pending);
      this.projectionDirty = false;
      if (this.projected) this.options.onDocument(structuredClone(this.projected), this.confirmed.epoch);
    }

    const error = leaseExpired ? 'Reconnect to renew access to this board.'
      : this.fatalError ?? this.storageError ?? this.rejectedEdit ?? this.blocked?.conflict.message ?? this.networkError;
    let status: BoardSyncStatus = 'synced';
    if (leaseExpired) status = 'offline';
    else if (this.fatalError || this.storageError || this.rejectedEdit) status = 'error';
    else if (this.blocked) status = 'conflict';
    else if (this.writing.size) status = 'saving-local';
    else if (this.networkError) status = 'offline';
    else if (this.mode === 'loading') status = 'loading';
    else if (this.catchingUp) status = 'catching-up';
    else if (pending.length) status = 'pending';
    const localConflict = this.rejectedWrites[0] && this.rejectedEdit ? {
      code: 'LOCAL_WRITE_REJECTED', commandId: this.rejectedWrites[0].command.commandId, message: this.rejectedEdit,
    } : undefined;
    const pendingVoteIds = new Set<string>();
    for (const write of pending) {
      for (const operation of write.command.operations) {
        if (operation.kind === 'vote') pendingVoteIds.add(operation.id);
      }
    }
    const canEdit = this.canEdit();
    this.options.onState({
      mode: this.mode, status, canEdit, permission: this.confirmed?.permission,
      resourceKind: this.confirmed && (this.confirmed.resourceKind ?? 'board'),
      canUndo: canEdit && !this.replayingHistory && this.undoStack.length > 0,
      canRedo: canEdit && !this.replayingHistory && this.redoStack.length > 0,
      historyNotice: this.historyNotice,
      epoch: this.confirmed?.epoch, seq: this.confirmed?.seq,
      pendingVoteIds: pendingVoteIds.size ? [...pendingVoteIds] : undefined,
      pendingCount: pending.length, hasDraft: this.canExportDraft() && (pending.length > 0 || this.rejectedWrites.length > 0),
      error, conflict: leaseExpired ? undefined : this.blocked?.conflict ?? localConflict,
    });
  }

  private rejectLocalEdit(error: unknown, write?: PendingWrite): void {
    if (this.disposed || this.revoked || this.authExpired) return;
    this.rejectedEdit = `An edit was not saved to this device. ${errorMessage(error)}`;
    if (write && this.rejectedWrites.length < MAX_BOARD_COMMANDS
      && write.bytes + this.rejectedWrites.reduce((sum, item) => sum + item.bytes, 0) <= MAX_BOARD_BYTES) {
      this.rejectedWrites.push(write);
      this.rejectedWrites.sort((left, right) => (left.localOrder ?? 0) - (right.localOrder ?? 0));
    }
    this.projectionDirty = true;
    this.publish();
  }

  private withQueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queueTail.then(work);
    this.queueTail = next.then(() => undefined, () => undefined);
    return next;
  }

  private async loadQueue(): Promise<void> {
    try {
      await this.withQueue(async () => {
        const records = await this.options.queue.list();
        if (this.disposed || this.revoked || this.authExpired) return;
        const previous = new Map(this.persisted.map((write) => [write.order, write]));
        const writes = records.map((record: QueuedCommand) => previous.get(record.order) ?? { ...record, command: JSON.parse(record.body) });
        this.projectionDirty ||= writes.length !== this.persisted.length || writes.some((write, index) => write !== this.persisted[index]);
        this.persisted = writes;
        if (this.blocked && !writes.some((write) => write.order === this.blocked?.order)) this.blocked = undefined;
        for (const order of this.consumed) {
          if (!writes.some((write) => write.order === order)) this.consumed.delete(order);
        }
        this.queueAvailable = true;
        this.storageError = undefined;
      });
    } catch (error) {
      this.queueAvailable = false;
      this.storageError = 'Offline edit storage is unavailable. ' + errorMessage(error);
    }
  }

  private async removeWrites(orders: number[]): Promise<void> {
    if (!orders.length) return;
    await this.withQueue(async () => {
      await this.options.queue.remove(orders);
      this.persisted = this.persisted.filter((write) => !orders.includes(write.order));
      for (const order of orders) this.consumed.delete(order);
      if (this.blocked && orders.includes(this.blocked.order)) this.blocked = undefined;
      this.projectionDirty = true;
    });
  }

  private async consumeWrites(orders: number[]): Promise<void> {
    if (!orders.length) return;
    for (const order of orders) this.consumed.add(order);
    try {
      await this.removeWrites(orders);
    } catch (error) {
      // The server has committed these commands. Do not apply their optimistic
      // payload again while a failed IndexedDB deletion is retried.
      this.storageError = errorMessage(error);
      this.projectionDirty = true;
    }
  }

  private async loadSnapshot(): Promise<void> {
    const snapshot = await this.options.transport.snapshot();
    if (this.disposed) return;
    if (snapshot.protocolVersion !== 2 || snapshot.boardId !== this.options.boardId
      || !validSequence(snapshot.epoch, 1) || !validSequence(snapshot.seq)
      || (this.confirmed && (snapshot.epoch < this.confirmed.epoch
        || (snapshot.epoch === this.confirmed.epoch && snapshot.seq < this.confirmed.seq)))
      || !validPermission(snapshot.permission) || typeof snapshot.document?.name !== 'string'
      || typeof snapshot.document?.defaultPageId !== 'string'
      || !Array.isArray(snapshot.document?.pages) || !Array.isArray(snapshot.document?.elements)
      || !Array.isArray(snapshot.document?.stamps)) {
      throw new Error('The server returned an invalid board snapshot.');
    }
    this.projectionDirty ||= this.confirmed?.epoch !== snapshot.epoch || this.confirmed?.seq !== snapshot.seq
      || this.confirmed?.hash !== snapshot.hash || this.confirmed?.permission !== snapshot.permission || this.legacyConfirmed;
    if (this.confirmed?.epoch !== snapshot.epoch) this.resetHistory();
    this.confirmed = snapshot;
    this.snapshotSeq = snapshot.seq;
    this.recentReceipts.clear();
    this.authorizedAt = this.now();
    this.legacyConfirmed = false;
    this.needsSnapshot = false;
    this.mode = 'active';
    this.networkError = undefined;
    this.fatalError = undefined;
  }

  private validChange(change: DocumentChange, epoch: number, seq: number): boolean {
    return change?.epoch === epoch && change.seq === seq && typeof change.clientId === 'string'
      && typeof change.commandId === 'string' && (change.actorId === undefined || typeof change.actorId === 'string')
      && (change.defaultPageId === undefined || typeof change.defaultPageId === 'string') && Array.isArray(change.operations)
      && change.operations.every((operation) => {
        if (operation.kind === 'rename') return typeof operation.value === 'string';
        if (operation.collection !== 'pages' && operation.collection !== 'elements' && operation.collection !== 'stamps') return false;
        if (typeof operation.id !== 'string') return false;
        if (operation.kind === 'delete') return true;
        return operation.kind === 'upsert' && operation.value?.id === operation.id
          && (operation.position === undefined || validSequence(operation.position));
      });
  }

  private async applyChanges(changes: DocumentChange[], permission: BoardSnapshot['permission']): Promise<void> {
    const current = this.confirmed;
    if (!current) throw new FeedGap();
    let document = current.document;
    let seq = current.seq;
    const acknowledged: number[] = [];
    for (const change of changes) {
      if (!this.validChange(change, current.epoch, seq + 1)) throw new FeedGap();
      seq = change.seq;
    }
    for (const change of changes) {
      const before = document;
      document = applyCanonicalChange(document, change);
      const { epoch, seq: appliedSeq, clientId, commandId, actorId } = change;
      const receipt = { epoch, seq: appliedSeq, clientId, commandId, actorId };
      this.recentReceipts.set(appliedSeq, receipt);
      if (actorId !== this.options.userId) continue;
      const write = this.persisted.find((item) => sameCommand(item.command, receipt));
      if (clientId === this.options.clientId) this.confirmHistory(change, before, write);
      if (write) acknowledged.push(write.order);
    }
    this.projectionDirty ||= current.seq !== seq || current.permission !== permission;
    this.confirmed = { ...current, seq, document, permission };
    this.authorizedAt = this.now();
    const cutoff = seq - MAX_BOARD_COMMANDS;
    for (const appliedSeq of this.recentReceipts.keys()) {
      if (appliedSeq > cutoff) break;
      this.recentReceipts.delete(appliedSeq);
    }
    await this.consumeWrites(acknowledged);
  }

  private async catchUp(target?: number): Promise<boolean> {
    for (let page = 0; page < MAX_CATCHUP_PAGES && !this.disposed; page++) {
      const current = this.confirmed;
      if (!current) return false;
      if (target !== undefined && current.seq >= target) return true;
      const response = await this.options.transport.changes(current.epoch, current.seq);
      if (this.disposed) return false;
      if (response.boardId !== this.options.boardId || response.epoch !== current.epoch
        || !validPermission(response.permission)
        || !validSequence(response.floorSeq) || response.floorSeq > current.seq
        || !validSequence(response.headSeq, current.seq) || !Array.isArray(response.changes)
        || current.seq + response.changes.length > response.headSeq
        || response.hasMore !== (current.seq + response.changes.length < response.headSeq)
        || (response.hasMore && !response.changes.length)) {
        throw new FeedGap();
      }
      await this.applyChanges(response.changes, response.permission);
      if (!response.hasMore) return target === undefined || (this.confirmed?.seq ?? 0) >= target;
    }
    return !this.disposed && target !== undefined && (this.confirmed?.seq ?? 0) >= target;
  }

  private expired(write: PendingWrite): boolean {
    return this.now() - write.createdAt >= COMMAND_MAX_AGE_MS;
  }

  private block(write: StoredWrite, code: string, message: string, details?: Record<string, unknown>): void {
    this.blocked = { order: write.order, conflict: {
      code, message, commandId: write.command.commandId, details, local: localConflictValue(write.command, details),
    } };
    this.projectionDirty = true;
  }

  private async verifyAck(ack: DocumentAck, write: StoredWrite): Promise<boolean> {
    const current = this.confirmed;
    if (!current || ack.boardId !== this.options.boardId || !sameCommand(write.command, ack)
      || ack.epoch !== current.epoch || !validSequence(ack.seq, 1)
      || (ack.change && (!sameCommand(ack, ack.change) || !this.validChange(ack.change, ack.epoch, ack.seq)
        || (ack.change.actorId !== undefined && ack.change.actorId !== this.options.userId)))) {
      throw new Error('The server returned an invalid commit acknowledgment. Your edit is still queued.');
    }
    if (ack.change && ack.seq === current.seq + 1) {
      await this.applyChanges([ack.change], current.permission);
    } else if (ack.seq > current.seq && !await this.catchUp(ack.seq)) {
      return false;
    }
    if (this.disposed) return false;
    const receipt = this.recentReceipts.get(ack.seq);
    if (receipt && (!sameCommand(ack, receipt) || (receipt.actorId !== undefined && receipt.actorId !== this.options.userId))) {
      throw new Error('The commit acknowledgment does not match the change feed. Your edit is still queued.');
    }
    if (!receipt && ack.seq > this.snapshotSeq) {
      await this.loadSnapshot();
      if (this.disposed || this.confirmed?.epoch !== ack.epoch || this.confirmed.seq < ack.seq) return false;
    }
    if (ack.clientId === this.options.clientId) this.pendingHistory.delete(ack.commandId);
    if (this.persisted.some((item) => item.order === write.order)) await this.consumeWrites([write.order]);
    return true;
  }

  private async flush(): Promise<RefreshResult> {
    for (let count = 0; count < MAX_COMMANDS_PER_REFRESH && !this.disposed; count++) {
      const write = this.persisted.find((item) => !this.consumed.has(item.order));
      if (!write || !this.confirmed || !this.queueAvailable || this.blocked) return 'idle';
      if (write.command.epoch !== this.confirmed.epoch) {
        this.block(write, 'STALE_EPOCH', 'A queued edit belongs to an older board version. Export or discard it to continue.');
        return 'idle';
      }
      if (this.expired(write)) {
        this.block(write, 'EXPIRED', 'A queued edit is over seven days old. Export or discard it to continue.');
        return 'idle';
      }
      if (!editablePermission(this.confirmed.permission)) {
        this.block(write, 'EDIT_ACCESS_LOST', 'You can view this board, but queued edits require edit access.');
        return 'idle';
      }

      let ack: DocumentAck;
      try {
        ack = await this.options.transport.commit(write.body);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 403 && error.code === 'ACCESS_DENIED') {
          // A board can still be readable after edit access is revoked.
          await this.loadSnapshot();
          if (this.disposed) return 'stop';
          this.block(write, 'EDIT_ACCESS_LOST', 'You no longer have permission to submit this edit.');
          return 'idle';
        }
        if (error.code === 'RESYNC_REQUIRED' && typeof error.details?.floorSeq === 'number'
          && write.command.baseSeq < error.details.floorSeq) {
          this.block(write, error.code, 'A queued edit is older than the board’s retained changes. Export or discard it to continue.', error.details);
          return 'idle';
        }
        if (error.code === 'STALE_EPOCH' || error.code === 'RESYNC_REQUIRED' || error.code === 'LEGACY_MODE'
          || error.status === 401 || error.status === 404 || error.status === 429 || error.status >= 500) throw error;
        this.block(write, error.code ?? 'INVALID_COMMAND', error.message, error.details);
        return 'idle';
      }
      if (this.disposed) return 'stop';
      if (!await this.verifyAck(ack, write)) return 'more';
    }
    return this.persisted.some((item) => !this.consumed.has(item.order)) ? 'more' : 'idle';
  }

  private async denyAccess(revoked: boolean): Promise<RefreshResult> {
    this.revoked = revoked;
    this.authExpired = !revoked;
    this.mode = 'error';
    this.confirmed = undefined;
    this.projected = undefined;
    this.resetHistory();
    this.needsSnapshot = true;
    this.authorizedAt = undefined;
    this.recentReceipts.clear();
    this.persisted = [];
    this.writing.clear();
    this.blocked = undefined;
    this.rejectedWrites = [];
    const message = revoked ? 'This board is no longer accessible.' : 'Sign in again to resume board sync.';
    this.options.onDocument(structuredClone(EMPTY_DOCUMENT));
    this.options.onState({ ...initialBoardSyncState, mode: 'error', status: revoked ? 'revoked' : 'error', error: message });
    if (!revoked) return 'stop';
    try {
      await this.withQueue(() => this.options.queue.clear());
    } catch {
      if (!this.disposed) this.options.onState({
        ...initialBoardSyncState, mode: 'error', status: 'revoked',
        error: message + ' The browser could not clear its offline queue.',
      });
    }
    return 'stop';
  }

  private async handleFailure(error: unknown): Promise<RefreshResult> {
    if (this.disposed) return 'stop';
    if (error instanceof ApiError) {
      if (error.status === 401) return this.denyAccess(false);
      if ((error.status === 403 && error.code === 'ACCESS_DENIED')
        || (error.status === 404 && error.code === 'BOARD_NOT_FOUND')) return this.denyAccess(true);
      if (error.code === 'LEGACY_MODE') {
        this.resetHistory();
        this.legacyConfirmed = true;
        this.authorizedAt = this.now();
        this.networkError = undefined;
        this.projectionDirty = true;
        const queued = this.persisted.find((write) => !this.consumed.has(write.order));
        if (queued) {
          this.mode = this.confirmed ? 'active' : 'loading';
          this.block(queued, 'LEGACY_MODE', 'The board returned to the legacy editor. Export or discard its queued V2 edits to continue.');
          return 'idle';
        }
        this.mode = 'legacy';
        this.blocked = undefined;
        return 'stop';
      }
      if (error.code === 'MIGRATION_BLOCKED') {
        this.mode = 'error';
        this.fatalError = error.message;
        return 'stop';
      }
    }
    if (error instanceof FeedGap || (error instanceof ApiError && ['STALE_EPOCH', 'RESYNC_REQUIRED'].includes(error.code ?? ''))) {
      const current = this.confirmed;
      this.needsSnapshot = true;
      this.catchingUp = true;
      if (current && (this.gapAt?.epoch !== current.epoch || this.gapAt.seq !== current.seq)) {
        this.gapAt = { epoch: current.epoch, seq: current.seq };
        return 'more';
      }
    }
    this.networkError = errorMessage(error);
    return 'retry';
  }

  private async runRefresh(): Promise<RefreshResult> {
    try {
      await this.loadQueue();
      if (this.disposed) return 'stop';
      await this.consumeWrites([...this.consumed]);
      if (this.needsSnapshot || this.legacyConfirmed) await this.loadSnapshot();
      if (this.disposed || !this.confirmed) return 'stop';
      if (!await this.catchUp()) {
        this.catchingUp = true;
        return 'more';
      }
      if (this.disposed) return 'stop';
      const stillQueued = new Set(this.persisted.map((write) => write.command.commandId));
      for (const commandId of this.pendingHistory.keys()) {
        if (!stillQueued.has(commandId)) this.invalidateHistory(commandId);
      }
      this.gapAt = undefined;
      this.networkError = undefined;
      this.catchingUp = false;
      if (this.blocked?.conflict.code === 'EDIT_ACCESS_LOST' && editablePermission(this.confirmed.permission)) {
        this.blocked = undefined;
        this.projectionDirty = true;
      }
      return await this.flush();
    } catch (error) {
      return await this.handleFailure(error);
    } finally {
      this.publish();
    }
  }
}
