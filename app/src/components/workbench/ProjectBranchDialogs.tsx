import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError } from '../../lib/api';
import { resourceIcon, resourcePath, type Project } from '../../lib/directory';
import { newRequestId } from '../../lib/requestId';
import {
  projectEndpoint, writeProject, type ProjectAction, type ProjectDifference, type ProjectFileSummary,
  type ProjectImportMode, type ProjectLink, type ProjectRestorePreview, type ProjectSyncPreview, type ProjectVersion,
  type ProjectVersionList, type SyncDirection,
} from '../../lib/projectSync';
import { useWorkshopResource } from '../../lib/workshop';
import WorkbenchIcon from './WorkbenchIcon';
import './project-branches.css';

export function BranchDialog({ title, context, busy, onClose, children }: {
  title: string; context: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const heading = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={ref} className="wb-dialog wb-branch-dialog" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="wb-dialog-heading">
      <div className="wb-branch-heading"><h2 id={heading}>{title}</h2><span>{context}</span></div>
      <button type="button" className="wb-icon-button" title="Close" aria-label="Close" disabled={busy} onClick={onClose}>
        <WorkbenchIcon name="close" />
      </button>
    </header>
    {children}
  </dialog>;
}

function useProjectWrite() {
  const receipt = useRef<{ signature: string; id: string }>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(path: string, payload: Record<string, unknown>, complete: (result: ProjectAction) => void, stale?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const signature = JSON.stringify({ path, payload });
    if (receipt.current?.signature !== signature) receipt.current = { signature, id: newRequestId() };
    try {
      const result = await writeProject(path, receipt.current.id, payload);
      receipt.current = null;
      complete(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not finish the project operation.');
      if (failure instanceof ApiError && failure.code === 'STALE_PROJECT') stale?.();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, clear: () => setError('') };
}

export function ImportProjectDialog({ project, workspaces, onClose, onImported }: {
  project: Project; workspaces: { id: string; label: string }[]; onClose: () => void;
  onImported: (project: string, organization: string) => void;
}) {
  const [workspaceId, setWorkspace] = useState(workspaces[0]?.id ?? '');
  const [name, setName] = useState(project.name);
  const [mode, setMode] = useState<ProjectImportMode>('linked');
  const action = useProjectWrite();
  const valid = Boolean(name.trim()) && Array.from(name.trim()).length <= 120 && workspaces.some(item => item.id === workspaceId);
  return <BranchDialog title="Import to Team" context={project.name} busy={action.busy} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      if (valid) void action.run(projectEndpoint(project.id) + '/import', { workspaceId, name: name.trim(), mode }, result => {
        if (result.organizationId) onImported(result.projectId, result.organizationId);
      });
    }}>
      <label className="wb-field">Team Workspace
        <select required value={workspaceId} disabled={action.busy} onChange={event => setWorkspace(event.target.value)}>
          {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.label}</option>)}
        </select>
      </label>
      <label className="wb-field">Project Name
        <input required maxLength={240} value={name} disabled={action.busy} onChange={event => setName(event.target.value)} />
      </label>
      <fieldset className="wb-branch-modes">
        <legend>Import Mode</legend>
        <label><input type="radio" name="project-import-mode" value="linked" checked={mode === 'linked'} disabled={action.busy} onChange={() => setMode('linked')} />
          <span><strong>Keep in Sync</strong><small>Pull and commit changes between the personal and Team copies.</small></span>
        </label>
        <label><input type="radio" name="project-import-mode" value="independent" checked={mode === 'independent'} disabled={action.busy} onChange={() => setMode('independent')} />
          <span><strong>Independent Branch</strong><small>Start a Team project from the files as they are today.</small></span>
        </label>
      </fieldset>
      {action.error && <p role="alert" className="wb-error-text">{action.error}</p>}
      <footer className="wb-dialog-actions">
        <button type="submit" className="wb-button wb-button-primary" disabled={!valid || action.busy}>
          <WorkbenchIcon name="branch" />{action.busy ? 'Importing…' : 'Import Project'}
        </button>
      </footer>
    </form>
  </BranchDialog>;
}

