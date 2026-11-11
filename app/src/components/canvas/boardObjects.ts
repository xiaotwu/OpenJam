import { generateElementId, type ConnectorElement, type Element } from '../../lib/elements';

export type Point = { x: number; y: number };
export type Bounds = { left: number; top: number; right: number; bottom: number };
type Anchor = NonNullable<ConnectorElement['startAnchor']>;

function boundsFromPoints(points: Point[]): Bounds {
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const point of points) {
    bounds.left = Math.min(bounds.left, point.x);
    bounds.top = Math.min(bounds.top, point.y);
    bounds.right = Math.max(bounds.right, point.x);
    bounds.bottom = Math.max(bounds.bottom, point.y);
  }
  return bounds;
}

function rotate(point: Point, center: Point, angle: number): Point {
  const radians = angle * Math.PI / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

export function elementBounds(element: Element): Bounds {
  if (element.type === 'connector') {
    const points = [element.startPoint, element.endPoint, ...(element.controlPoints ?? [])];
    if (element.style === 'curved' && !element.controlPoints?.length) {
      const { startPoint: a, endPoint: b } = element;
      points.push({ x: (a.x + b.x) / 2 - (b.y - a.y) * 0.3, y: (a.y + b.y) / 2 + (b.x - a.x) * 0.3 });
    }
    return expandBounds(boundsFromPoints(points), Math.max(element.strokeWidth, 4));
  }
  if (element.type === 'drawing' && element.points.length) {
    const bounds = boundsFromPoints(element.points);
    return expandBounds({
      left: bounds.left + element.x, right: bounds.right + element.x,
      top: bounds.top + element.y, bottom: bounds.bottom + element.y,
    }, element.strokeWidth / 2);
  }
  const { x, y, rotation, width = 100, height = 100 } = element;
  if (!rotation) return { left: x, top: y, right: x + width, bottom: y + height };
  const center = { x: x + width / 2, y: y + height / 2 };
  return boundsFromPoints([{ x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height }]
    .map(point => rotate(point, center, rotation)));
}

export function expandBounds(bounds: Bounds, margin: number): Bounds {
  return { left: bounds.left - margin, top: bounds.top - margin, right: bounds.right + margin, bottom: bounds.bottom + margin };
}

export function withinBounds(outer: Bounds, inner: Bounds): boolean {
  return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
}

export function overlapsBounds(a: Bounds, b: Bounds): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function anchorPoint(element: Element, anchor: Anchor): Point {
  const { x, y, width, height } = element;
  const center = { x: x + width / 2, y: y + height / 2 };
  const sides: Record<Anchor, Point> = {
    center, left: { x, y: center.y }, right: { x: x + width, y: center.y },
    top: { x: center.x, y }, bottom: { x: center.x, y: y + height },
  };
  return rotate(sides[anchor], center, element.rotation || 0);
}

export function resolveConnector(element: Element, byId: ReadonlyMap<string, Element>): Element {
  if (element.type !== 'connector' || (!element.startElementId && !element.endElementId)) return element;
  const start = element.startElementId ? byId.get(element.startElementId) : undefined;
  const end = element.endElementId ? byId.get(element.endElementId) : undefined;
  return {
    ...element,
    startPoint: start && start.pageId === element.pageId ? anchorPoint(start, element.startAnchor ?? 'center') : element.startPoint,
    endPoint: end && end.pageId === element.pageId ? anchorPoint(end, element.endAnchor ?? 'center') : element.endPoint,
  };
}

export function findAnchor(elements: Element[], point: Point, tolerance: number) {
  const hit = { left: point.x, top: point.y, right: point.x, bottom: point.y };
  let target: Element | undefined;
  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index];
    if (element.type === 'connector' || element.type === 'drawing' || element.type === 'frame') continue;
    if (overlapsBounds(expandBounds(elementBounds(element), tolerance), hit)) {
      target = element;
      break;
    }
  }
  if (!target) return undefined;
  const anchors: Anchor[] = ['top', 'right', 'bottom', 'left'];
  const distance = (at: Point) => Math.hypot(at.x - point.x, at.y - point.y);
  const name = anchors.reduce((closest, anchor) => distance(anchorPoint(target, anchor)) < distance(anchorPoint(target, closest)) ? anchor : closest);
  return { id: target.id, name, point: anchorPoint(target, name) };
}

