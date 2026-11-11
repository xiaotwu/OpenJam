import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { request, type User } from '../../lib/api';
import { boardReviewAPI } from '../../lib/boardReview';
import { getTeamMembers, type Organization, type TeamMember } from '../../lib/directory';
import { useI18n } from '../../i18n';
import { newRequestId } from '../../lib/requestId';
import {
  meetingPath, useWorkshopResource, workshopPath, writeWorkshop,
  type Conversation, type Inbox, type ThreadPage, type WorkshopMessage,
} from '../../lib/workshop';
import { AgendaOverview } from './WorkshopCalendar';
import WorkbenchIcon from './WorkbenchIcon';

const tabs = ['All', 'Teams', 'Direct', 'Mentions', 'Meetings'] as const;
type Tab = typeof tabs[number];

function Compose({ teams, user, onClose, onSent }: {
  teams: Organization[]; user: User; onClose: () => void; onSent: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [team, setTeam] = useState(teams[0]?.id ?? '');
  const [recipient, setRecipient] = useState('');
  const [roster, setRoster] = useState<{ team: string; members?: TeamMember[]; error?: string }>();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const draft = useRef<{ signature: string; id: string }>(null);

  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (!team) return;
    const controller = new AbortController();
    void getTeamMembers(team, controller.signal).then(members => {
      if (!controller.signal.aborted) setRoster({ team, members: members.filter(member => member.userId !== user.id) });
    }).catch(failure => {
      if (!controller.signal.aborted) setRoster({ team, error: failure instanceof Error ? failure.message : 'Could not load members.' });
    });
    return () => controller.abort();
  }, [team, user.id]);

  async function send() {
    const values = { teamId: team, recipientId: recipient || undefined, subject: subject.trim(), body: body.trim() };
    if (!values.teamId || !values.subject || !values.body || busy) return;
    const signature = JSON.stringify(values);
    if (draft.current?.signature !== signature) draft.current = { signature, id: newRequestId() };
    setBusy(true);
    setError('');
    try {
      const response = await writeWorkshop<{ id: string }>('/threads', 'POST', { ...values, id: draft.current.id });
      onSent(response.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not send this message.');
    } finally {
      setBusy(false);
    }
  }

  const currentRoster = roster?.team === team ? roster : undefined;
  return <dialog className="wb-dialog wb-compose-dialog" ref={dialog} aria-label="New Conversation"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="wb-dialog-heading">
      <h2>New Conversation</h2>
      <button type="button" className="wb-icon-button" onClick={onClose} aria-label="Close" disabled={busy}><WorkbenchIcon name="close" /></button>
    </header>
    <form onSubmit={event => { event.preventDefault(); void send(); }}>
      <div className="wb-form-grid">
        <label className="wb-field">Team<select value={team} onChange={event => { setTeam(event.target.value); setRecipient(''); }} required>
          {teams.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select></label>
        <label className="wb-field">To<select value={recipient} disabled={!currentRoster?.members} onChange={event => setRecipient(event.target.value)}>
          <option value="">Team Discussion</option>
          {currentRoster?.members?.map(member => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
        </select></label>
      </div>
      <label className="wb-field">Subject<input value={subject} required maxLength={140} onChange={event => setSubject(event.target.value)} /></label>
      <label className="wb-field">Message<textarea value={body} rows={5} required maxLength={6000} onChange={event => setBody(event.target.value)} /></label>
      {currentRoster?.error && <p className="wb-muted" role="status">{currentRoster.error}</p>}
      {error && <p className="wb-error-text" role="alert">{error}</p>}
      <footer className="wb-dialog-actions">
        <button type="submit" className="wb-button wb-button-primary" disabled={busy || !team || !subject.trim() || !body.trim()}>
          <WorkbenchIcon name="send" />Send
        </button>
      </footer>
    </form>
  </dialog>;
}

function ThreadReader({ id, summary, onBack, onChange }: {
  id: string; summary?: Conversation; onBack: () => void; onChange: () => void;
}) {
  const { formatDate } = useI18n();
  const path = '/threads/' + encodeURIComponent(id);
  const { data, error: loadError, loading, refresh } = useWorkshopResource<ThreadPage>(workshopPath + path, 7000);
  const [archive, setArchive] = useState<{ messages: WorkshopMessage[]; nextBefore?: number }>();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState('');
  const read = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const olderHeight = useRef<number>(null);
  const draft = useRef<{ body: string; id: string }>(null);
  const recent = data?.messages ?? [];
  const latest = recent.at(-1)?.sequence ?? 0;
  const nextBefore = archive ? archive.nextBefore : data?.nextBefore;
  const messages = archive ? [...new Map([...archive.messages, ...recent].map(item => [item.sequence, item])).values()] : recent;

  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    if (olderHeight.current !== null) {
      node.scrollTop += node.scrollHeight - olderHeight.current;
      olderHeight.current = null;
    } else if (follow.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [latest, archive]);

  useEffect(() => {
    if (!latest || latest <= read.current) return;
    let active = true;
    let pending = false;
    const mark = async () => {
      if (!active || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        await writeWorkshop(path + '/state', 'PUT', { readThrough: latest });
        if (active) {
          read.current = Math.max(read.current, latest);
          onChange();
        }
      } catch {
        // A later poll or focus can retry while the conversation is accessible.
      } finally {
        pending = false;
      }
    };
    void mark();
    document.addEventListener('visibilitychange', mark);
    return () => { active = false; document.removeEventListener('visibilitychange', mark); };
  }, [latest, onChange, path]);

  async function earlier() {
    if (!nextBefore || paging) return;
    setPaging(true);
    setError('');
    try {
      const result = await request<ThreadPage>(workshopPath + path + '?before=' + nextBefore, { cache: 'no-store' });
      olderHeight.current = scroll.current?.scrollHeight ?? null;
      setArchive({ messages: [...result.messages, ...(archive?.messages ?? recent)], nextBefore: result.nextBefore });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load earlier messages.');
    } finally {
      setPaging(false);
    }
  }

  async function reply() {
    const message = body.trim();
    if (!message || busy) return;
    if (draft.current?.body !== message) draft.current = { body: message, id: newRequestId() };
    setBusy(true);
    setError('');
    try {
      await writeWorkshop(path + '/replies', 'POST', { id: draft.current.id, body: message });
      draft.current = null;
      follow.current = true;
      setBody('');
      refresh();
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not send this reply.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="wb-thread-reader" aria-label="Conversation">
    <header className="wb-section-head wb-thread-heading">
      <button type="button" className="wb-icon-button" onClick={onBack} aria-label="Close Conversation" title="Close Conversation">
        <WorkbenchIcon name="previous" />
      </button>
      <div className="wb-row-content">
        <h2>{summary?.subject ?? 'Conversation'}</h2>
        {summary && <p>{summary.teamName}{summary.contact ? ' · ' + summary.contact : ''}</p>}
      </div>
    </header>
    {loading && <p className="wb-inline-empty" role="status">Loading conversation…</p>}
    {loadError && <p className="wb-inline-empty wb-error-text" role="alert">{loadError}</p>}
    {data && <>
      <div className="wb-thread-scroll" ref={scroll} onScroll={({ currentTarget }) => {
        follow.current = currentTarget.scrollHeight - currentTarget.scrollTop - currentTarget.clientHeight < 48;
      }}>
        {nextBefore !== undefined && <button type="button" className="wb-button wb-button-secondary wb-load-earlier" onClick={() => void earlier()} disabled={paging}>Earlier Messages</button>}
        <ol className="wb-message-list">{messages.map((message, index) => {
          const prior = messages[index - 1];
          const grouped = prior && message.authorId && prior.authorId === message.authorId &&
            Date.parse(message.createdAt) - Date.parse(prior.createdAt) < 300_000;
          const author = message.author || 'Former Member';
          return <li key={message.id} data-mine={message.mine} data-grouped={Boolean(grouped)}>
            {!message.mine && <span aria-hidden="true" className="wb-chat-avatar"
              style={{ backgroundColor: message.avatarColor }}>{Array.from(author)[0]?.toUpperCase()}</span>}
            <div className="wb-message-bubble">
              {!grouped && <div className="wb-message-byline">
                <strong>{message.mine ? 'You' : author}</strong><time dateTime={message.createdAt}>{formatDate(message.createdAt, 'compact')}</time>
              </div>}
              {grouped && <time className="sr-only" dateTime={message.createdAt}>{formatDate(message.createdAt, 'compact')}</time>}
              <p>{message.body}</p>
            </div>
          </li>;
        })}</ol>
      </div>
      <form className="wb-reply" data-sending={busy} onSubmit={event => { event.preventDefault(); void reply(); }}>
        <label className="wb-field"><span className="sr-only">Reply</span>
          <textarea rows={1} value={body} maxLength={6000} placeholder="Reply…" disabled={busy} onChange={event => setBody(event.target.value)} />
        </label>
        <button type="submit" className="wb-icon-button wb-accent-action" aria-label="Send Reply" title="Send Reply" disabled={busy || !body.trim()}>
          <WorkbenchIcon name="send" />
        </button>
      </form>
    </>}
    {error && <p className="wb-inline-empty wb-error-text" role="alert">{error}</p>}
  </section>;
}

interface InboxProps {
  user: User;
  teams: Organization[];
  data?: Inbox;
  loading: boolean;
  error?: string;
  selected?: string;
  onSelect: (id?: string) => void;
  onChange: () => void;
}

export default function WorkshopInbox({ user, teams, data, loading, error, selected, onSelect, onChange }: InboxProps) {
  const { formatDate, formatNumber } = useI18n();
  const [tab, setTab] = useState<Tab>('All');
  const [compose, setCompose] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pendingPin, setPendingPin] = useState('');
  const current = data?.threads.find(thread => thread.id === selected);
  const conversations = (data?.threads ?? []).filter(thread =>
    tab === 'All' || (tab === 'Teams' && thread.kind === 'team') || (tab === 'Direct' && thread.kind === 'direct'));
  const unreadMentions = data?.mentions.filter(mention => mention.unread).length ?? 0;
  const unreadMeetings = data?.unreadMeetings ?? 0;

  async function togglePin(thread: Conversation) {
    setPendingPin(thread.id);
    setPinError('');
    try {
      await writeWorkshop('/threads/' + encodeURIComponent(thread.id) + '/state', 'PUT', { pinned: !thread.pinned });
      onChange();
    } catch (failure) {
      setPinError(failure instanceof Error ? failure.message : 'Could not update this conversation.');
    } finally {
      setPendingPin('');
    }
  }

  return <div className="wb-inbox-layout">
    <section className="wb-surface wb-inbox" aria-label="Inbox" data-reading={Boolean(selected)}>
      <div className="wb-inbox-list">
        <div className="wb-section-head wb-inbox-actions">
          <div className="wb-segmented" role="group" aria-label="Inbox Filters">
            {tabs.map(name => <button type="button" key={name} aria-pressed={tab === name}
              onClick={() => { setTab(name); if (name === 'Mentions' || name === 'Meetings') onSelect(); }}>
              {name}{name === 'Mentions' && unreadMentions > 0 && <span className="wb-mention-dot" aria-label={unreadMentions + ' unread'} />}
              {name === 'Meetings' && unreadMeetings > 0 && <span className="wb-mention-dot" aria-label={unreadMeetings + ' unread'} />}
            </button>)}
          </div>
          <button type="button" className="wb-icon-button wb-accent-action" onClick={() => setCompose(true)}
            aria-label="New Conversation" title="New Conversation" disabled={!teams.length}><WorkbenchIcon name="pencil" /></button>
        </div>
        {loading && <p className="wb-inline-empty" role="status">Loading inbox…</p>}
        {(error || pinError) && <p className="wb-inline-empty wb-error-text" role="alert">{error || pinError}</p>}
        {data && tab === 'Mentions' && <>
          {!data.mentions.length && <p className="wb-inline-empty">No mentions yet.</p>}
          <ul className="wb-result-list">{data.mentions.map(item => <li key={item.commentId}>
            <Link className="wb-result-row wb-inbox-row" to={item.url} data-unread={item.unread}
              onClick={() => { if (item.unread) void boardReviewAPI(item.boardId).markRead(item.commentId).then(onChange, () => undefined); }}>
              <span className="wb-result-icon"><WorkbenchIcon name="bell" /></span>
              <span className="wb-row-content"><strong>{item.boardName}</strong><span>{item.author} · {item.preview}</span></span>
              <WorkbenchIcon name="arrow" />
            </Link>
          </li>)}</ul>
        </>}
        {data && tab === 'Meetings' && <>
          {!data.meetings?.length && <p className="wb-inline-empty">No open or upcoming meetings.</p>}
          <ul className="wb-result-list">{data.meetings?.map(item => <li key={item.id}>
            <Link className="wb-result-row wb-inbox-row" to={meetingPath(item.id)} state={{ workshop: '/workplace?view=inbox' }} data-unread={item.unread}>
              <span className="wb-result-icon"><WorkbenchIcon name="camera" /></span>
              <span className="wb-row-content"><strong>{item.title}</strong>
                <span>{item.scopeName} · {item.status === 'open' ? 'Open Now' : formatDate(item.startsAt, 'compact')}</span></span>
              <WorkbenchIcon name="arrow" />
            </Link>
          </li>)}</ul>
        </>}
        {data && tab !== 'Mentions' && tab !== 'Meetings' && <>
          {!conversations.length && <p className="wb-inline-empty">{teams.length ? 'No conversations yet.' : 'Join or create a team to start a conversation.'}</p>}
          <ul className="wb-result-list">{conversations.map(thread => <li key={thread.id} className="wb-conversation-row" data-selected={selected === thread.id}>
            <button type="button" className="wb-result-row wb-inbox-row" onClick={() => onSelect(thread.id)} data-unread={thread.unread > 0}
              aria-current={selected === thread.id ? 'true' : undefined}>
              <span className="wb-result-icon"><WorkbenchIcon name={thread.kind === 'team' ? 'organization' : 'message'} /></span>
              <span className="wb-row-content">
                <strong>{thread.subject}</strong>
                <span>{thread.contact || thread.teamName}{thread.startedByMe && thread.kind === 'direct' ? ' · Sent' : ''}</span>
                <span>{thread.preview}</span>
              </span>
              <span className="wb-inbox-row-end"><time dateTime={thread.updatedAt}>{formatDate(thread.updatedAt, 'compact')}</time>
                {thread.unread > 0 && <span className="wb-unread-badge">{formatNumber(thread.unread)}</span>}
              </span>
            </button>
            <button type="button" className="wb-icon-button wb-pin" aria-label={'Pin ' + thread.subject} aria-pressed={thread.pinned}
              title={thread.pinned ? 'Unpin' : 'Pin'} disabled={Boolean(pendingPin)} onClick={() => void togglePin(thread)}>
              <WorkbenchIcon name="pin" filled={thread.pinned} />
            </button>
          </li>)}</ul>
        </>}
      </div>
      {selected ? <ThreadReader key={selected} id={selected} summary={current} onBack={() => onSelect()} onChange={onChange} />
        : <div className="wb-thread-placeholder"><WorkbenchIcon name={tab === 'Mentions' ? 'bell' : tab === 'Meetings' ? 'camera' : 'message'} />
          <p>{tab === 'Mentions' ? 'Open a mention to view its source.' : tab === 'Meetings' ? 'Select a meeting.' : 'Select a conversation.'}</p></div>}
    </section>
    <AgendaOverview />
    {compose && <Compose teams={teams} user={user} onClose={() => setCompose(false)} onSent={id => {
      setCompose(false); setTab('All'); onSelect(id); onChange();
    }} />}
  </div>;
}
