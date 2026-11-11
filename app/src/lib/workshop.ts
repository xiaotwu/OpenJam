import { useCallback, useEffect, useState } from 'react';
import { request } from './api';

export const workshopPath = '/api/v2/workshop';

export type SearchKind = 'project' | 'member' | 'file' | 'content';
export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  context?: string;
  snippet?: string;
  organizationId?: string;
  url: string;
}
export interface GraphNode {
  id: string;
  kind: 'member' | 'project' | 'resource';
  title: string;
  color?: string;
  url: string;
}
export interface TeamGraph {
  nodes: GraphNode[];
  edges: { from: string; to: string; kind: 'owns' | 'participates' | 'contains' | 'references' }[];
  truncated: boolean;
}
export interface Conversation {
  id: string;
  teamId: string;
  teamName: string;
  kind: 'team' | 'direct';
  subject: string;
  contact?: string;
  preview: string;
  updatedAt: string;
  unread: number;
  pinned: boolean;
  startedByMe: boolean;
}
export interface Mention {
  boardId: string;
  boardName: string;
  commentId: string;
  threadId: string;
  author: string;
  preview: string;
  createdAt: string;
  unread: boolean;
  url: string;
}
export interface Inbox {
  threads: Conversation[];
  mentions: Mention[];
  unread: number;
}
export interface WorkshopMessage {
  id: string;
  sequence: number;
  author: string;
  body: string;
  mine: boolean;
  createdAt: string;
}
export interface ThreadPage {
  messages: WorkshopMessage[];
  nextBefore?: number;
}
export interface AgendaDraft {
  teamId?: string;
  projectId?: string;
  kind: 'event' | 'task';
  title: string;
  notes: string;
  startsAt: string;
  endsAt: string;
  completed: boolean;
  revision?: number;
}
export interface AgendaItem extends AgendaDraft {
  id: string;
  editable: boolean;
  scopeName?: string;
  revision: number;
}
export interface RecentResource {
  id: string;
  title: string;
  context?: string;
  openedAt: string;
  url: string;
}

export function writeWorkshop<T>(suffix: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) {
  return request<T>(workshopPath + suffix, {
    method,
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function recordRecentBoard(id: string) {
  return writeWorkshop('/recents/' + encodeURIComponent(id), 'PUT');
}

export function agendaPath(from: Date, to: Date) {
  return workshopPath + '/agenda?' + new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
}

interface ResourceState<T> {
  path: string;
  value?: T;
  error?: string;
}

export function useWorkshopResource<T>(path: string | null, interval = 0) {
  const [state, setState] = useState<ResourceState<T>>();
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(current => current + 1), []);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending || controller.signal.aborted || path === null) return;
      pending = true;
      try {
        const value = await request<T>(path, { signal: controller.signal, cache: 'no-store' });
        if (!controller.signal.aborted) setState({ path, value });
      } catch (error) {
        if (!controller.signal.aborted) setState({ path, error: error instanceof Error ? error.message : 'Could not load this view.' });
      } finally {
        pending = false;
      }
    }
    void load();
    const timer = interval ? window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, interval) : undefined;
    const onFocus = () => { void load(); };
    if (interval) window.addEventListener('focus', onFocus);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [path, interval, attempt]);

  const current = state?.path === path ? state : undefined;
  return { data: current?.value, error: current?.error, loading: path !== null && current === undefined, refresh };
}
