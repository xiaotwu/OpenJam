import { useState } from 'react';
import type { Organization, Project } from '../../lib/directory';
import type { InboxBadgeStyle } from '../../lib/useAppearance';
import WorkbenchIcon, { type WorkbenchIconName } from './WorkbenchIcon';

export type WorkshopView = 'inbox' | 'calendar' | 'recents' | 'recent' | 'favorites' | 'shared' | 'archive';

const primaryViews = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'recents', label: 'Recents', icon: 'recent' },
] as const;
const libraryViews = [
  { id: 'favorites', label: 'Favorites', icon: 'star' },
  { id: 'shared', label: 'Shared With Me', icon: 'shared' },
  { id: 'archive', label: 'Archive', icon: 'archive' },
] as const;

interface Props {
  activeView?: WorkshopView;
  personalProjects: Project[];
  teams: Organization[];
  projectsByTeam: Map<string, Project[]>;
  activeTeam?: string;
  activeProject?: string;
  personalOpen: boolean;
  badge: InboxBadgeStyle;
  unread: number;
  onView: (view: WorkshopView) => void;
  onProjects: () => void;
  onTeam: (id: string) => void;
  onProject: (id: string) => void;
  onNewTeam: () => void;
}

export default function WorkshopNavigation({
  activeView, personalProjects, teams, projectsByTeam, activeTeam, activeProject, personalOpen, badge, unread,
  onView, onProjects, onTeam, onProject, onNewTeam,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  function toggle(key: string) {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function row(id: WorkshopView, label: string, icon: WorkbenchIconName) {
    return <button type="button" key={id} className="wb-nav-button" aria-current={activeView === id ? 'page' : undefined}
      aria-label={id === 'inbox' && unread > 0 && badge !== 'hidden' ? `Inbox, ${unread} unread` : undefined}
      onClick={() => onView(id)}>
      <WorkbenchIcon name={icon} /><span>{label}</span>
      {id === 'inbox' && unread > 0 && badge !== 'hidden' && (
        <span className={`wb-unread-badge wb-unread-${badge}`} aria-hidden="true">{badge === 'count' && (unread > 99 ? '99+' : unread)}</span>
      )}
    </button>;
  }
  function projectRows(items: Project[]) {
    return items.map(project => <button type="button" key={project.id} className="wb-nav-button wb-nav-child"
      aria-current={activeProject === project.id ? 'page' : undefined} onClick={() => onProject(project.id)} title={project.name}>
      <WorkbenchIcon name="folder" /><span>{project.name}</span>
    </button>);
  }

  const projectsExpanded = !collapsed.has('projects');
  const teamsExpanded = !collapsed.has('teams');

  return (
    <nav className="wb-navigation" aria-label="Workshop Navigation">
      <p className="wb-nav-heading">Workshop</p>
      {primaryViews.map(item => row(item.id, item.label, item.icon))}
      <div className="wb-nav-group">
        <div className="wb-nav-parent">
          <button type="button" className="wb-nav-button" aria-current={personalOpen && !activeProject ? 'page' : undefined}
            onClick={() => { if (!projectsExpanded) toggle('projects'); onProjects(); }}>
            <WorkbenchIcon name="folder" /><span>Projects</span>
          </button>
          <button type="button" className="wb-icon-button wb-nav-chevron" data-expanded={projectsExpanded}
            aria-label={projectsExpanded ? 'Collapse Projects' : 'Expand Projects'} aria-expanded={projectsExpanded}
            onClick={() => toggle('projects')}><WorkbenchIcon name="chevron" /></button>
        </div>
        {projectsExpanded && <div className="wb-nav-children">{projectRows(personalProjects)}</div>}
      </div>
      <div className="wb-nav-group">
        <div className="wb-nav-parent">
          <button type="button" className="wb-nav-button" aria-expanded={teamsExpanded} onClick={() => toggle('teams')}>
            <WorkbenchIcon name="organization" /><span>Teams</span>
            <i className="wb-nav-chevron" data-expanded={teamsExpanded}><WorkbenchIcon name="chevron" /></i>
          </button>
          <button type="button" className="wb-icon-button" aria-label="New Team" title="New Team" onClick={onNewTeam}>
            <WorkbenchIcon name="plus" />
          </button>
        </div>
        {teamsExpanded && <div className="wb-nav-children">
          {teams.map(team => {
            const expanded = activeTeam === team.id && !collapsed.has(team.id);
            return <div key={team.id}>
              <div className="wb-nav-parent">
                <button type="button" className="wb-nav-button wb-nav-child" title={team.name}
                  aria-current={activeTeam === team.id && !activeProject ? 'page' : undefined}
                  onClick={() => { if (collapsed.has(team.id)) toggle(team.id); onTeam(team.id); }}>
                  <WorkbenchIcon name="organization" /><span>{team.name}</span>
                </button>
                {activeTeam === team.id && <button type="button" className="wb-icon-button wb-nav-chevron" data-expanded={expanded}
                  aria-label={expanded ? 'Collapse ' + team.name : 'Expand ' + team.name} aria-expanded={expanded}
                  onClick={() => toggle(team.id)}><WorkbenchIcon name="chevron" /></button>}
              </div>
              {expanded && <div className="wb-nav-children">{projectRows(projectsByTeam.get(team.id) ?? [])}</div>}
            </div>;
          })}
        </div>}
      </div>
      <div className="wb-library-nav">{libraryViews.map(item => row(item.id, item.label, item.icon))}</div>
    </nav>
  );
}
