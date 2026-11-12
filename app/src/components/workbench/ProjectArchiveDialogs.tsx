import { useEffect, useRef, useState } from 'react';
import { getTeamMembers, type Project, type ProjectRole, type TeamMember, type Workspace } from '../../lib/directory';
import { downloadProjectArchive, inspectProjectArchive, projectArchiveLimit, restoreProjectArchive,
  type ProjectArchiveInfo, type ProjectArchiveMapping } from '../../lib/projectArchives';
import { newRequestId } from '../../lib/requestId';
import { BranchDialog } from './ProjectBranchDialogs';
import WorkbenchIcon from './WorkbenchIcon';
import './project-archives.css';

const roleLabels: Record<ProjectRole, string> = { manager: 'Manager', edit: 'Can Edit', comment: 'Can Comment', view: 'Can View' };
const roles: ProjectRole[] = ['view', 'comment', 'edit', 'manager'];

function countNames<T>(people: T[], nameOf: (person: T) => string) {
  const counts = new Map<string, number>();
  for (const person of people) {
    const name = nameOf(person);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function useArchiveAction() {
  const current = useRef<AbortController>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => current.current?.abort(), []);
  async function run(work: (signal: AbortSignal) => Promise<void>, fallback: string) {
    if (current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setBusy(true);
    setError('');
    try {
      await work(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : fallback);
    } finally {
      current.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function ExportProjectArchiveDialog({ project, onClose, onExported }: {
  project: Project; onClose: () => void; onExported: () => void;
}) {
  const action = useArchiveAction();
  return <BranchDialog title="Export Project Archive" context={project.name} busy={action.busy} onClose={onClose}>
    <div className="wb-archive-intro">
      <span className="wb-archive-icon"><WorkbenchIcon name="archive" /></span>
      <div>
        <strong>One package for your project</strong>
        <p>Includes Boards, Docs, Sheets, Slides, private images, file versions, and project snapshots.</p>
      </div>
    </div>
    <p className="wb-archive-note">Keep the ZIP private. Team membership, share links, and invitations aren’t carried over.</p>
    {action.busy && <p className="wb-archive-note" role="status">Preparing your project archive…</p>}
    {action.error && <p role="alert" className="wb-error-text">{action.error}</p>}
    <footer className="wb-dialog-actions">
      <button type="button" className="wb-button wb-button-primary" disabled={action.busy}
        onClick={() => void action.run(async signal => {
          await downloadProjectArchive(project, signal);
          if (!signal.aborted) onExported();
        }, 'Could not download the project archive.')}>
        <WorkbenchIcon name="download" />Download
      </button>
    </footer>
  </BranchDialog>;
}

export function RestoreProjectArchiveDialog({ label, teamId, actorId, workspaces, initialWorkspaceId, onClose, onRestored }: {
  label: string; teamId?: string; actorId: string; workspaces: Workspace[]; initialWorkspaceId: string;
  onClose: () => void; onRestored: (project: Project) => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [file, setFile] = useState<File>();
  const [info, setInfo] = useState<ProjectArchiveInfo>();
  const [name, setName] = useState('');
  const [mappings, setMappings] = useState<Record<string, ProjectArchiveMapping>>({});
  const [roster, setRoster] = useState<{ members: TeamMember[]; error?: string }>();
  const [saving, setSaving] = useState(false);
  const [rosterRetry, setRosterRetry] = useState(0);
  const receipt = useRef<{ id: string; signature: string }>(null);
  const action = useArchiveAction();
  useEffect(() => {
    if (!teamId) return;
    const controller = new AbortController();
    void getTeamMembers(teamId, controller.signal).then(members => {
      if (!controller.signal.aborted) setRoster({ members: members.filter(member => member.role !== 'owner' && member.userId !== actorId) });
    }).catch(() => {
      if (!controller.signal.aborted) setRoster({ members: [], error: 'Could not load Team members.' });
    });
    return () => controller.abort();
  }, [teamId, actorId, rosterRetry]);

  function selectArchive(selected: File) {
    setFile(undefined);
    setInfo(undefined);
    setMappings({});
    receipt.current = null;
    if (selected.size === 0 || selected.size > projectArchiveLimit) {
      action.setError('Choose a project ZIP up to 64 MiB.');
      return;
    }
    setFile(selected);
    void action.run(async signal => {
      const parsed = await inspectProjectArchive(selected, signal);
      if (!signal.aborted) {
        setName(parsed.name);
        setInfo(parsed);
      }
    }, 'Could not read this project archive.');
  }

  function setTarget(sourceUserId: string, targetUserId: string) {
    setMappings(previous => {
      const next = { ...previous };
      if (targetUserId) {
        next[sourceUserId] = { sourceUserId, targetUserId, role: 'view' };
      } else {
        delete next[sourceUserId];
      }
      return next;
    });
  }

  const picks = Object.values(mappings).sort((a, b) => a.sourceUserId.localeCompare(b.sourceUserId));
  const sourceNames = countNames(info?.members ?? [], member => member.name);
  const targetNames = countNames(roster?.members ?? [], member => member.displayName);
  const assigned = new Set(picks.map(item => item.targetUserId));
  const valid = Boolean(file && info && name.trim()) && Array.from(name.trim()).length <= 120
    && workspaces.some(workspace => workspace.id === workspaceId);
  function restore() {
    if (!file || !valid || action.busy) return;
    setSaving(true);
    const signature = JSON.stringify([workspaceId, name.trim(), picks]);
    if (receipt.current?.signature !== signature) receipt.current = { signature, id: newRequestId() };
    const requestId = receipt.current.id;
    void action.run(async signal => {
      try {
        const project = await restoreProjectArchive(workspaceId, file, requestId, name.trim(), picks, signal);
        if (!signal.aborted) onRestored(project);
      } finally {
        if (!signal.aborted) setSaving(false);
      }
    }, 'Could not restore the project archive.');
  }

  return <BranchDialog title="Restore Project Archive" context={label} busy={action.busy} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); restore(); }}>
      <div className="wb-archive-select">
        <label className="wb-button wb-button-secondary wb-archive-picker" data-disabled={action.busy}>
          <WorkbenchIcon name="import" />{file ? 'Change ZIP' : 'Choose ZIP'}
          <input type="file" aria-label="Project ZIP" accept=".zip,application/zip" disabled={action.busy}
            onChange={event => {
              if (event.target.files?.[0]) selectArchive(event.target.files[0]);
              event.target.value = '';
            }} />
        </label>
        <span title={file?.name}>{file?.name ?? 'OpenJam project archive · Up to 64 MiB'}</span>
      </div>
      {action.busy && <p role="status" className="wb-archive-note">{saving ? 'Restoring files and history…' : 'Checking the archive…'}</p>}
      {info && <>
        <div className="wb-archive-summary" aria-label="Archive contents">
          <span><strong>{info.files}</strong> Files</span>
          <span><strong>{info.fileVersions}</strong> File Versions</span>
          <span><strong>{info.projectVersions}</strong> Project Snapshots</span>
          <span><strong>{info.images}</strong> Private Images</span>
        </div>
        <div className="wb-archive-destination">
          <label className="wb-field">Project Name
            <input required maxLength={240} value={name} disabled={action.busy} onChange={event => setName(event.target.value)} />
          </label>
          {workspaces.length > 1 && <label className="wb-field">Workspace
            <select value={workspaceId} disabled={action.busy} onChange={event => setWorkspaceId(event.target.value)}>
              {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          </label>}
        </div>
        {teamId && info.members.length > 0 && <details className="wb-archive-mapping">
          <summary><WorkbenchIcon name="shared" /><strong>Map Members</strong>
            <span>{picks.length ? `${picks.length} mapped` : 'Optional'}</span>
          </summary>
          <p>Only selected Team members receive a project role. The Team owner and you keep manager access.</p>
          {roster?.error ? <p role="status">{roster.error} <button type="button" className="wb-button wb-button-secondary" disabled={action.busy}
            onClick={() => { setRoster(undefined); setRosterRetry(value => value + 1); }}>Retry</button></p>
            : !roster ? <p role="status">Loading Team members…</p>
              : roster.members.length === 0 ? <p>No other Team members to map.</p>
                : <div className="wb-archive-people">
                  {info.members.map(source => {
                    const pick = mappings[source.id];
                    const available = roster.members.filter(member => member.userId === pick?.targetUserId || !assigned.has(member.userId));
                    const sourceLabel = (source.name || 'Unnamed Member') + ((sourceNames.get(source.name) ?? 0) > 1
                      ? ` · ${source.id.slice(0, 8)}` : '');
                    return <div className="wb-archive-person" key={source.id}>
                      <div><strong>{sourceLabel}</strong><small>{roleLabels[source.role]}</small></div>
                      <select aria-label={`Destination for ${sourceLabel}`} value={pick?.targetUserId ?? ''} disabled={action.busy}
                        onChange={event => setTarget(source.id, event.target.value)}>
                        <option value="">No Access</option>
                        {available.map(member => <option key={member.userId} value={member.userId}>
                          {member.displayName}{(targetNames.get(member.displayName) ?? 0) > 1 ? ` (${member.email ?? member.userId.slice(0, 8)})` : ''}
                        </option>)}
                      </select>
                      {pick && <select aria-label={`Role for ${sourceLabel}`} value={pick.role} disabled={action.busy}
                        onChange={event => setMappings(previous => ({
                          ...previous, [source.id]: { ...pick, role: event.target.value as ProjectRole },
                        }))}>
                        {roles.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}
                      </select>}
                    </div>;
                  })}
                </div>}
        </details>}
        <p className="wb-archive-note">Creates a new project. Internal file links point to the restored copies.</p>
      </>}
      {action.error && <p role="alert" className="wb-error-text">{action.error}</p>}
      <footer className="wb-dialog-actions">
        <button type="submit" className="wb-button wb-button-primary" disabled={!valid || action.busy}>
          <WorkbenchIcon name="restore" />Restore
        </button>
      </footer>
    </form>
  </BranchDialog>;
}
