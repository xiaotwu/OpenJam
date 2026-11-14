import { request } from './api';

export type ReviewFilter = 'open' | 'resolved' | 'mentioned' | 'all';

export interface ReviewLocation {
  pageId: string;
  elementId?: string;
  x?: number;
  y?: number;
}

export interface ReviewAnchor extends ReviewLocation {
  pageName: string;
  currentPageId?: string;
  status: 'live' | 'moved' | 'missing-object' | 'missing-page';
}

export interface ReviewThread {
  id: string;
  anchor: ReviewAnchor;
  authorId: string;
  authorName: string;
  body: string;
  commentCount: number;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  canResolve: boolean;
}

export interface ReviewComment {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  body: string;
  mentionUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewPerson { id: string; displayName: string; avatarColor: string }

export interface ReviewNotification {
  commentId: string;
  threadId: string;
  authorName: string;
  preview: string;
  createdAt: string;
  readAt?: string;
}

export interface ReviewDraft { body: string; mentionUserIds: string[] }

export interface ReviewThreadPage {
  threads: ReviewThread[];
  nextCursor?: string;
  unreadCount: number;
  canComment: boolean;
}

export interface ReviewThreadDetail {
  thread: ReviewThread;
  comments: ReviewComment[];
  nextCursor?: string;
  canComment: boolean;
}

export function boardReviewAPI(boardId: string) {
  const path = `/api/v2/boards/${encodeURIComponent(boardId)}/review`;
  const threadPath = (threadId: string) => `/threads/${encodeURIComponent(threadId)}`;
  const read = <T>(route: string, signal?: AbortSignal) => request<T>(path + route, { signal });
  const write = <T>(route: string, method: 'POST' | 'PUT', body?: object) => request<T>(path + route, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12_000),
  });

  return {
    threads(filter: ReviewFilter, cursor?: string, signal?: AbortSignal) {
      const query = new URLSearchParams({ status: filter });
      if (cursor) query.set('cursor', cursor);
      return read<ReviewThreadPage>(`/threads?${query}`, signal);
    },
    thread(threadId: string, cursor?: string, signal?: AbortSignal) {
      return read<ReviewThreadDetail>(threadPath(threadId) + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''), signal);
    },
    people: (signal?: AbortSignal) => read<{ people: ReviewPerson[] }>('/people', signal),
    notifications: (signal?: AbortSignal) => read<{ notifications: ReviewNotification[] }>('/notifications', signal),
    createThread: (requestId: string, anchor: ReviewLocation, draft: ReviewDraft) =>
      write<ReviewThread>('/threads', 'POST', { requestId, anchor, ...draft }),
    reply: (threadId: string, requestId: string, draft: ReviewDraft) =>
      write<ReviewComment>(`${threadPath(threadId)}/replies`, 'POST', { requestId, ...draft }),
    edit: (threadId: string, comment: ReviewComment, draft: ReviewDraft) =>
      write<ReviewComment>(`${threadPath(threadId)}/comments/${encodeURIComponent(comment.id)}`, 'PUT', { ...draft, expectedUpdatedAt: comment.updatedAt }),
    resolve: (threadId: string, resolved: boolean) => write<ReviewThread>(threadPath(threadId), 'PUT', { resolved }),
    markRead: (commentId: string) => write<{ ok: boolean }>(`/notifications/${encodeURIComponent(commentId)}/read`, 'PUT'),
  };
}
