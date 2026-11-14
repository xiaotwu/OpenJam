import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { readBoardAsset } from './boardFiles';
import { BoardImages } from './boardImages';

vi.mock('./boardFiles', () => ({ readBoardAsset: vi.fn() }));
const download = vi.mocked(readBoardAsset);
const image = new Blob(['fixture image'], { type: 'image/png' });

describe('private board images', () => {
  let images: BoardImages;

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => 'board-session' });
    download.mockReset();
    images = new BoardImages('board-a');
  });

  afterEach(() => {
    images.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shares a download and an object URL across duplicate instances and remounts', async () => {
    download.mockResolvedValue(image);
    const first = images.subscribe('asset-a', vi.fn());
    const second = images.subscribe('asset-a', vi.fn());
    expect(download).toHaveBeenCalledTimes(1);
    await Promise.resolve();

    const loaded = images.snapshot('asset-a');
    expect(loaded.status).toBe('ready');
    first();
    second();
    images.subscribe('asset-a', vi.fn());
    expect(images.snapshot('asset-a')).toBe(loaded);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('reserves request slots for collaboration and drops unmounted images still waiting in the queue', async () => {
    const finish: Array<(blob: Blob) => void> = [];
    download.mockImplementation(() => new Promise(resolve => finish.push(resolve)));

    for (const id of ['a', 'b', 'c', 'd']) images.subscribe(id, vi.fn());
    const offscreen = images.subscribe('e', vi.fn());
    images.subscribe('f', vi.fn());
    offscreen();
    expect(download.mock.calls.map(call => call[1])).toEqual(['a', 'b', 'c', 'd']);

    finish[0](image);
    await Promise.resolve();
    expect(download.mock.calls.map(call => call[1])).toEqual(['a', 'b', 'c', 'd', 'f']);
    expect(images.snapshot('a').status).toBe('ready');
  });

  it('honors Retry-After without issuing one retry per visible instance', async () => {
    vi.useFakeTimers();
    download.mockRejectedValueOnce(new ApiError('Slow down', 429, 'RATE_LIMITED', undefined, '2')).mockResolvedValue(image);
    images.subscribe('asset-a', vi.fn());
    images.subscribe('asset-a', vi.fn());
    await vi.advanceTimersByTimeAsync(1_999);
    expect(download).toHaveBeenCalledTimes(1);
    expect(images.snapshot('asset-a').status).toBe('loading');

    await vi.advanceTimersByTimeAsync(1);
    expect(download).toHaveBeenCalledTimes(2);
    expect(images.snapshot('asset-a').status).toBe('ready');
  });

  it('drops cached URLs and aborts other requests after access is denied', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    download.mockResolvedValueOnce(image);
    const listener = vi.fn();
    images.subscribe('cached', listener);
    await Promise.resolve();
    const loaded = images.snapshot('cached');
    if (loaded.status !== 'ready') throw new Error('Expected the first image to load');

    let pendingSignal: AbortSignal | undefined;
    let resolveLate: ((blob: Blob) => void) | undefined;
    download.mockImplementationOnce((_board, _id, signal) => {
      pendingSignal = signal;
      return new Promise(resolve => { resolveLate = resolve; });
    }).mockRejectedValueOnce(new ApiError('Access revoked', 403, 'ACCESS_DENIED'));
    images.subscribe('pending', vi.fn());
    images.subscribe('denied', vi.fn());
    await Promise.resolve();

    expect(pendingSignal?.aborted).toBe(true);
    expect(revoke).toHaveBeenCalledWith(loaded.url);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(images.snapshot('cached').status).toBe('unavailable');
    resolveLate?.(image);
    await Promise.resolve();
    expect(images.snapshot('pending').status).toBe('unavailable');
  });
});
