export type ElementType =
  | 'sticky'
  | 'shape'
  | 'text'
  | 'connector'
  | 'drawing'
  | 'image'
  | 'frame'
  | 'widget';

export type WidgetType =
  | 'table'
  | 'timer'
  | 'stopwatch'
  | 'poll'
  | 'kanban'
  | 'retro'
  | 'mood-meter'
  | 'random-picker'
  | 'question-card'
  | 'dot-voting'
  | 'reaction-counter';

export type ShapeType =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'circle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'star'
  | 'hexagon';

export type StickyColor =
  | 'yellow'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'blue'
  | 'green'
  | 'gray';

export type ConnectorStyle =
  | 'straight'
  | 'elbow'
  | 'curved';

export type ArrowHead =
  | 'none'
  | 'arrow'
  | 'circle'
  | 'diamond';

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  locked: boolean;
  opacity: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface StickyElement extends BaseElement {
  type: 'sticky';
  text: string;
  color: StickyColor;
  fontSize: number;
  textAlign: 'left' | 'center' | 'right';
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text?: string;
  fontSize?: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  backgroundColor?: string;
}

export interface ConnectorElement extends BaseElement {
  type: 'connector';
  style: ConnectorStyle;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  controlPoints?: { x: number; y: number }[];
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  stroke: string;
  strokeWidth: number;
  startElementId?: string;
  startAnchor?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  endElementId?: string;
  endAnchor?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export interface DrawingElement extends BaseElement {
  type: 'drawing';
  points: { x: number; y: number }[];
  stroke: string;
  strokeWidth: number;
  isEraser: boolean;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  originalWidth: number;
  originalHeight: number;
  objectFit: 'contain' | 'cover' | 'fill';
}

export interface FrameElement extends BaseElement {
  type: 'frame';
  name: string;
  backgroundColor: string;
  showName: boolean;
  childIds: string[];
}

export interface WidgetElement extends BaseElement {
  type: 'widget';
  widgetType: WidgetType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  widgetData: Record<string, any>;
}

export type Element =
  | StickyElement
  | ShapeElement
  | TextElement
  | ConnectorElement
  | DrawingElement
  | ImageElement
  | FrameElement
  | WidgetElement;

export type ReactionType =
  | '👍' | '👎' | '❤️' | '🎉' | '🔥'
  | '⭐' | '✅' | '❌' | '❓' | '💡';

export interface Reaction {
  id: string;
  type: ReactionType;
  x: number;
  y: number;
  userId: string;
  createdAt: number;
}

export interface Comment {
  id: string;
  text: string;
  x: number;
  y: number;
  userId: string;
  userName: string;
  userColor: string;
  createdAt: number;
  resolved: boolean;
  replies: CommentReply[];
}

export interface CommentReply {
  id: string;
  text: string;
  userId: string;
  userName: string;
  createdAt: number;
}

export const DEFAULT_DIMENSIONS: Record<ElementType, { width: number; height: number }> = {
  sticky: { width: 200, height: 200 },
  shape: { width: 120, height: 120 },
  text: { width: 200, height: 40 },
  connector: { width: 100, height: 0 },
  drawing: { width: 0, height: 0 },
  image: { width: 300, height: 200 },
  frame: { width: 400, height: 300 },
  widget: { width: 300, height: 250 },
};

export const WIDGET_DIMENSIONS: Record<WidgetType, { width: number; height: number }> = {
  table: { width: 400, height: 250 },
  timer: { width: 200, height: 280 },
  stopwatch: { width: 200, height: 200 },
  poll: { width: 320, height: 300 },
  kanban: { width: 600, height: 400 },
  retro: { width: 650, height: 400 },
  'mood-meter': { width: 400, height: 400 },
  'random-picker': { width: 300, height: 350 },
  'question-card': { width: 320, height: 220 },
  'dot-voting': { width: 350, height: 300 },
  'reaction-counter': { width: 280, height: 120 },
};

export const STICKY_COLORS: Record<StickyColor, { bg: string; text: string }> = {
  yellow: { bg: '#FEF3C7', text: '#92400E' },
  orange: { bg: '#FFEDD5', text: '#9A3412' },
  pink: { bg: '#FCE7F3', text: '#9D174D' },
  purple: { bg: '#EDE9FE', text: '#5B21B6' },
  blue: { bg: '#DBEAFE', text: '#1E40AF' },
  green: { bg: '#D1FAE5', text: '#065F46' },
  gray: { bg: '#F3F4F6', text: '#374151' },
};

export const SHAPE_COLORS = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#06B6D4',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#6B7280',
  '#1F2937',
  '#FFFFFF',
  'transparent',
];

