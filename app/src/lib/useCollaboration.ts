import { useEffect, useRef, useCallback, useState } from 'react';
import { wsClient, type WebSocketMessage, type CursorPayload, type UserPresence } from './websocket';
import { ElementStore, type ElementOperation } from './elementStore';

export interface RemoteCursor {
  userId: string;
  x: number;
  y: number;
  color: string;
  name: string;
  lastUpdate: number;
}

export interface CollaborationState {
  isConnected: boolean;
  collaborators: UserPresence[];
  cursors: Map<string, RemoteCursor>;
}

interface UseCollaborationOptions {
  roomId: string;
  userId: string;
  elementStore: ElementStore;
  onElementsChanged?: () => void;
}

export function useCollaboration({ roomId, userId, elementStore, onElementsChanged }: UseCollaborationOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<UserPresence[]>([]);
  const [cursors, setCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const cursorThrottleRef = useRef<number>(0);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((msg: WebSocketMessage) => {
    switch (msg.type) {
      case 'op': {
        const payload = msg.payload as {
          opId: string;
          opType: string;
          data: Record<string, unknown>;
          userId: string;
          vectorClock: Record<string, number>;
        };
        // Ignore own operations
        if (payload.userId === userId) return;

        const remoteOp = reconstructOperation(payload);
        if (remoteOp) {
          elementStore.applyRemote(remoteOp);
          onElementsChanged?.();
        }
        break;
      }
      case 'cursor': {
        const cursor = msg.payload as CursorPayload;
        if (cursor.userId === userId) return;
        setCursors(prev => {
          const next = new Map(prev);
          next.set(cursor.userId, {
            ...cursor,
            lastUpdate: Date.now(),
          });
          return next;
        });
        break;
      }
      case 'presence': {
        const presence = msg.payload as {
          userId: string;
          action: 'join' | 'leave';
          user?: UserPresence;
        };
        if (presence.action === 'join' && presence.user) {
          setCollaborators(prev => {
            if (prev.some(c => c.id === presence.user!.id)) return prev;
            return [...prev, presence.user!];
          });
        } else if (presence.action === 'leave') {
          setCollaborators(prev => prev.filter(c => c.id !== presence.userId));
          setCursors(prev => {
            const next = new Map(prev);
            next.delete(presence.userId);
            return next;
          });
        }
        break;
      }
      case 'sync': {
        const sync = msg.payload as {
          users: UserPresence[];
        };
        if (sync.users) {
          setCollaborators(sync.users);
        }
        break;
      }
    }
  }, [userId, elementStore, onElementsChanged]);

  // Subscribe to local operations and broadcast them
  useEffect(() => {
    const unsub = elementStore.on('operation', (op) => {
      if (!wsClient.isConnected()) return;
      wsClient.sendOperation(op.opType as never, {
        opId: op.opId,
        elementId: op.elementId,
        timestamp: op.timestamp,
        ...extractOpData(op),
      } as never, op.opId);
    });
    return unsub;
  }, [elementStore]);

  // Connect WebSocket and join room
  useEffect(() => {
    let mounted = true;

    const connect = async () => {
      try {
        await wsClient.connect();
        if (mounted) {
          setIsConnected(true);
          wsClient.joinRoom(roomId);
        }
      } catch (err) {
        console.error('[Collab] Failed to connect:', err);
        if (mounted) setIsConnected(false);
      }
    };

    const unsubscribe = wsClient.subscribe(handleMessage);
    connect();

    return () => {
      mounted = false;
      unsubscribe();
      wsClient.leaveRoom();
      wsClient.disconnect();
      setIsConnected(false);
    };
  }, [roomId, handleMessage]);

  // Clean up stale cursors every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setCursors(prev => {
        const next = new Map(prev);
        let changed = false;
        for (const [id, cursor] of next) {
          if (now - cursor.lastUpdate > 10000) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Send cursor position (throttled)
  const sendCursor = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - cursorThrottleRef.current < 50) return; // 20fps max
    cursorThrottleRef.current = now;
    wsClient.sendCursor(x, y);
  }, []);

  return {
    isConnected,
    collaborators,
    cursors,
    sendCursor,
  };
}

// Extract operation-specific data for transmission
function extractOpData(op: ElementOperation): Record<string, unknown> {
  switch (op.opType) {
    case 'add':
      return { element: (op as { element: unknown }).element };
    case 'update':
      return { changes: (op as { changes: unknown }).changes };
    case 'delete':
      return {};
    case 'move':
      return { x: (op as { x: number }).x, y: (op as { y: number }).y };
    case 'resize':
      return {
        width: (op as { width: number }).width,
        height: (op as { height: number }).height,
        x: (op as { x?: number }).x,
        y: (op as { y?: number }).y,
      };
    case 'reorder':
      return { zIndex: (op as { zIndex: number }).zIndex };
    case 'lock':
      return { locked: (op as { locked: boolean }).locked };
    case 'clear':
      return {};
    default:
      return {};
  }
}

// Reconstruct an ElementOperation from a server message
function reconstructOperation(payload: {
  opId: string;
  opType: string;
  data: Record<string, unknown>;
  userId: string;
  vectorClock: Record<string, number>;
}): ElementOperation | null {
  const base = {
    opId: payload.opId,
    opType: payload.opType as ElementOperation['opType'],
    elementId: (payload.data.elementId as string) || '',
    vectorClock: payload.vectorClock,
    userId: payload.userId,
    timestamp: (payload.data.timestamp as number) || Date.now(),
  };

  switch (payload.opType) {
    case 'add':
      return { ...base, opType: 'add', element: payload.data.element } as ElementOperation;
    case 'update':
      return { ...base, opType: 'update', changes: payload.data.changes } as ElementOperation;
    case 'delete':
      return { ...base, opType: 'delete' } as ElementOperation;
    case 'move':
      return { ...base, opType: 'move', x: payload.data.x as number, y: payload.data.y as number } as ElementOperation;
    case 'resize':
      return {
        ...base,
        opType: 'resize',
        width: payload.data.width as number,
        height: payload.data.height as number,
        x: payload.data.x as number | undefined,
        y: payload.data.y as number | undefined,
      } as ElementOperation;
    case 'reorder':
      return { ...base, opType: 'reorder', zIndex: payload.data.zIndex as number } as ElementOperation;
    case 'lock':
      return { ...base, opType: 'lock', locked: payload.data.locked as boolean } as ElementOperation;
    case 'clear':
      return { ...base, opType: 'clear' } as ElementOperation;
    default:
      return null;
  }
}
