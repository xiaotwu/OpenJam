import { request, requestResponse } from './api';
import type { Project, ProjectRole } from './directory';

export const projectArchiveLimit = 64 * 1024 * 1024;

export interface ProjectArchiveInfo {
  name: string;
  files: number;
  fileVersions: number;
  projectVersions: number;
  images: number;
  members: { id: string; name: string; role: ProjectRole }[];
}

export interface ProjectArchiveMapping {
  sourceUserId: string;
  targetUserId: string;
  role: ProjectRole;
}

export function inspectProjectArchive(archive: File, signal: AbortSignal) {
  return request<ProjectArchiveInfo>('/api/v2/project-archives/inspect', {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: archive, signal, cache: 'no-store',
  });
}

export function restoreProjectArchive(workspaceId: string, archive: File, requestId: string,
  name: string, mappings: ProjectArchiveMapping[], signal: AbortSignal) {
  const form = new FormData();
  form.append('options', JSON.stringify({ requestId, name, mappings }));
  form.append('archive', archive);
  return request<Project>(`/api/v2/workspaces/${encodeURIComponent(workspaceId)}/project-archives`, {
    method: 'POST', body: form, signal, cache: 'no-store',
  });
}

export async function downloadProjectArchive(project: Project, signal: AbortSignal) {
  const query = new URLSearchParams({ origin: window.location.origin });
  const response = await requestResponse(`/api/v2/projects/${encodeURIComponent(project.id)}/archive?${query}`, { signal, cache: 'no-store' });
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  const name = Array.from(project.name, char => '/\\:*?"<>|'.includes(char) || char.charCodeAt(0) < 32 ? '-' : char)
    .join('').replace(/^[ .]+|[ .]+$/g, '');
  link.download = (name || 'Shiori') + '.shiori-project.zip';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
