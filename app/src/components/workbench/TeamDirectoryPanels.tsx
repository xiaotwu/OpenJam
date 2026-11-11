import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { boardCredentialFragment } from '../../lib/boardSharing';
import {
  changeProjectMember, changeTeamMember, getProjectMembers, getTeamMembers, inviteTeamMember,
  type AssignableTeamRole, type Organization, type Project, type ProjectMember, type ProjectRole, type TeamMember,
} from '../../lib/directory';
import WorkbenchIcon from './WorkbenchIcon';

const projectRoles: ProjectRole[] = ['view', 'comment', 'edit', 'manager'];

function usePanelAction(fallback: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run };
}

export function ProjectList({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  const { messages: { workbench: { teams: text } } } = useI18n();
  return (
    <section className="wb-team-panel" aria-label={text.projects}>
      <h2>{text.projects}</h2>
      {projects.length ? <ul className="wb-team-list">
        {projects.map(project => <li key={project.id}>
          <button type="button" className="wb-team-link" onClick={() => onOpen(project.id)}>
            <WorkbenchIcon name="folder" /> <span>{project.name}</span>
          </button>
          {!!project.people?.length && <div className="wb-project-avatars" aria-label="Project People">
            {project.people.map(person => {
              const label = person.displayName + ' · ' + (person.isOwner ? 'Owner' : 'Participant');
              return <span className="wb-team-avatar" key={person.userId} data-owner={person.isOwner}
                aria-label={label} role="img" title={label} style={{ backgroundColor: person.avatarColor }}>
                {Array.from(person.displayName)[0]?.toUpperCase()}
              </span>;
            })}
            {(project.peopleCount ?? 0) > project.people.length && <span className="wb-avatar-overflow"
              aria-label={String(project.peopleCount! - project.people.length) + ' more participants'}>
              +{project.peopleCount! - project.people.length}
            </span>}
          </div>}
        </li>)}
      </ul> : <p>{text.noProjects}</p>}
    </section>
  );
}

interface TeamMembersProps {
  team: Organization;
  currentUserId: string;
  focusedMember?: string | null;
  onLeave: () => void;
}

export function TeamMembers({ team, currentUserId, focusedMember, onLeave }: TeamMembersProps) {
  const { formatDate, messages: { workbench: { teams: text } } } = useI18n();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableTeamRole>('member');
  const [invitation, setInvitation] = useState<{ url: string; expiresAt: string }>();
  const [copied, setCopied] = useState(false);
  const focusRow = useRef<HTMLLIElement>(null);
  const { busy, error, run } = usePanelAction(text.actionError);

  useEffect(() => {
    const controller = new AbortController();
    void getTeamMembers(team.id, controller.signal).then(setMembers).catch(failure => {
      if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : text.loadError);
    }).finally(() => {
      if (!controller.signal.aborted) setLoaded(true);
    });
    return () => controller.abort();
  }, [team.id, text.loadError]);

  useEffect(() => {
    if (!loaded || !focusedMember) return;
    focusRow.current?.scrollIntoView({ block: 'nearest' });
    focusRow.current?.focus({ preventScroll: true });
  }, [loaded, focusedMember]);

  const isOwner = team.role === 'owner';
  const canInvite = isOwner || team.role === 'admin';

  return (
    <section className="wb-team-panel" aria-label={text.members}>
      <h2>{text.members}</h2>
      {!loaded && <p role="status">{text.loadingMembers}</p>}
      {(loadError || error) && <p role="alert" className="wb-error-text">{loadError || error}</p>}
      <ul className="wb-team-list">
        {members.map(member => {
          const self = member.userId === currentUserId;
          const canRemove = member.role !== 'owner' && (self || isOwner || (team.role === 'admin' && member.role === 'member'));
          return <li key={member.userId} tabIndex={-1} ref={focusedMember === member.userId ? focusRow : undefined}
            data-focused={focusedMember === member.userId}>
            <div className="wb-team-person">
              <span className="wb-team-avatar" aria-hidden="true" style={{ backgroundColor: member.avatarColor }}>
                {Array.from(member.displayName)[0]?.toUpperCase()}
              </span>
              <div><strong>{member.displayName}</strong>{member.email && <p>{member.email}</p>}</div>
            </div>
            <div className="wb-team-actions">
              {isOwner && member.role !== 'owner' ? (
                <select aria-label={text.roleFor(member.displayName)} value={member.role} disabled={busy}
                  onChange={event => {
                    const updated = event.target.value === 'admin' ? 'admin' : 'member';
                    void run(async () => {
                      await changeTeamMember(team.id, member.userId, updated);
                      setMembers(await getTeamMembers(team.id));
                    });
                  }}>
                  <option value="member">{text.teamRoles.member}</option>
                  <option value="admin">{text.teamRoles.admin}</option>
                </select>
              ) : <span className="wb-role-label">{text.teamRoles[member.role]}</span>}
              {canRemove && <button type="button" className="wb-button wb-button-secondary" disabled={busy}
                onClick={() => void run(async () => {
                  await changeTeamMember(team.id, member.userId);
                  if (self) onLeave();
                  else setMembers(await getTeamMembers(team.id));
                })}>{self ? text.leave : text.remove(member.displayName)}</button>}
            </div>
          </li>;
        })}
      </ul>
      {canInvite && <form className="wb-team-form" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          const result = await inviteTeamMember(team.id, email.trim(), role);
          const url = new URL(`/teams/${encodeURIComponent(team.id)}/invite`, window.location.origin);
          url.hash = boardCredentialFragment({ kind: 'invite', token: result.token });
          setInvitation({ url: url.href, expiresAt: result.expiresAt });
          setCopied(false);
          setEmail('');
        });
      }}>
        <label className="wb-field">{text.inviteEmail}
          <input type="email" required value={email} maxLength={254} disabled={busy} onChange={event => setEmail(event.target.value)} />
        </label>
        {isOwner && <label className="wb-field">{text.inviteRole}
          <select value={role} disabled={busy} onChange={event => setRole(event.target.value === 'admin' ? 'admin' : 'member')}>
            <option value="member">{text.teamRoles.member}</option>
            <option value="admin">{text.teamRoles.admin}</option>
          </select>
        </label>}
        <button type="submit" className="wb-button wb-button-primary" disabled={busy || !email.trim()}><WorkbenchIcon name="plus" />{text.invite}</button>
      </form>}
      {invitation && <div className="wb-team-invitation">
        <label className="wb-field">{text.invitationURL}
          <input readOnly value={invitation.url} onFocus={event => event.currentTarget.select()} />
        </label>
        <div className="wb-team-actions">
          <button type="button" className="wb-button wb-button-secondary" onClick={() => void run(async () => {
            await navigator.clipboard.writeText(invitation.url);
            setCopied(true);
          })}>{copied ? text.copied : text.copyInvitation}</button>
          <span>{text.invitationExpires(formatDate(invitation.expiresAt))}</span>
        </div>
      </div>}
    </section>
  );
}