export function generateElementId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function createDefaultElement(
  type: ElementType,
  x: number,
  y: number,
  userId: string
): Element {
  const now = Date.now();
  const { width, height } = DEFAULT_DIMENSIONS[type];

  const base: BaseElement = {
    id: generateElementId(),
    type,
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex: now,
    locked: false,
    opacity: 1,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  switch (type) {
    case 'sticky':
      return {
        ...base,
        type: 'sticky',
        text: '',
        color: 'yellow',
        fontSize: 16,
        textAlign: 'center',
      } as StickyElement;

    case 'shape':
      return {
        ...base,
        type: 'shape',
        shapeType: 'rectangle',
        fill: '#FFFFFF',
        stroke: '#374151',
        strokeWidth: 2,
      } as ShapeElement;

    case 'text':
      return {
        ...base,
        type: 'text',
        text: 'Text',
        fontFamily: 'Inter, sans-serif',
        fontSize: 24,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#1F2937',
        textAlign: 'left',
      } as TextElement;

    case 'connector':
      return {
        ...base,
        type: 'connector',
        style: 'straight',
        startPoint: { x, y },
        endPoint: { x: x + 100, y },
        startArrow: 'none',
        endArrow: 'arrow',
        stroke: '#6B7280',
        strokeWidth: 2,
      } as ConnectorElement;

    case 'drawing':
      return {
        ...base,
        type: 'drawing',
        points: [],
        stroke: '#1F2937',
        strokeWidth: 3,
        isEraser: false,
      } as DrawingElement;

    case 'image':
      return {
        ...base,
        type: 'image',
        src: '',
        originalWidth: 0,
        originalHeight: 0,
        objectFit: 'contain',
      } as ImageElement;

    case 'frame':
      return {
        ...base,
        type: 'frame',
        name: 'Frame',
        backgroundColor: '#FFFFFF',
        showName: true,
        childIds: [],
      } as FrameElement;

    case 'widget':
      return {
        ...base,
        type: 'widget',
        widgetType: 'timer',
        widgetData: {},
      } as WidgetElement;

    default:
      throw new Error(`Unknown element type: ${type}`);
  }
}

export function getElementBounds(element: Element): {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} {
  const { x, y, width, height } = element;
  return {
    x,
    y,
    width,
    height,
    centerX: x + width / 2,
    centerY: y + height / 2,
  };
}

export function isPointInElement(
  px: number,
  py: number,
  element: Element,
  padding = 0
): boolean {
  const { x, y, width, height } = element;
  return (
    px >= x - padding &&
    px <= x + width + padding &&
    py >= y - padding &&
    py <= y + height + padding
  );
}

export function getAnchorPoint(
  element: Element,
  anchor: 'top' | 'bottom' | 'left' | 'right' | 'center'
): { x: number; y: number } {
  const bounds = getElementBounds(element);

  switch (anchor) {
    case 'top':
      return { x: bounds.centerX, y: bounds.y };
    case 'bottom':
      return { x: bounds.centerX, y: bounds.y + bounds.height };
    case 'left':
      return { x: bounds.x, y: bounds.centerY };
    case 'right':
      return { x: bounds.x + bounds.width, y: bounds.centerY };
    case 'center':
    default:
      return { x: bounds.centerX, y: bounds.centerY };
  }
}
