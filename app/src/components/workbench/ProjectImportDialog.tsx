import { useEffect, useRef, useState } from 'react';
import { importDoc, maxDocImportBytes, type DocFormat } from '../../lib/docs';
import { importSheet, maxSheetUploadBytes, type SheetFormat } from '../../lib/sheets';
import { importPptx, maxPptxUploadBytes } from '../../lib/slides';
import { resourceNames, type DirectoryBoard } from '../../lib/directory';
import WorkbenchIcon from './WorkbenchIcon';

const formats = {
  doc: { label: 'Markdown or Word (.docx)', extensions: '.md,.markdown,.docx', pattern: /^(.*)\.(docx|md|markdown)$/i, limit: maxDocImportBytes },
  sheet: { label: 'CSV or Excel (.xlsx)', extensions: '.csv,.xlsx', pattern: /^(.*)\.(csv|xlsx)$/i, limit: maxSheetUploadBytes },
  slides: { label: 'PowerPoint (.pptx)', extensions: '.pptx', pattern: /^(.*)\.(pptx)$/i, limit: maxPptxUploadBytes },
};

export default function ProjectImportDialog({ kind, projectId, projectName, onClose, onImported }: {
  kind: keyof typeof formats; projectId: string; projectName: string; onClose: () => void; onImported: (id: string, warnings?: string[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [upload, setUpload] = useState<{ file: File; format: DocFormat | SheetFormat | 'pptx' }>();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const noun = resourceNames[kind];
  const config = formats[kind];

  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  function choose(file: File | undefined) {
    setUpload(undefined);
    setError('');
    if (!file) return;
    const name = file.name.match(config.pattern);
    if (!name) { setError('Choose a ' + config.label + ' file.'); return; }
    if (file.size > config.limit) { setError('Choose a file up to ' + config.limit / (1024 * 1024) + ' MiB.'); return; }
    setTitle(Array.from(name[1] || 'Untitled ' + noun).slice(0, 255).join(''));
    const format = name[2].toLowerCase();
    setUpload({ file, format: format === 'markdown' ? 'md' : format as DocFormat | SheetFormat | 'pptx' });
  }

  async function submit() {
    if (!upload || !title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const name = title.trim();
      let result: DirectoryBoard & { warnings?: string[] };
      if (upload.format === 'pptx') result = await importPptx(projectId, name, upload.file);
      else if (upload.format === 'csv' || upload.format === 'xlsx') result = await importSheet(projectId, name, upload.format, upload.file);
      else result = await importDoc(projectId, name, upload.format, upload.file);
      onImported(result.id, result.warnings);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The ' + noun.toLowerCase() + ' could not be imported.');
    } finally {
      setBusy(false);
    }
  }

  return <dialog className="wb-dialog wb-doc-import" ref={dialog} aria-label={'Import ' + noun}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="wb-dialog-heading">
      <h2>Import {noun}</h2>
      <button type="button" className="wb-icon-button" aria-label="Close" onClick={onClose} disabled={busy}><WorkbenchIcon name="close" /></button>
    </header>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p className="wb-import-context">{projectName} · {config.label}</p>
      <label className="wb-field">File<input type="file" accept={config.extensions} disabled={busy}
        onChange={event => choose(event.target.files?.[0])} required /></label>
      <label className="wb-field">{noun} Name<input value={title} onChange={event => setTitle(event.target.value)} disabled={busy} required maxLength={255} /></label>
      {error && <p role="alert" className="wb-error-text">{error}</p>}
      <footer className="wb-dialog-actions">
        <button type="button" className="wb-button wb-button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="wb-button wb-button-primary" disabled={busy || !upload || !title.trim()}>
          <WorkbenchIcon name="import" />{busy ? 'Importing…' : 'Import'}
        </button>
      </footer>
    </form>
  </dialog>;
}
