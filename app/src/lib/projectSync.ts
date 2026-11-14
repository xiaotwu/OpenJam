import { request } from './api';
import type { ResourceKind } from './directory';

export type ProjectImportMode = 'linked' | 'independent';
export type SyncDirection = 'pull' | 'push';

export interface ProjectAction {
  projectId: string;
  organizationId?: string;
  versionId?: string;
  files: number;
}

export interface ProjectLink {
  projectId: string;
  projectName: string;
  organizationName: string;
}

export interface ProjectFileSummary {
  id?: string;
  name: string;
  archived: boolean;
}

export interface ProjectDifference {
  key: string;
  kind: ResourceKind;
  state: 'incoming' | 'outgoing' | 'conflict';
  current?: ProjectFileSummary;
  linked?: ProjectFileSummary;
}

export interface ProjectSyncPreview {
  token: string;
  changes: ProjectDifference[];
}

export interface ProjectVersion {
  id: string;
  name: string;
  kind: 'named' | 'imported' | 'before_sync' | 'pulled' | 'pushed' | 'before_restore' | 'restored';
  createdAt: string;
  author?: string;
  files: number;
}

export interface ProjectVersionList {
  versions: ProjectVersion[];
  next?: string;
}

export interface ProjectRestorePreview {
  token: string;
  changes: Array<{ key: string; name: string; kind: ResourceKind; action: 'restore' | 'recreate' | 'archive' }>;
}

export function projectEndpoint(id: string) {
  return '/api/v2/projects/' + encodeURIComponent(id);
}

export function writeProject(path: string, requestId: string, input: Record<string, unknown>) {
  return request<ProjectAction>(path, {
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify({ ...input, requestId }),
  });
}
