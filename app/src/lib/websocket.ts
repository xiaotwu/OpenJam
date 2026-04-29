import { getToken } from './api';

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

const WS_URL = getWsUrl();

export type MessageType = 'join' | 'leave' | 'op' | 'cursor' | 'sync' | 'presence' | 'error';

export interface WebSocketMessage {
  type: MessageType;
  payload: unknown;
}

export interface SyncPayload {
  operations: Operation[];
  users: UserPresence[];
}

export interface OperationPayload {
  opId: string;
  opType: OperationType;
  data: OperationData;
  vectorClock: VectorClock;
  userId?: string;
}

export interface CursorPayload {
  userId: string;
  x: number;
  y: number;
  color: string;
  name: string;
}

export interface PresencePayload {
  userId: string;
  action: 'join' | 'leave';
  user?: UserPresence;
}

export interface UserPresence {
  id: string;
  displayName: string;
  avatarColor: string;
}

export type OperationType = 'draw' | 'erase' | 'undo' | 'clear'
  | 'add' | 'update' | 'delete' | 'move' | 'resize' | 'reorder' | 'lock' | 'reaction' | 'comment';

export interface Point {
  x: number;
  y: number;
}

export interface DrawData {
  pathId: string;
  color: string;
  width: number;
  points: Point[];
}

export interface EraseData {
  pathId: string;
  width: number;
  points: Point[];
}

export interface UndoData {
  targetOpId: string;
}

export type ClearData = Record<string, never>;

export type OperationData = DrawData | EraseData | UndoData | ClearData;

export type VectorClock = Record<string, number>;

export interface Operation {
  opId: string;
  opType: OperationType;
  payload: OperationData;
  vectorClock: VectorClock;
  userId?: string;
}

type MessageHandler = (msg: WebSocketMessage) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private handlers: Set<MessageHandler> = new Set();
  private pendingMessages: string[] = [];
  private roomId: string | null = null;
  private shouldReconnect = false;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = getToken();
      if (!token) {
        reject(new Error('No auth token'));
        return;
      }

      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.shouldReconnect = true;
      const url = `${WS_URL}?token=${encodeURIComponent(token)}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.reconnectAttempts = 0;

        while (this.pendingMessages.length > 0) {
          const msg = this.pendingMessages.shift()!;
          this.ws?.send(msg);
        }

        if (this.roomId) {
          this.joinRoom(this.roomId);
        }

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WebSocketMessage;
          this.handlers.forEach((handler) => handler(msg));
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };

      this.ws.onclose = (event) => {
        console.log('[WS] Disconnected:', event.code, event.reason);
        if (this.shouldReconnect) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        reject(error);
      };
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(() => { });
    }, delay);
  }

  disconnect() {
    this.shouldReconnect = false;
    this.roomId = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private send(type: MessageType, payload: unknown) {
    const msg = JSON.stringify({ type, payload });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.pendingMessages.push(msg);
    }
  }

  joinRoom(roomId: string) {
    this.roomId = roomId;
    this.send('join', { roomId });
  }

  leaveRoom() {
    this.send('leave', {});
    this.roomId = null;
  }

  sendOperation(opType: OperationType, data: OperationData, opId?: string) {
    this.send('op', { opId, opType, data });
  }

  sendCursor(x: number, y: number) {
    this.send('cursor', { x, y });
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsClient = new WebSocketClient();
