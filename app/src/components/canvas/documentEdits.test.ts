import { describe, expect, it } from 'vitest';
import { ElementStore } from '../../lib/elementStore';
import { elementMutation, isGeometryPatch } from './documentEdits';

describe('editor document mutations', () => {
  it('keeps the text editor baseline and serializes an unset field separately', () => {
    const store = new ElementStore('user-a');
    store.setEditingContext(true, 'page-a');
    const { element } = store.addElement('sticky', 10, 20, { text: 'Updated remotely' });
    store.on('operation', (operation, previous) => {
      const mutation = elementMutation(operation, store.getElementById(element.id), previous);
      expect(mutation).toMatchObject({
        kind: 'patch',
        collection: 'elements',
        id: element.id,
        fields: { text: 'Local draft' },
        unset: ['groupId'],
        expected: { text: 'Before remote edit' },
      });
      expect(mutation && isGeometryPatch(mutation)).toBe(false);
    });
    const changes = { text: 'Local draft', groupId: undefined };
    store.updateElement(element.id, changes, { text: 'Before remote edit' });
  });

  it('moves the connector endpoints with the element as one geometry patch', () => {
    const store = new ElementStore('user-a');
    store.setEditingContext(true, 'page-a');
    const { element } = store.addElement('connector', 10, 20, {
      startPoint: { x: 10, y: 20 },
      endPoint: { x: 40, y: 50 },
    });
    const operation = store.moveElement(element.id, 20, 40);
    const mutation = elementMutation(operation!, store.getElementById(element.id));
    expect(mutation && isGeometryPatch(mutation)).toBe(true);
    expect(mutation).toMatchObject({
      fields: { x: 20, y: 40, startPoint: { x: 20, y: 40 }, endPoint: { x: 50, y: 70 } },
    });
  });
});
