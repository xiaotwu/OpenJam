import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

import { ElementRenderer } from './elements';
import { useAutoSave } from './canvas/hooks/useAutoSave';
import { useKeyboardShortcuts } from './canvas/hooks/useKeyboardShortcuts';
import { useClipboard } from './canvas/hooks/useClipboard';
import { useSelection } from './canvas/hooks/useSelection';
import { useDrawing } from './canvas/hooks/useDrawing';
import { useEraser } from './canvas/hooks/useEraser';
import { useDragCreate } from './canvas/hooks/useDragCreate';
import { useDragMove } from './canvas/hooks/useDragMove';
import DrawingPreview from './canvas/DrawingPreview';
import EraserCursor from './canvas/EraserCursor';
import DragCreatePreview from './canvas/DragCreatePreview';
import { ElementStore } from '../lib/elementStore';
import { useCollaboration } from '../lib/useCollaboration';
import {
  createRoom,
  deleteRoom as deleteRoomApi,
  getRoomShareSettings,
  inviteRoomMember,
  removeRoomMember,
  saveBoard,
  updateRoomShareSettings,
  type LinkPermission,
  type MemberPermission,
  type RoomMember,
} from '../lib/api';
import {
  type Element,
  type ElementType,
  type DrawingElement,
  type WidgetElement,
  type WidgetType,
  WIDGET_DIMENSIONS,
} from '../lib/elements';
import {
  TableWidget,
  TimerWidget,
  StopwatchWidget,
  PollWidget,
  KanbanWidget,
  RetroWidget,
  MoodMeterWidget,
  RandomPickerWidget,
  QuestionCardWidget,
  DotVotingWidget,
  ReactionCounterWidget,
  createDefaultPoll,
  createDefaultKanban,
  createDefaultRetro,
  createDefaultMoodMeter,
  createDefaultRandomPicker,
  createDefaultQuestionCard,
  createDefaultDotVoting,
  createDefaultReactionCounter,
} from './widgets';
import TableCreationDialog from './widgets/TableCreationDialog';
import TimerCreationDialog from './widgets/TimerCreationDialog';
import MenuBar from './MenuBar';
import { useTheme } from '../lib/useTheme';
import CommandPalette from './CommandPalette';
import ZoomControls from './ZoomControls';
import { StampElement, type Stamp } from './StampTool';
import { type Collaborator } from './CollaboratorPanel';
import ShareDialog from './ShareDialog';
import LiveCursorLayer from './collaboration/LiveCursorLayer';
import ContextMenu, {
  getElementContextMenuItems,
  getCanvasContextMenuItems,
  type ContextMenuItem,
} from './ContextMenu';
import HelpPanel from './HelpPanel';
import MultiSelectToolbar from './MultiSelectToolbar';
import BottomToolbar, {
  type ToolType,
  type ShapeType,
  type StickyColor,
  type ConnectorStyle,
  type ArrowHead,
  type EraserMode,
} from './BottomToolbar';
import VersionHistoryPanel, { generateMockVersions } from './VersionHistoryPanel';
import ImageUploadDialog from './ImageUploadDialog';
import FileInfoDialog from './FileInfoDialog';
import FloatingObjectToolbar from './FloatingObjectToolbar';
import { ConfirmDialog, NoticeDialog } from './AppDialog';
import { type Page } from './PagesPanel';

