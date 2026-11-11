import { request, type Room } from './api';

export interface Organization {
  id: string;
  name: string;
  kind: 'personal' | 'team';
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
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
