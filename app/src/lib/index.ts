// API exports
export {
  getToken,
  setToken,
  clearToken,
  register,
  login,
  logout,
  getMe,
  updateProfile,
  createRoom,
  listRooms,
  getRoom,
  updateRoom,
  deleteRoom,
  saveBoard,
  loadBoard,
  type User as ApiUser,
  type Room,
  type AuthResponse,
} from './api';

// Element exports
export * from './elements';

// Element store exports
export {
  ElementStore,
  type ElementOperationType,
  type VectorClock,
  type BaseOperation,
  type AddOperation,
  type UpdateOperation,
  type DeleteOperation,
  type MoveOperation,
  type ResizeOperation,
  type ReorderOperation,
  type LockOperation,
  type ReactionOperation,
  type CommentOperation,
  type ClearOperation as ElementClearOperation,
  type ElementOperation,
} from './elementStore';

// Types exports
export { type Point, type User, type Cursor, type Tool, type ToolState, type ViewState } from './types';

// CRDT exports
export {
  generateId,
  CRDTStore,
  type OperationType as CRDTOperationType,
  type DrawOperation,
  type EraseOperation,
  type UndoOperation,
  type ClearOperation as CRDTClearOperation,
  type Operation as CRDTOperation,
  type VectorClock as CRDTVectorClock,
} from './crdt';

// WebSocket exports
export {
  wsClient,
  type MessageType,
  type WebSocketMessage,
  type SyncPayload,
  type OperationPayload,
  type CursorPayload,
  type PresencePayload,
  type UserPresence,
} from './websocket';
