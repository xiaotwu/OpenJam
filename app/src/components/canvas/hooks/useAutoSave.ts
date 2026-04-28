import { useState, useCallback, useEffect, useRef } from 'react';
import type { Element } from '../../../lib/elements';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict';

interface UseAutoSaveOptions {
  boardId: string;
  getElements: () => Element[];
  getBoardName: () => string;
  getStamps: () => unknown[];
  getPages: () => unknown[];
  getCurrentPageId: () => string;
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
  debounceMs = 1200,
  enabled = true,
}: UseAutoSaveOptions) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string>('');
  const timeoutRef = useRef<number | null>(null);
  const saveStatusRef = useRef<SaveStatus>('idle');
  const latestRef = useRef({
    getElements,
    getBoardName,
    getStamps,
    getPages,
    getCurrentPageId,
  });

  useEffect(() => {
    latestRef.current = {
      getElements,
      getBoardName,
      getStamps,
      getPages,
      getCurrentPageId,
    };
  }, [getElements, getBoardName, getStamps, getPages, getCurrentPageId]);

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
    try {
      const { saveBoard } = await import('../../../lib/api');
      const current = latestRef.current;
      const currentElements = current.getElements();
      await saveBoard(boardId, {
        name: current.getBoardName(),
        elements: currentElements,
        stamps: current.getStamps(),
        pages: current.getPages(),
        currentPageId: current.getCurrentPageId(),
      });
      setSaveStatus('saved');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to save board:', errorMessage);
      setSaveError(errorMessage);
      setSaveStatus('error');
    }
  }, [boardId, clearPendingSave, enabled]);

  const markDirty = useCallback(() => {
    if (!enabled) return;

    if (!navigator.onLine) {
      setSaveStatus('offline');
      setSaveError('Browser is offline');
      return;
    }

    setSaveError('');
    setSaveStatus('dirty');
    clearPendingSave();
    timeoutRef.current = window.setTimeout(() => {
      void saveNow();
    }, debounceMs);
  }, [clearPendingSave, debounceMs, enabled, saveNow]);

  useEffect(() => {
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
  }, [clearPendingSave, markDirty]);

  return { saveStatus, saveError, markDirty, saveNow, saveToDatabase: saveNow };
}
