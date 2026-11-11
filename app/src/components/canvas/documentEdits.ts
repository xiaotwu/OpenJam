import type { DocumentMutation } from '../../lib/boardSync';
import type { Element } from '../../lib/elements';
import type { ElementOperation } from '../../lib/elementStore';

export type DocumentPatch = Extract<DocumentMutation, { kind: 'patch' }>;

const immutableFields = new Set(['id', 'type', 'createdBy', 'createdAt', 'userId', 'widgetType']);
const guardedFields = new Set(['text', 'name', 'widgetData']);
const geometryFields = new Set([
  'x', 'y', 'width', 'height', 'rotation', 'startPoint', 'endPoint', 'controlPoints', 'updatedAt',
]);

export const MAX_BATCH_OPERATIONS = 256;

export function fitsDocumentBatch(mutations: DocumentMutation[]): boolean {
  return mutations.length <= MAX_BATCH_OPERATIONS && new Blob([JSON.stringify(mutations)]).size <= 25 * 1024 * 1024 - 2048;
}

export function isGeometryPatch(mutation: DocumentMutation): mutation is DocumentPatch {
  return mutation.kind === 'patch'
    && !mutation.expected
    && !mutation.unset?.length
    && Object.keys(mutation.fields ?? {}).every(field => geometryFields.has(field));
}

export function elementMutation(
  op: ElementOperation,
  current?: Element,
  previous?: Element,
): DocumentMutation | undefined {
  const target = { collection: 'elements' as const, id: op.elementId };
  if (op.opType === 'add') {
    return { ...target, kind: op.restore ? 'restore' : 'add', value: op.element };
  }
  if (op.opType === 'delete') {
    return { ...target, kind: 'delete', ...(op.expected ? { expected: { ...op.expected } } : {}) };
  }

  const fields: Record<string, unknown> = { updatedAt: op.timestamp };
  const expected: Record<string, unknown> = {};
  const unset: string[] = [];
  switch (op.opType) {
    case 'update':
      for (const [field, value] of Object.entries(op.changes)) {
        if (immutableFields.has(field)) continue;
        if (value === undefined) unset.push(field);
        else fields[field] = value;
        if (guardedFields.has(field)) {
          const before = previous as unknown as Record<string, unknown> | undefined;
          expected[field] = op.expected && Object.hasOwn(op.expected, field) ? op.expected[field] : before?.[field] ?? null;
        }
      }
      break;
    case 'move':
      fields.x = op.x;
      fields.y = op.y;
      if (current?.type === 'connector') {
        fields.startPoint = current.startPoint;
        fields.endPoint = current.endPoint;
        if (current.controlPoints) fields.controlPoints = current.controlPoints;
      }
      break;
    case 'resize':
      fields.width = op.width;
      fields.height = op.height;
      if (op.x !== undefined) fields.x = op.x;
      if (op.y !== undefined) fields.y = op.y;
      break;
    case 'reorder':
      fields.zIndex = op.zIndex;
      break;
    case 'lock':
      fields.locked = op.locked;
      break;
    default:
      return undefined;
  }
  return {
    ...target,
    kind: 'patch',
    fields,
    ...(unset.length ? { unset } : {}),
    ...(Object.keys(expected).length ? { expected } : {}),
  };
}
