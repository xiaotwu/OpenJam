import { describe, expect, it } from 'vitest';
import { createDefaultElement, type ConnectorElement, type FrameElement } from '../../lib/elements';
import { copyBoardElements, elementBounds, pageMoveSelection, resolveConnector } from './boardObjects';

function linkedObjects() {
  const first = { ...createDefaultElement('sticky', 20, 30, 'author'), id: 'first', pageId: 'page-a', groupId: 'group-a' };
  const second = { ...createDefaultElement('shape', 300, 80, 'author'), id: 'second', pageId: 'page-a', groupId: 'group-a' };
  const connector: ConnectorElement = {
    ...createDefaultElement('connector', 80, 80, 'author') as ConnectorElement,
    id: 'connector', pageId: 'page-a', startElementId: 'first', startAnchor: 'right', endElementId: 'second', endAnchor: 'left',
  };
  const frame: FrameElement = {
    ...createDefaultElement('frame', 0, 0, 'author') as FrameElement,
    id: 'frame', pageId: 'page-a', childIds: [first.id, second.id],
  };
  return { first, second, connector, frame };
}

describe('canvas page relationships', () => {
  it('remaps copied group, frame and connector references', () => {
    const { first, second, connector, frame } = linkedObjects();
    const [newFirst, newSecond, newConnector, newFrame] = copyBoardElements([first, second, connector, frame], {
      userId: 'another-author', pageId: 'page-b', offset: 20,
    });
    expect(newFirst.groupId).toBe(newSecond.groupId);
    expect(newFirst.groupId).not.toBe(first.groupId);
    expect(newFrame).toMatchObject({ pageId: 'page-b', childIds: [newFirst.id, newSecond.id] });
    expect(newConnector).toMatchObject({ pageId: 'page-b', startElementId: newFirst.id, endElementId: newSecond.id });
    expect(newFirst).toMatchObject({ x: 40, y: 50, createdBy: 'another-author' });
  });

  it('includes connected objects when moving a frame and rejects a split relationship', () => {
    const { first, second, connector, frame } = linkedObjects();
    const elements = [first, second, connector, frame];
    expect(pageMoveSelection(elements, new Set([frame.id]))?.map(element => element.id)).toEqual(['first', 'second', 'connector', 'frame']);
    expect(pageMoveSelection(elements, new Set([first.id]))).toBeUndefined();
    expect(pageMoveSelection([first, { ...second, locked: true }, connector, frame], new Set([frame.id]))).toBeUndefined();
  });

  it('uses live anchors for viewport bounds and keeps the recorded endpoint when the target is gone', () => {
    const { first, second, connector } = linkedObjects();
    const resolved = resolveConnector(connector, new Map([[first.id, first], [second.id, second]]));
    expect(resolved).toMatchObject({ startPoint: { x: first.x + first.width, y: first.y + first.height / 2 }, endPoint: { x: second.x, y: second.y + second.height / 2 } });
    expect(elementBounds(resolved).right).toBeGreaterThan(second.x);
    expect(resolveConnector(connector, new Map([[first.id, first]]))).toMatchObject({ endPoint: connector.endPoint });
  });
});
