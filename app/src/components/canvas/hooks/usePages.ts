import { useCallback } from 'react';
import type { Page } from '../../PagesPanel';
import type { Stamp } from '../../StampTool';
import type { DocumentMutation } from '../../../lib/boardSync';
import { generateElementId } from '../../../lib/elements';
import type { ElementStore } from '../../../lib/elementStore';
import { copyBoardElements } from '../boardObjects';
import { fitsDocumentBatch } from '../documentEdits';

interface UsePagesOptions {
  pages: Page[];
  currentPageId: string;
  setPages: React.Dispatch<React.SetStateAction<Page[]>>;
  setCurrentPageId: React.Dispatch<React.SetStateAction<string>>;
  markDirty: () => void;
  canEdit: boolean;
  submit?: (operations: DocumentMutation[]) => Promise<boolean>;
  elementStore: ElementStore;
  stamps: Stamp[];
  userId: string;
  defaultPageId: string;
  onNotice: (notice: { title: string; message: string }) => void;
}

// page-<timestamp> collides when two tabs/clients add a page in the same
// millisecond; use a random suffix so concurrent editors cannot fork a board
// into two pages sharing one id.
function newPageId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `page-${Date.now()}-${rand}`;
}

export function usePages({
  pages, currentPageId, setPages, setCurrentPageId, markDirty, canEdit, submit, elementStore,
  stamps, userId, defaultPageId, onNotice,
}: UsePagesOptions) {
  const handleAddPage = useCallback(() => {
    if (!canEdit) return;
    const newPage: Page = {
      id: newPageId(),
      name: `Page ${pages.length + 1}`,
    };
    if (submit) {
      void submit([{ kind: 'add', collection: 'pages', id: newPage.id, value: newPage }]).then(saved => {
        if (saved) setCurrentPageId(newPage.id);
      });
      return;
    }
    setPages((prev) => [...prev, newPage]);
    setCurrentPageId(newPage.id);
    markDirty();
  }, [canEdit, pages.length, setPages, setCurrentPageId, markDirty, submit]);

  const handleSelectPage = useCallback((pageId: string) => {
    if (!pages.some(page => page.id === pageId)) return;
    setCurrentPageId(pageId);
    if (!submit && canEdit) markDirty();
  }, [canEdit, pages, setCurrentPageId, markDirty, submit]);

  const handleRenamePage = useCallback((pageId: string, name: string, expectedName: string) => {
    if (!canEdit || name === expectedName || !pages.some(page => page.id === pageId)) return;
    if (submit) {
      void submit([{ kind: 'patch', collection: 'pages', id: pageId, fields: { name }, expected: { name: expectedName } }]);
      return;
    }
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, name } : p)));
    markDirty();
  }, [canEdit, pages, setPages, markDirty, submit]);

  const handleDuplicatePage = useCallback((pageId: string) => {
    if (!canEdit) return;
    const pageToDuplicate = pages.find((p) => p.id === pageId);
    if (!pageToDuplicate) return;
    const newPage: Page = {
      ...pageToDuplicate,
      id: newPageId(),
      name: `${pageToDuplicate.name} (Copy)`,
    };
    const position = pages.findIndex((p) => p.id === pageId) + 1;
    const newPages = [...pages];
    newPages.splice(position, 0, newPage);
    if (submit) {
      const now = Date.now();
      const originals = elementStore.getElements().filter(element => element.pageId === pageId);
      const copies = copyBoardElements(originals, { pageId: newPage.id, userId });
      const stampCopies = stamps.filter(stamp => stamp.pageId === pageId).map(stamp => ({
        ...stamp, id: generateElementId(), pageId: newPage.id, userId, createdAt: now,
      }));
      const operations: DocumentMutation[] = [
        { kind: 'add', collection: 'pages', id: newPage.id, value: newPage, position },
        ...copies.map(value => ({ kind: 'add' as const, collection: 'elements' as const, id: value.id, value })),
        ...stampCopies.map(value => ({ kind: 'add' as const, collection: 'stamps' as const, id: value.id, value })),
      ];
      if (!fitsDocumentBatch(operations)) {
        onNotice({
          title: 'Page exceeds the copy limit',
          message: 'Create a page and copy smaller selections of objects to it.',
        });
        return;
      }
      void submit(operations).then(saved => {
        if (saved) setCurrentPageId(newPage.id);
      });
      return;
    }
    setPages(newPages);
    setCurrentPageId(newPage.id);
    markDirty();
  }, [canEdit, pages, setPages, setCurrentPageId, markDirty, submit, elementStore, stamps, userId, onNotice]);

  const handleDeletePage = useCallback((pageId: string) => {
    const page = pages.find(item => item.id === pageId);
    if (!canEdit || !page || pages.length <= 1) return;
    if (submit) {
      const operations: DocumentMutation[] = [
        ...elementStore.getElements().filter(element => element.pageId === pageId).map(element => ({
          kind: 'delete' as const, collection: 'elements' as const, id: element.id, expected: { ...element },
        })),
        ...stamps.filter(stamp => stamp.pageId === pageId).map(stamp => ({
          kind: 'delete' as const, collection: 'stamps' as const, id: stamp.id, expected: { ...stamp },
        })),
        { kind: 'delete', collection: 'pages', id: page.id, expected: { ...page } },
      ];
      if (!fitsDocumentBatch(operations)) {
        onNotice({ title: 'Page exceeds the delete limit', message: 'Remove smaller selections of objects before deleting this page.' });
        return;
      }
      void submit(operations);
      return;
    }
    setPages((prev) => prev.filter((p) => p.id !== pageId));
    if (currentPageId === pageId) {
      const remaining = pages.filter((p) => p.id !== pageId);
      setCurrentPageId(remaining.find(page => page.id === defaultPageId)?.id ?? remaining[0]?.id ?? '');
    }
    markDirty();
  }, [canEdit, pages, currentPageId, defaultPageId, setPages, setCurrentPageId, markDirty, submit, elementStore, stamps, onNotice]);

  const handleReorderPage = useCallback((pageId: string, position: number) => {
    if (!canEdit || !submit || position < 0 || position >= pages.length) return;
    const order = pages.map(page => page.id);
    if (!order.includes(pageId) || order[position] === pageId) return;
    void submit([{ kind: 'reorder', collection: 'pages', id: pageId, position, expected: { order } }]);
  }, [canEdit, pages, submit]);

  const handleDefaultPage = useCallback((pageId: string) => {
    if (!canEdit || !submit || pageId === defaultPageId || !pages.some(page => page.id === pageId)) return;
    void submit([{ kind: 'setDefaultPage', value: pageId, expected: { defaultPageId } }]);
  }, [canEdit, defaultPageId, pages, submit]);

  return {
    handleAddPage,
    handleSelectPage,
    handleRenamePage,
    handleDuplicatePage,
    handleDeletePage,
    handleReorderPage,
    handleDefaultPage,
  };
}