function Side({ file, kind, label }: { file?: ProjectFileSummary; kind: ProjectDifference['kind']; label: string }) {
  const location = useLocation();
  const name = file ? file.name + (file.archived ? ' (Archived)' : '') : 'Missing';
  return <span className="wb-branch-side">
    <small>{label}</small>{file?.id ? <Link to={resourcePath(kind, file.id)}
      state={{ workshop: location.pathname + location.search }}>{name}</Link> : <span>{name}</span>}
  </span>;
}

function SyncChanges({ project, busy, onSync }: {
  project: Project; busy: boolean;
  onSync: (path: string, payload: Record<string, unknown>, refresh: () => void) => void;
}) {
  const path = projectEndpoint(project.id) + '/sync';
  const links = useWorkshopResource<{ links: ProjectLink[] }>(path, 8_000);
  const [selection, setSelection] = useState('');
  const link = links.data?.links.find(item => item.projectId === selection) ?? links.data?.links[0];
  const endpoint = link ? path + '/' + encodeURIComponent(link.projectId) : null;
  const preview = useWorkshopResource<ProjectSyncPreview>(endpoint);
  const [choices, setChoices] = useState<{ token: string; values: Record<string, SyncDirection | ''> }>();
  const [commitName, setCommitName] = useState('');
  const changes = preview.data?.changes ?? [];
  const token = preview.data?.token;
  const selected = choices?.token === token ? choices?.values : undefined;
  const pull = changes.filter(item => item.state === 'incoming' || selected?.[item.key] === 'pull');
  const push = changes.filter(item => item.state === 'outgoing' || selected?.[item.key] === 'push');
  const ordered = [...changes].sort((a, b) =>
    Number(b.state === 'conflict') - Number(a.state === 'conflict') ||
    (a.current?.name ?? a.linked?.name ?? '').localeCompare(b.current?.name ?? b.linked?.name ?? ''));

  function submit(direction: SyncDirection) {
    if (!endpoint || !token) return;
    const resolve = changes.filter(item => item.state === 'conflict' && selected?.[item.key] === direction).map(item => item.key);
    onSync(endpoint, { token, direction, resolve, ...(direction === 'push' && commitName.trim() ? { name: commitName.trim() } : {}) }, preview.refresh);
  }

  return <>
    <div className="wb-branch-target">
      <label className="wb-field">Linked Project
        <select value={link?.projectId ?? ''} onChange={event => setSelection(event.target.value)} disabled={!link || busy}>
          {!link && <option value="">Choose a linked project</option>}
          {links.data?.links.map(item => <option key={item.projectId} value={item.projectId}>{item.organizationName} / {item.projectName}</option>)}
        </select>
      </label>
      <button type="button" className="wb-icon-button wb-glass-control" title="Refresh Changes" aria-label="Refresh Changes"
        disabled={busy} onClick={() => { links.refresh(); preview.refresh(); }}><WorkbenchIcon name="sync" /></button>
    </div>
    {(links.loading || preview.loading) && <p className="wb-branch-empty" role="status">Checking changes…</p>}
    {(links.error || preview.error) && <p className="wb-error-text" role="alert">{links.error || preview.error}</p>}
    {links.data && !link && <p className="wb-branch-empty">No linked project is available to your account.</p>}
    {preview.data && !changes.length && <p className="wb-branch-empty" role="status">The linked copies are up to date.</p>}
    {ordered.length > 0 && <ul className="wb-branch-list" aria-label="File Changes">
      {ordered.map(item => <li key={item.key} className="wb-branch-change" data-conflict={item.state === 'conflict'}>
        <div className="wb-branch-row-title">
          <span className="wb-result-icon"><WorkbenchIcon name={resourceIcon(item.kind)} /></span>
          <strong>{item.current?.name ?? item.linked?.name}</strong>
          <span className="wb-branch-status" data-state={item.state}>
            {item.state === 'conflict' ? 'Conflict' : item.state === 'incoming' ? 'Incoming' : 'Outgoing'}
          </span>
        </div>
        {(item.state === 'conflict' || item.current?.name !== item.linked?.name || item.current?.archived !== item.linked?.archived) && <div className="wb-branch-sides">
          <Side file={item.current} kind={item.kind} label="Current Copy" />
          <Side file={item.linked} kind={item.kind} label="Linked Copy" />
          {item.state === 'conflict' && <label className="wb-branch-side">
            <small>Resolution</small>
            <select className="wb-select" aria-label={'Resolve ' + (item.current?.name ?? item.linked?.name)}
              value={selected?.[item.key] ?? ''} disabled={busy} onChange={event => {
                if (token) setChoices({ token, values: { ...selected, [item.key]: event.target.value as SyncDirection | '' } });
              }}>
              <option value="">Leave Unresolved</option>
              <option value="pull">Use Linked Copy</option>
              <option value="push">Use Current Copy</option>
            </select>
          </label>}
        </div>}
      </li>)}
    </ul>}
    {push.length > 0 && <label className="wb-field">Commit Message
      <input value={commitName} maxLength={120} disabled={busy} placeholder="Project commit" onChange={event => setCommitName(event.target.value)} />
    </label>}
    {preview.data && changes.length > 0 && <footer className="wb-dialog-actions wb-branch-actions">
      <button type="button" className="wb-button wb-button-secondary" disabled={busy || !pull.length} onClick={() => submit('pull')}>
        <WorkbenchIcon name="download" />Pull{pull.length ? ` (${pull.length})` : ''}
      </button>
      <button type="button" className="wb-button wb-button-primary" disabled={busy || !push.length} onClick={() => submit('push')}>
        <WorkbenchIcon name="up" />Commit &amp; Push{push.length ? ` (${push.length})` : ''}
      </button>
    </footer>}
  </>;
}

