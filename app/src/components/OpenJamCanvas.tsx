import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ElementRenderer } from './elements';
import { useAutoSave } from './canvas/hooks/useAutoSave';
import { useKeyboardShortcuts } from './canvas/hooks/useKeyboardShortcuts';
import { useClipboard } from './canvas/hooks/useClipboard';
import { useSelection } from './canvas/hooks/useSelection';
import { useDrawing } from './canvas/hooks/useDrawing';
import { useEraser } from './canvas/hooks/useEraser';
import { useDragCreate } from './canvas/hooks/useDragCreate';
import { useDragMove } from './canvas/hooks/useDragMove';
import { useAlignDistribute } from './canvas/hooks/useAlignDistribute';
import { usePages } from './canvas/hooks/usePages';
import { elementMutation, fitsDocumentBatch, isGeometryPatch, MAX_BATCH_OPERATIONS, type DocumentPatch } from './canvas/documentEdits';
import { elementBounds, expandBounds, findAnchor, movementSelection, overlapsBounds, pageMoveSelection, resolveConnector, selectionGroup, withinBounds } from './canvas/boardObjects';
import DrawingPreview from './canvas/DrawingPreview';
import EraserCursor from './canvas/EraserCursor';
import DragCreatePreview from './canvas/DragCreatePreview';
import { ElementStore } from '../lib/elementStore';
import { useCollaboration } from '../lib/useCollaboration';
import { useBoardSync, type BoardDocument, type DocumentMutation } from '../lib/boardSync';
import type { BoardViewport } from '../lib/boardPresentation';
import type { ReviewAnchor, ReviewLocation } from '../lib/boardReview';
import {
  createRoom,
  deleteRoom as deleteRoomApi,
  getRoom,
  getRoomShareSettings,
  inviteRoomMember,
  loadBoard,
  removeRoomMember,
  saveBoard,
  updateRoomShareSettings,
  ApiError,
  type LinkPermission,
  type MemberPermission,
  type RoomMember,
  type BoardData,
} from '../lib/api';
import {
  type Element,
  type WidgetElement,
  type WidgetType,
  generateElementId,
  WIDGET_DIMENSIONS,
} from '../lib/elements';
import {
  createDefaultPoll,
  createDefaultKanban,
  createDefaultRetro,
  createDefaultMoodMeter,
  createDefaultRandomPicker,
  createDefaultQuestionCard,
  createDefaultDotVoting,
  createDefaultReactionCounter,
  createDefaultTable,
} from './widgets';
import WidgetRenderer from './WidgetRenderer';
import TableCreationDialog from './widgets/TableCreationDialog';
import TimerCreationDialog from './widgets/TimerCreationDialog';
import MenuBar from './MenuBar';
import { useTheme } from '../lib/useTheme';
import CommandPalette from './CommandPalette';
import ZoomControls from './ZoomControls';
import { StampElement, type Stamp } from './StampTool';
import { type Collaborator } from './CollaboratorPanel';
import ShareDialog from './ShareDialog';
import BoardSharingDialog from './BoardSharingDialog';
import LiveCursorLayer from './collaboration/LiveCursorLayer';
import BoardSyncNotice from './collaboration/BoardSyncNotice';
import BoardReviewPanel from './collaboration/BoardReviewPanel';
import BoardVersionsPanel from './collaboration/BoardVersionsPanel';
import BoardFilesPanel from './BoardFilesPanel';
import BoardAgentPanel from './BoardAgentPanel';
import AgentCanvasPreview, { AgentPreviewObjects } from './canvas/AgentCanvasPreview';
import AgentCharacter from './canvas/AgentCharacter';
import AgentProfileDialog from './canvas/AgentProfileDialog';
import { characterPose, readAgentAttributions, readAgentProfile, type AgentAttribution, type AgentProfile } from '../lib/agentIdentity';
import type { AgentPreview } from '../lib/boardAgent';
import { useI18n } from '../i18n';
import { copyPrivateBoard } from '../lib/boardFiles';
import BoardPresentationControls from './collaboration/BoardPresentationControls';
import { useBoardPresentation } from './collaboration/useBoardPresentation';
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
import ImageUploadDialog from './ImageUploadDialog';
import FileInfoDialog from './FileInfoDialog';
import FloatingObjectToolbar from './FloatingObjectToolbar';
import { ConfirmDialog, NoticeDialog } from './AppDialog';
import { useAuth } from './AuthContext';
import { type Page } from './PagesPanel';
import './canvas/agentCanvas.css';

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
  email?: string;
  color: string;
}