// Tool options interface
interface ToolOptions {
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

interface OpenJamCanvasProps {
  boardId: string;
  userId: string;
  username: string;
  color: string;
}

// Generate stamp ID
function generateStampId(): string {
  return `stamp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Sticky color map
const _STICKY_COLORS: Record<StickyColor, string> = {
  yellow: '#FEF3C7',
  orange: '#FED7AA',
  pink: '#FBCFE8',
  purple: '#DDD6FE',
  blue: '#BFDBFE',
  green: '#BBF7D0',
  gray: '#E5E7EB',
};
void _STICKY_COLORS;

// Widget Renderer - renders the appropriate widget component based on widget type
interface WidgetRendererProps {
  element: WidgetElement;
  isSelected: boolean;
  onSelect: (id: string, addToSelection: boolean) => void;
  onUpdate: (id: string, changes: Partial<Element>) => void;
  onDelete: () => void;
}

function WidgetRenderer({ element, isSelected, onSelect, onUpdate, onDelete }: WidgetRendererProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleWidgetUpdate = useCallback((data: any) => {
    onUpdate(element.id, { widgetData: { ...element.widgetData, ...data } } as Partial<Element>);
  }, [element.id, element.widgetData, onUpdate]);

  const commonProps = {
    id: element.id,
    x: element.x,
    y: element.y,
    isSelected,
    onSelect: () => onSelect(element.id, false),
    onDelete,
  };

  const data = element.widgetData;

  switch (element.widgetType) {
    case 'table':
      return (
        <TableWidget
          {...commonProps}
          rows={data.rows || 3}
          cols={data.cols || 3}
          cells={data.cells || []}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'timer':
      return (
        <TimerWidget
          {...commonProps}
          initialMinutes={data.minutes || 5}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'stopwatch':
      return (
        <StopwatchWidget
          {...commonProps}
        />
      );
    case 'poll':
      return (
        <PollWidget
          {...commonProps}
          question={data.question || ''}
          options={data.options || []}
          showResults={data.showResults || false}
          userId="current-user"
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'kanban':
      return (
        <KanbanWidget
          {...commonProps}
          columns={data.columns || []}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'retro':
      return (
        <RetroWidget
          {...commonProps}
          template={data.template || 'start-stop-continue'}
          columns={data.columns || []}
          onUpdate={handleWidgetUpdate}
          userId="current-user"
        />
      );
    case 'mood-meter':
      return (
        <MoodMeterWidget
          {...commonProps}
          entries={data.entries || []}
          onUpdate={handleWidgetUpdate}
          userId="current-user"
          userName="User"
          userColor="#3B82F6"
        />
      );
    case 'random-picker':
      return (
        <RandomPickerWidget
          {...commonProps}
          items={data.items || []}
          pickedItems={data.pickedItems || []}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'question-card':
      return (
        <QuestionCardWidget
          {...commonProps}
          category={data.category || 'icebreaker'}
          currentIndex={data.currentIndex || 0}
          customQuestions={data.customQuestions || []}
          onUpdate={handleWidgetUpdate}
        />
      );
    case 'dot-voting':
      return (
        <DotVotingWidget
          {...commonProps}
          maxVotesPerUser={data.maxVotesPerUser || 3}
          votes={data.votes || []}
          onUpdate={handleWidgetUpdate}
          userId="current-user"
          userColor="#3B82F6"
        />
      );
    case 'reaction-counter':
      return (
        <ReactionCounterWidget
          {...commonProps}
          reactions={data.reactions || []}
          allowMultiple={data.allowMultiple !== false}
          onUpdate={handleWidgetUpdate}
          userId="current-user"
        />
      );
    default:
      return null;
  }
}

export default function OpenJamCanvas({
  boardId: _boardId,
  userId,
  username,
  color,
}: OpenJamCanvasProps) {
  // Theme
  const { isDark, setTheme } = useTheme();

  // Canvas state
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [boardName, setBoardName] = useState('Untitled');
  
  // Tool state
  const [currentTool, setCurrentTool] = useState<ToolType>('select');
  const [selectedStampEmoji, setSelectedStampEmoji] = useState<string | null>(null);
  const [showStampPicker, setShowStampPicker] = useState(false);

  // Suppress unused warning for showStampPicker (used in keyboard handler)
  void showStampPicker;
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
  
  // Element state
  const elementStoreRef = useRef(new ElementStore(userId));
  const [elements, setElements] = useState<Element[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  // Drag-to-create hook (for text, shape, sticky, connector)
  const { dragCreateStart, dragCreateEnd, dragCreateTool, startDragCreate, updateDragCreate, endDragCreate } = useDragCreate({
    elementStoreRef, toolOptions, setSelectedIds, setEditingId, setCurrentTool,
  });

  // Drag-move hook (for moving elements after creation)
  const { dragMoveStart, startDragMove, updateDragMove, endDragMove } = useDragMove({
    elementStoreRef,
  });

  // Eraser hook
  const { isErasing, eraserPosition, setEraserPosition, startErasing, continueErasing, endErasing: endErasingHook } = useEraser({
    elementStoreRef, toolOptions,
  });
  
  // Stamps state
  const [stamps, setStamps] = useState<Stamp[]>([]);
  
  // Pages state
  const [pages, setPages] = useState<Page[]>([
    { id: 'page-1', name: 'Page 1' },
  ]);
  const [currentPageId, setCurrentPageId] = useState('page-1');
  
  // User preferences
  const [currentUsername, setCurrentUsername] = useState(username);
  const [currentUserColor, setCurrentUserColor] = useState(color);
  const [currentUserAvatarUrl, setCurrentUserAvatarUrl] = useState<string | undefined>(undefined);
  const [isPinned, setIsPinned] = useState(false);
  
  // UI state
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [showFileInfo, setShowFileInfo] = useState(false);
  const [showTableCreation, setShowTableCreation] = useState(false);
  const [showTimerCreation, setShowTimerCreation] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [noticeDialog, setNoticeDialog] = useState<{ title: string; message: string } | null>(null);
  const [deleteBoardDialogOpen, setDeleteBoardDialogOpen] = useState(false);
  const [boardActionBusy, setBoardActionBusy] = useState(false);
  
  // Mock version history
  const versions = useMemo(() => generateMockVersions(userId, currentUsername, currentUserColor), [userId, currentUsername, currentUserColor]);

  // Selected element for property inspector
  const selectedElement = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const id = Array.from(selectedIds)[0];
    return elements.find((el) => el.id === id) || null;
  }, [selectedIds, elements]);
  
  // File info
  const fileInfo = useMemo(() => ({
    id: _boardId,
    name: boardName,
    createdAt: new Date(Date.now() - 7 * 24 * 3600000),
    updatedAt: new Date(),
    createdBy: currentUsername,
    size: '2.4 KB',
    elementsCount: elements.length,
  }), [_boardId, boardName, currentUsername, elements.length]);

  const handleRemoteElementsChanged = useCallback(() => {
    setElements(elementStoreRef.current.getElements());
  }, []);

  const collaboration = useCollaboration({
    roomId: _boardId,
    userId,
    elementStore: elementStoreRef.current,
    onElementsChanged: handleRemoteElementsChanged,
  });
  const {
    isConnected: isCollaborationConnected,
    collaborators: remoteCollaborators,
    cursors: remoteCursors,
    sendCursor,
  } = collaboration;

  const liveCursors = useMemo(() => (
    Array.from(remoteCursors.values()).map((cursor) => ({
      userId: cursor.userId,
      name: cursor.name,
      color: cursor.color,
      x: cursor.x,
      y: cursor.y,
    }))
  ), [remoteCursors]);

  const collaborators = useMemo<Collaborator[]>(() => [
    {
      id: userId,
      name: currentUsername,
      email: `${currentUsername.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      avatarUrl: currentUserAvatarUrl,
      color: currentUserColor,
      permission: 'edit',
      isOnline: true,
    },
    ...remoteCollaborators
      .filter((collaborator) => collaborator.id !== userId)
      .map((collaborator) => ({
        id: collaborator.id,
        name: collaborator.displayName,
        email: '',
        color: collaborator.avatarColor,
        permission: 'edit' as const,
        isOnline: true,
      })),
  ], [userId, currentUsername, currentUserAvatarUrl, currentUserColor, remoteCollaborators]);
  const [shareLinkPermission, setShareLinkPermission] = useState<LinkPermission>('restricted');
  const [shareMembers, setShareMembers] = useState<RoomMember[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [autosaveReady, setAutosaveReady] = useState(false);
  const [boardLoadError, setBoardLoadError] = useState<string | null>(null);

  // Debounced autosave
  const { saveStatus, saveError, markDirty, saveToDatabase } = useAutoSave({
    boardId: _boardId,
    getElements: () => elementStoreRef.current.getElements(),
    getBoardName: () => boardName,
    getStamps: () => stamps,
    getPages: () => pages,
    getCurrentPageId: () => currentPageId,
    enabled: autosaveReady && !boardLoadError,
  });

  const connectionState = isCollaborationConnected ? 'connected' : saveStatus === 'offline' ? 'offline' : 'connecting';

  const handleBoardNameChange = useCallback((name: string) => {
    setBoardName(name);
    markDirty();
  }, [markDirty]);

  const loadShareSettings = useCallback(async () => {
    setShareLoading(true);
    setShareError(null);

    try {
      const settings = await getRoomShareSettings(_boardId);
      setShareLinkPermission(settings.linkPermission);
      setShareMembers(settings.members || []);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Failed to load sharing settings');
    } finally {
      setShareLoading(false);
    }
  }, [_boardId]);

  useEffect(() => {
    if (showShareDialog) {
      void loadShareSettings();
    }
  }, [loadShareSettings, showShareDialog]);

  const handleChangeLinkPermission = useCallback(async (permission: LinkPermission) => {
    const previousPermission = shareLinkPermission;
    setShareSaving(true);
    setShareError(null);
    setShareLinkPermission(permission);

    try {
      const settings = await updateRoomShareSettings(_boardId, permission);
      setShareLinkPermission(settings.linkPermission);
      setShareMembers(settings.members || []);
    } catch (err) {
      setShareLinkPermission(previousPermission);
      const message = err instanceof Error ? err.message : 'Failed to update sharing settings';
      setShareError(message);
      throw err;
    } finally {
      setShareSaving(false);
    }
  }, [_boardId, shareLinkPermission]);

  const handleInviteMember = useCallback(async (email: string, permission: MemberPermission) => {
    setShareSaving(true);
    setShareError(null);

    try {
      const member = await inviteRoomMember(_boardId, email, permission);
      setShareMembers((current) => {
        const withoutExisting = current.filter((item) => item.userId !== member.userId);
        return [member, ...withoutExisting];
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to invite member';
      setShareError(message);
      throw err;
    } finally {
      setShareSaving(false);
    }
  }, [_boardId]);

  const handleRemoveMember = useCallback(async (memberId: string) => {
    setShareSaving(true);
    setShareError(null);

    try {
      await removeRoomMember(_boardId, memberId);
      setShareMembers((current) => current.filter((member) => member.userId !== memberId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove member';
      setShareError(message);
      throw err;
    } finally {
      setShareSaving(false);
    }
  }, [_boardId]);
  
  // Interaction state
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const { selectionBox, setSelectionBox, handleSelect, selectAll, getSelectedFromBox } = useSelection({
    elements, setSelectedIds,
  });
  const { isDrawing, drawingPath, startDrawing, continueDrawing, endDrawing } = useDrawing({
    elementStoreRef, currentTool, toolOptions,
  });
  
  // Subscribe to element store changes
  useEffect(() => {
    const store = elementStoreRef.current;
    const unsubscribe = store.subscribe(() => {
      setElements(store.getElements());
    });
    setElements(store.getElements());
    return unsubscribe;
  }, []);

  useEffect(() => {
    const store = elementStoreRef.current;
    return store.on('operation', () => {
      markDirty();
    });
  }, [markDirty]);

  // Load board data from database on mount
  useEffect(() => {
    setAutosaveReady(false);
    setBoardLoadError(null);
    const loadBoardFromDatabase = async () => {
      let failed = false;
      try {
        const { loadBoard } = await import('../lib/api');
        const data = await loadBoard(_boardId);
        if (data) {
          if (data.name) setBoardName(data.name);
          // Load elements directly without creating operations
          const savedElements = Array.isArray(data.elements) ? data.elements as Element[] : [];
          const savedStamps = Array.isArray(data.stamps) ? data.stamps as Stamp[] : [];
          const savedPages = Array.isArray(data.pages) && data.pages.length > 0
            ? data.pages as Page[]
            : [{ id: 'page-1', name: 'Page 1' }];

          elementStoreRef.current.loadSavedElements(savedElements);
          setStamps(savedStamps);
          setPages(savedPages);
          setCurrentPageId(data.currentPageId || savedPages[0]?.id || 'page-1');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load board data';
        console.error('Failed to load board data:', message);
        failed = true;
        setBoardLoadError(message);
        setAutosaveReady(false);
        return;
      } finally {
        if (!failed) {
          setAutosaveReady(true);
        }
      }
    };
    loadBoardFromDatabase();
  }, [_boardId]);
  
  // Convert screen coordinates to canvas coordinates
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
  
  // handleSelect is provided by useSelection hook
  
  // Handle element update
  const handleUpdate = useCallback((id: string, changes: Partial<Element>) => {
    elementStoreRef.current.updateElement(id, changes);
  }, []);
  
  // Handle element move
  const handleMove = useCallback((id: string, x: number, y: number) => {
    elementStoreRef.current.moveElement(id, x, y);
  }, []);
  
  // Handle element resize
  const handleResize = useCallback((id: string, width: number, height: number) => {
    elementStoreRef.current.resizeElement(id, width, height);
  }, []);
  
  // Handle start editing
  const handleStartEdit = useCallback((id: string) => {
    setEditingId(id);
  }, []);
  
  // Handle end editing
  const handleEndEdit = useCallback(() => {
    setEditingId(null);
  }, []);
  
  // Create new element at position
  const createElementAt = useCallback(
    (type: ElementType, x: number, y: number): Element => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let overrides: Record<string, any> = {};
      
      if (type === 'sticky') {
        overrides = { color: toolOptions.stickyColor };
      } else if (type === 'shape') {
        overrides = {
          shapeType: toolOptions.shapeType,
          strokeColor: toolOptions.strokeColor,
          strokeWidth: toolOptions.strokeWidth,
          fillColor: toolOptions.fillColor,
        };
      } else if (type === 'text') {
        overrides = { fontSize: toolOptions.fontSize };
      } else if (type === 'connector') {
        overrides = {
          strokeColor: toolOptions.strokeColor,
          strokeWidth: toolOptions.strokeWidth,
        };
      } else if (type === 'drawing') {
        overrides = {
          color: toolOptions.strokeColor,
          strokeWidth: toolOptions.strokeWidth,
        };
      }
      
      const op = elementStoreRef.current.addElement(type, x, y, overrides as Partial<Element>);
      const element = op.element;
      setSelectedIds(new Set([element.id]));
      
      if (type === 'sticky' || type === 'text') {
        setEditingId(element.id);
      }
      
      return element;
    },
    [toolOptions]
  );
  
  // Delete selected elements
  const deleteSelected = useCallback(() => {
    selectedIds.forEach((id) => {
      elementStoreRef.current.deleteElement(id);
    });
    setStamps((prev) => prev.filter((s) => !selectedIds.has(s.id)));
    markDirty();
    setSelectedIds(new Set());
  }, [selectedIds, markDirty]);
  
  // Clipboard operations
  const { clipboard, duplicateSelected, copySelected, cutSelected, pasteElements } = useClipboard({
    elements, selectedIds, elementStoreRef, setSelectedIds, onDelete: deleteSelected,
  });

  // selectAll is provided by useSelection hook
  
  // Bring to front / send to back
  const bringToFront = useCallback(() => {
    const maxZ = Math.max(...elements.map((el) => el.zIndex), 0);
    selectedIds.forEach((id) => {
      elementStoreRef.current.updateElement(id, { zIndex: maxZ + 1 } as Partial<Element>);
    });
  }, [selectedIds, elements]);
  
  const sendToBack = useCallback(() => {
    const minZ = Math.min(...elements.map((el) => el.zIndex), 0);
    selectedIds.forEach((id) => {
      elementStoreRef.current.updateElement(id, { zIndex: minZ - 1 } as Partial<Element>);
    });
  }, [selectedIds, elements]);
  
  // Lock/Unlock elements
  const lockSelected = useCallback(() => {
    selectedIds.forEach((id) => {
      elementStoreRef.current.updateElement(id, { locked: true } as Partial<Element>);
    });
  }, [selectedIds]);
  
  const unlockAll = useCallback(() => {
    elements.forEach((el) => {
      if (el.locked) {
        elementStoreRef.current.updateElement(el.id, { locked: false } as Partial<Element>);
      }
    });
  }, [elements]);
  
  // Group/Ungroup elements
  const groupSelected = useCallback(() => {
    if (selectedIds.size < 2) return;
    const groupId = `group-${Date.now()}`;
    selectedIds.forEach((id) => {
      elementStoreRef.current.updateElement(id, { groupId } as Partial<Element>);
    });
  }, [selectedIds]);
  
  const ungroupSelected = useCallback(() => {
    selectedIds.forEach((id) => {
      elementStoreRef.current.updateElement(id, { groupId: undefined } as Partial<Element>);
    });
  }, [selectedIds]);
  
  // Page management handlers
  const handleAddPage = useCallback(() => {
    const newPage: Page = {
      id: `page-${Date.now()}`,
      name: `Page ${pages.length + 1}`,
    };
    setPages((prev) => [...prev, newPage]);
    setCurrentPageId(newPage.id);
    markDirty();
  }, [pages.length, markDirty]);
  
  const handleSelectPage = useCallback((pageId: string) => {
    setCurrentPageId(pageId);
    markDirty();
  }, [markDirty]);
  
  const handleRenamePage = useCallback((pageId: string, name: string) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, name } : p)));
    markDirty();
  }, [markDirty]);
  
  const handleDuplicatePage = useCallback((pageId: string) => {
    const pageToDuplicate = pages.find((p) => p.id === pageId);
    if (!pageToDuplicate) return;
    const newPage: Page = {
      id: `page-${Date.now()}`,
      name: `${pageToDuplicate.name} (Copy)`,
    };
    const index = pages.findIndex((p) => p.id === pageId);
    const newPages = [...pages];
    newPages.splice(index + 1, 0, newPage);
    setPages(newPages);
    setCurrentPageId(newPage.id);
    markDirty();
  }, [pages, markDirty]);
  
  const handleDeletePage = useCallback((pageId: string) => {
    if (pages.length <= 1) return; // Can't delete last page
    setPages((prev) => prev.filter((p) => p.id !== pageId));
    if (currentPageId === pageId) {
      const remaining = pages.filter((p) => p.id !== pageId);
      setCurrentPageId(remaining[0]?.id || '');
    }
    markDirty();
  }, [pages, currentPageId, markDirty]);
  
  // User profile update handler
  const handleUpdateProfile = useCallback((settings: { username: string; color: string; avatarUrl?: string }) => {
    setCurrentUsername(settings.username);
    setCurrentUserColor(settings.color);
    if (settings.avatarUrl !== undefined) {
      setCurrentUserAvatarUrl(settings.avatarUrl);
    }
  }, []);
  
  // Alignment functions
  const getSelectedElements = useCallback(() => {
    return elements.filter((el) => selectedIds.has(el.id));
  }, [elements, selectedIds]);
  
  const alignLeft = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const minX = Math.min(...selected.map((el) => el.x));
    selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, minX, el.y);
    });
  }, [getSelectedElements]);
  
  const alignCenter = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const minX = Math.min(...selected.map((el) => el.x));
    const maxX = Math.max(...selected.map((el) => el.x + el.width));
    const centerX = (minX + maxX) / 2;
    selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, centerX - el.width / 2, el.y);
    });
  }, [getSelectedElements]);
  
  const alignRight = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const maxX = Math.max(...selected.map((el) => el.x + el.width));
    selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, maxX - el.width, el.y);
    });
  }, [getSelectedElements]);
  
  const alignTop = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const minY = Math.min(...selected.map((el) => el.y));
    selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, el.x, minY);
    });
  }, [getSelectedElements]);
  
  const alignMiddle = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const minY = Math.min(...selected.map((el) => el.y));
    const maxY = Math.max(...selected.map((el) => el.y + el.height));
    const centerY = (minY + maxY) / 2;
    selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, el.x, centerY - el.height / 2);
    });
  }, [getSelectedElements]);
  
  const alignBottom = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 2) return;
    const maxY = Math.max(...selected.map((el) => el.y + el.height));
    selected.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, el.x, maxY - el.height);
    });
  }, [getSelectedElements]);
  
  const distributeHorizontally = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 3) return;
    const sorted = [...selected].sort((a, b) => a.x - b.x);
    const totalWidth = sorted.reduce((sum, el) => sum + el.width, 0);
    const minX = sorted[0].x;
    const maxX = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
    const spacing = (maxX - minX - totalWidth) / (sorted.length - 1);
    let currentX = minX;
    sorted.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, currentX, el.y);
      currentX += el.width + spacing;
    });
  }, [getSelectedElements]);
  
  const distributeVertically = useCallback(() => {
    const selected = getSelectedElements();
    if (selected.length < 3) return;
    const sorted = [...selected].sort((a, b) => a.y - b.y);
    const totalHeight = sorted.reduce((sum, el) => sum + el.height, 0);
    const minY = sorted[0].y;
    const maxY = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
    const spacing = (maxY - minY - totalHeight) / (sorted.length - 1);
    let currentY = minY;
    sorted.forEach((el) => {
      elementStoreRef.current.moveElement(el.id, el.x, currentY);
      currentY += el.height + spacing;
    });
  }, [getSelectedElements]);
  
  // Export functions
  const exportToPNG = useCallback(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Calculate bounds of all elements
    if (elements.length === 0) {
      setNoticeDialog({
        title: 'Nothing to export',
        message: 'Add at least one element to the board before exporting a PNG.',
      });
      return;
    }
    
    const padding = 50;
    const minX = Math.min(...elements.map((el) => el.x)) - padding;
    const minY = Math.min(...elements.map((el) => el.y)) - padding;
    const maxX = Math.max(...elements.map((el) => el.x + el.width)) + padding;
    const maxY = Math.max(...elements.map((el) => el.y + el.height)) + padding;
    
    canvas.width = maxX - minX;
    canvas.height = maxY - minY;
    
    // Fill background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw elements (simplified - just rectangles for now)
    elements.forEach((el) => {
      ctx.save();
      ctx.translate(el.x - minX, el.y - minY);
      
      if (el.type === 'sticky') {
        ctx.fillStyle = '#FEF3C7';
        ctx.fillRect(0, 0, el.width, el.height);
        ctx.strokeStyle = '#D97706';
        ctx.strokeRect(0, 0, el.width, el.height);
      } else if (el.type === 'shape') {
        ctx.fillStyle = (el as { fill?: string }).fill || '#ffffff';
        ctx.strokeStyle = (el as { stroke?: string }).stroke || '#000000';
        ctx.fillRect(0, 0, el.width, el.height);
        ctx.strokeRect(0, 0, el.width, el.height);
      } else {
        ctx.fillStyle = '#E5E7EB';
        ctx.fillRect(0, 0, el.width, el.height);
      }
      
      ctx.restore();
    });
    
    // Download
    const link = document.createElement('a');
    link.download = `${boardName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [elements, boardName]);
  
  // Export to JSON file (for download)
  const exportToJSONFile = useCallback(() => {
    const data = {
      name: boardName,
      exportedAt: new Date().toISOString(),
      elements: elements,
      stamps: stamps,
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `${boardName}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }, [boardName, elements, stamps]);
  
  // Insert widget handler - creates interactive widget elements
  const handleInsertWidget = useCallback((widgetId: string) => {
    // Calculate center of viewport for widget placement
    const container = containerRef.current;
    const centerX = container ? (container.clientWidth / 2 - offset.x) / scale : 400;
    const centerY = container ? (container.clientHeight / 2 - offset.y) / scale : 300;
    
    // Map widget panel IDs to widget types
    const widgetTypeMap: Record<string, WidgetType> = {
      'table': 'table',
      'timer': 'timer',
      'stopwatch': 'stopwatch',
      'poll': 'poll',
      'kanban': 'kanban',
      'retro': 'retro',
      'mood-meter': 'mood-meter',
      'random-picker': 'random-picker',
      'question': 'question-card',
      'dot-voting': 'dot-voting',
      'reactions': 'reaction-counter',
    };
    
    const widgetType = widgetTypeMap[widgetId];
    
    // Handle sprint-board as kanban variant
    if (widgetId === 'sprint-board') {
      const dims = WIDGET_DIMENSIONS['kanban'];
      const op = elementStoreRef.current.addElement('widget', centerX - dims.width / 2, centerY - dims.height / 2, {
        width: dims.width,
        height: dims.height,
        widgetType: 'kanban',
        widgetData: {
          ...createDefaultKanban(),
          columns: [
            { id: 'col-1', title: 'Backlog', cards: [] },
            { id: 'col-2', title: 'Sprint', cards: [] },
            { id: 'col-3', title: 'In Progress', cards: [] },
            { id: 'col-4', title: 'Done', cards: [] },
          ],
        },
      } as Partial<Element>);
      setSelectedIds(new Set([op.element.id]));
      setCurrentTool('select');
      return;
    }
    
    if (!widgetType) {
      // Fallback for unknown widget types
      const op = elementStoreRef.current.addElement('frame', centerX - 100, centerY - 75, {
        width: 200,
        height: 150,
        name: widgetId,
        backgroundColor: '#F3F4F6',
      } as Partial<Element>);
      setSelectedIds(new Set([op.element.id]));
      setCurrentTool('select');
      return;
    }
    
    // Get widget dimensions
    const dims = WIDGET_DIMENSIONS[widgetType];
    
    // Create default widget data based on type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let widgetData: Record<string, any> = {};
    switch (widgetType) {
      case 'table':
        setShowTableCreation(true);
        return;
      case 'timer':
        setShowTimerCreation(true);
        return;
      case 'stopwatch':
        widgetData = {};
        break;
      case 'poll':
        widgetData = createDefaultPoll();
        break;
      case 'kanban':
        widgetData = createDefaultKanban();
        break;
      case 'retro':
        widgetData = createDefaultRetro();
        break;
      case 'mood-meter':
        widgetData = createDefaultMoodMeter();
        break;
      case 'random-picker':
        widgetData = createDefaultRandomPicker();
        break;
      case 'question-card':
        widgetData = createDefaultQuestionCard();
        break;
      case 'dot-voting':
        widgetData = createDefaultDotVoting();
        break;
      case 'reaction-counter':
        widgetData = createDefaultReactionCounter();
        break;
    }
    
    // Create the widget element
    const op = elementStoreRef.current.addElement('widget', centerX - dims.width / 2, centerY - dims.height / 2, {
      width: dims.width,
      height: dims.height,
      widgetType,
      widgetData,
    } as Partial<Element>);
    
    setSelectedIds(new Set([op.element.id]));
    setCurrentTool('select');
  }, [offset, scale]);
  
  // Handle canvas mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Close context menu on any click
      if (contextMenu) {
        setContextMenu(null);
      }
      
      if (e.button !== 0) return; // Only left click
      
      // Check if click is on a widget - if so, let the widget handle it
      const target = e.target as HTMLElement;
      if (target.closest('[data-widget]')) {
        return;
      }
      
      const canvas = screenToCanvas(e.clientX, e.clientY);
      
      // Pan mode
      if (currentTool === 'pan') {
        setIsPanning(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }
      
      // Selection mode - check if clicking on an element first
      if (currentTool === 'select') {
        const padding = 6; // Hit detection padding for easier clicking
        // Check if clicking on an element (top-to-bottom z-order)
        const clickedElement = [...elements].reverse().find((el) => {
          // For connectors, use start/end points to build correct bounds
          if (el.type === 'connector') {
            const conn = el as import('../lib/elements').ConnectorElement;
            const minX = Math.min(conn.startPoint.x, conn.endPoint.x) - padding - 8;
            const maxX = Math.max(conn.startPoint.x, conn.endPoint.x) + padding + 8;
            const minY = Math.min(conn.startPoint.y, conn.endPoint.y) - padding - 8;
            const maxY = Math.max(conn.startPoint.y, conn.endPoint.y) + padding + 8;
            return canvas.x >= minX && canvas.x <= maxX && canvas.y >= minY && canvas.y <= maxY;
          }
          // For drawings, use element position + point bounds
          if (el.type === 'drawing') {
            const draw = el as import('../lib/elements').DrawingElement;
            if (draw.points.length === 0) return false;
            const xs = draw.points.map((p: { x: number; y: number }) => p.x);
            const ys = draw.points.map((p: { x: number; y: number }) => p.y);
            const minX = draw.x + Math.min(...xs) - padding;
            const maxX = draw.x + Math.max(...xs) + padding;
            const minY = draw.y + Math.min(...ys) - padding;
            const maxY = draw.y + Math.max(...ys) + padding;
            return canvas.x >= minX && canvas.x <= maxX && canvas.y >= minY && canvas.y <= maxY;
          }
          // Standard bounding box for other elements
          const width = el.width || 100;
          const height = el.height || 100;
          return canvas.x >= el.x - padding && canvas.x <= el.x + width + padding &&
                 canvas.y >= el.y - padding && canvas.y <= el.y + height + padding;
        });

        if (clickedElement && !clickedElement.locked) {
          // If shift-clicking, toggle in selection
          if (e.shiftKey) {
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (next.has(clickedElement.id)) next.delete(clickedElement.id);
              else next.add(clickedElement.id);
              return next;
            });
          } else if (!selectedIds.has(clickedElement.id)) {
            setSelectedIds(new Set([clickedElement.id]));
          }
          // Start dragging all selected elements (or just the clicked one)
          const idsToMove = selectedIds.has(clickedElement.id) && selectedIds.size > 1
            ? Array.from(selectedIds)
            : [clickedElement.id];
          startDragMove(
            { x: canvas.x, y: canvas.y },
            idsToMove,
            (id) => {
              const el = elementStoreRef.current.getElementById(id);
              return el ? { x: el.x, y: el.y } : undefined;
            },
          );
          return;
        }

        // If no element clicked, start selection box
        setSelectionBox({ start: canvas, end: canvas });
        return;
      }
      
      // Create elements with drag-to-size
      if (currentTool === 'sticky' || currentTool === 'shape' || currentTool === 'text' || currentTool === 'connector') {
        startDragCreate({ x: canvas.x, y: canvas.y }, currentTool);
        return;
      }
      
      if (currentTool === 'frame') {
        createElementAt('frame', canvas.x, canvas.y);
        setCurrentTool('select');
        return;
      }
      
      // Stamp mode
      if (currentTool === 'stamp' && selectedStampEmoji) {
        const newStamp: Stamp = {
          id: generateStampId(),
          emoji: selectedStampEmoji,
          x: canvas.x,
          y: canvas.y,
          scale: 1,
          rotation: Math.random() * 20 - 10,
          userId,
          createdAt: Date.now(),
        };
        setStamps((prev) => [...prev, newStamp]);
        markDirty();
        return;
      }
      
      // Drawing mode (pen or marker)
      if (currentTool === 'draw' || currentTool === 'marker') {
        startDrawing({ x: canvas.x, y: canvas.y });
        return;
      }
      
      // Eraser mode - start erasing and erase drawing strokes under cursor
      if (currentTool === 'eraser') {
        startErasing({ x: canvas.x, y: canvas.y }, elements);
        return;
      }
    },
    [currentTool, screenToCanvas, createElementAt, selectedStampEmoji, userId, contextMenu, elements, startErasing, startDrawing, selectedIds, startDragMove, startDragCreate, setSelectionBox, elementStoreRef, markDirty]
  );
  
  // Handle canvas mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = screenToCanvas(e.clientX, e.clientY);
      sendCursor(canvas.x, canvas.y);
      
      // Track eraser position for visual cursor
      if (currentTool === 'eraser') {
        setEraserPosition(canvas);
      } else {
        setEraserPosition(null);
      }
      
      if (isPanning) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }
      
      if (selectionBox) {
        setSelectionBox((prev) => prev ? { ...prev, end: canvas } : null);
        return;
      }
      
      if (isDrawing) {
        continueDrawing({ x: canvas.x, y: canvas.y });
        return;
      }
      
      // Eraser - erase drawing strokes where cursor touches
      if (isErasing) {
        continueErasing({ x: canvas.x, y: canvas.y }, elements);
        return;
      }
      
      // Drag-to-create elements
      if (dragCreateStart) {
        updateDragCreate({ x: canvas.x, y: canvas.y });
        return;
      }

      // Element dragging (moving)
      if (dragMoveStart) {
        updateDragMove({ x: canvas.x, y: canvas.y });
        return;
      }
    },
    [isPanning, dragStart, selectionBox, isDrawing, screenToCanvas, dragCreateStart, isErasing, elements, dragMoveStart, currentTool, setEraserPosition, setSelectionBox, continueDrawing, continueErasing, updateDragCreate, updateDragMove, sendCursor]
  );
  
  // Handle canvas mouse up
  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    
    if (selectionBox) {
      setSelectedIds(getSelectedFromBox(selectionBox));
      setSelectionBox(null);
      return;
    }
    
    if (isDrawing) {
      endDrawing();
      return;
    }
    
    // Drag-to-create element complete
    if (dragCreateStart) {
      endDragCreate();
      return;
    }

    // Stop element dragging
    if (dragMoveStart) {
      endDragMove();
      return;
    }

    // Stop erasing
    if (isErasing) {
      endErasingHook();
      return;
    }

    endDrawing();
  }, [isPanning, selectionBox, isDrawing, dragCreateStart, isErasing, dragMoveStart, getSelectedFromBox, setSelectionBox, endDrawing, endErasingHook, endDragCreate, endDragMove]);
  
  // Zoom functions (defined early for use in context menu)
  const handleZoomIn = useCallback(() => setScale((s) => Math.min(s * 1.2, 5)), []);
  const handleZoomOut = useCallback(() => setScale((s) => Math.max(s / 1.2, 0.1)), []);
  const handleZoomReset = useCallback(() => setScale(1), []);
  const handleZoomFit = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Delete stamp by id
  const deleteStamp = useCallback((stampId: string) => {
    setStamps((prev) => prev.filter((s) => s.id !== stampId));
    markDirty();
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(stampId);
      return newSet;
    });
  }, [markDirty]);

  // Handle right-click context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const canvas = screenToCanvas(e.clientX, e.clientY);
      
      // Check if right-clicking on a stamp first
      const clickedStamp = stamps.find((stamp) => {
        const stampSize = 32; // Approximate stamp size
        const distance = Math.sqrt(
          Math.pow(canvas.x - stamp.x, 2) + Math.pow(canvas.y - stamp.y, 2)
        );
        return distance <= stampSize;
      });
      
      if (clickedStamp) {
        // Select the stamp
        setSelectedIds(new Set([clickedStamp.id]));
        
        // Show stamp context menu with delete option
        const items: ContextMenuItem[] = [
          {
            id: 'delete-stamp',
            label: 'Delete',
            shortcut: 'Del',
            action: () => deleteStamp(clickedStamp.id),
            danger: true,
          },
        ];
        setContextMenu({ x: e.clientX, y: e.clientY, items });
        return;
      }
      
      // Check if right-clicking on an element with improved hit detection
      const clickedElement = [...elements].reverse().find((el) => {
        // Special handling for connectors - use line distance
        if (el.type === 'connector') {
          const connector = el as { startPoint?: { x: number; y: number }; endPoint?: { x: number; y: number } };
          const startX = el.x;
          const startY = el.y;
          const endX = connector.endPoint?.x ?? el.x + el.width;
          const endY = connector.endPoint?.y ?? el.y;
          
          // Calculate distance from point to line segment
          const lineLength = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
          if (lineLength === 0) {
            return Math.sqrt(Math.pow(canvas.x - startX, 2) + Math.pow(canvas.y - startY, 2)) <= 15;
          }
          
          const t = Math.max(0, Math.min(1, 
            ((canvas.x - startX) * (endX - startX) + (canvas.y - startY) * (endY - startY)) / (lineLength * lineLength)
          ));
          const projX = startX + t * (endX - startX);
          const projY = startY + t * (endY - startY);
          const distance = Math.sqrt(Math.pow(canvas.x - projX, 2) + Math.pow(canvas.y - projY, 2));
          
          return distance <= 15; // 15px tolerance for connectors
        }
        
        // Special handling for drawings - check proximity to path
        if (el.type === 'drawing') {
          const drawing = el as DrawingElement;
          const isNearPath = drawing.points.some((point) => {
            const absX = drawing.x + point.x;
            const absY = drawing.y + point.y;
            const distance = Math.sqrt(
              Math.pow(canvas.x - absX, 2) + Math.pow(canvas.y - absY, 2)
            );
            return distance <= 15 + drawing.strokeWidth / 2;
          });
          return isNearPath;
        }
        
        // Standard bounding box check for other elements
        const bounds = {
          left: el.x,
          right: el.x + (el.width || 100),
          top: el.y,
          bottom: el.y + (el.height || 100),
        };
        return canvas.x >= bounds.left && canvas.x <= bounds.right && 
               canvas.y >= bounds.top && canvas.y <= bounds.bottom;
      });
      
      if (clickedElement) {
        // Select if not already selected
        if (!selectedIds.has(clickedElement.id)) {
          setSelectedIds(new Set([clickedElement.id]));
        }
        
        const items = getElementContextMenuItems(
          duplicateSelected,
          deleteSelected,
          copySelected,
          () => { copySelected(); deleteSelected(); },
          bringToFront,
          sendToBack,
          lockSelected,
          groupSelected,
          ungroupSelected,
          false,
          clickedElement.locked || false
        );
        setContextMenu({ x: e.clientX, y: e.clientY, items });
      } else {
        // Canvas context menu
        const items = getCanvasContextMenuItems(
          pasteElements,
          selectAll,
          handleZoomIn,
          handleZoomOut,
          handleZoomFit,
          clipboard.length > 0,
          () => elementStoreRef.current.undo(),
          () => elementStoreRef.current.redo()
        );
        setContextMenu({ x: e.clientX, y: e.clientY, items });
      }
    },
    [elements, stamps, selectedIds, screenToCanvas, duplicateSelected, deleteSelected, copySelected, bringToFront, sendToBack, lockSelected, groupSelected, ungroupSelected, pasteElements, selectAll, clipboard, handleZoomIn, handleZoomOut, handleZoomFit, deleteStamp]
  );
  
  // Handle zoom with wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(Math.max(scale * delta, 0.1), 5);
        
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          const newOffsetX = mouseX - (mouseX - offset.x) * (newScale / scale);
          const newOffsetY = mouseY - (mouseY - offset.y) * (newScale / scale);
          setOffset({ x: newOffsetX, y: newOffsetY });
        }
        setScale(newScale);
      } else {
        setOffset((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    },
    [scale, offset]
  );
  
  // Keyboard shortcuts
  useKeyboardShortcuts({
    editingId,
    onDelete: deleteSelected,
    onDuplicate: duplicateSelected,
    onCopy: copySelected,
    onPaste: pasteElements,
    onUndo: () => elementStoreRef.current.undo(),
    onRedo: () => elementStoreRef.current.redo(),
    onSelectAll: selectAll,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: handleZoomReset,
    onZoomFit: handleZoomFit,
    onBringToFront: bringToFront,
    onSendToBack: sendToBack,
    onCommandPalette: () => setShowCommandPalette(true),
    onHelp: () => setShowHelpPanel(true),
    onSetTool: (tool) => {
      setCurrentTool(tool as ToolType);
      if (tool === 'stamp') {
        setShowStampPicker(true);
      }
    },
    onEscape: () => {
      setCurrentTool('select');
      setEditingId(null);
      setShowStampPicker(false);
      setContextMenu(null);
    },
    onSave: saveToDatabase,
    onCut: cutSelected,
    onToggleLock: lockSelected,
    onGroup: groupSelected,
    onUngroup: ungroupSelected,
  });
  
  // Sort elements by z-index
  const sortedElements = useMemo(() => {
    return [...elements].sort((a, b) => a.zIndex - b.zIndex);
  }, [elements]);
  
  // Get cursor based on tool
  const getCursor = () => {
    switch (currentTool) {
      case 'pan':
        return isPanning ? 'grabbing' : 'grab';
      case 'draw':
        return 'crosshair';
      case 'text':
        return 'text';
      case 'stamp':
        return 'crosshair';
      case 'eraser':
        return 'crosshair';
      default:
        return 'default';
    }
  };
  
  // Command palette commands
  const commands = useMemo(() => [
    { id: 'select', label: 'Cursor tool', category: 'Tools', shortcut: 'V', action: () => setCurrentTool('select') },
    { id: 'pan', label: 'Pan tool', category: 'Tools', shortcut: 'H', action: () => setCurrentTool('pan') },
    { id: 'sticky', label: 'Sticky note', category: 'Tools', shortcut: 'S', action: () => setCurrentTool('sticky') },
    { id: 'shape', label: 'Shape tool', category: 'Tools', shortcut: 'R', action: () => setCurrentTool('shape') },
    { id: 'text', label: 'Text tool', category: 'Tools', shortcut: 'T', action: () => setCurrentTool('text') },
    { id: 'connector', label: 'Connector', category: 'Tools', shortcut: 'C', action: () => setCurrentTool('connector') },
    { id: 'draw', label: 'Pen tool', category: 'Tools', shortcut: 'P', action: () => setCurrentTool('draw') },
    { id: 'marker', label: 'Marker tool', category: 'Tools', shortcut: 'M', action: () => setCurrentTool('marker') },
    { id: 'stamp', label: 'Stamp tool', category: 'Tools', shortcut: 'E', action: () => { setCurrentTool('stamp'); setShowStampPicker(true); } },
    { id: 'eraser', label: 'Eraser tool', category: 'Tools', shortcut: 'X', action: () => setCurrentTool('eraser') },
    { id: 'frame', label: 'Frame tool', category: 'Tools', shortcut: 'F', action: () => setCurrentTool('frame') },
    { id: 'undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z', action: () => elementStoreRef.current.undo() },
    { id: 'redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Shift+Z', action: () => elementStoreRef.current.redo() },
    { id: 'copy', label: 'Copy', category: 'Edit', shortcut: 'Ctrl+C', action: copySelected },
    { id: 'paste', label: 'Paste', category: 'Edit', shortcut: 'Ctrl+V', action: pasteElements },
    { id: 'duplicate', label: 'Duplicate', category: 'Edit', shortcut: 'Ctrl+D', action: duplicateSelected },
    { id: 'selectAll', label: 'Select all', category: 'Edit', shortcut: 'Ctrl+A', action: selectAll },
    { id: 'delete', label: 'Delete selection', category: 'Edit', shortcut: 'Del', action: deleteSelected },
    { id: 'zoomIn', label: 'Zoom in', category: 'View', shortcut: 'Ctrl++', action: handleZoomIn },
    { id: 'zoomOut', label: 'Zoom out', category: 'View', shortcut: 'Ctrl+-', action: handleZoomOut },
    { id: 'zoomReset', label: 'Reset zoom', category: 'View', shortcut: 'Ctrl+0', action: handleZoomReset },
    { id: 'zoomFit', label: 'Zoom to fit', category: 'View', shortcut: 'Ctrl+1', action: handleZoomFit },
    { id: 'toggleGrid', label: 'Toggle grid', category: 'View', action: () => setShowGrid((g) => !g) },
    { id: 'share', label: 'Share...', category: 'File', action: () => setShowShareDialog(true) },
    { id: 'help', label: 'Help & shortcuts', category: 'Help', shortcut: '?', action: () => setShowHelpPanel(true) },
  ], [copySelected, pasteElements, duplicateSelected, selectAll, deleteSelected, handleZoomIn, handleZoomOut, handleZoomReset, handleZoomFit]);

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: 'var(--surface-canvas)' }}>
      {/* Menu Bar — self-positions absolute top-right, includes avatar stack */}
      <MenuBar
        boardName={boardName}
        onBoardNameChange={handleBoardNameChange}
        onUndo={() => elementStoreRef.current.undo()}
        onRedo={() => elementStoreRef.current.redo()}
        onSelectAll={selectAll}
        onDelete={deleteSelected}
        onDuplicate={duplicateSelected}
        onCopy={copySelected}
        onPaste={pasteElements}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onZoomFit={handleZoomFit}
        onSave={saveToDatabase}
        saveStatus={saveStatus}
        saveError={saveError}
        onExportPNG={exportToPNG}
        onExportJSON={exportToJSONFile}
        onShare={() => setShowShareDialog(true)}
        onToggleGrid={() => setShowGrid((g) => !g)}
        showGrid={showGrid}
        onVersionHistory={() => setShowVersionHistory(true)}
        onFileInfo={() => setShowFileInfo(true)}
        onDeleteBoard={() => setDeleteBoardDialogOpen(true)}
        // Page management
        pages={pages}
        currentPageId={currentPageId}
        onSelectPage={handleSelectPage}
        onAddPage={handleAddPage}
        onRenamePage={handleRenamePage}
        onDuplicatePage={handleDuplicatePage}
        onDeletePage={handleDeletePage}
        onDuplicateBoard={async () => {
          setBoardActionBusy(true);
          try {
            const name = `${boardName} (Copy)`;
            const room = await createRoom(name);
            await saveBoard(room.id, {
              name,
              elements: elementStoreRef.current.getElements(),
              stamps,
              pages,
              currentPageId,
            });
            window.location.href = `/board/${room.id}`;
          } catch (err) {
            setNoticeDialog({
              title: 'Could not duplicate board',
              message: err instanceof Error ? err.message : 'Failed to duplicate board',
            });
          } finally {
            setBoardActionBusy(false);
          }
        }}
        // User settings
        username={currentUsername}
        userEmail={`${currentUsername.toLowerCase().replace(/\s+/g, '.')}@example.com`}
        userColor={currentUserColor}
        userId={userId}
        userAvatarUrl={currentUserAvatarUrl}
        isPinned={isPinned}
        onTogglePin={() => setIsPinned((p) => !p)}
        onUpdateProfile={handleUpdateProfile}
        onLogout={async () => {
          try {
            const { logout } = await import('../lib/api');
            await logout();
            window.location.href = '/';
          } catch {
            window.location.href = '/';
          }
        }}
        // Menu actions
        onBringToFront={bringToFront}
        onSendToBack={sendToBack}
        onLock={lockSelected}
        onUnlockAll={unlockAll}
        onGroup={groupSelected}
        onUngroup={ungroupSelected}
        collaborators={collaborators.filter(c => c.id !== userId).map(c => ({ id: c.id, name: c.name, color: c.color, avatarUrl: undefined }))}
        connectionState={connectionState}
        isDark={isDark}
        onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
      />

      {boardLoadError && (
        <div className="pointer-events-auto absolute left-1/2 top-24 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg" role="alert">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not load this board. Autosave is paused to protect existing content.</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-11 rounded-xl bg-red-600 px-3 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      
      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        commands={commands}
      />
      
      {/* Share Dialog */}
      <ShareDialog
        isOpen={showShareDialog}
        onClose={() => setShowShareDialog(false)}
        boardName={boardName}
        shareLink={`${window.location.origin}/board/${_boardId}`}
        linkPermission={shareLinkPermission}
        members={shareMembers}
        isLoading={shareLoading}
        isSaving={shareSaving}
        error={shareError}
        onChangeLinkPermission={handleChangeLinkPermission}
        onInvite={handleInviteMember}
        onRemoveMember={handleRemoveMember}
        onCopyLink={() => {}}
      />
      
      {/* Help Panel */}
      <HelpPanel
        isOpen={showHelpPanel}
        onClose={() => setShowHelpPanel(false)}
      />
      
      {/* Version History Panel */}
      <VersionHistoryPanel
        isOpen={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        versions={versions}
        onRestore={(versionId) => {
          console.log('Restore version:', versionId);
          setShowVersionHistory(false);
        }}
        onPreview={(versionId) => console.log('Preview version:', versionId)}
        onNameVersion={(versionId, name) => console.log('Name version:', versionId, name)}
      />
      
      {/* Image Upload Dialog */}
      <ImageUploadDialog
        isOpen={showImageUpload}
        onClose={() => setShowImageUpload(false)}
        onUpload={(imageData) => {
          // Calculate center of viewport for image placement
          const container = containerRef.current;
          const centerX = container ? (container.clientWidth / 2 - offset.x) / scale : 400;
          const centerY = container ? (container.clientHeight / 2 - offset.y) / scale : 300;
          
          // Scale image to fit within max dimensions while maintaining aspect ratio
          const maxWidth = 400;
          const maxHeight = 400;
          let width = imageData.width;
          let height = imageData.height;
          
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          
          // Add image element at center of viewport
          const op = elementStoreRef.current.addElement('image', centerX - width / 2, centerY - height / 2, {
            src: imageData.url,
            originalWidth: imageData.width,
            originalHeight: imageData.height,
            width,
            height,
            objectFit: 'contain',
          } as Partial<Element>);
          setSelectedIds(new Set([op.element.id]));
          setCurrentTool('select');
        }}
      />
      
      {/* File Info Dialog */}
      <FileInfoDialog
        isOpen={showFileInfo}
        onClose={() => setShowFileInfo(false)}
        fileInfo={fileInfo}
        collaborators={collaborators}
      />

      <ConfirmDialog
        isOpen={deleteBoardDialogOpen}
        title="Delete Board"
        message={(
          <span>
            Delete <strong style={{ color: 'var(--text-primary)' }}>{boardName}</strong>? This cannot be undone.
          </span>
        )}
        confirmLabel="Delete"
        tone="danger"
        isBusy={boardActionBusy}
        onConfirm={async () => {
          setBoardActionBusy(true);
          try {
            await deleteRoomApi(_boardId);
            window.location.href = '/workplace';
          } catch (err) {
            setNoticeDialog({
              title: 'Could not delete board',
              message: err instanceof Error ? err.message : 'Failed to delete board',
            });
            setDeleteBoardDialogOpen(false);
          } finally {
            setBoardActionBusy(false);
          }
        }}
        onClose={() => setDeleteBoardDialogOpen(false)}
      />

      <NoticeDialog
        isOpen={noticeDialog !== null}
        title={noticeDialog?.title || ''}
        message={noticeDialog?.message || ''}
        onClose={() => setNoticeDialog(null)}
      />
      
      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
      
      {/* Multi-select toolbar */}
      <MultiSelectToolbar
        selectedCount={selectedIds.size}
        onAlignLeft={alignLeft}
        onAlignCenter={alignCenter}
        onAlignRight={alignRight}
        onAlignTop={alignTop}
        onAlignMiddle={alignMiddle}
        onAlignBottom={alignBottom}
        onDistributeH={distributeHorizontally}
        onDistributeV={distributeVertically}
        onGroup={groupSelected}
        onUngroup={ungroupSelected}
        onDelete={deleteSelected}
        onDuplicate={duplicateSelected}
        onBringToFront={bringToFront}
        onSendToBack={sendToBack}
        canUngroup={elements.some((el) => selectedIds.has(el.id) && (el as { groupId?: string }).groupId)}
      />

      <FloatingObjectToolbar
        element={selectedElement}
        scale={scale}
        offset={offset}
        onUpdate={handleUpdate}
        onDuplicate={duplicateSelected}
        onDelete={deleteSelected}
      />

      <LiveCursorLayer cursors={liveCursors} scale={scale} offset={offset} />

      {/* Canvas */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ cursor: getCursor() }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
      >
        {/* Transform container */}
        <div
          className="absolute origin-top-left"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        >
          {/* Grid */}
          {showGrid && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `
                  repeating-linear-gradient(to right, #E5E7EB 0px, #E5E7EB 4px, transparent 4px, transparent 8px),
                  repeating-linear-gradient(to bottom, #E5E7EB 0px, #E5E7EB 4px, transparent 4px, transparent 8px)
                `,
                backgroundSize: '20px 1px, 1px 20px',
                width: '10000px',
                height: '10000px',
                left: '-5000px',
                top: '-5000px',
              }}
            />
          )}
          
          {/* Elements */}
          {sortedElements.map((element) => {
            // Render widget elements with their specific components
            if (element.type === 'widget') {
              const widgetEl = element as WidgetElement;
              return (
                <WidgetRenderer
                  key={element.id}
                  element={widgetEl}
                  isSelected={selectedIds.has(element.id)}
                  onSelect={handleSelect}
                  onUpdate={handleUpdate}
                  onDelete={() => elementStoreRef.current.deleteElement(element.id)}
                />
              );
            }
            
            return (
              <ElementRenderer
                key={element.id}
                element={element}
                isSelected={selectedIds.has(element.id)}
                isEditing={editingId === element.id}
                scale={scale}
                onSelect={handleSelect}
                onStartEdit={handleStartEdit}
                onEndEdit={handleEndEdit}
                onUpdate={handleUpdate}
                onMove={handleMove}
                onResize={handleResize}
                isPinned={isPinned && element.createdBy === userId}
              />
            );
          })}
          
          {/* Stamps */}
          {stamps.map((stamp) => (
            <StampElement
              key={stamp.id}
              stamp={stamp}
              isSelected={selectedIds.has(stamp.id)}
              onSelect={handleSelect}
              onDelete={(id) => {
                setStamps((prev) => prev.filter((s) => s.id !== id));
                markDirty();
              }}
              onMove={(id, x, y) => {
                setStamps((prev) => prev.map((s) => s.id === id ? { ...s, x, y } : s));
                markDirty();
              }}
            />
          ))}
          
          {/* Drawing preview */}
          {isDrawing && drawingPath.length > 1 && (
            <DrawingPreview
              drawingPath={drawingPath}
              isMarker={currentTool === 'marker'}
              strokeWidth={toolOptions.strokeWidth}
              strokeColor={toolOptions.strokeColor}
            />
          )}
          
          {/* Selection box */}
          {selectionBox && (
            <div
              className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none"
              style={{
                left: Math.min(selectionBox.start.x, selectionBox.end.x),
                top: Math.min(selectionBox.start.y, selectionBox.end.y),
                width: Math.abs(selectionBox.end.x - selectionBox.start.x),
                height: Math.abs(selectionBox.end.y - selectionBox.start.y),
              }}
            />
          )}
          
          {/* Drag-to-create preview */}
          {dragCreateStart && dragCreateEnd && dragCreateTool && (
            <DragCreatePreview start={dragCreateStart} end={dragCreateEnd} tool={dragCreateTool} shapeType={toolOptions.shapeType} />
          )}
          
          {/* Eraser cursor indicator */}
          {currentTool === 'eraser' && eraserPosition && (
            <EraserCursor x={eraserPosition.x} y={eraserPosition.y} size={toolOptions.eraserSize} isErasing={isErasing} />
          )}
        </div>
      </div>
      
      {/* Bottom Toolbar */}
      <BottomToolbar
        currentTool={currentTool}
        onToolChange={setCurrentTool}
        toolOptions={toolOptions}
        onToolOptionsChange={(opts) => setToolOptions((prev) => ({ ...prev, ...opts }))}
        onInsertImage={() => setShowImageUpload(true)}
        onInsertWidget={handleInsertWidget}
        selectedColor={selectedColor}
        onColorChange={setSelectedColor}
        onSelectStamp={setSelectedStampEmoji}
      />
      
      {/* Zoom controls - bottom right */}
      <div className="absolute bottom-6 right-4 z-40 flex items-center gap-2">
        <ZoomControls
          scale={scale}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onZoomFit={handleZoomFit}
          onHelp={() => setShowHelpPanel(true)}
        />
      </div>
      
      {/* Status bar */}
      <div className="glass-subtle absolute bottom-6 left-4 z-40 flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span className="flex items-center gap-1.5 rounded-lg px-2" title={`${elements.length} elements`} aria-label={`${elements.length} elements`}>
          <ElementsIcon />
          <span>{elements.length}</span>
        </span>
        {selectedIds.size > 0 && (
          <span className="badge flex items-center gap-1.5 rounded-lg px-2 py-1" title={`${selectedIds.size} selected`} aria-label={`${selectedIds.size} selected`}>
            <SelectionCountIcon />
            <span>{selectedIds.size}</span>
          </span>
        )}
      </div>

      {/* Table Creation Dialog */}
      {showTableCreation && (
        <TableCreationDialog
          onConfirm={(rows, cols) => {
            const centerX = (-offset.x + window.innerWidth / 2) / scale;
            const centerY = (-offset.y + window.innerHeight / 2) / scale;
            const cells = Array(rows).fill(null).map(() =>
              Array(cols).fill(null).map(() => ({ content: '', backgroundColor: '#ffffff' }))
            );
            elementStoreRef.current.addElement('widget', centerX - 200, centerY - 150, {
              width: 400, height: 300,
              widgetType: 'table',
              widgetData: { rows, cols, cells },
            } as Partial<Element>);
            setShowTableCreation(false);
            setCurrentTool('select');
          }}
          onCancel={() => setShowTableCreation(false)}
        />
      )}

      {/* Timer Creation Dialog */}
      {showTimerCreation && (
        <TimerCreationDialog
          onConfirm={(minutes) => {
            const centerX = (-offset.x + window.innerWidth / 2) / scale;
            const centerY = (-offset.y + window.innerHeight / 2) / scale;
            elementStoreRef.current.addElement('widget', centerX - 100, centerY - 100, {
              width: 200, height: 200,
              widgetType: 'timer',
              widgetData: { minutes },
            } as Partial<Element>);
            setShowTimerCreation(false);
            setCurrentTool('select');
          }}
          onCancel={() => setShowTimerCreation(false)}
        />
      )}

    </div>
  );
}

function ElementsIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  );
}

function SelectionCountIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" strokeDasharray="3 2" />
      <path d="M9 12l2 2 4-5" />
    </svg>
  );
}