interface ProjectAccessProps {
  project: Project;
  teamId: string;
  currentUserId: string;
  onChange: () => void;
}

export function ProjectAccess({ project, teamId, currentUserId, onChange }: ProjectAccessProps) {
  const { messages: { workbench: { teams: text } } } = useI18n();
  return <details className="wb-team-panel wb-project-access">
    <summary>{text.manageProject}</summary>
    <ProjectAccessEditor project={project} teamId={teamId} currentUserId={currentUserId} onChange={onChange} />
  </details>;
}

function ProjectAccessEditor({ project, teamId, currentUserId, onChange }: ProjectAccessProps) {
  const { messages: { workbench: { teams: text } } } = useI18n();
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [target, setTarget] = useState('');
  const [role, setRole] = useState<ProjectRole>('view');
  const { busy, error, run } = usePanelAction(text.actionError);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([getTeamMembers(teamId, controller.signal), getProjectMembers(project.id, controller.signal)])
      .then(([people, access]) => {
        if (!controller.signal.aborted) {
          setRoster(people);
          setMembers(access);
        }
      }).catch(failure => {
        if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : text.loadError);
      }).finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [project.id, teamId, text.loadError]);

  const available = roster.filter(person => !members.some(member => member.userId === person.userId));
  const memberToAdd = available.some(person => person.userId === target) ? target : available[0]?.userId ?? '';

  function updateAccess(userId: string, updated?: ProjectRole) {
    void run(async () => {
      await changeProjectMember(project.id, userId, updated);
      if (userId === currentUserId) onChange();
      else setMembers(await getProjectMembers(project.id));
      setTarget('');
    });
  }

  return (
    <>
      {!loaded && <p role="status">{text.loadingMembers}</p>}
      {(loadError || error) && <p className="wb-error-text" role="alert">{loadError || error}</p>}
      <ul className="wb-team-list">
        {members.map(member => <li key={member.userId}>
          <strong>{member.displayName}</strong>
          <div className="wb-team-actions">
            {member.inherited ? <span className="wb-role-label">{text.projectRoles[member.role]}</span> : (
              <>
                <select aria-label={text.roleFor(member.displayName)} value={member.role} disabled={busy}
                  onChange={event => updateAccess(member.userId, event.target.value as ProjectRole)}>
                  {projectRoles.map(option => <option key={option} value={option}>{text.projectRoles[option]}</option>)}
                </select>
                <button type="button" className="wb-button wb-button-secondary" disabled={busy}
                  onClick={() => updateAccess(member.userId)}>{text.remove(member.displayName)}</button>
              </>
            )}
          </div>
        </li>)}
      </ul>
      {available.length > 0 && <form className="wb-team-form" onSubmit={event => {
        event.preventDefault();
        if (memberToAdd) updateAccess(memberToAdd, role);
      }}>
        <label className="wb-field">{text.memberToAdd}
          <select aria-label={text.memberToAdd} value={memberToAdd} disabled={busy} onChange={event => setTarget(event.target.value)}>
            {available.map(person => <option key={person.userId} value={person.userId}>{person.displayName}</option>)}
          </select>
        </label>
        <label className="wb-field">{text.projectRole}
          <select aria-label={text.projectRole} value={role} disabled={busy} onChange={event => setRole(event.target.value as ProjectRole)}>
            {projectRoles.map(option => <option key={option} value={option}>{text.projectRoles[option]}</option>)}
          </select>
        </label>
        <button type="submit" className="wb-button wb-button-primary" disabled={busy}>{text.grantAccess}</button>
      </form>}
    </>
  );
}
