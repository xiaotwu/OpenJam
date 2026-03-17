import { useState, useCallback } from 'react';
import type { Element } from '../../../lib/elements';

interface UseAutoSaveOptions {
  boardId: string;
  getElements: () => Element[];
  getBoardName: () => string;
  getStamps: () => unknown[];
  getPages: () => unknown[];
  getCurrentPageId: () => string;
}

export function useAutoSave({ boardId, getElements, getBoardName, getStamps, getPages, getCurrentPageId }: UseAutoSaveOptions) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string>('');

  const saveToDatabase = useCallback(async () => {
    setSaveStatus('saving');
    setSaveError('');
    try {
      const { saveBoard } = await import('../../../lib/api');
      const currentElements = getElements();
      await saveBoard(boardId, {
        name: getBoardName(),
        elements: currentElements,
        stamps: getStamps(),
        pages: getPages(),
        currentPageId: getCurrentPageId(),
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to save board:', errorMessage);
      setSaveError(errorMessage);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 5000);
    }
  }, [boardId, getElements, getBoardName, getStamps, getPages, getCurrentPageId]);

  return { saveStatus, saveError, saveToDatabase };
}
