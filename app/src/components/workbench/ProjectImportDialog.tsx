import { useEffect, useRef, useState } from 'react';
import { importDoc, maxDocImportBytes, type DocFormat } from '../../lib/docs';
import { importSheet, maxSheetUploadBytes, type SheetFormat } from '../../lib/sheets';
import { resourceNames } from '../../lib/directory';
import WorkbenchIcon from './WorkbenchIcon';

export default function ProjectImportDialog({ kind, projectId, projectName, onClose, onImported }: {
  kind: 'doc' | 'sheet'; projectId: string; projectName: string; onClose: () => void; onImported: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [upload, setUpload] = useState<{ file: File; format: DocFormat | SheetFormat }>();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const spreadsheet = kind === 'sheet';
  const noun = resourceNames[kind];
  const formatLabel = spreadsheet ? 'CSV or Excel (.xlsx)' : 'Markdown or Word (.docx)';

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
    const name = file.name.match(spreadsheet ? /^(.*)\.(csv|xlsx)$/i : /^(.*)\.(docx|md|markdown)$/i);
    if (!name) { setError('Choose a ' + formatLabel + ' file.'); return; }
    if (file.size > (spreadsheet ? maxSheetUploadBytes : maxDocImportBytes)) { setError('Choose a file up to 4 MiB.'); return; }
    setTitle(Array.from(name[1] || 'Untitled ' + noun).slice(0, 255).join(''));
    const format = name[2].toLowerCase();
    setUpload({ file, format: format === 'markdown' ? 'md' : format as DocFormat | SheetFormat });
  }

  async function submit() {
    if (!upload || !title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = upload.format === 'csv' || upload.format === 'xlsx'
        ? await importSheet(projectId, title.trim(), upload.format, upload.file)
        : await importDoc(projectId, title.trim(), upload.format, upload.file);
      onImported(result.id);
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
      <p className="wb-import-context">{projectName} · {formatLabel}</p>
      <label className="wb-field">File<input type="file" accept={spreadsheet ? '.csv,.xlsx' : '.md,.markdown,.docx'} disabled={busy}
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
