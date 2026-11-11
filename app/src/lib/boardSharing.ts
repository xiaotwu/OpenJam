import { request, type LinkPermission, type MemberPermission, type RoomMember } from './api';

export type BoardCredential = { kind: 'invite' | 'share'; token: string };
export type ShareLinkPermission = Exclude<MemberPermission, 'edit'>;
export type EffectiveBoardAccess = {
  permission: 'owner' | MemberPermission;
  source: 'owner' | 'member' | 'project' | 'link' | 'legacy-link';
  capabilities: { canRead: boolean; canComment: boolean; canEdit: boolean; canManage: boolean; canRestore: boolean };
};

export type BoardInvitation = {
  id: string;
  email: string;
  permission: MemberPermission;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
};

export type BoardShareLink = {
  id: string;
  permission: ShareLinkPermission;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  redemptionCount: number;
};

export type BoardSharing = {
  members: RoomMember[];
  invitations: BoardInvitation[];
  links: BoardShareLink[];
  legacyLink?: { permission: LinkPermission; expiresAt: string };
};

const credentialPattern = /^[A-Za-z0-9_-]{43}$/;

export function readBoardCredential(hash: string): BoardCredential | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const invite = params.getAll('invite');
  const share = params.getAll('share');
  if (!invite.length && !share.length) return null;
  const token = invite[0] ?? share[0];
  return {
    kind: invite.length ? 'invite' : 'share',
    token: invite.length + share.length === 1 && credentialPattern.test(token) ? token : '',
  };
}

export function boardCredentialFragment({ kind, token }: BoardCredential): string {
  return `#${kind}=${encodeURIComponent(token)}`;
}

export function boardCredentialURL(boardId: string, credential: BoardCredential): string {
  const url = new URL(`/board/${encodeURIComponent(boardId)}`, window.location.origin);
  url.hash = boardCredentialFragment(credential);
  return url.href;
}

function boardPath(boardId: string) {
  return `/api/v2/boards/${encodeURIComponent(boardId)}`;
}

function sharingRequest<T>(boardId: string, suffix: string, method: string, body?: unknown, signal?: AbortSignal) {
  return request<T>(`${boardPath(boardId)}/sharing${suffix}`, {
    method, cache: 'no-store', signal, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getEffectiveBoardAccess(boardId: string, signal?: AbortSignal) {
  return request<EffectiveBoardAccess>(`${boardPath(boardId)}/access`, { cache: 'no-store', signal });
}

export function getBoardSharing(boardId: string, signal?: AbortSignal) {
  return sharingRequest<BoardSharing>(boardId, '', 'GET', undefined, signal);
}

export function issueBoardInvitation(boardId: string, email: string, permission: MemberPermission, expiresInDays: number, signal?: AbortSignal) {
  return sharingRequest<{ invitation: BoardInvitation; token: string }>(boardId, '/invitations', 'POST', { email, permission, expiresInDays }, signal);
}

export function issueBoardShareLink(boardId: string, permission: ShareLinkPermission, expiresInDays: number, signal?: AbortSignal) {
  return sharingRequest<{ link: BoardShareLink; token: string }>(boardId, '/links', 'POST', { permission, expiresInDays }, signal);
}

export function redeemBoardCredential(boardId: string, credential: BoardCredential, signal?: AbortSignal) {
  const suffix = credential.kind === 'invite' ? '/invitations/accept' : '/links/redeem';
  return sharingRequest<EffectiveBoardAccess>(boardId, suffix, 'POST', { token: credential.token }, signal);
}

export function revokeBoardInvitation(boardId: string, invitationId: string, signal?: AbortSignal) {
  return sharingRequest<void>(boardId, `/invitations/${encodeURIComponent(invitationId)}`, 'DELETE', undefined, signal);
}

export function revokeBoardShareLink(boardId: string, linkId: string, signal?: AbortSignal) {
  return sharingRequest<void>(boardId, `/links/${encodeURIComponent(linkId)}`, 'DELETE', undefined, signal);
}

export function updateBoardMemberRole(boardId: string, userId: string, permission: MemberPermission, signal?: AbortSignal) {
  return sharingRequest<RoomMember>(boardId, `/members/${encodeURIComponent(userId)}`, 'PUT', { permission }, signal);
}

export function removeBoardMember(boardId: string, userId: string, signal?: AbortSignal) {
  return sharingRequest<void>(boardId, `/members/${encodeURIComponent(userId)}`, 'DELETE', undefined, signal);
}

export function closeLegacyBoardLink(boardId: string, signal?: AbortSignal) {
  return sharingRequest<void>(boardId, '/legacy-link', 'DELETE', undefined, signal);
}