export function selectionGroup(elements: Element[], id: string): string[] {
  const element = elements.find(item => item.id === id);
  return element?.groupId ? elements.filter(item => item.groupId === element.groupId).map(item => item.id) : [id];
}

export function movementSelection(elements: Element[], selected: ReadonlySet<string>): Element[] {
  const byId = new Map(elements.map(element => [element.id, element]));
  const groups = new Map<string, string[]>();
  for (const element of elements) {
    if (!element.groupId) continue;
    const members = groups.get(element.groupId) ?? [];
    members.push(element.id);
    groups.set(element.groupId, members);
  }
  const ids = new Set(selected);
  const expandedGroups = new Set<string>();
  for (const id of ids) {
    const element = byId.get(id);
    if (element?.groupId && !expandedGroups.has(element.groupId)) {
      expandedGroups.add(element.groupId);
      for (const member of groups.get(element.groupId) ?? []) ids.add(member);
    }
    if (element?.type === 'frame') for (const child of element.childIds ?? []) ids.add(child);
  }
  return elements.filter(element => ids.has(element.id));
}

export function pageMoveSelection(elements: Element[], selected: ReadonlySet<string>): Element[] | undefined {
  let moving = movementSelection(elements, selected);
  const available = new Set(elements.map(element => element.id));
  const links = (connector: ConnectorElement) => [connector.startElementId, connector.endElementId]
    .filter((id): id is string => Boolean(id && available.has(id)));
  let ids = new Set(moving.map(element => element.id));
  const addConnectors = () => elements.filter(element => {
    if (element.type !== 'connector' || ids.has(element.id)) return false;
    const attached = links(element);
    return attached.length > 0 && attached.every(id => ids.has(id));
  });
  for (let added = addConnectors(); added.length; added = addConnectors()) {
    moving = movementSelection(elements, new Set([...ids, ...added.map(element => element.id)]));
    ids = new Set(moving.map(element => element.id));
  }
  if (moving.some(element => element.locked)) return undefined;
  const keepsRelationships = elements.every(element => {
    const related = element.type === 'frame' ? (element.childIds ?? []).filter(id => available.has(id))
      : element.type === 'connector' ? links(element) : [];
    return related.every(id => ids.has(element.id) === ids.has(id));
  });
  return keepsRelationships ? moving : undefined;
}

export function copyBoardElements(elements: Element[], options: {
  userId: string;
  pageId?: string;
  offset?: number;
  firstZIndex?: number;
}): Element[] {
  const ids = new Map(elements.map(element => [element.id, generateElementId()]));
  const groups = new Map<string, string>();
  const now = Date.now();
  const offset = options.offset ?? 0;
  const translate = (point: Point): Point => ({ x: point.x + offset, y: point.y + offset });
  const byId = new Map(elements.map(element => [element.id, element]));
  return elements.map((original, index) => {
    const element = resolveConnector(original, byId);
    const copy: Element = {
      ...element, id: ids.get(element.id)!, createdBy: options.userId, createdAt: now, updatedAt: now,
      x: element.x + offset, y: element.y + offset,
    };
    if (options.pageId) copy.pageId = options.pageId;
    if (options.firstZIndex !== undefined) copy.zIndex = options.firstZIndex + index;
    if (copy.groupId) {
      if (!groups.has(copy.groupId)) groups.set(copy.groupId, generateElementId());
      copy.groupId = groups.get(copy.groupId);
    }
    if (copy.type === 'frame') copy.childIds = (copy.childIds ?? []).flatMap(id => ids.get(id) ?? []);
    if (copy.type === 'connector') {
      copy.startPoint = translate(copy.startPoint);
      copy.endPoint = translate(copy.endPoint);
      if (copy.controlPoints) copy.controlPoints = copy.controlPoints.map(translate);
      copy.startElementId = copy.startElementId ? ids.get(copy.startElementId) : undefined;
      copy.endElementId = copy.endElementId ? ids.get(copy.endElementId) : undefined;
      if (!copy.startElementId) delete copy.startAnchor;
      if (!copy.endElementId) delete copy.endAnchor;
    }
    return copy;
  });
}
