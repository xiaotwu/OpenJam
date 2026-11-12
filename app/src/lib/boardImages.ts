import { ApiError, getToken } from './api';
import { readBoardAsset } from './boardFiles';

const concurrentDownloads = 4;
const maxIdleImages = 64;
const maxIdleBytes = 32 * 1024 * 1024;
const maxAttempts = 3;

const loading = { status: 'loading' } as const;
const unavailable = { status: 'unavailable' } as const;
type ImageState = typeof loading | typeof unavailable | { status: 'ready'; url: string; bytes: number };

interface ImageEntry {
  id: string;
  listeners: Set<() => void>;
  state: ImageState;
  attempts: number;
}

function retryAt(header?: string): number {
  const now = Date.now();
  const deadline = header && /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header ?? '');
  return Number.isFinite(deadline) ? Math.max(now + 1000, deadline) : now + 1000;
}

// Owned by one open board and authenticated session. Idle object URLs stay
// in memory across viewport changes. Visible images remain pinned until unmounted.
export class BoardImages {
  private readonly boardId: string;
  private readonly token = getToken();
  private readonly controller = new AbortController();
  private readonly entries = new Map<string, ImageEntry>();
  private readonly queued = new Set<ImageEntry>();
  private readonly idle = new Set<ImageEntry>();
  private idleBytes = 0;
  private active = 0;
  private pausedUntil = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(boardId: string) {
    this.boardId = boardId;
  }

  snapshot(id: string): ImageState {
    if (this.controller.signal.aborted) return unavailable;
    return this.entries.get(id)?.state ?? loading;
  }

  subscribe(id: string, listener: () => void): () => void {
    if (this.controller.signal.aborted) return () => {};
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { id, listeners: new Set(), state: loading, attempts: 0 };
      this.entries.set(id, entry);
      this.queued.add(entry);
    }
    if (this.idle.delete(entry) && entry.state.status === 'ready') {
      this.idleBytes -= entry.state.bytes;
    }
    const subscribed = entry;
    subscribed.listeners.add(listener);
    this.pump();
    return () => {
      subscribed.listeners.delete(listener);
      if (subscribed.listeners.size || this.controller.signal.aborted) return;
      if (subscribed.state.status === 'ready') {
        this.keepIdle(subscribed);
      } else if (this.queued.delete(subscribed) || subscribed.state.status === 'unavailable') {
        this.entries.delete(id);
      }
    };
  }

  retry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || !entry.listeners.size || entry.state.status === 'loading' || this.controller.signal.aborted) return;
    if (entry.state.status === 'ready') URL.revokeObjectURL(entry.state.url);
    entry.attempts = 0;
    this.publish(entry, loading);
    this.queued.add(entry);
    this.pump();
  }

  dispose(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    clearTimeout(this.timer);
    for (const entry of this.entries.values()) {
      if (entry.state.status === 'ready') URL.revokeObjectURL(entry.state.url);
      this.publish(entry, unavailable);
    }
    this.entries.clear();
    this.queued.clear();
    this.idle.clear();
    this.idleBytes = 0;
  }

  private publish(entry: ImageEntry, state: ImageState): void {
    entry.state = state;
    entry.listeners.forEach(listener => listener());
  }

  private keepIdle(entry: ImageEntry): void {
    if (entry.state.status !== 'ready') return;
    this.idle.add(entry);
    this.idleBytes += entry.state.bytes;
    for (const oldest of this.idle) {
      if (this.idle.size <= maxIdleImages && this.idleBytes <= maxIdleBytes) break;
      if (oldest.state.status === 'ready') {
        URL.revokeObjectURL(oldest.state.url);
        this.idleBytes -= oldest.state.bytes;
      }
      this.idle.delete(oldest);
      this.entries.delete(oldest.id);
    }
  }

  private pump(): void {
    if (this.controller.signal.aborted || this.active >= concurrentDownloads || !this.queued.size) return;
    clearTimeout(this.timer);
    const wait = this.pausedUntil - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => this.pump(), Math.min(wait, 2_147_483_647));
      return;
    }

    for (const entry of this.queued) {
      if (this.active >= concurrentDownloads || this.controller.signal.aborted) break;
      this.queued.delete(entry);
      void this.download(entry);
    }
  }

  private async download(entry: ImageEntry): Promise<void> {
    const session = this.controller.signal;
    if (getToken() !== this.token) {
      this.dispose();
      return;
    }
    this.active++;
    entry.attempts++;
    try {
      const signal = AbortSignal.any([session, AbortSignal.timeout(35_000)]);
      const blob = await readBoardAsset(this.boardId, entry.id, signal);
      if (session.aborted) return;
      if (getToken() !== this.token) {
        this.dispose();
        return;
      }
      this.publish(entry, { status: 'ready', url: URL.createObjectURL(blob), bytes: blob.size });
      if (!entry.listeners.size) this.keepIdle(entry);
    } catch (error) {
      if (!session.aborted) this.downloadFailed(entry, error);
    } finally {
      this.active--;
      this.pump();
    }
  }

  private downloadFailed(entry: ImageEntry, error: unknown): void {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        this.dispose();
        return;
      }
      if (error.status === 429) {
        this.pausedUntil = Math.max(this.pausedUntil, retryAt(error.retryAfter));
        if (entry.listeners.size && entry.attempts < maxAttempts) {
          this.queued.add(entry);
          return;
        }
      }
    }
    if (entry.listeners.size) this.publish(entry, unavailable);
    else this.entries.delete(entry.id);
  }
}