function ProjectHistory({ project, busy, onWrite }: {
  project: Project; busy: boolean;
  onWrite: (path: string, payload: Record<string, unknown>, refresh: () => void, after?: () => void) => void;
}) {
  const path = projectEndpoint(project.id) + '/versions';
  const { formatDate } = useI18n();
  const [before, setBefore] = useState<string>();
  const [name, setName] = useState('');
  const [version, setVersion] = useState<ProjectVersion>();
  const history = useWorkshopResource<ProjectVersionList>(path + (before ? '?before=' + encodeURIComponent(before) : ''));
  const restorePath = version ? path + '/' + encodeURIComponent(version.id) + '/restore' : null;
  const restore = useWorkshopResource<ProjectRestorePreview>(restorePath);
  function refreshHistory() {
    setBefore(undefined);
    history.refresh();
  }
  return <>
    {!version && <form className="wb-branch-snapshot-form" onSubmit={event => {
      event.preventDefault();
      if (name.trim()) onWrite(path, { name: name.trim() }, refreshHistory, () => setName(''));
    }}>
      <label className="wb-field">Snapshot Name
        <input required maxLength={120} disabled={busy} value={name} onChange={event => setName(event.target.value)} placeholder="Milestone" />
      </label>
      <button type="submit" className="wb-button wb-button-primary" disabled={busy || !name.trim()}>
        <WorkbenchIcon name="plus" />Save Snapshot
      </button>
    </form>}
    {(history.loading || restore.loading) && <p className="wb-branch-empty" role="status">Loading versions…</p>}
    {(history.error || restore.error) && <p className="wb-error-text" role="alert">{history.error || restore.error}</p>}
    {version ? <section aria-label="Restore Preview" className="wb-branch-restore">
      <div className="wb-branch-section-title">
        <button type="button" className="wb-icon-button" aria-label="Back to Versions" disabled={busy} onClick={() => setVersion(undefined)}><WorkbenchIcon name="back" /></button>
        <h3>{version.name}</h3>
      </div>
      {restore.data && (restore.data.changes.length ? <ul className="wb-branch-list">
        {restore.data.changes.map(file => <li key={file.key} className="wb-branch-row-title">
          <span className="wb-result-icon"><WorkbenchIcon name={resourceIcon(file.kind)} /></span><strong>{file.name}</strong>
          <span className="wb-branch-status">{{ restore: 'Restore', recreate: 'Recreate', archive: 'Archive' }[file.action]}</span>
        </li>)}
      </ul> : <p className="wb-branch-empty">The project already matches this snapshot.</p>)}
      <footer className="wb-dialog-actions">
        <button type="button" className="wb-button wb-button-primary" disabled={busy || !restore.data?.changes.length}
          onClick={() => {
            if (restorePath && restore.data) onWrite(restorePath, { token: restore.data.token }, restore.refresh, () => {
              setVersion(undefined);
              refreshHistory();
            });
          }}><WorkbenchIcon name="restore" />Restore Project</button>
      </footer>
    </section> : <>
      {history.data && !history.data.versions.length && <p className="wb-branch-empty">No snapshots yet.</p>}
      {!!history.data?.versions.length && <ul className="wb-branch-list" aria-label="Project Snapshots">
        {history.data.versions.map(item => <li className="wb-branch-row-title" key={item.id}>
          <span className="wb-result-icon"><WorkbenchIcon name="recent" /></span>
          <span className="wb-branch-version"><strong>{item.name}</strong>
            <small>{formatDate(item.createdAt, 'compact')} · {item.files} {item.files === 1 ? 'file' : 'files'}{item.author && ' · ' + item.author}</small>
          </span>
          {project.role === 'manager' && <button type="button" className="wb-icon-button" aria-label={'Preview Restore ' + item.name}
            title="Preview Restore" disabled={busy} onClick={() => setVersion(item)}><WorkbenchIcon name="restore" /></button>}
        </li>)}
      </ul>}
      {(before || history.data?.next) && <footer className="wb-dialog-actions">
        {before && <button type="button" className="wb-button wb-button-secondary" disabled={busy} onClick={() => setBefore(undefined)}>Newest</button>}
        {history.data?.next && <button type="button" className="wb-button wb-button-secondary" disabled={busy} onClick={() => setBefore(history.data?.next)}>Earlier</button>}
      </footer>}
    </>}
  </>;
}

