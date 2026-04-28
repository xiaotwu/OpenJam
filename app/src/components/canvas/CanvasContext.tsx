/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useRef, useState, useCallback, type RefObject } from 'react';
import { ElementStore } from '../../lib/elementStore';
import type { Element } from '../../lib/elements';
import type { ToolType, ShapeType, StickyColor, ConnectorStyle, ArrowHead, EraserMode } from '../BottomToolbar';

export interface ToolOptions {
  stickyColor: StickyColor;
  stickyShape: 'square' | 'rounded' | 'circle';
  shapeType: ShapeType;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  fontSize: number;
  connectorStyle: ConnectorStyle;
  arrowStart: ArrowHead;
  arrowEnd: ArrowHead;
  eraserMode: EraserMode;
  eraserSize: number;
}

export interface CanvasContextValue {
  // Refs
  containerRef: RefObject<HTMLDivElement | null>;
  elementStoreRef: RefObject<ElementStore>;

  // Element state
  elements: Element[];
  setElements: React.Dispatch<React.SetStateAction<Element[]>>;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  editingId: string | null;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  clipboard: Element[];
  setClipboard: React.Dispatch<React.SetStateAction<Element[]>>;

  // View state
  offset: { x: number; y: number };
  setOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  scale: number;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  showGrid: boolean;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;

  // Tool state
  currentTool: ToolType;
  setCurrentTool: React.Dispatch<React.SetStateAction<ToolType>>;
  toolOptions: ToolOptions;
  setToolOptions: React.Dispatch<React.SetStateAction<ToolOptions>>;
  selectedColor: string;
  setSelectedColor: React.Dispatch<React.SetStateAction<string>>;

  // Derived helpers
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number };
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasContext(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error('useCanvasContext must be used within CanvasProvider');
  return ctx;
}

export interface CanvasProviderProps {
  userId: string;
  children: React.ReactNode;
}

export function CanvasProvider({ userId, children }: CanvasProviderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Lazy initialization to avoid creating a new ElementStore on every render
  const elementStoreRef = useRef<ElementStore>(null!);
  if (elementStoreRef.current === null) {
    elementStoreRef.current = new ElementStore(userId);
  }

  // Element state
  const [elements, setElements] = useState<Element[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Element[]>([]);

  // View state
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [showGrid, setShowGrid] = useState(true);

  // Tool state
  const [currentTool, setCurrentTool] = useState<ToolType>('select');
  const [toolOptions, setToolOptions] = useState<ToolOptions>({
    stickyColor: 'yellow',
    stickyShape: 'square',
    shapeType: 'rectangle',
    strokeColor: '#000000',
    strokeWidth: 2,
    fillColor: '#ffffff',
    fontSize: 16,
    connectorStyle: 'straight',
    arrowStart: 'none',
    arrowEnd: 'arrow',
    eraserMode: 'stroke',
    eraserSize: 20,
  });
  const [selectedColor, setSelectedColor] = useState('#000000');

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      return {
        x: (screenX - rect.left - offset.x) / scale,
        y: (screenY - rect.top - offset.y) / scale,
      };
    },
    [offset, scale]
  );

  const value: CanvasContextValue = {
    containerRef, elementStoreRef,
    elements, setElements, selectedIds, setSelectedIds, editingId, setEditingId, clipboard, setClipboard,
    offset, setOffset, scale, setScale, showGrid, setShowGrid,
    currentTool, setCurrentTool, toolOptions, setToolOptions, selectedColor, setSelectedColor,
    screenToCanvas,
  };

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}
