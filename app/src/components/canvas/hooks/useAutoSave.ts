import { useState, useCallback, useEffect, useRef } from 'react';
import type { Element } from '../../../lib/elements';
import { saveBoard, BoardConflictError, type BoardData } from '../../../lib/api';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict';

interface UseAutoSaveOptions {
  boardId: string;
  getElements: () => Element[];
  getBoardName: () => string;
  getStamps: () => unknown[];
  getPages: () => unknown[];
  getCurrentPageId: () => string;
  getExpectedUpdatedAt: () => string | undefined;
  onConflict: (remoteBoard: BoardData) => void;
  debounceMs?: number;
  enabled?: boolean;
}

export function useAutoSave({
  boardId,
  getElements,
  getBoardName,
  getStamps,
  getPages,
  getCurrentPageId,
  getExpectedUpdatedAt,
  onConflict,
  debounceMs = 1200,
  enabled = true,
}: UseAutoSaveOptions) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string>('');
  const timeoutRef = useRef<number | null>(null);
  const saveStatusRef = useRef<SaveStatus>('idle');
  const dirtyVersionRef = useRef(0);
  const lastSavedUpdatedAtRef = useRef<string | undefined>(undefined);
  const onConflictRef = useRef(onConflict);
  const latestRef = useRef({
    getElements,
    getBoardName,
    getStamps,
    getPages,
    getCurrentPageId,
    getExpectedUpdatedAt,
  });

  useEffect(() => {
    onConflictRef.current = onConflict;
  }, [onConflict]);

  useEffect(() => {
    latestRef.current = {
      getElements,
      getBoardName,
      getStamps,
      getPages,
      getCurrentPageId,
      getExpectedUpdatedAt,
    };
  }, [getElements, getBoardName, getStamps, getPages, getCurrentPageId, getExpectedUpdatedAt]);

  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  const clearPendingSave = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const saveNow = useCallback(async () => {
    if (!enabled) return;
    clearPendingSave();

    if (!navigator.onLine) {
      setSaveStatus('offline');
      setSaveError('Browser is offline');
      return;
    }

    setSaveStatus('saving');
    setSaveError('');
    const versionAtStart = dirtyVersionRef.current;
    try {
      const current = latestRef.current;
      const currentElements = current.getElements();
      const expected = current.getExpectedUpdatedAt();
      const result = await saveBoard(boardId, {
        name: current.getBoardName(),
        elements: currentElements,
        stamps: current.getStamps(),
        pages: current.getPages(),
        currentPageId: current.getCurrentPageId(),
      }, expected);
      if (result.updatedAt) {
        lastSavedUpdatedAtRef.current = result.updatedAt;
      }
      if (dirtyVersionRef.current === versionAtStart) {
        setSaveStatus('saved');
      } else {
        setSaveStatus('dirty');
        timeoutRef.current = window.setTimeout(() => {
          void saveNow();
        }, debounceMs);
      }
    } catch (error) {
      if (error instanceof BoardConflictError) {
        setSaveStatus('conflict');
        setSaveError(error.message);
        onConflictRef.current(error.board);
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to save board:', errorMessage);
      setSaveError(errorMessage);
      setSaveStatus('error');
    }
  }, [boardId, clearPendingSave, debounceMs, enabled]);

  const markDirty = useCallback(() => {
    if (!enabled) return;

    if (!navigator.onLine) {
      setSaveStatus('offline');
      setSaveError('Browser is offline');
      return;
    }

    setSaveError('');
    dirtyVersionRef.current += 1;
    setSaveStatus('dirty');
    clearPendingSave();
    timeoutRef.current = window.setTimeout(() => {
      void saveNow();
    }, debounceMs);
  }, [clearPendingSave, debounceMs, enabled, saveNow]);

  useEffect(() => {
    if (!enabled) return;
    const handleOnline = () => {
      if (saveStatusRef.current === 'offline') {
        markDirty();
      }
    };
    const handleOffline = () => {
      clearPendingSave();
      setSaveStatus('offline');
      setSaveError('Browser is offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearPendingSave();
    };
  }, [clearPendingSave, enabled, markDirty]);

  return { saveStatus, saveError, markDirty, saveNow, saveToDatabase: saveNow, getSavedUpdatedAt: () => lastSavedUpdatedAtRef.current };
}
