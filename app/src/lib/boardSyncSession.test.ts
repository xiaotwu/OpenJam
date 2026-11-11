import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
  type BoardDocument, type BoardSnapshot, type BoardTransport, type DocumentAck,
  type DocumentChange, type DocumentChangePage, type DocumentCommand,
} from './boardSyncProtocol';
import { COMMAND_MAX_AGE_MS, type BoardQueue, type QueuedCommand } from './boardSyncQueue';
import { BoardSyncSession, type BoardSyncState } from './boardSyncSession';

const boardId = 'test-board';
const userId = 'user-1';
const initialDocument: BoardDocument = {
  name: 'Board', defaultPageId: 'page-1',
  pages: [{ id: 'page-1', name: 'One' }, { id: 'page-2', name: 'Two' }],
  elements: [], stamps: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function change(command: DocumentCommand, seq: number, value: string): DocumentChange {
  const { epoch, clientId, commandId } = command;
  return { epoch, seq, clientId, commandId, actorId: userId, operations: [{ kind: 'rename', value }] };
}

function remoteChange(seq: number, value: string): DocumentChange {
  return { epoch: 1, seq, clientId: 'remote-client', commandId: `remote-${seq}`, actorId: 'user-2', operations: [{ kind: 'rename', value }] };
}

function page(changes: DocumentChange[], headSeq: number, epoch = 1): DocumentChangePage {
  return { boardId, epoch, headSeq, floorSeq: 0, permission: 'owner', changes, hasMore: false };
}

function ack(command: DocumentCommand, seq: number, canonical?: DocumentChange): DocumentAck {
  const { epoch, clientId, commandId } = command;
  return { boardId, epoch, seq, clientId, commandId, replayed: false, change: canonical };
}

function fixture(now: () => number = Date.now) {
  let order = 0;
  const stored = new Map<number, QueuedCommand>();
  const queue = {
    list: vi.fn(async () => [...stored.values()]),
    append: vi.fn(async (body: string, bytes: number, createdAt: number) => {
      const row = { order: ++order, userId, boardId, body, bytes, createdAt };
      stored.set(row.order, row);
      return row;
    }),
    remove: vi.fn(async (orders: number[]) => { for (const id of orders) stored.delete(id); }),
    clear: vi.fn(async () => { stored.clear(); }),
  } satisfies BoardQueue;
  const transport = {
    snapshot: vi.fn<BoardTransport['snapshot']>(async () => ({
      protocolVersion: 2, boardId, epoch: 1, seq: 0, hash: 'initial', permission: 'owner',
      updatedAt: '', document: initialDocument,
    })),
    changes: vi.fn<BoardTransport['changes']>(async (epoch, afterSeq) => page([], afterSeq, epoch)),
    commit: vi.fn<BoardTransport['commit']>(async () => { throw new Error('unexpected commit'); }),
  };
  const onState = vi.fn<(state: BoardSyncState) => void>();
  const onDocument = vi.fn<(document: BoardDocument) => void>();
  const session = (clientId = 'client-1') => new BoardSyncSession({
    boardId, userId, clientId, transport, queue, now, onState, onDocument, wake: () => {},
  });
  return {
    session, transport, queue, stored,
    state: () => onState.mock.lastCall?.[0],
    document: () => onDocument.mock.lastCall?.[0],
  };
}

function queuedCommands(f: ReturnType<typeof fixture>): DocumentCommand[] {
  return [...f.stored.values()].map((row) => JSON.parse(row.body) as DocumentCommand);
}

describe('BoardSyncSession', () => {
  it('adopts one additive server commit into guarded undo without writing it again', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    const addition: DocumentChange = {
      epoch: 1, seq: 1, clientId: 'client-1', commandId: 'applied-draft', actorId: userId,
      operations: [{ kind: 'upsert', collection: 'pages', id: 'agent-page', value: { id: 'agent-page', name: 'Workshop' } }],
    };
    const receipt = { boardId, epoch: 1, seq: 1, clientId: addition.clientId, commandId: addition.commandId, replayed: false, change: addition };
    f.transport.changes.mockResolvedValueOnce(page([addition], 1));
    expect(await board.adoptAdditions(receipt)).toBe(true);
    expect(await board.adoptAdditions({ ...receipt, replayed: true })).toBe(true);
    expect(f.document()?.pages.at(-1)?.id).toBe('agent-page');
    expect(f.transport.commit).not.toHaveBeenCalled();
    expect(await board.undo('another-draft')).toBe(false);
    expect(await board.undo('applied-draft')).toBe(true);
    expect(await board.undo()).toBe(false);
    expect(queuedCommands(f)[0]).toMatchObject({ dependsOn: 'applied-draft', operations: [
      { kind: 'delete', collection: 'pages', id: 'agent-page', expected: { id: 'agent-page', name: 'Workshop' } },
    ] });
  });

  it('queues one guarded undo and redo batch after an offline page edit', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    await board.enqueue([
      { kind: 'add', collection: 'pages', id: 'page-3', position: 1, value: { id: 'page-3', name: 'Review' } },
      { kind: 'setDefaultPage', value: 'page-3', expected: { defaultPageId: 'page-1' } },
      { kind: 'patch', collection: 'pages', id: 'page-2', fields: { name: 'Retrospective' } },
    ]);
    expect(f.state()).toMatchObject({ canUndo: true, canRedo: false });
    expect(f.document()?.pages.map(({ id }) => id)).toEqual(['page-1', 'page-3', 'page-2']);
    expect(f.document()?.defaultPageId).toBe('page-3');

    expect(await board.undo()).toBe(true);
    const [source, undo] = queuedCommands(f);
    expect(undo.dependsOn).toBe(source.commandId);
    expect(undo.operations).toEqual([
      { kind: 'patch', collection: 'pages', id: 'page-2', fields: { name: 'Two' }, expected: { name: 'Retrospective' } },
      { kind: 'setDefaultPage', value: 'page-1', expected: { defaultPageId: 'page-3' } },
      { kind: 'delete', collection: 'pages', id: 'page-3', expected: { id: 'page-3', name: 'Review' } },
    ]);
    expect(f.document()).toEqual(initialDocument);
    expect(f.state()).toMatchObject({ canUndo: false, canRedo: true });

    expect(await board.redo()).toBe(true);
    const redo = queuedCommands(f)[2];
    expect(redo.dependsOn).toBe(undo.commandId);
    expect(redo.operations[0]).toEqual({
      kind: 'restore', collection: 'pages', id: 'page-3', position: 1, value: { id: 'page-3', name: 'Review' },
    });
    expect(f.document()?.pages.map(({ id }) => id)).toEqual(['page-1', 'page-3', 'page-2']);
    expect(f.document()?.defaultPageId).toBe('page-3');
    expect(f.transport.commit).not.toHaveBeenCalled();
  });

  it('uses canonical fields when undoing and leaves independent remote edits intact', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    await board.enqueue([{ kind: 'patch', collection: 'pages', id: 'page-1', fields: { name: 'New name ' } }]);
    f.transport.commit.mockImplementationOnce(async (body) => {
      const command = JSON.parse(body) as DocumentCommand;
      return ack(command, 1, { ...change(command, 1, ''), operations: [{
        kind: 'upsert', collection: 'pages', id: 'page-1', value: { id: 'page-1', name: 'New name' },
      }] });
    });
    await board.refresh();
    f.transport.changes.mockResolvedValueOnce(page([{ ...remoteChange(2, ''), operations: [{
      kind: 'upsert', collection: 'pages', id: 'page-1', value: { id: 'page-1', name: 'New name', thumbnail: 'other-editor' },
    }] }], 2));
    await board.refresh();

    expect(await board.undo()).toBe(true);
    expect(queuedCommands(f)[0].operations).toEqual([{
      kind: 'patch', collection: 'pages', id: 'page-1', fields: { name: 'One' }, expected: { name: 'New name' },
    }]);
    expect(f.document()?.pages[0]).toEqual({ id: 'page-1', name: 'One', thumbnail: 'other-editor' });
  });

  it('blocks the whole inverse when one of its fields changed remotely', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    await board.enqueue([
      { kind: 'patch', collection: 'pages', id: 'page-1', fields: { name: 'First edit' } },
      { kind: 'patch', collection: 'pages', id: 'page-2', fields: { name: 'Second edit' } },
    ]);
    f.transport.commit.mockImplementationOnce(async (body) => {
      const command = JSON.parse(body) as DocumentCommand;
      return ack(command, 1, { ...change(command, 1, ''), operations: [
        { kind: 'upsert', collection: 'pages', id: 'page-1', value: { id: 'page-1', name: 'First edit' } },
        { kind: 'upsert', collection: 'pages', id: 'page-2', value: { id: 'page-2', name: 'Second edit' } },
      ] });
    });
    await board.refresh();
    f.transport.changes.mockResolvedValueOnce(page([{ ...remoteChange(2, ''), operations: [{
      kind: 'upsert', collection: 'pages', id: 'page-1', value: { id: 'page-1', name: 'Remote edit' },
    }] }], 2));
    await board.refresh();

    expect(await board.undo()).toBe(false);
    expect(f.state()).toMatchObject({ canUndo: false, canRedo: false, historyNotice: 'Could not undo this edit. The name field has changed.' });
    expect(f.stored.size).toBe(0);
    expect(f.document()?.pages.map(({ name }) => name)).toEqual(['Remote edit', 'Second edit']);
  });

  it('restores a deleted default page before its stamped content', async () => {
    const f = fixture();
    const board = f.session();
    const stamp = { id: 'stamp', pageId: 'page-1', emoji: '🎯', x: 10, y: 10, scale: 1, rotation: 0, userId, createdAt: 1 };
    const snapshot = await f.transport.snapshot();
    f.transport.snapshot.mockResolvedValueOnce({ ...snapshot, document: { ...initialDocument, stamps: [stamp] } });
    await board.refresh();
    await board.enqueue([
      { kind: 'delete', collection: 'stamps', id: stamp.id },
      { kind: 'delete', collection: 'pages', id: 'page-1' },
    ]);
    expect(f.document()).toMatchObject({ defaultPageId: 'page-2', stamps: [] });
    expect(await board.undo()).toBe(true);
    expect(queuedCommands(f)[1].operations).toEqual([
      { kind: 'restore', collection: 'pages', id: 'page-1', position: 0, value: initialDocument.pages[0] },
      { kind: 'setDefaultPage', value: 'page-1', expected: { defaultPageId: 'page-2' } },
      { kind: 'restore', collection: 'stamps', id: stamp.id, value: stamp },
    ]);
    expect(f.document()).toEqual({ ...initialDocument, stamps: [stamp] });
  });

  it('does not keep replay history for a dependency discarded in another tab', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    await board.enqueue([{ kind: 'rename', value: 'My draft', expected: { name: 'Board' } }]);
    expect(await board.undo()).toBe(true);
    const sourceOrder = [...f.stored.keys()][0];
    await f.queue.remove([sourceOrder]);
    f.transport.commit.mockRejectedValueOnce(new ApiError('Original edit unavailable', 409, 'HISTORY_DEPENDENCY'));
    await board.refresh();

    expect(f.state()).toMatchObject({ status: 'conflict', canUndo: false, canRedo: false, conflict: { code: 'HISTORY_DEPENDENCY' } });
    await board.discardConflict();
    await board.refresh();
    expect(f.state()).toMatchObject({ status: 'synced', canUndo: false, canRedo: false });
    expect(f.document()).toEqual(initialDocument);
  });

  it('reorders pages with an order precondition and drops history on a new epoch', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    await board.enqueue([{ kind: 'reorder', collection: 'pages', id: 'page-1', position: 1, expected: { order: ['page-1', 'page-2'] } }]);
    expect(f.document()?.pages.map(({ id }) => id)).toEqual(['page-2', 'page-1']);
    expect(await board.undo()).toBe(true);
    expect(queuedCommands(f)[1].operations).toEqual([
      { kind: 'reorder', collection: 'pages', id: 'page-1', position: 0, expected: { order: ['page-2', 'page-1'] } },
    ]);
    expect(f.state()).toMatchObject({ canRedo: true });

    f.transport.changes.mockRejectedValueOnce(new ApiError('New epoch', 409, 'RESYNC_REQUIRED'));
    expect(await board.refresh()).toBe('more');
    const oldSnapshot = await f.transport.snapshot();
    f.transport.snapshot.mockResolvedValueOnce({ ...oldSnapshot, epoch: 2, seq: 1 });
    await board.refresh();
    expect(f.state()).toMatchObject({ epoch: 2, seq: 1, canUndo: false, canRedo: false, pendingCount: 2, conflict: { code: 'STALE_EPOCH' } });
    expect(f.stored.size).toBe(2);
  });

  it('waits for the server ballot and excludes votes from document history', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    expect(await board.enqueue([{ kind: 'vote', collection: 'elements', id: 'poll', value: { action: 'poll-cast', optionId: 'a' } }])).toBe(true);
    expect(f.state()).toMatchObject({ pendingCount: 1, pendingVoteIds: ['poll'], canUndo: false });
    expect(f.document()).toEqual(initialDocument);
    expect(await board.undo()).toBe(false);
  });

  it('retries the exact durable envelope and publishes the canonical ack before becoming synced', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    expect(await board.enqueue([{ kind: 'rename', value: 'New name ', expected: { name: 'Board' } }])).toBe(true);
    expect(f.state()).toMatchObject({ status: 'pending', pendingCount: 1 });
    const original = [...f.stored.values()][0].body;
    f.transport.commit.mockRejectedValueOnce(new Error('response lost'));
    expect(await board.refresh()).toBe('retry');
    expect(f.stored.size).toBe(1);
    expect(f.state()).toMatchObject({ status: 'offline', canEdit: true });

    f.transport.commit.mockImplementationOnce(async (body) => {
      const command = JSON.parse(body) as DocumentCommand;
      return ack(command, 1, change(command, 1, 'New name'));
    });
    await board.refresh();
    expect(f.transport.commit.mock.calls).toEqual([[original], [original]]);
    expect(f.document()?.name).toBe('New name');
    expect(f.state()).toMatchObject({ status: 'synced', pendingCount: 0 });
    expect(f.stored.size).toBe(0);
  });

  it('restores a queued envelope after reopening and consumes its own receipt from the ordered feed', async () => {
    const f = fixture();
    const original = f.session();
    await original.refresh();
    await original.enqueue([{ kind: 'rename', value: 'Local', expected: { name: 'Board' } }]);
    const command = JSON.parse([...f.stored.values()][0].body) as DocumentCommand;
    f.transport.commit.mockRejectedValueOnce(new Error('response lost after commit'));
    expect(await original.refresh()).toBe('retry');
    original.dispose();

    f.transport.changes.mockResolvedValueOnce(page([remoteChange(1, 'Other'), change(command, 2, 'Canonical local')], 2));
    const reopened = f.session('client-2');
    expect(await reopened.refresh()).toBe('idle');
    expect(f.transport.commit).toHaveBeenCalledTimes(1);
    expect(f.document()?.name).toBe('Canonical local');
    expect(f.stored.size).toBe(0);
  });

  it('catches up through an ack gap and retains a command when the feed does not match', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    await board.enqueue([{ kind: 'rename', value: 'Local', expected: { name: 'Board' } }]);
    const command = JSON.parse([...f.stored.values()][0].body) as DocumentCommand;
    f.transport.commit.mockResolvedValue(ack(command, 2));
    f.transport.changes.mockResolvedValueOnce(page([], 0)).mockResolvedValueOnce(page([
      remoteChange(1, 'First'), { ...change(command, 2, 'Second'), actorId: 'user-2' },
    ], 2));

    expect(await board.refresh()).toBe('retry');
    expect(f.queue.remove).not.toHaveBeenCalled();
    expect(f.stored.size).toBe(1);
    expect(await board.refresh()).toBe('retry');
    expect(f.stored.size).toBe(1);
  });

  it('keeps consecutive optimistic edits when remote catch-up overlaps an IndexedDB write', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    const feed = deferred<DocumentChangePage>();
    const requested = deferred<void>();
    f.transport.changes.mockImplementationOnce(() => {
      requested.resolve();
      return feed.promise;
    });
    const refresh = board.refresh();
    await requested.promise;
    const localWrite = deferred<void>();
    const append = f.queue.append.getMockImplementation()!;
    f.queue.append.mockImplementationOnce(async (...args) => {
      await localWrite.promise;
      return append(...args);
    });
    const first = board.enqueue([{ kind: 'patch', collection: 'pages', id: 'page-1', fields: { name: 'Local one' } }]);
    const second = board.enqueue([{ kind: 'patch', collection: 'pages', id: 'page-2', fields: { name: 'Local two' } }]);
    expect(f.state()).toMatchObject({ status: 'saving-local', pendingCount: 2 });
    feed.resolve(page([remoteChange(1, 'Remote')], 1));
    try {
      await refresh;
      expect(f.document()).toMatchObject({ name: 'Remote', pages: [
        { id: 'page-1', name: 'Local one' }, { id: 'page-2', name: 'Local two' },
      ] });
      expect(f.stored.size).toBe(0);
    } finally {
      localWrite.resolve();
    }
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(f.stored.size).toBe(2);
  });

  it('keeps failed local writes visibly unsaved until the matching draft is explicitly discarded', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    f.queue.append.mockRejectedValueOnce(new Error('Device quota exceeded'));
    const first = board.enqueue([{ kind: 'rename', value: 'Unsaved first', expected: { name: 'Board' } }]);
    const second = board.enqueue([{ kind: 'rename', value: 'Unsaved second', expected: { name: 'Unsaved first' } }]);
    expect(await Promise.all([first, second])).toEqual([false, false]);
    const firstId = f.state()?.conflict?.commandId;
    expect(f.state()).toMatchObject({ status: 'error', hasDraft: true, pendingCount: 0, conflict: { code: 'LOCAL_WRITE_REJECTED' } });
    expect(board.draft()).toContain('Unsaved first');
    expect(board.draft()).toContain('Unsaved second');
    expect(f.stored.size).toBe(0);

    await board.retry();
    expect(f.state()?.status).toBe('error');
    await board.discardConflict(firstId);
    const secondId = f.state()?.conflict?.commandId;
    expect(secondId).not.toBe(firstId);
    await board.discardConflict(firstId);
    expect(f.state()?.conflict?.commandId).toBe(secondId);
    await board.discardConflict(secondId);
    expect(f.state()).toMatchObject({ status: 'synced', hasDraft: false });
  });

  it('resnapshots a noncontiguous feed before publishing any of its changes', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    f.transport.changes.mockResolvedValueOnce(page([remoteChange(1, 'Partial'), remoteChange(3, 'Gap')], 2));
    expect(await board.refresh()).toBe('more');
    expect(f.document()?.name).toBe('Board');
    const snapshot = await f.transport.snapshot();
    f.transport.snapshot.mockResolvedValueOnce({ ...snapshot, seq: 3, document: { ...snapshot.document, name: 'Resynced' } });
    expect(await board.refresh()).toBe('idle');
    expect(f.document()?.name).toBe('Resynced');
  });

  it('preserves drafts across epoch changes and discards only the blocked command', async () => {
    const f = fixture();
    const original = f.session();
    await original.refresh();
    await original.enqueue([{ kind: 'rename', value: 'Draft one', expected: { name: 'Board' } }]);
    await original.enqueue([{ kind: 'rename', value: 'Draft two', expected: { name: 'Draft one' } }]);
    const snapshot = await f.transport.snapshot() as BoardSnapshot;
    f.transport.snapshot.mockResolvedValue({ ...snapshot, epoch: 2, seq: 3, document: { ...snapshot.document, name: 'Restored' } });
    original.dispose();

    const reopened = f.session('client-2');
    await reopened.refresh();
    expect(f.state()).toMatchObject({ status: 'conflict', pendingCount: 2, conflict: { code: 'STALE_EPOCH' } });
    expect(reopened.draft()).toContain('Draft one');
    expect(f.document()?.name).toBe('Restored');
    expect(f.transport.commit).not.toHaveBeenCalled();
    await reopened.discardConflict();
    await reopened.refresh();
    expect(f.state()).toMatchObject({ status: 'conflict', pendingCount: 1 });
    expect(reopened.draft()).toContain('Draft two');
    expect(f.stored.size).toBe(1);
  });

  it('retains unacknowledged edits on an expired session and clears them after explicit revocation', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    await board.enqueue([{ kind: 'rename', value: 'Draft', expected: { name: 'Board' } }]);
    f.transport.changes.mockRejectedValueOnce(new ApiError('Session expired', 401));
    expect(await board.refresh()).toBe('stop');
    expect(f.document()?.pages).toEqual([]);
    expect(board.draft()).toBeUndefined();
    expect(f.stored.size).toBe(1);
    expect(f.queue.clear).not.toHaveBeenCalled();

    f.transport.snapshot.mockRejectedValueOnce(new ApiError('Access removed', 403, 'ACCESS_DENIED'));
    expect(await board.retry()).toBe('stop');
    expect(f.state()).toMatchObject({ status: 'revoked', canEdit: false });
    expect(f.stored.size).toBe(0);
  });

  it('expires offline authorization after seven days and preserves the old command for review', async () => {
    let now = 100;
    const f = fixture(() => now);
    const board = f.session();
    await board.refresh();
    await board.enqueue([{ kind: 'rename', value: 'Old draft', expected: { name: 'Board' } }]);
    now += COMMAND_MAX_AGE_MS;
    f.transport.changes.mockRejectedValueOnce(new Error('offline'));
    expect(await board.refresh()).toBe('retry');
    expect(f.state()).toMatchObject({ status: 'offline', canEdit: false, hasDraft: false });
    expect(f.document()?.pages).toEqual([]);
    expect(await board.enqueue([{ kind: 'rename', value: 'Too late', expected: { name: 'Board' } }])).toBe(false);
    expect(f.stored.size).toBe(1);

    await board.refresh();
    expect(f.state()).toMatchObject({ status: 'conflict', hasDraft: true, conflict: { code: 'EXPIRED' } });
    expect(f.document()).toEqual(initialDocument);
    expect(board.draft()).toContain('Old draft');
    expect(f.transport.commit).not.toHaveBeenCalled();
  });

  it('shows current and local values for a guarded edit and preserves the exact rejected envelope', async () => {
    const f = fixture();
    const board = f.session();
    await board.refresh();
    await board.enqueue([{ kind: 'patch', collection: 'pages', id: 'page-1', fields: { name: 'Local' }, expected: { name: 'One' } }]);
    f.transport.commit.mockRejectedValueOnce(new ApiError('Page name changed', 409, 'CONFLICT', {
      collection: 'pages', id: 'page-1', field: 'name', current: 'Current',
    }));
    await board.refresh();
    expect(f.state()).toMatchObject({ status: 'conflict', hasDraft: true, conflict: { local: 'Local', details: { current: 'Current' } } });
    expect(f.stored.size).toBe(1);
  });
});
