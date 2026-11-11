const DATABASE = 'openjam-board-sync';
const COMMANDS = 'commands';
const USAGE = 'usage';
const ORIGIN_SCOPE = ['origin'];

export const MAX_BOARD_BYTES = 32 * 1024 * 1024;
export const MAX_BOARD_COMMANDS = 5000;
export const MAX_USER_BYTES = 128 * 1024 * 1024;
export const MAX_ORIGIN_BYTES = 256 * 1024 * 1024;
export const COMMAND_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface QueuedCommand {
  order: number;
  userId: string;
  boardId: string;
  body: string;
  bytes: number;
  createdAt: number;
}

export interface BoardQueue {
  list(): Promise<QueuedCommand[]>;
  append(body: string, bytes: number, createdAt: number): Promise<QueuedCommand>;
  remove(orders: number[]): Promise<void>;
  clear(): Promise<void>;
}

interface Usage {
  scope: string[];
  bytes: number;
  count: number;
}

export class BoardQueueCapacityError extends Error {
  constructor() {
    super('The offline edit queue is full. Sync or export your pending edits before adding more.');
    this.name = 'BoardQueueCapacityError';
  }
}

let opening: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      const queue = db.createObjectStore(COMMANDS, { keyPath: 'order', autoIncrement: true });
      queue.createIndex('board', ['userId', 'boardId']);
      queue.createIndex('account', 'userId');
      db.createObjectStore(USAGE, { keyPath: 'scope' });
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error('The offline edit database is blocked by another tab.'));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      db.onclose = () => { opening = undefined; };
      resolve(db);
    };
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  mode: 'readonly' | 'readwrite',
  action: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await database();
  const tx = db.transaction([COMMANDS, USAGE], mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
  const finished = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Offline edit transaction aborted.'));
  });
  try {
    const [result] = await Promise.all([action(tx), finished]);
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // IndexedDB may already have aborted the transaction.
    }
    await finished.catch(() => undefined);
    throw error;
  }
}

async function readUsage(store: IDBObjectStore, scope: string[]): Promise<Usage> {
  return await read(store.get(scope)) ?? { scope, bytes: 0, count: 0 };
}

function updateUsage(store: IDBObjectStore, usage: Usage, bytes: number, count: number): void {
  if (count === 0) {
    store.delete(usage.scope);
  } else {
    store.put({ scope: usage.scope, bytes, count });
  }
}

export function countAccountPending(userId: string): Promise<number> {
  return transaction('readonly', (tx) => read(tx.objectStore(COMMANDS).index('account').count(userId)));
}

export function discardAccountPending(userId: string): Promise<void> {
  return transaction('readwrite', async (tx) => {
    const queue = tx.objectStore(COMMANDS);
    const stats = tx.objectStore(USAGE);
    const boardRange = IDBKeyRange.bound(['board', userId], ['board', userId, []]);
    const [orders, boardKeys, account, origin] = await Promise.all([
      read(queue.index('account').getAllKeys(userId)),
      read(stats.getAllKeys(boardRange)),
      readUsage(stats, ['user', userId]),
      readUsage(stats, ORIGIN_SCOPE),
    ]);
    for (const order of orders) queue.delete(order);
    for (const boardKey of boardKeys) stats.delete(boardKey);
    stats.delete(account.scope);
    updateUsage(stats, origin, origin.bytes - account.bytes, origin.count - account.count);
  });
}

export function createBoardQueue(userId: string, boardId: string): BoardQueue {
  const boardKey = [userId, boardId];
  const boardScope = ['board', userId, boardId];
  const userScope = ['user', userId];

  async function removeRecords(tx: IDBTransaction, rows: QueuedCommand[]) {
    const owned = rows.filter((row) => row.userId === userId && row.boardId === boardId);
    if (!owned.length) return;
    const stats = tx.objectStore(USAGE);
    const queue = tx.objectStore(COMMANDS);
    const [board, user, origin] = await Promise.all([
      readUsage(stats, boardScope), readUsage(stats, userScope), readUsage(stats, ORIGIN_SCOPE),
    ]);
    const bytes = owned.reduce((total, row) => total + row.bytes, 0);
    for (const row of owned) queue.delete(row.order);
    updateUsage(stats, board, board.bytes - bytes, board.count - owned.length);
    updateUsage(stats, user, user.bytes - bytes, user.count - owned.length);
    updateUsage(stats, origin, origin.bytes - bytes, origin.count - owned.length);
  }

  return {
    list: () => transaction('readonly', async (tx) => read<QueuedCommand[]>(tx.objectStore(COMMANDS).index('board').getAll(boardKey))),

    append: (body, bytes, createdAt) => transaction('readwrite', async (tx) => {
      const stats = tx.objectStore(USAGE);
      const [board, user, origin] = await Promise.all([
        readUsage(stats, boardScope), readUsage(stats, userScope), readUsage(stats, ORIGIN_SCOPE),
      ]);
      if (board.bytes + bytes > MAX_BOARD_BYTES || board.count >= MAX_BOARD_COMMANDS
        || user.bytes + bytes > MAX_USER_BYTES || origin.bytes + bytes > MAX_ORIGIN_BYTES) {
        throw new BoardQueueCapacityError();
      }
      const row = { userId, boardId, body, bytes, createdAt };
      const order = await read(tx.objectStore(COMMANDS).add(row)) as number;
      updateUsage(stats, board, board.bytes + bytes, board.count + 1);
      updateUsage(stats, user, user.bytes + bytes, user.count + 1);
      updateUsage(stats, origin, origin.bytes + bytes, origin.count + 1);
      return { ...row, order };
    }),

    remove: (orders) => transaction('readwrite', async (tx) => {
      const queue = tx.objectStore(COMMANDS);
      const rows: (QueuedCommand | undefined)[] = await Promise.all([...new Set(orders)].map((order) => read(queue.get(order))));
      await removeRecords(tx, rows.filter((row): row is QueuedCommand => row !== undefined));
    }),

    clear: () => transaction('readwrite', async (tx) => {
      await removeRecords(tx, await read(tx.objectStore(COMMANDS).index('board').getAll(boardKey)));
    }),
  };
}