export function ProjectBranchDialog({ project, onClose, onChange }: {
  project: Project; onClose: () => void; onChange: () => void;
}) {
  const manager = project.role === 'manager';
  const [view, setView] = useState(manager ? 'sync' : 'history');
  const [status, setStatus] = useState('');
  const action = useProjectWrite();
  return <BranchDialog title={manager ? 'Project Sync & Versions' : 'Project Versions'} context={project.name} busy={action.busy} onClose={onClose}>
    {manager && <div className="wb-branch-tabs">
      <div className="wb-segmented" role="group" aria-label="Project View">
        {(['sync', 'history'] as const).map(tab => <button type="button" key={tab} disabled={action.busy} aria-pressed={view === tab}
          onClick={() => { action.clear(); setStatus(''); setView(tab); }}>{tab === 'sync' ? 'Sync' : 'History'}</button>)}
      </div>
    </div>}
    {action.error && <p className="wb-error-text" role="alert">{action.error}</p>}
    {status && <p className="wb-branch-feedback" role="status">{status}</p>}
    {view === 'sync' && manager ? <SyncChanges project={project} busy={action.busy} onSync={(path, payload, refresh) => {
      setStatus('');
      void action.run(path, payload, result => {
        setStatus(result.files ? `${result.files} ${result.files === 1 ? 'file' : 'files'} updated.` : 'The linked copies are up to date.');
        onChange();
        refresh();
      }, refresh);
    }} /> : <ProjectHistory project={project} busy={action.busy} onWrite={(path, payload, refresh, after) => {
      const restoring = 'token' in payload;
      setStatus('');
      void action.run(path, payload, result => {
        setStatus(restoring ? `Restored project. ${result.files} ${result.files === 1 ? 'file' : 'files'} updated.` : 'Snapshot saved.');
        if (restoring) onChange();
        else refresh();
        after?.();
      }, restoring ? refresh : undefined);
    }} />}
  </BranchDialog>;
}
