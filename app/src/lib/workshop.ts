import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, request } from './api';
import type { ResourceKind } from './directory';

export const workshopPath = '/api/v2/workshop';

export type SearchKind = 'project' | 'member' | 'file' | 'content';
export interface SearchHit {
  resourceKind?: ResourceKind;
  kind: SearchKind;
  id: string;
  title: string;
  context?: string;
  snippet?: string;
  organizationId?: string;
  url: string;
}
export interface GraphNode {
  resourceKind?: ResourceKind;
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
  meetings: MeetingNotice[];
  unreadMeetings: number;
  unread: number;
}
export interface WorkshopMessage {
  authorId?: string;
  avatarColor?: string;
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
export type MeetingStatus = 'scheduled' | 'open' | 'ended';

interface MeetingSummary {
  id: string;
  title: string;
  scopeName: string;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
}

export interface MeetingNotice extends MeetingSummary {
  unread: boolean;
}

export interface MeetingDetail {
  meeting: MeetingSummary & { organizer: string; canEnd: boolean };
  mediaEnabled: boolean;
}

export interface MeetingDraft {
  teamId?: string;
  projectId?: string;
  title: string;
  startsAt?: string;
  endsAt?: string;
}

export interface AgendaItem extends Omit<AgendaDraft, 'kind'> {
  id: string;
  kind: AgendaDraft['kind'] | 'meeting';
  editable: boolean;
  scopeName?: string;
  meetingStatus?: MeetingStatus;
  revision: number;
}
export interface RecentResource {
  resourceKind?: ResourceKind;
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

export function meetingPath(id: string) {
  return '/meeting/' + encodeURIComponent(id);
}

export function meetingEndpoint(id: string) {
  return '/meetings/' + encodeURIComponent(id);
}

export function meetingSignalURL(id: string) {
  const url = new URL('/ws/meetings/' + encodeURIComponent(id), API_BASE_URL || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
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
