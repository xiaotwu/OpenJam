import { request, type MemberPermission, type Room } from './api';

export type TeamRole = 'owner' | 'admin' | 'member';
export type AssignableTeamRole = Exclude<TeamRole, 'owner'>;
export type ProjectRole = 'manager' | MemberPermission;

export interface TeamMember {
  userId: string;
  displayName: string;
  avatarColor: string;
  email?: string;
  role: TeamRole;
}

export interface ProjectMember {
  userId: string;
  displayName: string;
  role: ProjectRole;
  inherited: boolean;
}

export interface Organization {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  role: TeamRole;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  role: ProjectRole;
  isDefault: boolean;
}

export interface DirectoryBoard extends Room {
  permission: NonNullable<Room['permission']>;
  projectId: string | null;
  archivedAt: string | null;
  favorite: boolean;
}

export interface Directory {
  organizations: Organization[];
  workspaces: Workspace[];
  projects: Project[];
  boards: DirectoryBoard[];
}

const directoryAPI = '/api/v2';

export function getDirectory(signal?: AbortSignal): Promise<Directory> {
  return request(`${directoryAPI}/directory`, { signal });
}

function create<T>(collection: string, name: string): Promise<T> {
  return request(`${directoryAPI}${collection}`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function createOrganization(name: string): Promise<Organization> {
  return create('/organizations', name);
}

export function createWorkspace(organizationId: string, name: string): Promise<Workspace> {
  return create(`/organizations/${encodeURIComponent(organizationId)}/workspaces`, name);
}

export function createProject(workspaceId: string, name: string): Promise<Project> {
  return create(`/workspaces/${encodeURIComponent(workspaceId)}/projects`, name);
}

export function createProjectBoard(projectId: string, name: string): Promise<DirectoryBoard> {
  return create(`/projects/${encodeURIComponent(projectId)}/boards`, name);
}

export function setBoardFavorite(id: string, favorite: boolean): Promise<{ favorite: boolean }> {
  return request(`${directoryAPI}/boards/${encodeURIComponent(id)}/favorite`, {
    method: 'PUT',
    body: JSON.stringify({ favorite }),
  });
}

export function setBoardArchive(id: string, archived: boolean): Promise<{ archivedAt: string | null }> {
  return request(`${directoryAPI}/boards/${encodeURIComponent(id)}/archive`, {
    method: 'PUT',
    body: JSON.stringify({ archived }),
  });
}

export function moveBoard(id: string, projectId: string): Promise<{ projectId: string }> {
  return request(`${directoryAPI}/boards/${encodeURIComponent(id)}/location`, {
    method: 'PUT',
    body: JSON.stringify({ projectId }),
  });
}

function directoryRequest<T>(path: string, method: string, body?: unknown, signal?: AbortSignal) {
  return request<T>(`${directoryAPI}${path}`, {
    method, cache: 'no-store', signal, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getTeamMembers(teamId: string, signal?: AbortSignal) {
  return directoryRequest<TeamMember[]>(`/teams/${encodeURIComponent(teamId)}/members`, 'GET', undefined, signal);
}

export function inviteTeamMember(teamId: string, email: string, role: AssignableTeamRole) {
  return directoryRequest<{ token: string; expiresAt: string }>(
    `/teams/${encodeURIComponent(teamId)}/invitations`, 'POST', { email, role },
  );
}

export function acceptTeamInvitation(teamId: string, token: string, signal?: AbortSignal) {
  return directoryRequest<{ teamId: string }>(`/teams/${encodeURIComponent(teamId)}/invitations/accept`, 'POST', { token }, signal);
}

export function changeTeamMember(teamId: string, memberId: string, role?: AssignableTeamRole) {
  return directoryRequest<{ ok: boolean }>(
    `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}`,
    role === undefined ? 'DELETE' : 'PUT', role === undefined ? undefined : { role },
  );
}

export function getProjectMembers(projectId: string, signal?: AbortSignal) {
  return directoryRequest<ProjectMember[]>(`/projects/${encodeURIComponent(projectId)}/members`, 'GET', undefined, signal);
}

export function changeProjectMember(projectId: string, memberId: string, role?: ProjectRole) {
  return directoryRequest<{ ok: boolean }>(
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`,
    role === undefined ? 'DELETE' : 'PUT', role === undefined ? undefined : { role },
  );
}