// Generate stamp ID
function generateStampId(): string {
  return `stamp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default function OpenJamCanvas({
  boardId,
  userId,
  username,
  email,
  color,
}: OpenJamCanvasProps) {
  // Theme
  const { isDark, theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const { messages: { agentIdentity: characterText } } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedRunId = searchParams.get('conversation') ?? undefined;

  // Canvas state
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [boardName, setBoardName] = useState('Untitled');
  const [noticeDialog, setNoticeDialog] = useState<{ title: string; message: string } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  
  // Tool state
  const [currentTool, setCurrentTool] = useState<ToolType>('select');
  const isInkTool = currentTool === 'draw' || currentTool === 'marker' || currentTool === 'eraser';
  const [selectedStampEmoji, setSelectedStampEmoji] = useState<string | null>(null);

  const [toolOptions, setToolOptions] = useState<ToolOptions>({
    stickyColor: 'yellow',
    stickyShape: 'square',
    shapeType: 'rectangle',
    strokeColor: isDark ? '#ececec' : '#000000',
    strokeWidth: 2,
    fillColor: '#ffffff',
    fontSize: 16,
    connectorStyle: 'straight',
    arrowStart: 'none',
    arrowEnd: 'arrow',
    eraserMode: 'stroke',
    eraserSize: 20,
  });
  const [selectedColor, setSelectedColor] = useState(isDark ? '#ececec' : '#000000');
  
  // Element state
  const [elementStore] = useState(() => new ElementStore(userId));
  const elementStoreRef = useRef(elementStore);
  const [allElements, setElements] = useState<Element[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  // Drag-to-create hook (for text, shape, sticky, connector)
  const { dragCreateStart, dragCreateEnd, dragCreateTool, startDragCreate, updateDragCreate, endDragCreate, cancelDragCreate } = useDragCreate({
    elementStoreRef, toolOptions, setSelectedIds, setEditingId, setCurrentTool,
  });

  // Drag-move hook (for moving elements after creation)
  const { dragMoveStart, startDragMove, updateDragMove, endDragMove } = useDragMove({
    elementStoreRef,
  });

  // Stamps state
  const [allStamps, setStamps] = useState<Stamp[]>([]);
  
  // Pages state
  const [pages, setPages] = useState<Page[]>([]);
  const [currentPageId, setCurrentPageId] = useState('');
  const [defaultPageId, setDefaultPageId] = useState('');
  const [legacyReady, setLegacyReady] = useState(false);
  const [legacyEditable, setLegacyEditable] = useState(false);
  const [legacyOwner, setLegacyOwner] = useState(false);
  const [legacyReload, setLegacyReload] = useState(0);
  const geometry = useRef(new Map<string, DocumentPatch>());
  const geometryTimer = useRef<number | null>(null);
  const elementBatch = useRef<DocumentMutation[] | null>(null);
  const activePointer = useRef<number | null>(null);
  const resizeGesture = useRef<{ element: Element; x: number; y: number } | null>(null);
  const projectedDocument = useRef<BoardDocument | undefined>(undefined);
  const projectedEpoch = useRef<number | undefined>(undefined);
  const initialLocation = useRef(new URLSearchParams(window.location.search));
  const localWrites = useRef(new Set<Promise<boolean>>());
  const [hasGeometryPreview, setHasGeometryPreview] = useState(false);

  const clearGeometry = useCallback(() => {
    if (geometryTimer.current !== null) window.clearTimeout(geometryTimer.current);
    geometryTimer.current = null;
    geometry.current.clear();
    setHasGeometryPreview(false);
  }, []);

  const applyDocument = useCallback((doc: BoardDocument, epoch?: number) => {
    if (projectedEpoch.current !== epoch) {
      activePointer.current = null;
      resizeGesture.current = null;
      clearGeometry();
      setEditingId(null);
      setSelectedIds(new Set());
    }
    projectedDocument.current = doc;
    projectedEpoch.current = epoch;
    const project = <T extends Element | Stamp>(records: T[], collection: 'elements' | 'stamps'): T[] => {
      if (!geometry.current.size) return records;
      return records.map(record => {
        const fields = geometry.current.get(`${collection}/${record.id}`)?.fields;
        return fields ? { ...record, ...fields } : record;
      });
    };
    setBoardName(doc.name);
    setDefaultPageId(doc.defaultPageId);
    setPages(doc.pages);
    const initialPage = initialLocation.current.get('page');
    if (doc.pages.length) initialLocation.current.delete('page');
    setCurrentPageId(current => (
      doc.pages.find(page => page.id === initialPage)?.id
      ?? (doc.pages.some(page => page.id === current) ? current : doc.defaultPageId)
    ));
    elementStoreRef.current.replaceSyncedElements(project(doc.elements, 'elements'));
    setStamps(project(doc.stamps, 'stamps'));
  }, [clearGeometry]);
  const boardSync = useBoardSync({ boardId, userId, onDocument: applyDocument });
  const { enqueue, mode, retry } = boardSync;
  const isLegacy = mode === 'legacy';
  const isV2 = mode === 'active';
  const canEdit = isLegacy ? legacyReady && legacyEditable : isV2 && boardSync.canEdit && Boolean(currentPageId);
  const canUseBoard = isLegacy ? legacyReady : isV2 && pages.length > 0 && boardSync.status !== 'revoked';
  const access = isLegacy ? (legacyEditable ? undefined : 'view') : boardSync.permission;
  const limitedAccess = canUseBoard && (access === 'view' || access === 'comment') ? access : undefined;
  const canPresent = isV2 && (boardSync.permission === 'owner' || boardSync.permission === 'edit');
  const localView = useMemo<BoardViewport | null>(() => currentPageId && viewport.width > 0 && viewport.height > 0 ? ({
    pageId: currentPageId,
    x: (viewport.width / 2 - offset.x) / scale,
    y: (viewport.height / 2 - offset.y) / scale,
    scale,
  }) : null, [currentPageId, offset.x, offset.y, scale, viewport.height, viewport.width]);
  const applyFollowedView = useCallback((view: BoardViewport) => {
    if (!pages.some(page => page.id === view.pageId)) return;
    setCurrentPageId(view.pageId);
    setScale(view.scale);
    const x = viewport.width / 2 - view.x * view.scale;
    const y = viewport.height / 2 - view.y * view.scale;
    setOffset(previous => previous.x === x && previous.y === y ? previous : { x, y });
  }, [pages, viewport.height, viewport.width]);
  const presentation = useBoardPresentation({
    connected: isV2 && boardSync.isConnected,
    canPresent,
    epoch: boardSync.epoch,
    view: localView,
    presenters: boardSync.presenters,
    send: boardSync.sendViewport,
    apply: applyFollowedView,
  });
  const { stopFollowing } = presentation;
  const elements = useMemo(
    () => isV2 ? allElements.filter(element => element.pageId === currentPageId) : allElements,
    [allElements, currentPageId, isV2],
  );
  const stamps = useMemo(
    () => isV2 ? allStamps.filter(stamp => stamp.pageId === currentPageId) : allStamps,
    [allStamps, currentPageId, isV2],
  );
  const renderElements = useMemo(() => {
    const byId = new Map(elements.map(element => [element.id, element]));
    return elements.map(element => resolveConnector(element, byId));
  }, [elements]);
  const objectBounds = useMemo(() => new Map(renderElements.map(element => [element.id, elementBounds(element)])), [renderElements]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const updateViewport = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const recordWrite = useCallback((mutations: DocumentMutation[]) => {
    if (!fitsDocumentBatch(mutations)) {
      if (projectedDocument.current) applyDocument(projectedDocument.current, projectedEpoch.current);
      setNoticeDialog({ title: 'Selection exceeds the edit limit', message: 'Edit a smaller selection and try again. The batch was left intact.' });
      return Promise.resolve(false);
    }
    const write = enqueue(mutations);
    localWrites.current.add(write);
    void write.finally(() => localWrites.current.delete(write));
    return write;
  }, [applyDocument, enqueue]);

  const flushGeometry = useCallback(() => {
    const mutations = Array.from(geometry.current.values());
    clearGeometry();
    if (mutations.length) void recordWrite(mutations);
  }, [clearGeometry, recordWrite]);

  const queueGeometry = useCallback((patch: DocumentPatch) => {
    const key = `${patch.collection}/${patch.id}`;
    const previous = geometry.current.get(key);
    geometry.current.set(key, { ...patch, fields: { ...previous?.fields, ...patch.fields } });
    setHasGeometryPreview(true);
    if (activePointer.current === null && geometryTimer.current === null) geometryTimer.current = window.setTimeout(flushGeometry, 100);
  }, [flushGeometry]);

  const submit = useCallback((mutations: DocumentMutation[]) => {
    flushGeometry();
    return recordWrite(mutations);
  }, [recordWrite, flushGeometry]);

  const runElementBatch = useCallback((edit: () => void) => {
    const store = elementStoreRef.current;
    if (!isV2 || elementBatch.current) {
      store.batch(edit);
      return;
    }
    flushGeometry();
    const batch: DocumentMutation[] = [];
    elementBatch.current = batch;
    try {
      store.batch(edit);
    } finally {
      elementBatch.current = null;
    }
    if (batch.length) void recordWrite(batch);
  }, [flushGeometry, isV2, recordWrite]);

  const { isErasing, eraserPosition, setEraserPosition, startErasing, continueErasing, endErasing: endErasingHook } = useEraser({
    elementStoreRef, toolOptions, editStroke: runElementBatch,
  });

  useLayoutEffect(() => {
    elementStoreRef.current.setEditingContext(canEdit, isV2 ? currentPageId : undefined, !isV2);
  }, [canEdit, currentPageId, isV2]);

  useEffect(() => {
    if (!isV2) return;
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushGeometry();
    };
    const finishPointer = (event: PointerEvent) => {
      if (activePointer.current !== event.pointerId) return;
      activePointer.current = null;
      flushGeometry();
    };
    window.addEventListener('pointerup', finishPointer, true);
    window.addEventListener('blur', flushGeometry);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pointerup', finishPointer, true);
      window.removeEventListener('blur', flushGeometry);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [flushGeometry, isV2]);

  useEffect(() => () => {
    if (geometryTimer.current !== null) window.clearTimeout(geometryTimer.current);
  }, []);

  useEffect(() => {
    if (!isV2 || (!hasGeometryPreview && boardSync.status !== 'saving-local')) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (geometry.current.size) flushGeometry();
      if (localWrites.current.size === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [boardSync.status, flushGeometry, hasGeometryPreview, isV2]);
  
  // User preferences
  const [currentUsername, setCurrentUsername] = useState(username);
  const [currentUserColor, setCurrentUserColor] = useState(color);
  const [currentUserAvatarUrl, setCurrentUserAvatarUrl] = useState<string | undefined>(undefined);
  const [isPinned, setIsPinned] = useState(false);
  
  // UI state
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [initialReviewThread] = useState(() => new URLSearchParams(window.location.search).get('thread') ?? undefined);
  const [showReview, setShowReview] = useState(Boolean(initialReviewThread));
  const [showVersions, setShowVersions] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const [agentPreview, setAgentPreview] = useState<AgentPreview>();
  const [agentProfile, setAgentProfile] = useState<AgentProfile>();
  const [editAgentProfile, setEditAgentProfile] = useState(false);
  const [attributions, setAttributions] = useState<{ page: string; entries: Map<string, AgentAttribution> }>();
  const showAssistant = showAgent || Boolean(sharedRunId);
  const closeAssistant = () => {
    setShowAgent(false);
    if (sharedRunId !== undefined) {
      const next = new URLSearchParams(searchParams);
      next.delete('conversation');
      setSearchParams(next, { replace: true });
    }
  };

  useEffect(() => {
    if (!showAgent || !canEdit) return;
    const controller = new AbortController();
    void readAgentProfile(controller.signal).then(profile => {
      if (!controller.signal.aborted) setAgentProfile(profile);
    }).catch(() => {});
    return () => controller.abort();
  }, [canEdit, showAgent]);

  useEffect(() => {
    if (!isV2 || !canUseBoard || !currentPageId || !boardSync.isConnected) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void readAgentAttributions(boardId, currentPageId, controller.signal).then(entries => {
        if (!controller.signal.aborted) setAttributions({ page: currentPageId, entries });
      }).catch(() => {});
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [boardId, boardSync.epoch, boardSync.isConnected, boardSync.seq, canUseBoard, currentPageId, isV2]);

  const ghostElements = useMemo(() => (
    agentPreview?.placement === 'current-page' && agentPreview.pageId === currentPageId
      ? agentPreview.operations.flatMap(operation => operation.kind === 'add' && operation.collection === 'elements' && 'type' in operation.value
        ? [operation.value] : [])
      : []
  ), [agentPreview, currentPageId]);
  const [reviewPickingPoint, setReviewPickingPoint] = useState(false);
  const [pickedReviewLocation, setPickedReviewLocation] = useState<ReviewLocation>();
  const [focusedReviewLocation, setFocusedReviewLocation] = useState<ReviewLocation>();
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [showFileInfo, setShowFileInfo] = useState(false);
  const [showTableCreation, setShowTableCreation] = useState(false);
  const [showTimerCreation, setShowTimerCreation] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [pageToDelete, setPageToDelete] = useState<Page | null>(null);
  const [deleteBoardDialogOpen, setDeleteBoardDialogOpen] = useState(false);
  const [conflictToDiscard, setConflictToDiscard] = useState<string | null>(null);
  const [discardingConflict, setDiscardingConflict] = useState(false);
  const [boardActionBusy, setBoardActionBusy] = useState(false);
  const isBoardOwner = isLegacy ? legacyOwner : boardSync.permission === 'owner';
  const canReview = isV2 && ['owner', 'edit', 'comment'].includes(boardSync.permission ?? '');
  const canViewVersions = isV2 && ['owner', 'edit'].includes(boardSync.permission ?? '');
  const reviewOnline = isV2 && !['offline', 'loading', 'revoked'].includes(boardSync.status);
  const unsavedDraft = boardSync.conflict?.code === 'LOCAL_WRITE_REJECTED';

  // Selected element for property inspector
  const selectedElement = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const id = Array.from(selectedIds)[0];
    return elements.find((el) => el.id === id) || null;
  }, [selectedIds, elements]);
  
  // File info
  const fileInfo = useMemo(() => ({
    id: boardId,
    name: boardName,
    createdAt: new Date(Date.now() - 7 * 24 * 3600000),
    updatedAt: new Date(),
    createdBy: currentUsername,
    size: '2.4 KB',
    elementsCount: elements.length,
  }), [boardId, boardName, currentUsername, elements.length]);

  const handleRemoteElementsChanged = useCallback(() => {
    setElements(elementStoreRef.current.getElements());
  }, []);

  const legacyCollaboration = useCollaboration({
    roomId: boardId,
    userId,
    elementStore: elementStoreRef.current,
    onElementsChanged: handleRemoteElementsChanged,
    enabled: isLegacy && legacyReady,
  });
  const {
    isConnected: isCollaborationConnected,
    collaborators: remoteCollaborators,
    cursors: remoteCursors,
    sendCursor,
  } = isLegacy ? legacyCollaboration : boardSync;

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
      email: email ?? '',
      avatarUrl: currentUserAvatarUrl,
      color: currentUserColor,
      permission: canEdit ? 'edit' : 'view',
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
  ], [userId, currentUsername, email, currentUserAvatarUrl, currentUserColor, remoteCollaborators, canEdit]);
  const [shareLinkPermission, setShareLinkPermission] = useState<LinkPermission>('restricted');
  const [shareMembers, setShareMembers] = useState<RoomMember[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // Structured load error: carries the HTTP status so we can tell "no access"
  // (403) / "not found" (404) apart from a transient network failure, and offer
  // the right next step instead of a dead-end retry.
  const [boardLoadError, setBoardLoadError] = useState<{ message: string; status?: number } | null>(null);
  const boardUpdatedAtRef = useRef<string | undefined>(undefined);

  // Reload board and merge after a save conflict (optimistic-lock mismatch)
  const handleSaveConflict = useCallback((remoteBoard: BoardData) => {
    const savedElements = Array.isArray(remoteBoard.elements) ? remoteBoard.elements as Element[] : [];
    const savedStamps = Array.isArray(remoteBoard.stamps) ? remoteBoard.stamps as Stamp[] : [];
    const savedPages = Array.isArray(remoteBoard.pages) && remoteBoard.pages.length > 0
      ? remoteBoard.pages as Page[]
      : pages;
    boardUpdatedAtRef.current = remoteBoard.updatedAt;
    elementStoreRef.current.loadSavedElements(savedElements);
    setStamps(savedStamps);
    setPages(savedPages);
    setCurrentPageId(remoteBoard.currentPageId || savedPages[0]?.id || currentPageId);
  }, [pages, currentPageId]);

  // Debounced autosave
  const { saveStatus, saveError, markDirty, saveToDatabase, getSavedUpdatedAt } = useAutoSave({
    boardId,
    getElements: () => elementStoreRef.current.getElements(),
    getBoardName: () => boardName,
    getStamps: () => allStamps,
    getPages: () => pages,
    getCurrentPageId: () => currentPageId,
    getExpectedUpdatedAt: () => boardUpdatedAtRef.current,
    onConflict: handleSaveConflict,
    enabled: isLegacy && legacyReady && legacyEditable && !boardLoadError,
  });

  // Sync the optimistic-lock version after a successful save
  useEffect(() => {
    if (isLegacy && saveStatus === 'saved') {
      const saved = getSavedUpdatedAt();
      if (saved) boardUpdatedAtRef.current = saved;
    }
  }, [isLegacy, saveStatus, getSavedUpdatedAt]);

  const displayedSaveStatus = isLegacy ? (legacyReady ? saveStatus : 'loading')
    : hasGeometryPreview && (boardSync.status === 'synced' || boardSync.status === 'offline')
      ? 'saving-local' : boardSync.status;
  const connectionState = (isLegacy ? saveStatus : boardSync.status) === 'offline'
    ? 'offline' : isCollaborationConnected ? 'connected' : 'connecting';

  const handleBoardNameChange = useCallback((name: string, expectedName: string) => {
    if (!canEdit || name === expectedName) return;
    setBoardName(name);
    if (isV2) void submit([{ kind: 'rename', value: name, expected: { name: expectedName } }]);
    else markDirty();
  }, [canEdit, isV2, markDirty, submit]);

  const save = useCallback(() => {
    if (isLegacy) {
      if (canEdit) void saveToDatabase();
      return;
    }
    flushGeometry();
    retry();
  }, [canEdit, flushGeometry, isLegacy, retry, saveToDatabase]);

  const loadShareSettings = useCallback(async () => {
    setShareLoading(true);
    setShareError(null);

    try {
      const settings = await getRoomShareSettings(boardId);
      setShareLinkPermission(settings.linkPermission);
      setShareMembers(settings.members || []);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Failed to load sharing settings');
    } finally {
      setShareLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    if (showShareDialog && isLegacy) {
      void loadShareSettings();
    }
  }, [isLegacy, loadShareSettings, showShareDialog]);

  const handleChangeLinkPermission = useCallback(async (permission: LinkPermission) => {
    const previousPermission = shareLinkPermission;
    setShareSaving(true);
    setShareError(null);
    setShareLinkPermission(permission);

    try {
      const settings = await updateRoomShareSettings(boardId, permission);
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
  }, [boardId, shareLinkPermission]);

  const handleInviteMember = useCallback(async (email: string, permission: MemberPermission) => {
    setShareSaving(true);
    setShareError(null);

    try {
      const member = await inviteRoomMember(boardId, email, permission);
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
  }, [boardId]);

  const handleRemoveMember = useCallback(async (memberId: string) => {
    setShareSaving(true);
    setShareError(null);

    try {
      await removeRoomMember(boardId, memberId);
      setShareMembers((current) => current.filter((member) => member.userId !== memberId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove member';
      setShareError(message);
      throw err;
    } finally {
      setShareSaving(false);
    }
  }, [boardId]);
  
  // Interaction state
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const { selectionBox, setSelectionBox, handleSelect, selectAll, getSelectedFromBox } = useSelection({
    elements, stamps, objectBounds, setSelectedIds,
  });
  const { isDrawing, drawingPath, startDrawing, continueDrawing, endDrawing, cancelDrawing } = useDrawing({
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

  useLayoutEffect(() => {
    const store = elementStoreRef.current;
    return store.on('operation', (op, previous) => {
      if (isLegacy) {
        markDirty();
        return;
      }
      if (!isV2) return;
      const mutation = elementMutation(op, store.getElementById(op.elementId), previous);
      if (!mutation) return;
      if (elementBatch.current) elementBatch.current.push(mutation);
      else if (isGeometryPatch(mutation)) queueGeometry(mutation);
      else void submit([mutation]);
    });
  }, [isLegacy, isV2, markDirty, queueGeometry, submit]);

  useEffect(() => {
    if (!isLegacy) return;
    let cancelled = false;
    setLegacyReady(false);
    setBoardLoadError(null);
    const loadBoardFromDatabase = async () => {
      try {
        const [data, room] = await Promise.all([loadBoard(boardId), getRoom(boardId)]);
        if (cancelled) return;
        setBoardName(data.name || room.name);
        boardUpdatedAtRef.current = data.updatedAt;
        const savedElements = Array.isArray(data.elements) ? data.elements as Element[] : [];
        const savedStamps = Array.isArray(data.stamps) ? data.stamps as Stamp[] : [];
        const savedPages = Array.isArray(data.pages) && data.pages.length > 0
          ? data.pages as Page[]
          : [{ id: 'page-1', name: 'Page 1' }];
        const owner = room.permission === 'owner' || room.ownerId === userId;
        elementStoreRef.current.loadSavedElements(savedElements);
        setStamps(savedStamps);
        setPages(savedPages);
        setCurrentPageId(data.currentPageId || savedPages[0].id);
        setDefaultPageId(data.currentPageId || savedPages[0].id);
        setLegacyOwner(owner);
        setLegacyEditable(owner || room.permission === 'edit');
        setLegacyReady(true);
      } catch (err) {
        if (cancelled) return;
        const status = err instanceof ApiError ? err.status : undefined;
        const message = err instanceof Error ? err.message : 'Failed to load board data';
        setBoardLoadError({ message, status });
      }
    };
    void loadBoardFromDatabase();
    return () => { cancelled = true; };
  }, [boardId, isLegacy, legacyReload, userId]);

  const visibleIds = useMemo(() => new Set([...elements, ...stamps].map(record => record.id)), [elements, stamps]);
  useEffect(() => {
    setSelectedIds(ids => {
      if ([...ids].every(id => visibleIds.has(id))) return ids;
      return new Set([...ids].filter(id => visibleIds.has(id)));
    });
    setEditingId(id => canEdit && id && visibleIds.has(id) ? id : null);
  }, [canEdit, visibleIds]);
  
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
  const handleUpdate = useCallback((id: string, changes: Partial<Element>, expected?: Record<string, unknown>) => {
    elementStoreRef.current.updateElement(id, changes, expected);
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
    if (canEdit) setEditingId(id);
  }, [canEdit]);
  
  // Handle end editing
  const handleEndEdit = useCallback(() => {
    setEditingId(null);
  }, []);
  
  // Delete selected elements
  const deleteSelected = useCallback(() => {
    if (!canEdit) return;
    const selectedElements = elements.filter(element => selectedIds.has(element.id) && !element.locked);
    const removedStamps = stamps.filter(stamp => selectedIds.has(stamp.id));
    if (isV2) {
      const operations: DocumentMutation[] = [
        ...selectedElements.map(element => ({ kind: 'delete' as const, collection: 'elements' as const, id: element.id, expected: { ...element } })),
        ...removedStamps.map(stamp => ({ kind: 'delete' as const, collection: 'stamps' as const, id: stamp.id, expected: { ...stamp } })),
      ];
      void submit(operations);
    } else {
      runElementBatch(() => selectedElements.forEach(element => elementStoreRef.current.deleteElement(element.id)));
      if (removedStamps.length) {
        setStamps(prev => prev.filter(stamp => !selectedIds.has(stamp.id)));
        markDirty();
      }
    }
    setSelectedIds(new Set());
  }, [canEdit, elements, isV2, markDirty, runElementBatch, selectedIds, stamps, submit]);

  const { undo: undoDocument, redo: redoDocument } = boardSync;
  const replayHistory = useCallback((reversing: boolean) => {
    if (!canEdit) return;
    if (isV2) {
      flushGeometry();
      void (reversing ? undoDocument() : redoDocument());
      return;
    }
    const store = elementStoreRef.current;
    const hasHistory = reversing ? store.canUndo() : store.canRedo();
    if (!hasHistory) return;
    if (!(reversing ? store.undo() : store.redo())) {
      setNoticeDialog({
        title: reversing ? 'Could not undo the edit' : 'Could not redo the edit',
        message: 'The object has changed since this action. Review the latest version on the canvas.',
      });
    }
  }, [canEdit, flushGeometry, isV2, redoDocument, undoDocument]);
  const undo = useCallback(() => replayHistory(true), [replayHistory]);
  const redo = useCallback(() => replayHistory(false), [replayHistory]);
  
  // Clipboard operations
  const insertCopies = useCallback((copies: Element[], stampCopies: Stamp[]) => {
    if (!canEdit || (!copies.length && !stampCopies.length)) return;
    const selectCopies = () => setSelectedIds(new Set([...copies, ...stampCopies].map(item => item.id)));
    if (isV2) {
      const operations: DocumentMutation[] = [
        ...copies.map(value => ({ kind: 'add' as const, collection: 'elements' as const, id: value.id, value })),
        ...stampCopies.map(value => ({ kind: 'add' as const, collection: 'stamps' as const, id: value.id, value })),
      ];
      void submit(operations).then(saved => { if (saved) selectCopies(); });
      return;
    }
    runElementBatch(() => copies.forEach(element => elementStoreRef.current.addElement(element)));
    if (stampCopies.length) {
      setStamps(previous => [...previous, ...stampCopies]);
      markDirty();
    }
    selectCopies();
  }, [canEdit, isV2, markDirty, runElementBatch, submit]);
  const { hasClipboard, duplicateSelected, copySelected, cutSelected, pasteElements } = useClipboard({
    elements, stamps, selectedIds, currentPageId: isV2 ? currentPageId : undefined,
    userId, insertCopies, onDelete: deleteSelected,
  });

  // selectAll is provided by useSelection hook
  
  // Bring to front / send to back
  const changeLayers = useCallback((front: boolean) => {
    const moving = elements.filter(element => selectedIds.has(element.id) && !element.locked);
    const edge = elements.reduce((value, element) => front ? Math.max(value, element.zIndex) : Math.min(value, element.zIndex), 0);
    runElementBatch(() => moving.forEach((element, index) => {
      elementStoreRef.current.reorderElement(element.id, front ? edge + index + 1 : edge - moving.length + index);
    }));
  }, [elements, runElementBatch, selectedIds]);
  const bringToFront = useCallback(() => changeLayers(true), [changeLayers]);
  const sendToBack = useCallback(() => changeLayers(false), [changeLayers]);
  
  // Lock/Unlock elements
  const lockSelected = useCallback(() => {
    const selected = elements.filter(element => selectedIds.has(element.id));
    const locked = selected.some(element => !element.locked);
    runElementBatch(() => selected.forEach(element => {
      if (element.locked !== locked) elementStoreRef.current.lockElement(element.id, locked);
    }));
  }, [elements, runElementBatch, selectedIds]);
  
  const unlockAll = useCallback(() => {
    runElementBatch(() => elements.forEach(element => {
      if (element.locked) elementStoreRef.current.lockElement(element.id, false);
    }));
  }, [elements, runElementBatch]);
  
  // Group/Ungroup elements
  const groupSelected = useCallback(() => {
    const selected = elements.filter(element => selectedIds.has(element.id));
    if (selected.length < 2 || selected.some(element => element.locked)) return;
    const groupId = generateElementId();
    runElementBatch(() => selected.forEach(element => elementStoreRef.current.updateElement(element.id, { groupId })));
  }, [elements, runElementBatch, selectedIds]);
  
  const ungroupSelected = useCallback(() => {
    runElementBatch(() => elements.forEach(element => {
      if (selectedIds.has(element.id) && element.groupId && !element.locked) {
        elementStoreRef.current.updateElement(element.id, { groupId: undefined });
      }
    }));
  }, [elements, runElementBatch, selectedIds]);
  
  // Page management
  const {
    handleAddPage,
    handleSelectPage,
    handleRenamePage,
    handleDuplicatePage,
    handleDeletePage,
    handleReorderPage,
    handleDefaultPage,
  } = usePages({
    pages, currentPageId, setPages, setCurrentPageId, markDirty, canEdit,
    submit: isV2 ? submit : undefined,
    elementStore, stamps: allStamps, userId, defaultPageId, onNotice: setNoticeDialog,
  });
  const selectBoardPage = useCallback((pageId: string) => {
    stopFollowing();
    handleSelectPage(pageId);
  }, [handleSelectPage, stopFollowing]);

  const moveSelectionToPage = useCallback((pageId: string) => {
    if (!isV2 || !canEdit || !selectedIds.size || pageId === currentPageId) return;
    const moving = pageMoveSelection(elements, selectedIds);
    if (!moving) {
      setNoticeDialog({ title: 'Selection has linked objects', message: 'Select the connected objects together and unlock them before moving to another page.' });
      return;
    }
    const operations: DocumentMutation[] = [
      ...moving.map(element => ({
        kind: 'patch' as const, collection: 'elements' as const, id: element.id, fields: { pageId },
        expected: { pageId: element.pageId, groupId: element.groupId ?? null },
      })),
      ...stamps.filter(stamp => selectedIds.has(stamp.id)).map(stamp => ({
        kind: 'patch' as const, collection: 'stamps' as const, id: stamp.id, fields: { pageId }, expected: { pageId: stamp.pageId },
      })),
    ];
    void submit(operations).then(saved => { if (saved) setCurrentPageId(pageId); });
  }, [canEdit, currentPageId, elements, isV2, selectedIds, stamps, submit]);

  const copyPageLink = useCallback(async (pageId: string, elementId?: string) => {
    try {
      const url = new URL(`/board/${encodeURIComponent(boardId)}`, window.location.origin);
      url.searchParams.set('page', pageId);
      if (elementId) url.searchParams.set('element', elementId);
      await navigator.clipboard.writeText(url.toString());
      return true;
    } catch {
      return false;
    }
  }, [boardId]);
  
  // User profile update handler
  const handleUpdateProfile = useCallback((settings: { username: string; color: string; avatarUrl?: string }) => {
    setCurrentUsername(settings.username);
    setCurrentUserColor(settings.color);
    if (settings.avatarUrl !== undefined) {
      setCurrentUserAvatarUrl(settings.avatarUrl);
    }
  }, []);
  
  // Alignment and distribution
  const {
    alignLeft,
    alignCenter,
    alignRight,
    alignTop,
    alignMiddle,
    alignBottom,
    distributeHorizontally,
    distributeVertically,
  } = useAlignDistribute({ elements, selectedIds, elementStoreRef, runElementBatch });
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
      elements: allElements,
      stamps: allStamps,
      pages,
      currentPageId: defaultPageId || currentPageId,
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `${boardName}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }, [boardName, allElements, allStamps, currentPageId, defaultPageId, pages]);
  
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
  
  const handlePointerDownCapture = useCallback((event: React.PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    stopFollowing();
    if (isV2 && activePointer.current === null && geometry.current.size) flushGeometry();
    activePointer.current = event.pointerId;
  }, [flushGeometry, isV2, stopFollowing]);

  const hitElement = useCallback((x: number, y: number) => {
    const point = { left: x, right: x, top: y, bottom: y };
    for (let index = renderElements.length - 1; index >= 0; index--) {
      const element = renderElements[index];
      const bounds = objectBounds.get(element.id);
      if (bounds && overlapsBounds(expandBounds(bounds, 5 / scale), point)) return element;
    }
  }, [objectBounds, renderElements, scale]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (contextMenu) setContextMenu(null);
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-widget], [data-canvas-stamp], input, textarea, button, select, [contenteditable]')) return;
    if (event.pointerType !== 'mouse' || (currentTool !== 'select' && canEdit)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const point = screenToCanvas(event.clientX, event.clientY);
    if (reviewPickingPoint && canReview) {
      const location = { pageId: currentPageId, x: point.x, y: point.y };
      setPickedReviewLocation(location);
      setFocusedReviewLocation(location);
      setReviewPickingPoint(false);
      return;
    }
    if (currentTool === 'pan') {
      setIsPanning(true);
      setDragStart({ x: event.clientX, y: event.clientY });
      return;
    }
    if (currentTool === 'select' || !canEdit) {
      const element = hitElement(point.x, point.y);
      if (!element) {
        setSelectionBox({ start: point, end: point });
        return;
      }
      if (event.shiftKey) return;
      const startingIds = selectedIds.has(element.id) ? selectedIds : new Set(selectionGroup(elements, element.id));
      if (!selectedIds.has(element.id)) setSelectedIds(startingIds);
      if (!canEdit || element.locked) return;
      const moving = movementSelection(elements, startingIds).filter(item => !item.locked);
      if (isV2 && moving.length > MAX_BATCH_OPERATIONS) {
        setNoticeDialog({ title: 'Selection exceeds the move limit', message: 'Select fewer objects before moving them.' });
        return;
      }
      startDragMove(point, moving.map(item => item.id), id => elementStoreRef.current.getElementById(id));
      return;
    }
    if (['sticky', 'shape', 'text', 'connector', 'frame'].includes(currentTool)) {
      startDragCreate(point, currentTool);
      return;
    }
    if (currentTool === 'stamp' && selectedStampEmoji) {
      const stamp: Stamp = {
        id: generateStampId(), emoji: selectedStampEmoji, x: point.x, y: point.y, scale: 1,
        rotation: Math.random() * 20 - 10, userId, createdAt: Date.now(),
        ...(isV2 ? { pageId: currentPageId } : {}),
      };
      if (isV2) void submit([{ kind: 'add', collection: 'stamps', id: stamp.id, value: stamp }]);
      else {
        setStamps(previous => [...previous, stamp]);
        markDirty();
      }
      return;
    }
    if (currentTool === 'draw' || currentTool === 'marker') startDrawing(point);
    else if (currentTool === 'eraser') startErasing(point, elements);
  }, [canEdit, canReview, contextMenu, currentPageId, currentTool, elements, hitElement, isV2, markDirty, reviewPickingPoint,
    screenToCanvas, selectedIds, selectedStampEmoji, setSelectionBox, startDragCreate, startDragMove, startDrawing, startErasing, submit, userId]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    const point = screenToCanvas(event.clientX, event.clientY);
    sendCursor(point.x, point.y);
    if (currentTool === 'eraser') setEraserPosition(point);
    else setEraserPosition(null);
    if (isPanning) {
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      setOffset(previous => ({ x: previous.x + dx, y: previous.y + dy }));
      setDragStart({ x: event.clientX, y: event.clientY });
    } else if (currentTool === 'select' && selectionBox) {
      setSelectionBox(previous => previous ? { ...previous, end: point } : null);
    } else if (isInkTool && activePointer.current === event.pointerId) {
      const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
      const points = samples.map(sample => screenToCanvas(sample.clientX, sample.clientY));
      points.push(point);
      if (currentTool === 'eraser') continueErasing(points, elements);
      else continueDrawing(points);
    }
    else if (dragCreateStart) updateDragCreate(point);
    else if (dragMoveStart) updateDragMove(point, snapToGrid);
  }, [continueDrawing, continueErasing, currentTool, dragCreateStart, dragMoveStart, dragStart, elements,
    isInkTool, isPanning, screenToCanvas, selectionBox, sendCursor, setEraserPosition,
    setSelectionBox, snapToGrid, updateDragCreate, updateDragMove]);

  const finishCanvasGesture = useCallback((point?: { x: number; y: number }) => {
    activePointer.current = null;
    if (isPanning) setIsPanning(false);
    else if (currentTool === 'select' && selectionBox) {
      setSelectedIds(getSelectedFromBox(selectionBox));
      setSelectionBox(null);
    } else if (currentTool === 'draw' || currentTool === 'marker') endDrawing(point);
    else if (currentTool === 'eraser') {
      if (point) continueErasing([point], elements);
      endErasingHook();
    }
    else if (dragCreateStart) {
      endDragCreate({
        getAnchor: point => findAnchor(renderElements, point, 8 / scale),
        getFrameChildren: bounds => elements.filter(element => {
          const child = objectBounds.get(element.id);
          return child && withinBounds(bounds, child);
        }).map(element => element.id),
      });
    } else if (dragMoveStart) endDragMove();
    if (isV2 && geometry.current.size) flushGeometry();
  }, [continueErasing, currentTool, dragCreateStart, dragMoveStart, elements, endDragCreate, endDragMove, endDrawing, endErasingHook, flushGeometry,
    getSelectedFromBox, isPanning, isV2, objectBounds, renderElements, scale, selectionBox, setSelectionBox]);

  const cancelCanvasGesture = useCallback(() => {
    activePointer.current = null;
    resizeGesture.current = null;
    setIsPanning(false);
    setSelectionBox(null);
    cancelDrawing();
    cancelDragCreate();
    endDragMove();
    endErasingHook();
    if (isV2 && geometry.current.size) {
      clearGeometry();
      if (projectedDocument.current) applyDocument(projectedDocument.current, projectedEpoch.current);
    }
  }, [applyDocument, cancelDragCreate, cancelDrawing, clearGeometry, endDragMove, endErasingHook, isV2, setSelectionBox]);

  useEffect(() => {
    cancelCanvasGesture();
  }, [boardSync.epoch, currentPageId, currentTool, cancelCanvasGesture]);

  // Zoom functions (defined early for use in context menu)
  const zoomAtCenter = useCallback((next: number) => {
    stopFollowing();
    const zoom = Math.max(0.1, Math.min(5, next));
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    setOffset(previous => ({ x: center.x + (previous.x - center.x) * zoom / scale, y: center.y + (previous.y - center.y) * zoom / scale }));
    setScale(zoom);
  }, [scale, stopFollowing, viewport]);
  const handleZoomIn = useCallback(() => zoomAtCenter(scale * 1.2), [scale, zoomAtCenter]);
  const handleZoomOut = useCallback(() => zoomAtCenter(scale / 1.2), [scale, zoomAtCenter]);
  const handleZoomReset = useCallback(() => zoomAtCenter(1), [zoomAtCenter]);
  const handleZoomFit = useCallback(() => {
    stopFollowing();
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const box of [...objectBounds.values(), ...stamps.map(stamp => ({ left: stamp.x - 16, top: stamp.y - 16, right: stamp.x + 16, bottom: stamp.y + 16 }))]) {
      bounds.left = Math.min(bounds.left, box.left);
      bounds.top = Math.min(bounds.top, box.top);
      bounds.right = Math.max(bounds.right, box.right);
      bounds.bottom = Math.max(bounds.bottom, box.bottom);
    }
    if (!Number.isFinite(bounds.left)) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
      return;
    }
    const next = Math.max(0.1, Math.min(1.5, (viewport.width - 128) / Math.max(1, bounds.right - bounds.left),
      (viewport.height - 170) / Math.max(1, bounds.bottom - bounds.top)));
    setScale(next);
    setOffset({ x: viewport.width / 2 - (bounds.left + bounds.right) * next / 2,
      y: viewport.height / 2 - (bounds.top + bounds.bottom) * next / 2 });
  }, [objectBounds, stamps, stopFollowing, viewport]);

  const centerOn = useCallback((x: number, y: number) => {
    setOffset({ x: viewport.width / 2 - x * scale, y: viewport.height / 2 - y * scale });
  }, [scale, viewport]);

  const focusBoardLocation = useCallback((location: { pageId: string; elementId?: string; x?: number; y?: number }) => {
    if (!pages.some(page => page.id === location.pageId)) return;
    selectBoardPage(location.pageId);
    const object = location.elementId ? elementStoreRef.current.getElementById(location.elementId) : undefined;
    if (object && (object.pageId === location.pageId || isLegacy)) {
      const bounds = elementBounds(resolveConnector(object, new Map(allElements.map(item => [item.id, item]))));
      centerOn((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
      setSelectedIds(new Set([object.id]));
    } else if (typeof location.x === 'number' && typeof location.y === 'number') centerOn(location.x, location.y);
  }, [allElements, centerOn, isLegacy, pages, selectBoardPage]);

  const pageSections = useMemo(() => elements.flatMap(element => element.type === 'frame'
    ? [{ id: element.id, name: element.name || 'Untitled section' }] : []), [elements]);

  const focusReviewAnchor = useCallback((anchor: ReviewAnchor) => {
    if (!anchor.currentPageId) return;
    const location = { pageId: anchor.currentPageId, elementId: anchor.status === 'missing-object' ? undefined : anchor.elementId,
      x: anchor.x, y: anchor.y };
    setFocusedReviewLocation(location);
    focusBoardLocation(location);
  }, [focusBoardLocation]);

  useEffect(() => {
    const elementId = initialLocation.current.get('element');
    if (!elementId || !currentPageId || !viewport.width) return;
    initialLocation.current.delete('element');
    focusBoardLocation({ pageId: currentPageId, elementId });
  }, [currentPageId, focusBoardLocation, viewport.width]);

  const startResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!canEdit || !selectedElement || selectedElement.locked || event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
    resizeGesture.current = { element: selectedElement, x: event.clientX, y: event.clientY };
  }, [canEdit, selectedElement]);

  const resizeSelection = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = resizeGesture.current;
    if (!gesture || activePointer.current !== event.pointerId || !canEdit) return;
    event.stopPropagation();
    const dx = (event.clientX - gesture.x) / scale;
    const dy = (event.clientY - gesture.y) / scale;
    const element = gesture.element;
    const angle = (element.rotation || 0) * Math.PI / 180;
    let width = Math.max(32, element.width + dx * Math.cos(angle) + dy * Math.sin(angle));
    let height = Math.max(32, element.height - dx * Math.sin(angle) + dy * Math.cos(angle));
    if ((element.type === 'shape' && element.shapeType === 'circle') || (element.type === 'sticky' && element.stickyShape === 'circle') || event.shiftKey) {
      const ratio = element.width / Math.max(element.height, 1);
      if (width / height > ratio) height = width / ratio;
      else width = height * ratio;
    }
    handleResize(element.id, width, height);
  }, [canEdit, handleResize, scale]);

  const nudgeSelection = useCallback((dx: number, dy: number) => {
    const moving = movementSelection(elements, selectedIds).filter(element => !element.locked);
    if (!canEdit || !moving.length) return;
    runElementBatch(() => moving.forEach(element => elementStoreRef.current.moveElement(element.id, element.x + dx, element.y + dy)));
  }, [canEdit, elements, runElementBatch, selectedIds]);

  // Delete stamp by id
  const deleteStamp = useCallback((stampId: string) => {
    const stamp = stamps.find(item => item.id === stampId);
    if (!canEdit || !stamp) return;
    if (isV2) void submit([{ kind: 'delete', collection: 'stamps', id: stampId, expected: { ...stamp } }]);
    else {
      setStamps((prev) => prev.filter((s) => s.id !== stampId));
      markDirty();
    }
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(stampId);
      return newSet;
    });
  }, [canEdit, isV2, markDirty, stamps, submit]);

  const moveStamp = useCallback((id: string, x: number, y: number) => {
    if (!canEdit || !stamps.some(stamp => stamp.id === id)) return;
    setStamps(previous => previous.map(stamp => stamp.id === id ? { ...stamp, x, y } : stamp));
    if (isV2) queueGeometry({ kind: 'patch', collection: 'stamps', id, fields: { x, y } });
    else markDirty();
  }, [canEdit, isV2, markDirty, queueGeometry, stamps]);

  // Handle right-click context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!canEdit || (e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
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
      
      const clickedElement = hitElement(canvas.x, canvas.y);

      if (clickedElement) {
        // Select if not already selected
        if (!selectedIds.has(clickedElement.id)) {
          setSelectedIds(new Set(selectionGroup(elements, clickedElement.id)));
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
          Boolean(clickedElement.groupId),
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
          hasClipboard,
          undo,
          redo,
        );
        setContextMenu({ x: e.clientX, y: e.clientY, items });
      }
    },
    [canEdit, elements, stamps, selectedIds, screenToCanvas, duplicateSelected, deleteSelected, copySelected, bringToFront, sendToBack, lockSelected, groupSelected, ungroupSelected, pasteElements, selectAll, hasClipboard, hitElement, handleZoomIn, handleZoomOut, handleZoomFit, deleteStamp, undo, redo]
  );
  
  // Handle zoom with wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      stopFollowing();
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
    [scale, offset, stopFollowing]
  );
  
  // Keyboard shortcuts
  useKeyboardShortcuts({
    editingId,
    editable: canEdit,
    onDelete: deleteSelected,
    onDuplicate: duplicateSelected,
    onCopy: copySelected,
    onPaste: pasteElements,
    onUndo: undo,
    onRedo: redo,
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
    },
    onEscape: () => {
      setCurrentTool('select');
      setEditingId(null);
      setContextMenu(null);
    },
    onSave: save,
    onCut: cutSelected,
    onToggleLock: lockSelected,
    onNudge: nudgeSelection,
    onGroup: groupSelected,
    onUngroup: ungroupSelected,
  });
  
  const visibleCanvasBounds = useMemo(() => expandBounds({
    left: -offset.x / scale, top: -offset.y / scale,
    right: (viewport.width - offset.x) / scale, bottom: (viewport.height - offset.y) / scale,
  }, 160 / scale), [offset, scale, viewport]);
  const visibleElements = useMemo(() => renderElements.filter(element => {
    const bounds = objectBounds.get(element.id);
    return !viewport.width || element.id === editingId || (bounds && overlapsBounds(bounds, visibleCanvasBounds));
  }), [editingId, objectBounds, renderElements, viewport.width, visibleCanvasBounds]);
  const visibleStamps = useMemo(() => stamps.filter(stamp => !viewport.width || overlapsBounds(visibleCanvasBounds, {
    left: stamp.x - 22, right: stamp.x + 22, top: stamp.y - 22, bottom: stamp.y + 22,
  })), [stamps, viewport.width, visibleCanvasBounds]);
  const resizable = canEdit && !isInkTool && !editingId && selectedElement && !selectedElement.locked
    && !['widget', 'connector', 'drawing'].includes(selectedElement.type) ? selectedElement : undefined;
  const resizeHandle = resizable ? (() => {
    const angle = (resizable.rotation || 0) * Math.PI / 180;
    return {
      x: resizable.x + (resizable.width + resizable.width * Math.cos(angle) - resizable.height * Math.sin(angle)) / 2,
      y: resizable.y + (resizable.height + resizable.width * Math.sin(angle) + resizable.height * Math.cos(angle)) / 2,
    };
  })() : undefined;
  
  // Get cursor based on tool
  const getCursor = () => {
    if (reviewPickingPoint) return 'crosshair';
    switch (currentTool) {
      case 'pan':
        return isPanning ? 'grabbing' : 'grab';
      case 'draw':
      case 'marker':
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
    { id: 'stamp', label: 'Stamp tool', category: 'Tools', shortcut: 'E', action: () => setCurrentTool('stamp') },
    { id: 'eraser', label: 'Eraser tool', category: 'Tools', shortcut: 'X', action: () => setCurrentTool('eraser') },
    { id: 'frame', label: 'Frame tool', category: 'Tools', shortcut: 'F', action: () => setCurrentTool('frame') },
    { id: 'undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z', action: undo },
    { id: 'redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Shift+Z', action: redo },
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
  ].filter(command => canEdit || ['select', 'pan', 'copy', 'selectAll', 'share', 'help'].includes(command.id) || command.category === 'View'),
  [canEdit, undo, redo, copySelected, pasteElements, duplicateSelected, selectAll, deleteSelected, handleZoomIn, handleZoomOut, handleZoomReset, handleZoomFit]);

  return (
    <div className="relative w-full h-full overflow-clip" style={{ background: 'var(--surface-canvas)' }}>
      {/* Menu Bar — self-positions absolute top-right, includes avatar stack */}
      <MenuBar
        canUndo={isV2 ? boardSync.canUndo : elementStore.canUndo()}
        canRedo={isV2 ? boardSync.canRedo : elementStore.canRedo()}
        boardName={boardName}
        onBoardNameChange={handleBoardNameChange}
        canEdit={canEdit}
        limitedAccess={limitedAccess}
        pendingCount={isLegacy ? undefined : boardSync.pendingCount}
        onUndo={undo}
        onRedo={redo}
        onSelectAll={selectAll}
        onDelete={deleteSelected}
        onDuplicate={duplicateSelected}
        onCopy={copySelected}
        onPaste={pasteElements}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onZoomFit={handleZoomFit}
        onSave={save}
        saveStatus={displayedSaveStatus}
        saveError={isLegacy ? saveError : boardSync.error}
        onExportPNG={isLegacy && canUseBoard ? exportToPNG : undefined}
        onExportJSON={isLegacy && canUseBoard ? exportToJSONFile : undefined}
        onOpenFiles={isV2 && canEdit ? () => {
          flushGeometry();
          setShowReview(false);
          setShowVersions(false);
          closeAssistant();
          setReviewPickingPoint(false);
          setShowFiles(open => !open);
        } : undefined}
        onShare={() => setShowShareDialog(true)}
        commentsOpen={showReview}
        onOpenComments={isV2 && canUseBoard ? () => {
          setShowVersions(false);
          setShowFiles(false);
          closeAssistant();
          setReviewPickingPoint(false);
          setShowReview(open => !open);
        } : undefined}
        onOpenVersions={canViewVersions && canUseBoard ? () => {
          flushGeometry();
          setShowReview(false);
          setShowFiles(false);
          closeAssistant();
          setReviewPickingPoint(false);
          setShowVersions(true);
        } : undefined}
        onOpenAgent={isV2 && canEdit ? () => {
          flushGeometry();
          setShowFiles(false);
          setShowReview(false);
          setShowVersions(false);
          setReviewPickingPoint(false);
          if (showAssistant) closeAssistant();
          else setShowAgent(true);
        } : undefined}
        onOpenHelp={() => setShowHelpPanel(true)}
        onOpenCommands={() => setShowCommandPalette(true)}
        presentationControls={isV2 && canUseBoard ? <BoardPresentationControls
          connected={boardSync.isConnected}
          canPresent={canPresent}
          presenting={presentation.presenting}
          followingId={presentation.followingId}
          presenters={Array.from(boardSync.presenters.keys(), id => ({
            id,
            displayName: boardSync.collaborators.find(user => user.id === id)?.displayName ?? 'Participant',
          }))}
          onTogglePresenting={presentation.togglePresenting}
          onFollow={presentation.follow}
          onStopFollowing={stopFollowing}
        /> : undefined}
        onToggleGrid={() => setShowGrid((g) => !g)}
        showGrid={showGrid}
        snapToGrid={snapToGrid}
        onToggleSnap={() => setSnapToGrid(value => !value)}
        onFileInfo={() => setShowFileInfo(true)}
        onDeleteBoard={isBoardOwner && canUseBoard ? () => setDeleteBoardDialogOpen(true) : undefined}
        // Page management
        pages={canUseBoard ? pages : undefined}
        currentPageId={currentPageId}
        onSelectPage={selectBoardPage}
        onAddPage={() => { stopFollowing(); handleAddPage(); }}
        onRenamePage={handleRenamePage}
        onDuplicatePage={handleDuplicatePage}
        onDeletePage={id => setPageToDelete(pages.find(page => page.id === id) ?? null)}
        defaultPageId={isV2 ? defaultPageId : undefined}
        onDefaultPage={isV2 ? handleDefaultPage : undefined}
        onReorderPage={isV2 ? handleReorderPage : undefined}
        onCopyPageLink={isV2 ? copyPageLink : undefined}
        onMoveSelection={isV2 && selectedIds.size ? moveSelectionToPage : undefined}
        sections={pageSections}
        onSelectSection={id => focusBoardLocation({ pageId: currentPageId, elementId: id })}
        onCopySectionLink={isV2 ? id => copyPageLink(currentPageId, id) : undefined}
        onDuplicateBoard={canUseBoard ? async () => {
          setBoardActionBusy(true);
          try {
            const name = `${boardName} (Copy)`;
            if (isV2) {
              if (boardSync.status !== 'synced' || hasGeometryPreview) throw new Error('Wait for the current edits to sync before cloning the board.');
              const result = await copyPrivateBoard(boardId, name);
              window.location.href = `/board/${encodeURIComponent(result.boardId)}`;
              return;
            }
            const room = await createRoom(name);
            await saveBoard(room.id, {
              name,
              elements: elementStoreRef.current.getElements(),
              stamps: allStamps,
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
        } : undefined}
        // User settings — real account email, not a fabricated one
        username={currentUsername}
        userEmail={email}
        userColor={currentUserColor}
        userId={userId}
        userAvatarUrl={currentUserAvatarUrl}
        isPinned={isPinned}
        onTogglePin={() => setIsPinned((p) => !p)}
        onUpdateProfile={handleUpdateProfile}
        onLogout={async () => {
          try {
            flushGeometry();
            const writes = await Promise.all(localWrites.current);
            if ((unsavedDraft || writes.includes(false))
              && !window.confirm('An edit could not be saved on this device. Sign out and discard it? Cancel to review the draft.')) return;
            if (await logout()) window.location.href = '/';
          } catch (error) {
            setNoticeDialog({
              title: 'Could not sign out',
              message: error instanceof Error ? error.message : 'Try signing out again.',
            });
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
        theme={theme}
        onToggleTheme={() => {
          // Cycle light -> dark -> system so users can get back to
          // "follow OS" without a separate settings screen.
          const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
          setTheme(next);
        }}
      />

      {isLegacy && boardLoadError && (() => {
        const status = boardLoadError.status;
        const isForbidden = status === 403;
        const isNotFound = status === 404;
        const title = isForbidden
          ? "You don't have access to this board."
          : isNotFound
            ? 'This board no longer exists.'
            : 'Could not load this board.';
        const detail = isForbidden
          ? 'Ask the board owner to share it with you, or switch to an account that has access.'
          : isNotFound
            ? 'It may have been deleted. Any local edits will not be saved.'
            : 'Check your connection. Autosave is paused to protect existing content.';
        return (
          <div className="pointer-events-auto absolute left-1/2 top-24 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg" role="alert">
            <p className="font-semibold">{title}</p>
            <p className="mt-1 text-red-700">{detail}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(isForbidden || isNotFound) ? (
                <a
                  href="/workplace"
                  className="inline-flex min-h-11 items-center rounded-xl bg-red-600 px-3 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                >
                  Back to workplace
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => setLegacyReload(value => value + 1)}
                  className="min-h-11 rounded-xl bg-red-600 px-3 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {!isLegacy && (
        <BoardSyncNotice
          state={boardSync}
          onRetry={retry}
          onExportDraft={boardSync.exportDraft}
          onDiscard={() => setConflictToDiscard(boardSync.conflict?.commandId ?? null)}
        />
      )}
      {isV2 && boardSync.historyNotice && (
        <p role="status" className="pointer-events-none absolute left-1/2 top-20 z-[51] w-max max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border px-3 py-2 text-sm shadow-lg"
          style={{ background: 'var(--surface-panel)', borderColor: 'var(--glass-border-strong)', color: 'var(--text-primary)' }}>
          {boardSync.historyNotice}
        </p>
      )}
      {isLegacy && !boardLoadError && saveStatus === 'offline' && (
        <div className="pointer-events-auto absolute left-1/2 top-24 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg" role="status" aria-live="polite">
          <p className="flex items-center gap-2 font-semibold">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
            You're offline
          </p>
          <p className="mt-1 text-amber-800">Keep this tab open until you reconnect and the board saves.</p>
        </div>
      )}
      {isLegacy && !boardLoadError && saveStatus === 'conflict' && (
        <div className="pointer-events-auto absolute left-1/2 top-24 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900 shadow-lg" role="alert">
          <p className="flex items-center gap-2 font-semibold">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500" aria-hidden="true" />
            Board reloaded after a save conflict
          </p>
          <p className="mt-1 text-orange-800">The editor loaded the latest saved version. Review it before continuing.</p>
        </div>
      )}

      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        commands={commands}
      />
      
      {/* Share Dialog */}
      {isV2 && <BoardSharingDialog isOpen={showShareDialog} onClose={() => setShowShareDialog(false)} boardId={boardId} boardName={boardName} />}
      {isLegacy && <ShareDialog
        isOpen={showShareDialog}
        onClose={() => setShowShareDialog(false)}
        boardName={boardName}
        shareLink={`${window.location.origin}/board/${boardId}`}
        linkPermission={shareLinkPermission}
        members={shareMembers}
        isLoading={shareLoading}
        isSaving={shareSaving}
        error={shareError}
        onChangeLinkPermission={handleChangeLinkPermission}
        onInvite={handleInviteMember}
        onRemoveMember={handleRemoveMember}
        onCopyLink={() => {}}
      />}

      {isV2 && canUseBoard && <BoardReviewPanel
        open={showReview}
        boardId={boardId}
        userId={userId}
        canComment={canReview}
        online={reviewOnline}
        epoch={boardSync.epoch}
        page={pages.find(page => page.id === currentPageId) ?? { id: currentPageId, name: 'Current page' }}
        selectedObject={selectedElement ? { id: selectedElement.id, label: 'name' in selectedElement ? selectedElement.name
          : 'text' in selectedElement && selectedElement.text ? selectedElement.text : selectedElement.type } : undefined}
        pickedLocation={pickedReviewLocation}
        pickingPoint={reviewPickingPoint}
        initialThreadId={initialReviewThread}
        onPickPoint={() => { setPickedReviewLocation(undefined); setReviewPickingPoint(true); }}
        onFocusAnchor={focusReviewAnchor}
        onClose={() => { setShowReview(false); setReviewPickingPoint(false); }}
      />}
      {showVersions && canViewVersions && <BoardVersionsPanel
        boardId={boardId}
        permission={boardSync.permission}
        epoch={boardSync.epoch}
        seq={boardSync.seq}
        pendingCount={boardSync.pendingCount + (hasGeometryPreview ? 1 : 0)}
        online={reviewOnline}
        onClose={() => setShowVersions(false)}
        onRestore={() => { cancelCanvasGesture(); return retry(); }}
        onOpenBoard={id => { window.location.href = `/board/${encodeURIComponent(id)}`; }}
      />}
      {showFiles && isV2 && canEdit && <BoardFilesPanel
        boardId={boardId}
        theme={isDark ? 'dark' : 'light'}
        pageId={currentPageId}
        elementIds={elements.filter(element => selectedIds.has(element.id)).map(element => element.id)}
        stampIds={stamps.filter(stamp => selectedIds.has(stamp.id)).map(stamp => stamp.id)}
        canExport={boardSync.status === 'synced' && !hasGeometryPreview}
        onClose={() => setShowFiles(false)}
      />}
      {showAssistant && isV2 && canUseBoard && (canEdit || Boolean(sharedRunId)) && <BoardAgentPanel
        key={sharedRunId ?? 'private'}
        boardId={boardId}
        pageId={currentPageId}
        sharedRunId={sharedRunId}
        pages={pages}
        selectedTextIds={elements.filter(element => selectedIds.has(element.id) && (element.type === 'sticky' || element.type === 'text')).map(element => element.id)}
        pendingCount={boardSync.pendingCount + (hasGeometryPreview || boardSync.status !== 'synced' ? 1 : 0)}
        online={reviewOnline}
        clientId={boardSync.clientId}
        agentIdentity={agentProfile?.name ? { name: agentProfile.name, kind: 'ring' } : undefined}
        identityVisual={status => <AgentCharacter profile={agentProfile} pose={characterPose(status)} />}
        onEditIdentity={() => {
          if (agentProfile) setEditAgentProfile(true);
          else void readAgentProfile().then(value => {
            setAgentProfile(value);
            setEditAgentProfile(true);
          }).catch(() => setNoticeDialog({ title: characterText.title, message: characterText.loadError }));
        }}
        renderCanvasPreview={preview => <AgentCanvasPreview preview={preview} />}
        onPreviewChange={setAgentPreview}
        onUndo={async ack => {
          flushGeometry();
          return undoDocument(ack.commandId);
        }}
        onClose={closeAssistant}
        onApplied={async (ack, pageId) => {
          if (!await boardSync.adoptAdditions(ack)) await retry();
          stopFollowing();
          setSelectedIds(new Set());
          setCurrentPageId(pageId);
        }}
      />}
      {editAgentProfile && agentProfile && <AgentProfileDialog profile={agentProfile} onClose={() => setEditAgentProfile(false)}
        onSave={value => { setAgentProfile(value); setEditAgentProfile(false); }} />}
      
      {/* Help Panel */}
      <HelpPanel
        isOpen={showHelpPanel}
        onClose={() => setShowHelpPanel(false)}
      />
      {/* Image Upload Dialog */}
      <ImageUploadDialog
        isOpen={canEdit && showImageUpload}
        boardId={isV2 ? boardId : undefined}
        onClose={() => setShowImageUpload(false)}
        onUpload={(imageData) => {
          if (!canEdit) return;
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
            ...(imageData.assetId ? { assetId: imageData.assetId } : {}),
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
        isOpen={isBoardOwner && canUseBoard && deleteBoardDialogOpen}
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
            await deleteRoomApi(boardId);
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
      <ConfirmDialog
        isOpen={pageToDelete !== null}
        title="Delete page?"
        message={isV2 ? 'This page and its objects will be removed together. Undo can restore them.' : 'This page will be removed.'}
        confirmLabel="Delete page"
        tone="danger"
        onConfirm={() => {
          if (pageToDelete) handleDeletePage(pageToDelete.id);
          setPageToDelete(null);
        }}
        onClose={() => setPageToDelete(null)}
      />
      <ConfirmDialog
        isOpen={conflictToDiscard !== null && conflictToDiscard === boardSync.conflict?.commandId}
        title={unsavedDraft ? 'Discard unsaved draft?' : 'Discard blocked edit?'}
        message={unsavedDraft
          ? 'The unsaved draft will be removed. Edits already saved to this device stay queued.'
          : 'The blocked edit will be removed from this device. Later edits stay queued and are checked against the latest board.'}
        confirmLabel="Discard edit"
        tone="danger"
        isBusy={discardingConflict}
        onClose={() => setConflictToDiscard(null)}
        onConfirm={async () => {
          if (!conflictToDiscard) return;
          setDiscardingConflict(true);
          try {
            await boardSync.discardConflict(conflictToDiscard);
            elementStore.resetHistory();
            setConflictToDiscard(null);
          } finally {
            setDiscardingConflict(false);
          }
        }}
      />
      
      {/* Context Menu */}
      {canEdit && contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
      
      {/* Multi-select toolbar */}
      <MultiSelectToolbar
        selectedCount={canEdit && !isInkTool ? selectedIds.size : 0}
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
        element={canEdit && !isInkTool ? selectedElement : null}
        scale={scale}
        offset={offset}
        onUpdate={handleUpdate}
        onDuplicate={duplicateSelected}
        onDelete={deleteSelected}
      />

      <LiveCursorLayer cursors={liveCursors} scale={scale} offset={offset} />
      {canUseBoard && !isInkTool && attributions?.page === currentPageId && (
        <div className="board-agent-attribution-layer">
          {visibleElements.map(element => {
            const attribution = attributions.entries.get(element.id);
            if (!attribution || attribution.actorId !== element.createdBy) return null;
            const bounds = elementBounds(element);
            const name = characterText.attribution(attribution.actorName, attribution.agentName || characterText.defaultName);
            return <span key={element.id} data-agent-attribution={element.id} role="img" aria-label={name} title={name}
              tabIndex={selectedIds.has(element.id) ? 0 : undefined} className="board-agent-attribution"
              style={{ left: bounds.right * scale + offset.x, top: bounds.top * scale + offset.y }}>
              <AgentCharacter profile={attribution.glyph ? { name: '', kind: 'glyph', glyph: attribution.glyph } : undefined} />
            </span>;
          })}
        </div>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`h-full w-full ${isInkTool ? 'ink-input' : ''}`}
        style={{ cursor: getCursor(), touchAction: 'none' }}
        onPointerDownCapture={handlePointerDownCapture}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={event => { if (event.isPrimary) finishCanvasGesture(screenToCanvas(event.clientX, event.clientY)); }}
        onPointerLeave={event => {
          if (event.isPrimary && event.pointerType === 'mouse' && !event.currentTarget.hasPointerCapture(event.pointerId)) finishCanvasGesture();
        }}
        onPointerCancel={event => { if (event.isPrimary) cancelCanvasGesture(); }}
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
                backgroundImage: 'radial-gradient(circle, var(--canvas-grid-dot) 1px, transparent 1px)',
                backgroundSize: '20px 20px',
                width: '10000px',
                height: '10000px',
                left: '-5000px',
                top: '-5000px',
              }}
            />
          )}
          
          {/* Elements */}
          {canUseBoard && visibleElements.map((element) => {
            // Render widget elements with their specific components
            if (element.type === 'widget') {
              const widgetEl = element as WidgetElement;
              return (
                <WidgetRenderer
                  key={element.id}
                  element={widgetEl}
                  isSelected={canEdit && !isInkTool && selectedIds.has(element.id)}
                  editable={canEdit}
                  onSelect={handleSelect}
                  onUpdate={handleUpdate}
                  onVote={isV2 && canEdit ? action => { void submit([{ kind: 'vote', collection: 'elements', id: widgetEl.id, value: action }]); } : undefined}
                  votePending={boardSync.pendingVoteIds?.includes(widgetEl.id)}
                  onDelete={() => elementStoreRef.current.deleteElement(element.id)}
                  userId={userId}
                  userName={currentUsername}
                  userColor={currentUserColor}
                />
              );
            }
            
            return (
              <ElementRenderer
                key={element.id}
                boardId={boardId}
                element={element}
                isSelected={canEdit && !isInkTool && selectedIds.has(element.id)}
                isEditing={canEdit && editingId === element.id}
                scale={scale}
                onSelect={handleSelect}
                onStartEdit={handleStartEdit}
                onEndEdit={handleEndEdit}
                onUpdate={handleUpdate}
                onMove={handleMove}
                onResize={handleResize}
                isPinned={isPinned && !isInkTool && element.type !== 'drawing' && element.createdBy === userId}
              />
            );
          })}
          {showAssistant && ghostElements.length > 0 && (
            <div className="board-agent-ghost"><AgentPreviewObjects elements={ghostElements} scale={scale} /></div>
          )}
          
          {/* Stamps */}
          {canUseBoard && visibleStamps.map((stamp) => (
            <StampElement
              key={stamp.id}
              stamp={stamp}
              isSelected={!isInkTool && selectedIds.has(stamp.id)}
              scale={scale}
              onSelect={handleSelect}
              onDelete={deleteStamp}
              onMove={canEdit ? moveStamp : undefined}
            />
          ))}
          
          {resizeHandle && <button
            type="button"
            aria-label="Resize selected object"
            className="absolute grid place-items-center rounded-full border-2 border-white bg-blue-500 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
            style={{ left: resizeHandle.x, top: resizeHandle.y, width: 14 / scale, height: 14 / scale, transform: 'translate(-50%, -50%)', cursor: 'nwse-resize', zIndex: 1100 }}
            onPointerDown={startResize}
            onPointerMove={resizeSelection}
            onPointerUp={() => { resizeGesture.current = null; if (isV2) flushGeometry(); }}
          />}

          {showReview && focusedReviewLocation?.pageId === currentPageId && !focusedReviewLocation.elementId
            && focusedReviewLocation.x !== undefined && focusedReviewLocation.y !== undefined && (
            <div className="pointer-events-none absolute rounded-full border-2 border-blue-300 bg-blue-600 shadow-md"
              aria-label="Comment anchor" style={{ left: focusedReviewLocation.x, top: focusedReviewLocation.y,
                width: 12 / scale, height: 12 / scale, transform: 'translate(-50%, -50%)', zIndex: 1101 }} />
          )}

          {/* Drawing preview */}
          {isDrawing && drawingPath.length > 0 && (
            <DrawingPreview
              drawingPath={drawingPath}
              isMarker={currentTool === 'marker'}
              strokeWidth={toolOptions.strokeWidth}
              strokeColor={toolOptions.strokeColor}
            />
          )}
          
          {/* Selection box */}
          {currentTool === 'select' && selectionBox && (
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
      {canEdit && <BottomToolbar
        currentTool={currentTool}
        onToolChange={setCurrentTool}
        toolOptions={toolOptions}
        onToolOptionsChange={(opts) => setToolOptions((prev) => ({ ...prev, ...opts }))}
        onInsertImage={() => setShowImageUpload(true)}
        onInsertWidget={handleInsertWidget}
        selectedColor={selectedColor}
        onColorChange={setSelectedColor}
        onSelectStamp={setSelectedStampEmoji}
      />}
      
      <div className="absolute bottom-22 right-3 z-40 flex items-center gap-2 min-[960px]:bottom-6">
        <ZoomControls
          scale={scale}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onZoomFit={handleZoomFit}
          onHelp={() => setShowHelpPanel(true)}
        />
      </div>

      <div className="glass-subtle absolute bottom-22 left-3 z-40 hidden min-h-11 items-center gap-2 rounded-full px-2 text-sm min-[420px]:flex min-[960px]:bottom-6" style={{ color: 'var(--text-secondary)' }}>
        <span className="flex items-center gap-1.5 rounded-full px-2" title={`${elements.length} elements`} aria-label={`${elements.length} elements`}>
          <ElementsIcon />
          <span>{elements.length}</span>
        </span>
        {!isInkTool && selectedIds.size > 0 && (
          <span className="badge flex items-center gap-1.5 rounded-full px-2 py-1" title={`${selectedIds.size} selected`} aria-label={`${selectedIds.size} selected`}>
            <SelectionCountIcon />
            <span>{selectedIds.size}</span>
          </span>
        )}
      </div>

      {/* Table Creation Dialog */}
      {canEdit && showTableCreation && (
        <TableCreationDialog
          onConfirm={(rows, cols) => {
            const centerX = (-offset.x + window.innerWidth / 2) / scale;
            const centerY = (-offset.y + window.innerHeight / 2) / scale;
            elementStoreRef.current.addElement('widget', centerX - 200, centerY - 150, {
              width: 400, height: 300,
              widgetType: 'table',
              widgetData: createDefaultTable(rows, cols),
            } as Partial<Element>);
            setShowTableCreation(false);
            setCurrentTool('select');
          }}
          onCancel={() => setShowTableCreation(false)}
        />
      )}

      {/* Timer Creation Dialog */}
      {canEdit && showTimerCreation && (
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
