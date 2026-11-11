import { request, requestResponse } from './api';
import type { Job } from './boardFiles';
import type { DocumentAck, DocumentMutation } from './boardSyncProtocol';

export type AgentWorkflow = 'workshop' | 'flowchart' | 'organize';
export type AgentPlacement = 'new-page' | 'current-page';
export type AgentRunStatus = Job['status'] | 'paused';
export type AgentRunAction = 'cancel' | 'retry' | 'pause' | 'resume';

export const MAX_AGENT_PROMPT_LENGTH = 4000;
export const MAX_AGENT_ANSWER_LENGTH = 1000;
export const MAX_AGENT_SELECTION = 12;

export interface AgentChoice {
  provider: string;
  model: string;
  cloud: boolean;
  label?: string;
}

export interface AgentSettings {
  enabled: boolean;
  provider?: string;
  model?: string;
  choices: AgentChoice[];
  organizationId?: string;
  canConfigure: boolean;
  allowBoardContext: boolean;
}

export type AgentSettingsInput = Pick<AgentSettings, 'enabled' | 'provider' | 'model' | 'allowBoardContext'>;

export interface AgentProposal {
  title: string;
  summary?: string;
  question?: string;
  groups?: { title: string; items: string[] }[] | null;
  nodes?: { id: string; label: string }[] | null;
  edges?: { from: string; to: string; label?: string }[] | null;
}

export interface AgentPreview {
  pageId: string;
  placement: AgentPlacement;
  operations: DocumentMutation[];
}

export interface AgentExternalReply {
  source: string;
  markdown: string;
}

export interface AgentConversation {
  prompt: string;
  question?: string;
  answer?: string;
}

export interface AgentApplyResult {
  ack: DocumentAck;
  pageId: string;
}

interface AgentResult {
  proposal?: AgentProposal;
  externalReply?: AgentExternalReply;
}

interface AgentDraftResult extends AgentResult {
  preview?: AgentPreview;
  usage?: unknown;
}

export interface SharedAgentRun {
  id: string;
  boardId: string;
  status: AgentRunStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  conversation?: AgentConversation;
  shared?: boolean;
  provider: string;
  model: string;
  workflow: AgentWorkflow;
  result?: AgentResult;
}

export type AgentRun = Omit<Job<AgentDraftResult>, 'status'> & SharedAgentRun & {
  result?: AgentDraftResult;
  placement: AgentPlacement;
  pageId: string;
  applied?: AgentApplyResult;
};

export interface AgentStartRequest {
  requestId: string;
  provider: string;
  model: string;
  workflow: AgentWorkflow;
  prompt: string;
  selectedIds?: string[];
  cloudConsent?: boolean;
  placement: AgentPlacement;
  pageId?: string;
}

const boardPath = (boardId: string) => '/api/v2/boards/' + encodeURIComponent(boardId);
const runsPath = (boardId: string) => boardPath(boardId) + '/agent-runs';
const runPath = (boardId: string, runId: string) => runsPath(boardId) + '/' + encodeURIComponent(runId);

export function getAgentSettings(boardId: string, signal?: AbortSignal) {
  return request<AgentSettings>(boardPath(boardId) + '/agent/settings', { signal, cache: 'no-store' });
}

export function configureAgent(boardId: string, input: AgentSettingsInput) {
  return request<AgentSettings>(boardPath(boardId) + '/agent/settings', { method: 'PUT', body: JSON.stringify(input) });
}

export async function listAgentRuns(boardId: string, signal?: AbortSignal) {
  const response = await request<{ runs: AgentRun[] }>(runsPath(boardId), { signal, cache: 'no-store' });
  return response.runs ?? [];
}

export function startAgentRun(boardId: string, input: AgentStartRequest) {
  return request<AgentRun>(runsPath(boardId), { method: 'POST', body: JSON.stringify(input) });
}

export function getAgentRun(boardId: string, runId: string, signal?: AbortSignal) {
  return request<AgentRun>(runPath(boardId, runId), { signal, cache: 'no-store' });
}

export function changeAgentRun(boardId: string, runId: string, action: AgentRunAction) {
  return request<AgentRun>(runPath(boardId, runId) + '/' + action, { method: 'POST' });
}

export function getSharedAgentRun(boardId: string, runId: string, signal?: AbortSignal) {
  return request<SharedAgentRun>(runPath(boardId, runId) + '/shared', { signal, cache: 'no-store' });
}

export function setAgentRunSharing(boardId: string, runId: string, shared: boolean) {
  return request<AgentRun>(runPath(boardId, runId) + '/share', { method: 'PUT', body: JSON.stringify({ shared }) });
}

export function conversationLink(boardId: string, runId: string) {
  const url = new URL('/board/' + encodeURIComponent(boardId), window.location.origin);
  url.searchParams.set('conversation', runId);
  return url.toString();
}

export function answerAgentRun(boardId: string, runId: string, revision: number, answer: string) {
  return request<AgentRun>(runPath(boardId, runId) + '/answer', { method: 'POST', body: JSON.stringify({ revision, answer }) });
}

export function applyAgentRun(boardId: string, runId: string, revision: number, clientId: string) {
  return request<AgentApplyResult>(runPath(boardId, runId) + '/apply', { method: 'POST', body: JSON.stringify({ revision, clientId }) });
}

export function agentRunActive(run: Pick<AgentRun, 'status'>) {
  return run.status === 'queued' || run.status === 'running';
}

export async function streamAgentRun(
  boardId: string,
  runId: string,
  lastEventId: string,
  signal: AbortSignal,
  onState: (run: AgentRun) => boolean,
) {
  const response = await requestResponse(runPath(boardId, runId) + '/events', {
    signal,
    cache: 'no-store',
    headers: { Accept: 'text/event-stream', 'Last-Event-ID': lastEventId },
  });
  const contentType = response.headers.get('Content-Type');
  if (!response.body || !contentType?.startsWith('text/event-stream')) {
    throw new Error('Live draft updates are unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const maxEventChars = 1024 * 1024;
  let buffer = '';
  let eventType = '';
  let dataLines: string[] = [];
  let dataLength = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let next = buffer.indexOf('\n');
      while (next !== -1) {
        const line = buffer.slice(0, next).replace(/\r$/, '');
        buffer = buffer.slice(next + 1);
        if (line === '') {
          if (eventType === 'state' && dataLines.length) {
            const run: AgentRun = JSON.parse(dataLines.join('\n'));
            if (run.id !== runId || !Number.isSafeInteger(run.revision)) {
              throw new Error('Live draft updates returned an invalid state.');
            }
            if (!onState(run)) return;
          }
          eventType = '';
          dataLines = [];
          dataLength = 0;
        } else {
          const separator = line.indexOf(':');
          const field = separator < 0 ? line : line.slice(0, separator);
          const fieldValue = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
          if (field === 'event') eventType = fieldValue;
          if (field === 'data') {
            dataLength += fieldValue.length + 1;
            if (dataLength > maxEventChars) throw new Error('Live draft update is too large.');
            dataLines.push(fieldValue);
          }
        }
        next = buffer.indexOf('\n');
      }
      if (buffer.length > maxEventChars) throw new Error('Live draft update is too large.');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
