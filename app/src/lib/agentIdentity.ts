import { request } from './api';

export const agentGlyphs = ['orbit', 'diamond', 'dot', 'sparkle'] as const;
export type AgentGlyph = typeof agentGlyphs[number];

export type AgentProfile = {
  name: string;
  kind: 'ring' | 'glyph' | 'image' | 'pet';
  glyph?: AgentGlyph;
  imagePng?: string;
};

export type AgentAttribution = {
  elementId: string;
  runId: string;
  actorId: string;
  actorName: string;
  agentName?: string;
  glyph?: AgentGlyph;
};

const profilePath = '/api/v2/me/agent-profile';
const sourceLimit = 20 * 1024 * 1024;
const frameSize = 48;
const petColumns = 6;
const petRows = [0, 7, 6, 8];

export type CharacterPose = 'idle' | 'working' | 'waiting' | 'reviewing';

export function characterPose(status?: string): CharacterPose {
  if (status === 'running') return 'working';
  if (status === 'awaiting_input' || status === 'paused' || status === 'queued') return 'waiting';
  return status === 'succeeded' ? 'reviewing' : 'idle';
}

export const readAgentProfile = (signal?: AbortSignal) => request<AgentProfile>(profilePath, { cache: 'no-store', signal });

export const saveAgentProfile = (profile: AgentProfile, signal?: AbortSignal) => request<AgentProfile>(profilePath, {
  method: 'PUT', body: JSON.stringify(profile), signal,
});

export async function readAgentAttributions(boardId: string, pageId: string, signal: AbortSignal) {
  const entries = new Map<string, AgentAttribution>();
  const query = new URLSearchParams({ page: pageId });
  const path = '/api/v2/boards/' + encodeURIComponent(boardId) + '/agent-attributions?';
  for (;;) {
    const result = await request<{ entries: AgentAttribution[]; next?: string }>(path + query.toString(), { cache: 'no-store', signal });
    for (const item of result.entries) entries.set(item.elementId, item);
    if (!result.next || result.next <= (query.get('after') ?? '')) return entries;
    query.set('after', result.next);
  }
}

export async function normalizeAgentArtwork(file: File): Promise<Pick<AgentProfile, 'kind' | 'imagePng'>> {
  if (!file.size || file.size > sourceLimit || !['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) throw new Error('UNSUPPORTED_ARTWORK');
  const bitmap = await createImageBitmap(file);
  try {
    const isPet = bitmap.width === 1536 && (bitmap.height === 1872 || bitmap.height === 2288);
    if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error('UNSUPPORTED_ARTWORK');
    const canvas = document.createElement('canvas');
    canvas.width = isPet ? frameSize * petColumns : frameSize;
    canvas.height = isPet ? frameSize * petRows.length : frameSize;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('UNSUPPORTED_ARTWORK');
    context.imageSmoothingQuality = 'high';
    if (isPet) {
      const scaledWidth = Math.round(192 * frameSize / 208);
      for (const [row, source] of petRows.entries()) {
        for (let column = 0; column < petColumns; column++) {
          context.drawImage(bitmap, column * 192, source * 208, 192, 208,
            column * frameSize + (frameSize - scaledWidth) / 2, row * frameSize, scaledWidth, frameSize);
        }
      }
    } else {
      const scale = frameSize / Math.max(bitmap.width, bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap, (frameSize - width) / 2, (frameSize - height) / 2, width, height);
    }
    return { kind: isPet ? 'pet' : 'image', imagePng: canvas.toDataURL('image/png').split(',')[1] };
  } finally {
    bitmap.close();
  }
}
