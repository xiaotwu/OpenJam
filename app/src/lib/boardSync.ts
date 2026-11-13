import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getToken, request } from './api';
import { PRESENTATION_TTL_MS, readBoardViewport, type PresentationMessage, type PresenterViewport } from './boardPresentation';
import {
  validSequence,
  type BoardDocument, type BoardSnapshot, type BoardTransport, type DocumentAck,
  type DocumentChangePage, type DocumentMutation,
} from './boardSyncProtocol';
import { createBoardQueue } from './boardSyncQueue';
import { BoardSyncSession, initialBoardSyncState, newCommandId } from './boardSyncSession';
import type { RemoteCursor } from './useCollaboration';
import type { UserPresence } from './websocket';

export type { BoardDocument, BoardElement, BoardStamp, DocumentMutation, DocumentPermission } from './boardSyncProtocol';
export { MAX_COMMAND_OPERATIONS } from './boardSyncProtocol';
export type { BoardSyncConflict, BoardSyncMode, BoardSyncState, BoardSyncStatus } from './boardSyncSession';

const POLL_MS = 2000;
const CONNECTED_POLL_MS = 4000;
const BACKGROUND_POLL_MS = 10000;
const REQUEST_TIMEOUT_MS = 12000;
const SOCKET_TIMEOUT_MS = 8000;
const CURSOR_INTERVAL_MS = 50;
const CURSOR_TTL_MS = 5000;
const EMPTY_PRESENTERS = new Map<string, PresenterViewport>();

function boardTransport(boardId: string, lifecycle: AbortSignal, isCurrentAccount: () => boolean): BoardTransport {
  const path = `/api/v2/boards/${encodeURIComponent(boardId)}`;
  const send = async <T>(endpoint: string, options: RequestInit = {}): Promise<T> => {
    lifecycle.throwIfAborted();
    if (!isCurrentAccount()) throw new ApiError('The signed-in account changed.', 401);
    const controller = new AbortController();
    const abort = () => controller.abort(lifecycle.reason);
    lifecycle.addEventListener('abort', abort, { once: true });
    const timeout = window.setTimeout(() => controller.abort(new Error('The board server did not respond in time.')), REQUEST_TIMEOUT_MS);
    try {
      const response = await request<T>(`${path}/${endpoint}`, { cache: 'no-store', ...options, signal: controller.signal });
      if (!isCurrentAccount()) throw new ApiError('The signed-in account changed.', 401);
      return response;
    } finally {
      lifecycle.removeEventListener('abort', abort);
      window.clearTimeout(timeout);
    }
  };
  return {
    snapshot: () => send<BoardSnapshot>('snapshot'),
    changes: (epoch, afterSeq) => send<DocumentChangePage>(`changes?epoch=${epoch}&afterSeq=${afterSeq}&limit=50`),
    commit: (body) => send<DocumentAck>('commands', { method: 'POST', body }),
  };
}

function documentSocketUrl(): string | undefined {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    const url = new URL(import.meta.env.SHIORI_WS_URL || `${protocol}//${window.location.host}/ws`);
    if (url.protocol !== protocol || url.host !== window.location.host || url.username || url.password) return;
    url.pathname = url.pathname.replace(/\/$/, '');
    if (!url.pathname.endsWith('/ws/v2')) url.pathname = `${url.pathname}/v2`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return;
  }
}

function isUserPresence(value: unknown): value is UserPresence {
  const user = value as Partial<UserPresence> | null;
  return user != null && typeof user.id === 'string' && typeof user.displayName === 'string' && typeof user.avatarColor === 'string';
}

interface BoardSyncOptions {
  boardId: string;
  userId: string;
  onDocument: (document: BoardDocument, epoch?: number) => void;
}

interface SessionControls {
  key: string;
  session: BoardSyncSession;
  retry: () => Promise<void>;
  sendCursor: (x: number, y: number) => void;
  sendViewport: (message: PresentationMessage) => void;
}

function sameIds(first: string[] | undefined, second: string[] | undefined): boolean {
  return first === second || Boolean(first && second && first.length === second.length
    && first.every((id, index) => id === second[index]));
}

