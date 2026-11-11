import type { Page } from '../components/PagesPanel';
import { request, requestResponse } from './api';
import { boardFonts } from './boardFonts';
import type { DirectoryBoard } from './directory';
import { newRequestId } from './requestId';

export type DocFormat = 'md' | 'docx';

export interface DocBlock extends Page {
  docBlock: true;
  text: string;
  fontFamily: string;
}

export const maxDocBlocks = 400;
export const maxDocBlockBytes = 16_000;
export const maxDocImportBytes = 4 * 1024 * 1024;

export function docBlocks(pages: Page[]): DocBlock[] {
  return pages.filter((page): page is DocBlock => {
    const block = page as Partial<DocBlock>;
    return block.docBlock === true && typeof block.text === 'string' && typeof block.fontFamily === 'string';
  });
}

export function newDocBlock(text = '', fontFamily: string = boardFonts[0].family): DocBlock {
  return { id: newRequestId(), name: 'Block', docBlock: true, text, fontFamily };
}

export function importDoc(projectId: string, name: string, format: DocFormat, file: File) {
  const params = new URLSearchParams({ name, format });
  return request<DirectoryBoard>(`/api/v2/projects/${encodeURIComponent(projectId)}/docs/import?${params}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  });
}

export async function downloadDoc(docId: string, title: string, format: DocFormat) {
  const response = await requestResponse(`/api/v2/docs/${encodeURIComponent(docId)}/export?format=${format}`, {
    cache: 'no-store',
  });
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  const filename = Array.from(title.trim(), character =>
    character === '/' || character === '\\' || character.charCodeAt(0) < 32 ? '_' : character).join('');
  link.download = (filename || 'Untitled Document') + '.' + format;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
