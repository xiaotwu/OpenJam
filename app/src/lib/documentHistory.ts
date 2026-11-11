import {
  applyCanonicalMutation, applyPendingMutation,
  type BoardDocument, type BoardEntity, type DocumentDelta, type DocumentMutation,
} from './boardSyncProtocol';

type Fields = Record<string, unknown>;
type HistoryPlan = { operations: DocumentMutation[] } | { reason: string };

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) || Array.isArray(right)) return false;
  const fields = left as Fields;
  const other = right as Fields;
  const keys = Object.keys(fields);
  return keys.length === Object.keys(other).length
    && keys.every((key) => Object.hasOwn(other, key) && jsonEqual(fields[key], other[key]));
}

function recordFields(record: BoardEntity): Fields {
  return { ...record };
}

function undoPatch(
  mutation: Extract<DocumentMutation, { kind: 'patch' }>,
  previous: Fields,
  next: Fields,
  removeAfterPatch: boolean,
): HistoryPlan {
  for (const [key, expected] of Object.entries(mutation.expected ?? {})) {
    const current = Object.hasOwn(previous, key) ? previous[key] : null;
    if (!jsonEqual(current, expected)) return { reason: `The ${key} field has changed.` };
  }

  const fields: Fields = {};
  const expected: Fields = {};
  const unset: string[] = [];
  const keys = new Set([...Object.keys(mutation.fields ?? {}), ...(mutation.unset ?? [])]);
  for (const key of keys) {
    // Bookkeeping timestamps change on unrelated edits to the same object.
    // Restore them only when this batch also reverses the object's creation.
    if (key === 'updatedAt' && !removeAfterPatch) continue;
    const before = Object.hasOwn(previous, key) ? previous[key] : undefined;
    const after = Object.hasOwn(next, key) ? next[key] : undefined;
    if (jsonEqual(before, after)) continue;
    if (before === undefined) unset.push(key);
    else fields[key] = before;
    if (key !== 'updatedAt') expected[key] = after ?? null;
  }
  if (!Object.keys(fields).length && !unset.length) return { operations: [] };
  return { operations: [{
    kind: 'patch', collection: mutation.collection, id: mutation.id, fields, expected,
    ...(unset.length ? { unset } : {}),
  }] };
}

/**
 * Derive one inverse batch from the document the editor acted on. Replay uses
 * the same check against the latest projection before queueing a guarded batch.
 */
export function invertDocumentMutations(
  before: BoardDocument,
  mutations: DocumentMutation[],
  actorId: string,
  committed?: DocumentDelta[],
): HistoryPlan {
  if (mutations.some((mutation) => mutation.kind === 'vote')) return { operations: [] };
  const groups: DocumentMutation[][] = [];
  const added = new Set<string>();
  let deltaIndex = 0;
  let document = before;
  for (const mutation of mutations) {
    let next = applyPendingMutation(document, mutation, actorId);
    if (committed && mutation.kind !== 'setDefaultPage') {
      const delta = committed[deltaIndex++];
      if (mutation.kind === 'rename' ? delta?.kind === 'rename'
        : delta && delta.kind !== 'rename' && delta.collection === mutation.collection && delta.id === mutation.id) {
        next = applyCanonicalMutation(next, delta);
      }
    }
    const inverse = invertOne(document, next, mutation, added);
    if ('reason' in inverse) return inverse;
    groups.push(inverse.operations);
    document = next;
  }
  return { operations: groups.reverse().flat() };
}

function invertOne(
  before: BoardDocument,
  after: BoardDocument,
  mutation: DocumentMutation,
  added: Set<string>,
): HistoryPlan {
  if (mutation.kind === 'vote') return { operations: [] };
  if (mutation.kind === 'rename') {
    if (mutation.expected.name !== before.name) return { reason: 'The board name has changed.' };
    return { operations: before.name === after.name ? [] : [{
      kind: 'rename', value: before.name, expected: { name: after.name },
    }] };
  }
  if (mutation.kind === 'setDefaultPage') {
    if (mutation.expected.defaultPageId !== before.defaultPageId) return { reason: 'The starting page has changed.' };
    if (!before.pages.some((page) => page.id === mutation.value)) return { reason: 'The starting page no longer exists.' };
    return { operations: before.defaultPageId === after.defaultPageId ? [] : [{
      kind: 'setDefaultPage', value: before.defaultPageId, expected: { defaultPageId: after.defaultPageId },
    }] };
  }

  const { collection, id } = mutation;
  const position = before[collection].findIndex((record) => record.id === id);
  const record = before[collection][position];
  const key = `${collection}/${id}`;
  if (mutation.kind === 'add' || mutation.kind === 'restore') {
    if (record) return { reason: 'An item with the same ID already exists.' };
    const inserted = after[collection].find((item) => item.id === id);
    if (!inserted) return { reason: 'The inserted item is unavailable.' };
    added.add(key);
    return { operations: [{ kind: 'delete', collection, id, expected: recordFields(inserted) }] };
  }
  if (!record) return { reason: 'An item in this action no longer exists.' };
  if (mutation.kind === 'patch') {
    const next = after[collection].find((item) => item.id === id);
    return next ? undoPatch(mutation, recordFields(record), recordFields(next), added.has(key))
      : { reason: 'An item in this action no longer exists.' };
  }
  if (mutation.kind === 'reorder') {
    if (!jsonEqual(before.pages.map((page) => page.id), mutation.expected.order)) return { reason: 'The page order has changed.' };
    const order = after.pages.map((page) => page.id);
    return { operations: order[position] === id ? [] : [{ kind: 'reorder', collection: 'pages', id, position, expected: { order } }] };
  }

  if (mutation.kind === 'delete' && mutation.expected && !jsonEqual(record, mutation.expected)) {
    return { reason: 'An item in this action has changed.' };
  }
  if (collection === 'pages') {
    if (before.pages.length === 1) return { reason: 'The board needs at least one page.' };
    if (before.elements.some((element) => element.pageId === id) || before.stamps.some((stamp) => stamp.pageId === id)) {
      return { reason: 'The page contains newer items.' };
    }
  }
  added.delete(key);
  const operations: DocumentMutation[] = [{
    kind: 'restore', collection, id, value: record, ...(collection === 'pages' ? { position } : {}),
  }];
  if (before.defaultPageId !== after.defaultPageId) operations.push({
    kind: 'setDefaultPage', value: before.defaultPageId, expected: { defaultPageId: after.defaultPageId },
  });
  return { operations };
}
