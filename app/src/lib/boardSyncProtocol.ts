import type { Page } from '../components/PagesPanel';
import type { Stamp } from '../components/StampTool';
import type { Element } from './elements';
import type { WidgetVoteAction } from './workshopWidgets';

export type BoardElement = Element & { pageId?: string };
export type BoardStamp = Stamp & { pageId?: string };

export interface BoardDocument {
  name: string;
  defaultPageId: string;
  pages: Page[];
  elements: BoardElement[];
  stamps: BoardStamp[];
}

export type BoardCollection = 'pages' | 'elements' | 'stamps';
export type BoardEntity = Page | BoardElement | BoardStamp;

export const MAX_COMMAND_OPERATIONS = 256;

export type DocumentMutation =
  | { kind: 'add' | 'restore'; collection: BoardCollection; id: string; value: BoardEntity; position?: number }
  | { kind: 'patch'; collection: BoardCollection; id: string; fields?: Record<string, unknown>; unset?: string[]; expected?: Record<string, unknown> }
  | { kind: 'delete'; collection: BoardCollection; id: string; expected?: Record<string, unknown> }
  | { kind: 'rename'; value: string; expected: { name: string } }
  | { kind: 'reorder'; collection: 'pages'; id: string; position: number; expected: { order: string[] } }
  | { kind: 'setDefaultPage'; value: string; expected: { defaultPageId: string } }
  | { kind: 'vote'; collection: 'elements'; id: string; value: WidgetVoteAction };

export type DocumentDelta =
  | { kind: 'upsert'; collection: BoardCollection; id: string; value: BoardEntity; position?: number }
  | { kind: 'delete'; collection: BoardCollection; id: string }
  | { kind: 'rename'; value: string };

export type DocumentPermission = 'owner' | 'edit' | 'comment' | 'view';

export interface DocumentCommand {
  protocolVersion: 2;
  epoch: number;
  baseSeq: number;
  clientId: string;
  commandId: string;
  dependsOn?: string;
  operations: DocumentMutation[];
}

export interface BoardSnapshot {
  protocolVersion: 2;
  boardId: string;
  epoch: number;
  seq: number;
  hash: string;
  permission: DocumentPermission;
  updatedAt: string;
  document: BoardDocument;
}

export interface DocumentChange {
  epoch: number;
  seq: number;
  actorId?: string;
  clientId: string;
  commandId: string;
  operations: DocumentDelta[];
  defaultPageId?: string;
}

export interface DocumentChangePage {
  boardId: string;
  epoch: number;
  headSeq: number;
  floorSeq: number;
  permission: DocumentPermission;
  changes: DocumentChange[];
  hasMore: boolean;
}

export interface DocumentAck {
  boardId: string;
  epoch: number;
  seq: number;
  clientId: string;
  commandId: string;
  replayed: boolean;
  change?: DocumentChange;
}

export interface BoardTransport {
  snapshot(): Promise<BoardSnapshot>;
  changes(epoch: number, afterSeq: number): Promise<DocumentChangePage>;
  commit(body: string): Promise<DocumentAck>;
}

export function validSequence(value: number, minimum = 0): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}

export function editablePermission(permission?: DocumentPermission): boolean {
  return permission === 'owner' || permission === 'edit';
}

export function validPermission(permission: unknown): permission is DocumentPermission {
  return permission === 'owner' || permission === 'edit' || permission === 'comment' || permission === 'view';
}

function upsert(
  document: BoardDocument,
  collection: BoardCollection,
  id: string,
  value: BoardEntity,
  position?: number,
): BoardDocument {
  const records = [...document[collection]];
  const index = records.findIndex((entry) => entry.id === id);
  if (index >= 0) records.splice(index, 1);
  records.splice(position ?? (index >= 0 ? index : records.length), 0, value);
  return { ...document, [collection]: records };
}

function remove(document: BoardDocument, collection: BoardCollection, id: string): BoardDocument {
  return { ...document, [collection]: document[collection].filter((record) => record.id !== id) };
}

export function applyCanonicalChange(document: BoardDocument, change: DocumentChange): BoardDocument {
  for (const operation of change.operations) document = applyCanonicalMutation(document, operation);
  if (change.defaultPageId) document = { ...document, defaultPageId: change.defaultPageId };
  return document;
}

export function applyCanonicalMutation(document: BoardDocument, operation: DocumentDelta): BoardDocument {
  switch (operation.kind) {
    case 'rename':
      return { ...document, name: operation.value };
    case 'delete':
      return remove(document, operation.collection, operation.id);
    case 'upsert':
      return upsert(document, operation.collection, operation.id, operation.value, operation.position);
  }
}

export function applyPendingMutation(document: BoardDocument, operation: DocumentMutation, actorId?: string): BoardDocument {
  if (operation.kind === 'rename') return { ...document, name: operation.value.trim() };
  if (operation.kind === 'setDefaultPage') return { ...document, defaultPageId: operation.value };
  if (operation.kind === 'vote') return document;

  const { collection, id } = operation;
  const current = document[collection].find((record) => record.id === id);
  switch (operation.kind) {
    case 'add':
    case 'restore': {
      if (current) return document;
      if (operation.kind === 'add' && collection === 'elements') {
        const element = operation.value as BoardElement;
        return upsert(document, collection, id, {
          ...element, pageId: element.pageId ?? document.defaultPageId, createdBy: actorId ?? element.createdBy,
        });
      }
      if (operation.kind === 'add' && collection === 'stamps') {
        const stamp = operation.value as BoardStamp;
        return upsert(document, collection, id, {
          ...stamp, pageId: stamp.pageId ?? document.defaultPageId, userId: actorId ?? stamp.userId,
        });
      }
      return upsert(document, collection, id, operation.value, operation.position);
    }
    case 'delete': {
      const next = remove(document, collection, id);
      return collection === 'pages' && id === document.defaultPageId && next.pages.length
        ? { ...next, defaultPageId: next.pages[0].id }
        : next;
    }
    case 'reorder':
      return current ? upsert(document, collection, id, current, operation.position) : document;
    case 'patch': {
      if (!current) return document;
      const record = { ...current, ...operation.fields };
      for (const key of operation.unset ?? []) Reflect.deleteProperty(record, key);
      return upsert(document, collection, id, record);
    }
  }
}

export function applyPendingCommand(document: BoardDocument, command: DocumentCommand, actorId?: string): BoardDocument {
  for (const operation of command.operations) document = applyPendingMutation(document, operation, actorId);
  return document;
}
