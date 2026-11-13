export const API_BASE_URL = import.meta.env.SHIORI_API_URL;

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarColor: string;
  createdAt: string;
  updatedAt: string;
}

export interface Room {
  id: string;
  name: string;
  ownerId: string;
  permission?: 'owner' | MemberPermission;
  createdAt: string;
  updatedAt: string;
}

export type LinkPermission = 'restricted' | 'anyone-view' | 'anyone-comment' | 'anyone-edit';
export type MemberPermission = 'view' | 'comment' | 'edit';

export interface RoomMember {
  userId: string;
  email: string;
  displayName: string;
  avatarColor: string;
  permission: MemberPermission;
  createdAt: string;
  updatedAt: string;
}

export interface RoomShareSettings {
  linkPermission: LinkPermission;
  members: RoomMember[];
}

export interface AuthResponse {
  token: string;
  user: User;
}

// Share the bearer credential with open tabs and the previous client on rollback.
export const SESSION_TOKEN_STORAGE_KEY = 'wb_token';
const DEV_API_URL = 'http://localhost:8080';
const BACKEND_UNAVAILABLE_MESSAGE = `Shiori API is unavailable. Start the Go backend on ${DEV_API_URL} and try again.`;

export function getToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
}

async function getApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get('content-type') || '';
  const retryAfter = response.headers.get('Retry-After') ?? undefined;
  const body = await response.text().catch(() => '');

  if (contentType.includes('application/json')) {
    try {
      const error = JSON.parse(body);
      const message = typeof error?.error === 'string' ? error.error : error?.message;
      if (typeof message === 'string') {
        return new ApiError(
          message,
          response.status,
          typeof error.code === 'string' ? error.code : undefined,
          error.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details : undefined,
          retryAfter,
        );
      }
    } catch {
      // A malformed JSON error can still be displayed as text.
    }
  }

  const isUnavailableStatus = [500, 502, 503, 504].includes(response.status);
  const isDevProxyRequest = API_BASE_URL === '';

  if (isDevProxyRequest && isUnavailableStatus) {
    return new ApiError(BACKEND_UNAVAILABLE_MESSAGE, response.status);
  }

  return new ApiError(body.trim() || `Request failed with HTTP ${response.status}`, response.status, undefined, undefined, retryAfter);
}

// ApiError carries the HTTP status so callers can distinguish 401/403/404/5xx
// instead of guessing from a message string.
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;
  retryAfter?: string;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>, retryAfter?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

export async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await requestResponse(endpoint, options);
  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function requestResponse(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();

  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(BACKEND_UNAVAILABLE_MESSAGE);
  }

  if (!response.ok) {
    throw await getApiError(response);
  }

  return response;
}

export async function register(
  email: string,
  password: string,
  displayName: string
): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
  setToken(data.token);
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export async function logout(): Promise<void> {
  const token = getToken();
  await request('/api/auth/logout', { method: 'POST' });
  if (getToken() === token) clearToken();
}

export async function getMe(): Promise<{ user: User }> {
  return request('/api/me');
}

export async function updateProfile(
  displayName: string,
  avatarColor: string
): Promise<{ user: User }> {
  return request('/api/me', {
    method: 'PUT',
    body: JSON.stringify({ displayName, avatarColor }),
  });
}

export async function createRoom(name: string): Promise<Room> {
  return request('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function listRooms(): Promise<{ rooms: Room[] }> {
  return request('/api/rooms');
}

export async function getRoom(id: string): Promise<Room> {
  return request(`/api/rooms/${id}`);
}

export async function updateRoom(id: string, name: string): Promise<Room> {
  return request(`/api/rooms/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export async function deleteRoom(id: string): Promise<void> {
  await request(`/api/rooms/${id}`, { method: 'DELETE' });
}

export async function getRoomShareSettings(id: string): Promise<RoomShareSettings> {
  return request(`/api/rooms/${id}/share`);
}

export async function updateRoomShareSettings(
  id: string,
  linkPermission: LinkPermission
): Promise<RoomShareSettings> {
  return request(`/api/rooms/${id}/share`, {
    method: 'PUT',
    body: JSON.stringify({ linkPermission }),
  });
}

export async function inviteRoomMember(
  id: string,
  email: string,
  permission: MemberPermission
): Promise<RoomMember> {
  return request(`/api/rooms/${id}/invites`, {
    method: 'POST',
    body: JSON.stringify({ email, permission }),
  });
}

export async function removeRoomMember(id: string, userId: string): Promise<void> {
  await request(`/api/rooms/${id}/members/${userId}`, { method: 'DELETE' });
}

export interface BoardData {
  name: string;
  elements: unknown[];
  stamps?: unknown[];
  pages?: unknown[];
  currentPageId?: string;
  updatedAt?: string;
}

export interface SaveBoardResult {
  success: boolean;
  savedAt: string;
  updatedAt: string;
}

export class BoardConflictError extends Error {
  board: BoardData;
  constructor(board: BoardData) {
    super('Board was modified by someone else; reload to merge');
    this.name = 'BoardConflictError';
    this.board = board;
  }
}

export async function saveBoard(roomId: string, data: BoardData, expectedUpdatedAt?: string): Promise<SaveBoardResult> {
  const token = getToken();
  const body: Record<string, unknown> = { ...data };
  if (expectedUpdatedAt) {
    body.expectedUpdatedAt = expectedUpdatedAt;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(BACKEND_UNAVAILABLE_MESSAGE);
  }

  if (response.status === 409) {
    const conflict = await response.json().catch(() => null);
    if (conflict?.board) {
      throw new BoardConflictError(conflict.board as BoardData);
    }
    throw new Error(conflict?.error || 'Board was modified by someone else; reload to merge');
  }

  if (!response.ok) {
    throw await getApiError(response);
  }

  return response.json();
}

export async function loadBoard(roomId: string): Promise<BoardData> {
  return request(`/api/rooms/${roomId}/load`);
}

export async function exportPNG(roomId: string, imageData: string): Promise<{ url: string; filename: string }> {
  return request(`/api/rooms/${roomId}/export/png`, {
    method: 'POST',
    body: JSON.stringify({ imageData }),
  });
}

export async function exportJSON(roomId: string): Promise<{ url: string; filename: string }> {
  return request(`/api/rooms/${roomId}/export/json`, {
    method: 'POST',
  });
}
