import { useEffect, useRef, useState } from 'react';
import { importDoc, maxDocImportBytes, type DocFormat } from '../../lib/docs';
import WorkbenchIcon from '../workbench/WorkbenchIcon';

export default function DocImportDialog({ projectId, projectName, onClose, onImported }: {
  projectId: string; projectName: string; onClose: () => void; onImported: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [upload, setUpload] = useState<{ file: File; format: DocFormat }>();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    const name = file.name.match(/^(.*)\.(docx|md|markdown)$/i);
    if (!name) { setError('Choose a Markdown or Word (.docx) file.'); return; }
    if (file.size > maxDocImportBytes) { setError('Choose a file up to 4 MiB.'); return; }
    setTitle(Array.from(name[1] || 'Untitled Document').slice(0, 255).join(''));
    setUpload({ file, format: name[2].toLowerCase() === 'docx' ? 'docx' : 'md' });
  }

  async function submit() {
    if (!upload || !title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const doc = await importDoc(projectId, title.trim(), upload.format, upload.file);
      onImported(doc.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The document could not be imported.');
    } finally {
      setBusy(false);
    }
  }

  return <dialog className="wb-dialog wb-doc-import" ref={dialog} aria-label="Import Document"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="wb-dialog-heading">
      <h2>Import Document</h2>
      <button type="button" className="wb-icon-button" aria-label="Close" onClick={onClose} disabled={busy}><WorkbenchIcon name="close" /></button>
    </header>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p className="wb-import-context">{projectName} · Markdown or Word (.docx)</p>
      <label className="wb-field">File<input type="file" accept=".md,.markdown,.docx" disabled={busy}
        onChange={event => choose(event.target.files?.[0])} required /></label>
      <label className="wb-field">Document Name<input value={title} onChange={event => setTitle(event.target.value)} disabled={busy} required maxLength={255} /></label>
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
