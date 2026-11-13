import { useEffect, useRef, useState } from 'react';
import WorkshopIcon from './WorkshopIcon';

export default function ProjectFilesActions({ onNewBoard, onNewDoc, onNewSheet, onNewPresentation, onImportBoard, onImportDoc, onImportSheet, onImportPresentation }: {
  onNewBoard: () => void; onNewDoc: () => void; onNewSheet: () => void; onNewPresentation: () => void;
  onImportBoard: () => void; onImportDoc: () => void; onImportSheet: () => void; onImportPresentation: () => void;
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

  return <div className="workshop-project-actions" ref={group} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    group.current?.querySelector<HTMLButtonElement>('button[aria-expanded=true]')?.focus();
    setOpen(null);
  }}>
    <button type="button" className="workshop-icon-button workshop-glass-control" aria-label="Import File" title="Import"
      aria-expanded={open === 'import'} onClick={() => setOpen(open === 'import' ? null : 'import')}><WorkshopIcon name="import" /></button>
    <button type="button" className="workshop-button workshop-button-primary" aria-label="New File" title="New File"
      aria-expanded={open === 'create'} onClick={() => setOpen(open === 'create' ? null : 'create')}>
      <WorkshopIcon name="plus" /><span>New</span><WorkshopIcon name="chevron" />
    </button>
    {open && <div className="workshop-board-menu workshop-project-menu">
      {open === 'create' ? <>
        <button type="button" onClick={() => run(onNewDoc)}><WorkshopIcon name="document" />New Document</button>
        <button type="button" onClick={() => run(onNewSheet)}><WorkshopIcon name="sheet" />New Spreadsheet</button>
        <button type="button" onClick={() => run(onNewPresentation)}><WorkshopIcon name="slides" />New Presentation</button>
        <button type="button" onClick={() => run(onNewBoard)}><WorkshopIcon name="board" />New Board</button>
      </> : <>
        <button type="button" onClick={() => run(onImportDoc)}><WorkshopIcon name="document" />Markdown or DOCX</button>
        <button type="button" onClick={() => run(onImportSheet)}><WorkshopIcon name="sheet" />CSV or XLSX</button>
        <button type="button" onClick={() => run(onImportPresentation)}><WorkshopIcon name="slides" />PowerPoint (.pptx)</button>
        <button type="button" onClick={() => run(onImportBoard)}><WorkshopIcon name="board" />Board File</button>
      </>}
    </div>}
  </div>;
}
