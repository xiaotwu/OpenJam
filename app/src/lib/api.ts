const API_BASE = import.meta.env.VITE_API_URL || '';

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
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

const TOKEN_KEY = 'wb_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
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
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    clearToken();
  }
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

export async function deleteRoom(id: string): Promise<void> {
  await request(`/api/rooms/${id}`, { method: 'DELETE' });
}

export interface BoardData {
  name: string;
  elements: unknown[];
  stamps?: unknown[];
  pages?: unknown[];
  currentPageId?: string;
}

export async function saveBoard(roomId: string, data: BoardData): Promise<{ success: boolean; savedAt: string }> {
  return request(`/api/rooms/${roomId}/save`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
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
