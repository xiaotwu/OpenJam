import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Organization, Project } from '../../lib/directory';
import { agendaPath, meetingPath, useWorkshopResource, writeWorkshop, type AgendaDraft, type AgendaItem } from '../../lib/workshop';
import { useI18n } from '../../i18n';
import { newRequestId } from '../../lib/requestId';
import WorkshopIcon from './WorkshopIcon';
import MeetingEditor from './MeetingEditor';

interface Scope {
  value: string;
  label: string;
  writable: boolean;
}

function workshopScopes(teams: Organization[], projects: Project[]): Scope[] {
  return [
    { value: '', label: 'Personal', writable: true },
    ...teams.map(team => ({ value: 'team:' + team.id, label: team.name, writable: true })),
    ...projects.map(project => ({
      value: 'project:' + project.id, label: project.name, writable: project.role === 'manager' || project.role === 'edit',
    })),
  ];
}

function atMidnight(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysAfter(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function dateKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function localInput(value: Date) {
  return dateKey(value) + 'T' + [value.getHours(), value.getMinutes()].map(part => String(part).padStart(2, '0')).join(':');
}

function agendaScope(item: Pick<AgendaDraft, 'teamId' | 'projectId'>) {
  return item.projectId ? 'project:' + item.projectId : item.teamId ? 'team:' + item.teamId : '';
}

function agendaURL(date: Date, item?: AgendaItem) {
  const params = new URLSearchParams({ view: 'calendar', date: dateKey(date) });
  if (item) params.set('item', item.id);
  return '/workplace?' + params;
}

function itemsOnDay(items: AgendaItem[], date: Date) {
  const from = atMidnight(date).getTime();
  const to = daysAfter(date, 1).getTime();
  return items.filter(item => {
    const start = new Date(item.startsAt).getTime();
    const end = new Date(item.endsAt).getTime();
    return start < to && (start === end ? start >= from : end > from);
  });
}

export function AgendaOverview() {
  const { formatDate } = useI18n();
  const today = atMidnight(new Date());
  const upcomingFrom = daysAfter(today, 1);
  const result = useWorkshopResource<{ items: AgendaItem[] }>(agendaPath(today, daysAfter(today, 8)), 15_000);
  const items = (result.data?.items ?? []).filter(item => !item.completed && item.meetingStatus !== 'ended');
  const todayItems = itemsOnDay(items, today);
  const upcoming = items.filter(item => new Date(item.startsAt) >= upcomingFrom);

  function rows(entries: AgendaItem[], empty: string, dates: boolean) {
    if (!entries.length) return <p className="workshop-muted">{empty}</p>;
    return <ul className="workshop-agenda-summary">
      {entries.slice(0, 8).map(item => <li key={item.id}>
        <Link to={item.kind === 'meeting' ? meetingPath(item.id) : agendaURL(dates ? new Date(item.startsAt) : today, item)}>
          <WorkshopIcon name={item.kind === 'meeting' ? 'camera' : item.kind === 'task' ? 'task' : 'calendar'} />
          <span><strong>{item.title}</strong>{dates && <small>{formatDate(item.startsAt, 'compact')}</small>}</span>
        </Link>
      </li>)}
    </ul>;
  }

  return <aside className="workshop-surface workshop-agenda-overview" aria-label="Agenda Overview">
    <div className="workshop-section-head">
      <h2>Today</h2>
      <Link className="workshop-icon-button" to={agendaURL(today)} title="Open Calendar" aria-label="Open Calendar"><WorkshopIcon name="calendar" /></Link>
    </div>
    {result.loading && <p role="status" className="workshop-muted">Loading agenda…</p>}
    {result.error && <p role="alert" className="workshop-error-text">{result.error}</p>}
    {result.data && <>
      {rows(todayItems, 'Nothing scheduled today.', false)}
      <h2>Next 7 Days</h2>
      {rows(upcoming, 'Nothing upcoming.', true)}
    </>}
  </aside>;
}

interface EditorProps {
  selectedDate: Date;
  item?: AgendaItem & { kind: AgendaDraft['kind'] };
  scopes: Scope[];
  initialScope?: string;
  onClose: () => void;
  onSaved: () => void;
}

function AgendaEditor({ selectedDate, item, scopes, initialScope, onClose, onSaved }: EditorProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [id] = useState(() => item?.id ?? newRequestId());
  const morning = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 9);
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [kind, setKind] = useState<AgendaDraft['kind']>(item?.kind ?? 'event');
  const [scope, setScope] = useState(item ? agendaScope(item) : scopes.some(entry => entry.value === initialScope) ? initialScope! : '');
  const [startsAt, setStartsAt] = useState(localInput(item ? new Date(item.startsAt) : morning));
  const [endsAt, setEndsAt] = useState(localInput(item ? new Date(item.endsAt) : new Date(morning.getTime() + 3_600_000)));
  const [completed, setCompleted] = useState(item?.completed ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  async function mutate(remove: boolean) {
    setBusy(true);
    setError('');
    try {
      if (remove && item) {
        await writeWorkshop('/agenda/' + id + '?revision=' + item.revision, 'DELETE');
      } else {
        const start = new Date(startsAt);
        const end = kind === 'task' ? start : new Date(endsAt);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
          setError('Choose an end time at or after the start.');
          return;
        }
        const draft: AgendaDraft = {
          kind, title: title.trim(), notes, startsAt: start.toISOString(), endsAt: end.toISOString(),
          completed: kind === 'task' && completed, revision: item?.revision,
          teamId: scope.startsWith('team:') ? scope.slice(5) : undefined,
          projectId: scope.startsWith('project:') ? scope.slice(8) : undefined,
        };
        await writeWorkshop('/agenda/' + id, 'PUT', draft);
      }
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save this item.');
    } finally {
      setBusy(false);
    }
  }

  const heading = item ? 'Edit ' + (item.kind === 'task' ? 'Task' : 'Event') : 'New Item';
  return <dialog className="workshop-dialog workshop-agenda-dialog" ref={ref} aria-label={heading}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="workshop-dialog-heading">
      <h2>{heading}</h2>
      <button type="button" className="workshop-icon-button" onClick={onClose} aria-label="Close" disabled={busy}><WorkshopIcon name="close" /></button>
    </header>
    <form onSubmit={event => { event.preventDefault(); void mutate(false); }}>
      <div className="workshop-form-grid">
        <label className="workshop-field">Type<select aria-label="Type" value={kind} onChange={event => setKind(event.target.value as AgendaDraft['kind'])}>
          <option value="event">Event</option><option value="task">Task</option>
        </select></label>
        <label className="workshop-field">Calendar<select aria-label="Calendar" value={scope} disabled={Boolean(item)} onChange={event => setScope(event.target.value)}>
          {scopes.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select></label>
      </div>
      <label className="workshop-field">Title<input required value={title} maxLength={140} onChange={event => setTitle(event.target.value)} /></label>
      <div className="workshop-form-grid">
        <label className="workshop-field">{kind === 'task' ? 'Due' : 'Starts'}<input type="datetime-local" required value={startsAt}
          onChange={event => setStartsAt(event.target.value)} /></label>
        {kind === 'event' && <label className="workshop-field">Ends<input type="datetime-local" required value={endsAt}
          onChange={event => setEndsAt(event.target.value)} /></label>}
      </div>
      <label className="workshop-field">Notes<textarea value={notes} maxLength={3600} rows={3} onChange={event => setNotes(event.target.value)} /></label>
      {kind === 'task' && <label className="workshop-check-row"><input type="checkbox" checked={completed} onChange={event => setCompleted(event.target.checked)} />Completed</label>}
      {error && <p className="workshop-error-text" role="alert">{error}</p>}
      <footer className="workshop-dialog-actions">
        {item && <button type="button" className="workshop-button workshop-button-secondary" disabled={busy}
          onClick={() => confirmDelete ? void mutate(true) : setConfirmDelete(true)}><WorkshopIcon name="trash" />
          {confirmDelete ? 'Confirm Delete' : 'Delete'}</button>}
        <button type="submit" className="workshop-button workshop-button-primary" disabled={busy || !title.trim()}><WorkshopIcon name="check" />Save</button>
      </footer>
    </form>
  </dialog>;
}

export function WorkshopCalendar({ initialDate, initialItem, initialScope, teams, projects }: {
  initialDate?: string; initialItem?: string; initialScope?: string; teams: Organization[]; projects: Project[];
}) {
  const { locale, formatDate } = useI18n();
  const navigate = useNavigate();
  const today = atMidnight(new Date());
  const [selected, setSelected] = useState(() => {
    const date = initialDate ? new Date(initialDate + 'T00:00:00') : today;
    return Number.isFinite(date.getTime()) ? date : today;
  });
  const [editing, setEditing] = useState<EditorProps['item'] | 'new'>();
  const [newMeeting, setNewMeeting] = useState(false);
  const [filter, setFilter] = useState(initialScope ?? 'all');
  const scopes = workshopScopes(teams, projects);
  const editorScopes = scopes.filter(scope => scope.writable || (editing && editing !== 'new' && agendaScope(editing) === scope.value));
  const meetingScopes = scopes.filter(scope => scope.value && scope.writable);
  const month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const first = daysAfter(month, -((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => daysAfter(first, i));
  const result = useWorkshopResource<{ items: AgendaItem[] }>(agendaPath(first, daysAfter(first, 42)), 15_000);
  const items = (result.data?.items ?? []).filter(item => filter === 'all' || agendaScope(item) === filter);
  const selectedItems = itemsOnDay(items, selected);
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month);
  const labelDay = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' });
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });

  return <div className="workshop-calendar-layout">
    <section className="workshop-surface workshop-calendar" aria-label="Month">
      <div className="workshop-section-head workshop-calendar-header">
        <div className="workshop-inline-actions">
          <button type="button" className="workshop-icon-button" title="Previous Month" aria-label="Previous Month"
            onClick={() => setSelected(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><WorkshopIcon name="previous" /></button>
          <h2>{monthLabel}</h2>
          <button type="button" className="workshop-icon-button" title="Next Month" aria-label="Next Month"
            onClick={() => setSelected(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><WorkshopIcon name="next" /></button>
        </div>
        <div className="workshop-inline-actions">
          <select className="workshop-select" aria-label="Calendar Filter" value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All Calendars</option>
            {scopes.map(scope => <option value={scope.value} key={scope.value}>{scope.label}</option>)}
          </select>
          <button type="button" className="workshop-button workshop-button-secondary" onClick={() => setSelected(today)}>Today</button>
          {meetingScopes.length > 0 && <button type="button" className="workshop-icon-button workshop-glass-control"
            title="Schedule Meeting" aria-label="Schedule Meeting" onClick={() => setNewMeeting(true)}><WorkshopIcon name="camera" /></button>}
          <button type="button" className="workshop-icon-button workshop-accent-action" onClick={() => setEditing('new')} title="New Event or Task" aria-label="New Event or Task">
            <WorkshopIcon name="plus" />
          </button>
        </div>
      </div>
      <div className="workshop-calendar-weekdays" aria-hidden="true">{days.slice(0, 7).map(day => <span key={dateKey(day)}>{weekday.format(day)}</span>)}</div>
      <div className="workshop-calendar-grid">{days.map(day => {
        const entries = itemsOnDay(items, day);
        return <button type="button" className="workshop-calendar-day" key={dateKey(day)}
          aria-label={labelDay.format(day) + (entries.length ? ', ' + entries.length + ' items' : '')}
          data-outside={day.getMonth() !== month.getMonth()} data-today={dateKey(day) === dateKey(today)}
          aria-pressed={dateKey(day) === dateKey(selected)} onClick={() => setSelected(day)}>
          <span className="workshop-day-number">{day.getDate()}</span>
          {entries.slice(0, 2).map(entry => <span className="workshop-day-entry" data-kind={entry.kind} key={entry.id}>{entry.title}</span>)}
          {entries.length > 2 && <small>+{entries.length - 2}</small>}
        </button>;
      })}</div>
      {result.error && <p className="workshop-inline-empty" role="alert">{result.error}</p>}
    </section>
    <section className="workshop-surface workshop-day-agenda" aria-label="Selected Day">
      <div className="workshop-section-head"><h2>{labelDay.format(selected)}</h2></div>
      {result.loading && <p className="workshop-inline-empty" role="status">Loading agenda…</p>}
      {result.data && !selectedItems.length && <p className="workshop-inline-empty">Nothing scheduled.</p>}
      <ul className="workshop-result-list">{selectedItems.map(item => (
        <li key={item.id} className="workshop-agenda-item" data-focused={initialItem === item.id}>
          <div className="workshop-result-row">
            <span className="workshop-result-icon"><WorkshopIcon name={item.kind === 'meeting' ? 'camera' : item.kind === 'task' ? 'task' : 'calendar'} /></span>
            <span className="workshop-row-content"><strong data-complete={item.completed}>{item.title}</strong>
              <span>{time.format(new Date(item.startsAt))}{item.scopeName ? ' · ' + item.scopeName : ''}</span></span>
            {item.kind === 'meeting' ? <Link className="workshop-icon-button" to={meetingPath(item.id)}
              state={{ workshop: agendaURL(selected, item) }} aria-label={'Open ' + item.title} title="Open Meeting"><WorkshopIcon name="arrow" /></Link>
              : item.editable && <button type="button" className="workshop-icon-button" aria-label={'Edit ' + item.title}
                onClick={() => setEditing({ ...item, kind: item.kind === 'task' ? 'task' : 'event' })}><WorkshopIcon name="pencil" /></button>}
          </div>
          {item.meetingStatus === 'ended' && <p>Ended</p>}
          {item.notes && <p>{item.notes}</p>}
          {item.kind === 'event' && dateKey(new Date(item.endsAt)) !== dateKey(selected) &&
            <p>Ends {formatDate(item.endsAt, 'compact')}</p>}
        </li>
      ))}</ul>
    </section>
    {editing && <AgendaEditor item={editing === 'new' ? undefined : editing} selectedDate={selected} scopes={editorScopes}
      initialScope={filter} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); result.refresh(); }} />}
    {newMeeting && <MeetingEditor scopes={meetingScopes} date={selected} initialScope={filter} onClose={() => setNewMeeting(false)}
      onCreated={id => navigate(meetingPath(id), { state: { workshop: agendaURL(selected) } })} />}
  </div>;
}
