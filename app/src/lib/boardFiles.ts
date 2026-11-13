import { ApiError, getToken, request, requestResponse } from './api';

export interface BoardAsset {
  id: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
}

export type JobStatus = 'queued' | 'running' | 'awaiting_input' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

export interface Job<T = unknown> {
  id: string;
  kind: string;
  boardId?: string;
  requestId: string;
  status: JobStatus;
  revision: number;
  attempt: number;
  maxAttempts: number;
  manualRetries: number;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  outputExpiresAt?: string;
  artifactAvailable: boolean;
  result?: T;
}

export type FileJob = Job<{ boardId?: string; epoch?: number; seq?: number; hash?: string; filename?: string }>;

export interface ExportRequest {
  requestId: string;
  format: 'png' | 'json' | 'zip';
  scope: 'board' | 'page' | 'selection';
  theme?: 'light' | 'dark';
  pageId?: string;
  elementIds?: string[];
  stampIds?: string[];
}

const boardPath = (id: string) => `/api/v2/boards/${encodeURIComponent(id)}`;
const jobPath = (id: string) => `/api/v2/jobs/${encodeURIComponent(id)}`;

export function uploadBoardAsset(boardId: string, file: File, signal: AbortSignal, progress: (ratio: number) => void) {
  return uploadFile<BoardAsset>(`${boardPath(boardId)}/assets`, file, file.type || 'application/octet-stream', signal, progress);
}

export async function readBoardAsset(boardId: string, assetId: string, signal?: AbortSignal) {
  const response = await requestResponse(`${boardPath(boardId)}/assets/${encodeURIComponent(assetId)}`, { signal, cache: 'no-store' });
  return response.blob();
}

export async function readBoardThumbnail(boardId: string, signal: AbortSignal, theme: 'light' | 'dark' = 'light'): Promise<Blob | 'pending' | null> {
  const response = await requestResponse(`${boardPath(boardId)}/thumbnail?theme=${theme}`, { signal, cache: 'no-store' });
  if (response.status === 202) return 'pending';
  if (response.status === 204) return null;
  return response.blob();
}

export function enqueueExport(boardId: string, settings: ExportRequest) {
  return request<FileJob>(`${boardPath(boardId)}/files/export`, { method: 'POST', body: JSON.stringify(settings) });
}

export function enqueueImport(file: File, requestId: string, signal: AbortSignal, progress: (ratio: number) => void) {
  const type = file.name.toLowerCase().endsWith('.json') ? 'application/json' : 'application/zip';
  return uploadFile<FileJob>('/api/v2/board-imports', file, type, signal, progress, requestId);
}

export async function listFileJobs(boardId?: string, signal?: AbortSignal) {
  const query = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
  const result = await request<{ jobs: FileJob[] }>(`/api/v2/jobs${query}`, { signal });
  return result.jobs;
}

export function getFileJob(jobId: string, signal?: AbortSignal) {
  return request<FileJob>(jobPath(jobId), { signal });
}

export function changeFileJob(jobId: string, action: 'cancel' | 'retry') {
  return request<FileJob>(`${jobPath(jobId)}/${action}`, { method: 'POST' });
}

export async function downloadFileJob(jobId: string) {
  const response = await requestResponse(`${jobPath(jobId)}/artifact`, { cache: 'no-store' });
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? 'shiori-export';
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = Array.from(name, char => char === '/' || char === '\\' || char.charCodeAt(0) < 32 ? '_' : char).join('');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function copyPrivateBoard(boardId: string, name: string) {
  return request<{ boardId: string }>(`${boardPath(boardId)}/copy`, { method: 'POST', body: JSON.stringify({ name }) });
}

function uploadFile<T>(endpoint: string, file: File, type: string, signal: AbortSignal, progress: (ratio: number) => void, requestId?: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Upload cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open('POST', `${import.meta.env.VITE_API_URL || ''}${endpoint}`);
    xhr.withCredentials = true;
    xhr.timeout = 90_000;
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', type);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (requestId) xhr.setRequestHeader('Idempotency-Key', requestId);
    signal.addEventListener('abort', abort, { once: true });
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(event.loaded / event.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) resolve(xhr.response as T);
      else reject(new ApiError(xhr.response?.error || 'Upload failed. Try again.', xhr.status, xhr.response?.code));
    };
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    xhr.onerror = xhr.ontimeout = () => reject(new Error('Upload was interrupted. Try again.'));
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    xhr.send(file);
  });
}
