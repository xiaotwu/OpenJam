import type { Page } from '../components/PagesPanel';
import { request, requestResponse } from './api';
import type { BoardElement, DocumentMutation } from './boardSyncProtocol';
import type { DirectoryBoard } from './directory';
import { newRequestId } from './requestId';

export const maxSlides = 60;
export const maxSlideObjects = 100;
export const maxSlideTextBytes = 16_000;
export const maxPptxUploadBytes = 32 * 1024 * 1024;
export const slideDefaultFont = 'IBM Plex Sans Variable';

export interface SlidePage extends Page {
  slidePage: true;
  width: number;
  height: number;
  background: string;
}

export interface SlideBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface SlideCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface SlideItem extends SlideBox {
  id: string;
  pageId: string;
  createdBy?: string;
}

export interface SlideText extends SlideItem {
  type: 'text';
  text?: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  color: string;
}

export interface SlideImage extends SlideItem {
  type: 'image';
  assetId: string;
  originalWidth: number;
  originalHeight: number;
  caption?: string;
  crop?: SlideCrop;
}

export type SlideObject = SlideText | SlideImage;

export function slidePages(pages: Page[]): SlidePage[] {
  return pages.filter((page): page is SlidePage => (page as Partial<SlidePage>).slidePage === true);
}

export function slideItems(elements: BoardElement[]): SlideObject[] {
  return elements.filter(element => element.pageId && (element.type === 'text' || element.type === 'image')) as unknown as SlideObject[];
}

export function newSlide(page: SlidePage): SlidePage {
  return { id: newRequestId(), name: 'Slide', slidePage: true, width: page.width, height: page.height, background: '#ffffff' };
}

export function addSlideObject(item: SlideObject): DocumentMutation {
  return { kind: 'add', collection: 'elements', id: item.id, value: item as unknown as BoardElement };
}

export function patchSlideObject(item: SlideObject, changes: Record<string, unknown>, unset: string[] = []): DocumentMutation {
  const before = item as unknown as Record<string, unknown>;
  const fields = Object.fromEntries(Object.entries(changes).filter(([key, value]) => value !== before[key]));
  const expected = Object.fromEntries([...Object.keys(fields), ...unset].map(key => [key, before[key] ?? null]));
  return { kind: 'patch', collection: 'elements', id: item.id, fields, expected, ...(unset.length ? { unset } : {}) };
}

export function isDarkSlideColor(value: string) {
  const red = parseInt(value.slice(1, 3), 16);
  const green = parseInt(value.slice(3, 5), 16);
  const blue = parseInt(value.slice(5, 7), 16);
  return red * .2126 + green * .7152 + blue * .0722 < 130;
}

export function importPptx(projectId: string, name: string, file: File) {
  const params = new URLSearchParams({ name });
  return request<DirectoryBoard & { warnings?: string[] }>('/api/v2/projects/' + encodeURIComponent(projectId) + '/slides/import?' + params, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  });
}

export async function downloadPptx(id: string, title: string, signal?: AbortSignal) {
  const response = await requestResponse('/api/v2/slides/' + encodeURIComponent(id) + '/export', { cache: 'no-store', signal });
  const url = URL.createObjectURL(await response.blob());
  if (signal?.aborted) { URL.revokeObjectURL(url); return; }
  const link = document.createElement('a');
  link.href = url;
  const name = Array.from(title.trim(), character =>
    character === '/' || character === '\\' || character.charCodeAt(0) < 32 ? '_' : character).join('');
  link.download = (name || 'Untitled Presentation') + '.pptx';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
