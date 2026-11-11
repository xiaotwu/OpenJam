import { useEffect, useRef, useState } from 'react';
import WorkbenchIcon from './WorkbenchIcon';

export default function ProjectFilesActions({ onNewBoard, onNewDoc, onNewSheet, onImportBoard, onImportDoc, onImportSheet }: {
  onNewBoard: () => void; onNewDoc: () => void; onNewSheet: () => void;
  onImportBoard: () => void; onImportDoc: () => void; onImportSheet: () => void;
}) {
  const [open, setOpen] = useState<'create' | 'import' | null>(null);
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !group.current?.contains(event.target)) setOpen(null);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function run(action: () => void) {
    group.current?.querySelector<HTMLButtonElement>('button[aria-expanded=true]')?.focus();
    setOpen(null);
    action();
  }

  return <div className="wb-project-actions" ref={group} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    group.current?.querySelector<HTMLButtonElement>('button[aria-expanded=true]')?.focus();
    setOpen(null);
  }}>
    <button type="button" className="wb-icon-button wb-glass-control" aria-label="Import File" title="Import"
      aria-expanded={open === 'import'} onClick={() => setOpen(open === 'import' ? null : 'import')}><WorkbenchIcon name="import" /></button>
    <button type="button" className="wb-button wb-button-primary" aria-label="New File" title="New File"
      aria-expanded={open === 'create'} onClick={() => setOpen(open === 'create' ? null : 'create')}>
      <WorkbenchIcon name="plus" /><span>New</span><WorkbenchIcon name="chevron" />
    </button>
    {open && <div className="wb-board-menu wb-project-menu">
      {open === 'create' ? <>
        <button type="button" onClick={() => run(onNewDoc)}><WorkbenchIcon name="document" />New Document</button>
        <button type="button" onClick={() => run(onNewSheet)}><WorkbenchIcon name="sheet" />New Spreadsheet</button>
        <button type="button" onClick={() => run(onNewBoard)}><WorkbenchIcon name="board" />New Board</button>
      </> : <>
        <button type="button" onClick={() => run(onImportDoc)}><WorkbenchIcon name="document" />Markdown or DOCX</button>
        <button type="button" onClick={() => run(onImportSheet)}><WorkbenchIcon name="sheet" />CSV or XLSX</button>
        <button type="button" onClick={() => run(onImportBoard)}><WorkbenchIcon name="board" />Board File</button>
      </>}
    </div>}
  </div>;
}