export function useBoardSync({ boardId, userId, onDocument }: BoardSyncOptions) {
  const key = JSON.stringify([userId, boardId]);
  const [clientId] = useState(newCommandId);
  const [view, setView] = useState({ key, state: initialBoardSyncState });
  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<UserPresence[]>([]);
  const [cursors, setCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const [presenters, setPresenters] = useState<Map<string, PresenterViewport>>(EMPTY_PRESENTERS);
  const controls = useRef<SessionControls | undefined>(undefined);
  const onDocumentRef = useRef(onDocument);

  useEffect(() => { onDocumentRef.current = onDocument; }, [onDocument]);

  useEffect(() => {
    if (!userId || !boardId) return;
    const lifecycle = new AbortController();
    const socketUrl = documentSocketUrl();
    const token = getToken();
    const isCurrentAccount = () => !!token && getToken() === token;
    let disposed = false;
    let timer: number | undefined;
    let refreshing: Promise<void> | undefined;
    let wakeAfter = false;
    let failures = 0;
    let socket: WebSocket | undefined;
    let socketEpoch: number | undefined;
    let socketConnected = false;
    let socketOpenedAt = 0;
    let nextSocketAt = 0;
    let socketFailures = 0;
    let cursorSentAt = 0;
    let viewportSentAt = 0;

    const session = new BoardSyncSession({
      boardId,
      userId,
      clientId,
      queue: createBoardQueue(userId, boardId),
      transport: boardTransport(boardId, lifecycle.signal, isCurrentAccount),
      onState: (state) => setView((previous) => {
        const before = previous.state;
        if (previous.key === key && before.mode === state.mode && before.status === state.status
          && before.canEdit === state.canEdit && before.permission === state.permission
          && before.resourceKind === state.resourceKind
          && before.canUndo === state.canUndo && before.canRedo === state.canRedo
          && before.historyNotice === state.historyNotice && before.epoch === state.epoch && before.seq === state.seq
          && sameIds(before.pendingVoteIds, state.pendingVoteIds)
          && before.pendingCount === state.pendingCount && before.hasDraft === state.hasDraft
          && before.error === state.error && before.conflict === state.conflict) return previous;
        return { key, state };
      }),
      onDocument: (document, epoch) => onDocumentRef.current(document, epoch),
      wake: () => schedule(0),
    });

    function resetPresence() {
      socketConnected = false;
      setIsConnected(false);
      setCollaborators((users) => users.length ? [] : users);
      setCursors((previous) => previous.size ? new Map() : previous);
      setPresenters(EMPTY_PRESENTERS);
    }

    function disconnect() {
      const current = socket;
      socket = undefined;
      if (current && current.readyState < WebSocket.CLOSING) current.close();
      if (!disposed) resetPresence();
    }

    function deferSocket() {
      socketFailures++;
      nextSocketAt = Date.now() + Math.min(15000, 1000 * 2 ** Math.min(socketFailures, 4));
    }

    function applyPresence(values: unknown[]) {
      const users = new Map<string, UserPresence>();
      for (const user of values) if (isUserPresence(user) && user.id !== userId) users.set(user.id, user);
      setCollaborators([...users.values()]);
      setCursors((previous) => {
        const remaining = [...previous].filter(([id]) => users.has(id));
        return remaining.length === previous.size ? previous : new Map(remaining);
      });
    }

    function syncSocket() {
      const subscription = session.subscription();
      if (!subscription || !socketUrl || !isCurrentAccount()) {
        if (socket) disconnect();
        return;
      }
      if (socket && socketEpoch !== subscription.epoch) {
        disconnect();
        nextSocketAt = 0;
      }
      if (socket && !socketConnected && Date.now() - socketOpenedAt > SOCKET_TIMEOUT_MS) {
        disconnect();
        deferSocket();
      }
      if (socket || navigator.onLine === false || Date.now() < nextSocketAt) return;

      let current: WebSocket;
      try {
        current = new WebSocket(socketUrl);
      } catch {
        deferSocket();
        return;
      }
      socket = current;
      socketEpoch = subscription.epoch;
      socketOpenedAt = Date.now();
      current.onopen = () => {
        const cursor = session.subscription();
        if (socket === current && cursor && isCurrentAccount()) current.send(JSON.stringify({ type: 'subscribe', payload: cursor }));
      };
      current.onclose = () => {
        if (socket !== current || disposed) return;
        socket = undefined;
        resetPresence();
        deferSocket();
        schedule(0);
      };
      current.onmessage = (event) => {
        if (socket !== current || disposed || !isCurrentAccount() || typeof event.data !== 'string') return;
        let message: { type?: string; payload?: Record<string, unknown> };
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        const payload = message?.payload;
        if (!payload || typeof payload !== 'object') return;
        if (message.type === 'subscribed') {
          if (payload.boardId !== boardId || payload.epoch !== socketEpoch || typeof payload.headSeq !== 'number'
            || !validSequence(payload.headSeq) || !Array.isArray(payload.users)) return;
          socketConnected = true;
          socketFailures = 0;
          setIsConnected(true);
          applyPresence(payload.users);
          schedule(0);
          return;
        }
        if (message.type === 'error') {
          // HTTP rechecks authorization and the epoch before updating the document.
          disconnect();
          deferSocket();
          schedule(0);
          return;
        }
        if (!socketConnected) return;
        if (message.type === 'presence_state' && Array.isArray(payload.users)) {
          applyPresence(payload.users);
          return;
        }
        if (message.type === 'document_changed') {
          const cursor = session.subscription();
          if (payload.boardId === boardId && cursor && typeof payload.epoch === 'number' && validSequence(payload.epoch, 1)
            && typeof payload.seq === 'number' && validSequence(payload.seq, 1)
            && (payload.epoch !== cursor.epoch || payload.seq > cursor.afterSeq)) schedule(0);
          return;
        }
        const id = payload.userId;
        if (typeof id !== 'string' || id === userId) return;
        if (message.type === 'present_view' && payload.epoch === socketEpoch) {
          if (payload.active === false) {
            setPresenters((previous) => {
              if (!previous.has(id)) return previous;
              const next = new Map(previous);
              next.delete(id);
              return next;
            });
          } else if (payload.active === true) {
            const view = readBoardViewport(payload);
            if (view) setPresenters((previous) => new Map(previous).set(id, { ...view, userId: id, lastUpdate: Date.now() }));
          }
        } else if (message.type === 'presence' && payload.action === 'join' && isUserPresence(payload.user) && payload.user.id === id) {
          const user = payload.user;
          setCollaborators((users) => [...users.filter((existing) => existing.id !== id), user]);
        } else if (message.type === 'presence' && payload.action === 'leave') {
          setCollaborators((users) => users.filter((user) => user.id !== id));
          setCursors((previous) => {
            if (!previous.has(id)) return previous;
            const remaining = new Map(previous);
            remaining.delete(id);
            return remaining;
          });
        } else if (message.type === 'cursor') {
          const { x, y, color, name } = payload;
          if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
            || typeof color !== 'string' || typeof name !== 'string') return;
          const cursor = { userId: id, x, y, color, name, lastUpdate: Date.now() };
          setCursors((previous) => new Map(previous).set(id, cursor));
        }
      };
    }

    function schedule(delay: number) {
      if (disposed) return;
      if (refreshing) {
        wakeAfter = true;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void cycle(); }, delay);
    }

    function cycle(retry = false): Promise<void> {
      if (disposed) return Promise.resolve();
      if (refreshing) {
        if (retry) return refreshing.then(() => cycle(true));
        wakeAfter = true;
        return refreshing;
      }
      window.clearTimeout(timer);
      refreshing = (retry ? session.retry() : session.refresh()).then((result) => {
        refreshing = undefined;
        if (disposed) return;
        syncSocket();
        const eager = wakeAfter;
        wakeAfter = false;
        if (result === 'stop') return;
        failures = result === 'retry' ? failures + 1 : 0;
        const hidden = document.visibilityState === 'hidden';
        const pollInterval = hidden ? BACKGROUND_POLL_MS : socketConnected ? CONNECTED_POLL_MS : POLL_MS;
        const delay = result === 'retry'
          ? Math.max(hidden ? BACKGROUND_POLL_MS : POLL_MS, Math.min(15000, POLL_MS * 2 ** Math.min(failures - 1, 4)))
          : result === 'more' ? 25 : eager ? 0 : pollInterval;
        schedule(delay >= POLL_MS ? delay * (0.9 + Math.random() * 0.2) : delay);
      });
      return refreshing;
    }

    const online = () => { nextSocketAt = 0; schedule(0); };
    const offline = () => { disconnect(); schedule(0); };
    const visible = () => { if (document.visibilityState === 'visible') schedule(0); };
    const cursorSweep = window.setInterval(() => setCursors((previous) => {
      const now = Date.now();
      const live = [...previous].filter(([, cursor]) => now - cursor.lastUpdate < CURSOR_TTL_MS);
      return live.length === previous.size ? previous : new Map(live);
    }), CURSOR_TTL_MS);
    const presentationSweep = window.setInterval(() => setPresenters((previous) => {
      const now = Date.now();
      const live = [...previous].filter(([, presenter]) => now - presenter.lastUpdate < PRESENTATION_TTL_MS);
      return live.length === previous.size ? previous : new Map(live);
    }), 1500);
    controls.current = {
      key,
      session,
      retry: () => cycle(true),
      sendCursor: (x, y) => {
        const now = Date.now();
        if (!socketConnected || !isCurrentAccount() || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 16384
          || now - cursorSentAt < CURSOR_INTERVAL_MS || !Number.isFinite(x) || !Number.isFinite(y)) return;
        cursorSentAt = now;
        socket.send(JSON.stringify({ type: 'cursor', payload: { x, y } }));
      },
      sendViewport: (message) => {
        const now = Date.now();
        if (!socketConnected || !isCurrentAccount() || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 16384
          || (message.active && now - viewportSentAt < 100)) return;
        viewportSentAt = now;
        socket.send(JSON.stringify({ type: 'present_view', payload: message }));
      },
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    resetPresence();
    schedule(0);

    return () => {
      disposed = true;
      controls.current = undefined;
      session.dispose();
      lifecycle.abort();
      window.clearTimeout(timer);
      window.clearInterval(cursorSweep);
      window.clearInterval(presentationSweep);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
      disconnect();
    };
  }, [boardId, clientId, key, userId]);

  const enqueue = useCallback((operations: DocumentMutation[]) => (
    controls.current?.key === key ? controls.current.session.enqueue(operations) : Promise.resolve(false)
  ), [key]);
  const undo = useCallback((commandId?: string) => (
    controls.current?.key === key ? controls.current.session.undo(commandId) : Promise.resolve(false)
  ), [key]);
  const redo = useCallback(() => (
    controls.current?.key === key ? controls.current.session.redo() : Promise.resolve(false)
  ), [key]);
  const adoptAdditions = useCallback((ack: DocumentAck) => (
    controls.current?.key === key ? controls.current.session.adoptAdditions(ack) : Promise.resolve(false)
  ), [key]);
  const retry = useCallback(async () => {
    if (controls.current?.key === key) await controls.current.retry();
  }, [key]);
  const discardConflict = useCallback(async (commandId?: string) => {
    if (controls.current?.key === key) await controls.current.session.discardConflict(commandId);
  }, [key]);
  const exportDraft = useCallback(() => {
    const draft = controls.current?.key === key ? controls.current.session.draft() : undefined;
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([draft], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'shiori-board-draft.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [key]);
  const sendCursor = useCallback((x: number, y: number) => {
    if (controls.current?.key === key) controls.current.sendCursor(x, y);
  }, [key]);
  const sendViewport = useCallback((message: PresentationMessage) => {
    if (controls.current?.key === key) controls.current.sendViewport(message);
  }, [key]);

  const sameBoard = view.key === key;
  return {
    ...(sameBoard ? view.state : initialBoardSyncState),
    isConnected: sameBoard && isConnected,
    collaborators: sameBoard ? collaborators : [],
    cursors: sameBoard ? cursors : new Map<string, RemoteCursor>(),
    presenters: sameBoard ? presenters : EMPTY_PRESENTERS,
    clientId, enqueue, undo, redo, adoptAdditions, retry, discardConflict, exportDraft, sendCursor, sendViewport,
  };
}
