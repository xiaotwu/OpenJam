import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  useWorkshopResource, workshopPath, type RecentResource, type SearchHit, type SearchKind,
} from '../../lib/workshop';
import { useI18n } from '../../i18n';
import { resourceIcon } from '../../lib/directory';
import WorkshopIcon, { type WorkshopIconName } from './WorkshopIcon';

const categories: Record<SearchKind, { label: string; icon: WorkshopIconName }> = {
  project: { label: 'Projects', icon: 'folder' },
  member: { label: 'Members', icon: 'shared' },
  file: { label: 'Files', icon: 'board' },
  content: { label: 'Content', icon: 'text' },
};

export function WorkshopSearch({ query, teamId, teamName, onOpen }: {
  query: string;
  teamId?: string;
  teamName?: string;
  onOpen: () => void;
}) {
  const [debounced, setDebounced] = useState('');
  const location = useLocation();
  const [category, setCategory] = useState<SearchKind | 'all'>('all');
  const [global, setGlobal] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 240);
    return () => window.clearTimeout(timer);
  }, [query]);

  const params = new URLSearchParams({ q: debounced });
  if (teamId && !global) params.set('team', teamId);
  const path = query === debounced && debounced ? workshopPath + '/search?' + params : null;
  const result = useWorkshopResource<{ results: SearchHit[] }>(path, 10_000);
  const hits = result.data?.results ?? [];
  const filtered = category === 'all' ? hits : hits.filter(hit => hit.kind === category);

  return (
    <section className="workshop-surface workshop-search-results" aria-label="Search Results">
      <div className="workshop-section-head">
        <div className="workshop-segmented" role="group" aria-label="Result Type">
          <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All</button>
          {(Object.keys(categories) as SearchKind[]).map(kind => (
            <button key={kind} type="button" aria-pressed={category === kind} onClick={() => setCategory(kind)}>
              {categories[kind].label}
            </button>
          ))}
        </div>
        {teamId && <select className="workshop-select" aria-label="Search Scope" value={global ? 'all' : 'team'}
          onChange={event => setGlobal(event.target.value === 'all')}>
          <option value="team">{teamName ?? 'This Team'}</option>
          <option value="all">All Workshop</option>
        </select>}
      </div>
      {(result.loading || !path) && <p role="status" className="workshop-inline-empty">Searching…</p>}
      {result.error && <p role="alert" className="workshop-inline-empty">{result.error}</p>}
      {result.data && filtered.length === 0 && <p role="status" className="workshop-inline-empty">No matching results.</p>}
      {filtered.length > 0 && <ul className="workshop-result-list">
        {filtered.map((hit, index) => (
          <li key={[hit.kind, hit.url, index].join(':')}>
            <Link to={hit.url} onClick={onOpen} className="workshop-result-row" state={{ workshop: location.pathname + location.search }}>
              <span className="workshop-result-icon"><WorkshopIcon name={hit.resourceKind && hit.resourceKind !== 'board' ? resourceIcon(hit.resourceKind) : categories[hit.kind].icon} /></span>
              <span className="workshop-row-content">
                <strong>{hit.title}</strong>
                {hit.snippet && <span>{hit.snippet}</span>}
              </span>
              <span className="workshop-row-context">{hit.context || categories[hit.kind].label}</span>
              <WorkshopIcon name="arrow" />
            </Link>
          </li>
        ))}
      </ul>}
    </section>
  );
}

export function WorkshopRecents() {
  const { formatDate } = useI18n();
  const result = useWorkshopResource<{ items: RecentResource[] }>(workshopPath + '/recents', 10_000);
  return (
    <section className="workshop-surface" aria-label="Recently Opened">
      {result.loading && <p role="status" className="workshop-inline-empty">Loading recent files…</p>}
      {result.error && <p role="alert" className="workshop-inline-empty">{result.error}</p>}
      {result.data && result.data.items.length === 0 && <p className="workshop-inline-empty">Files you open will appear here.</p>}
      {!!result.data?.items.length && <ul className="workshop-result-list">
        {result.data.items.map(item => <li key={item.id}>
          <Link className="workshop-result-row" to={item.url}>
            <span className="workshop-result-icon"><WorkshopIcon name={resourceIcon(item.resourceKind)} /></span>
            <span className="workshop-row-content"><strong>{item.title}</strong>{item.context && <span>{item.context}</span>}</span>
            <span className="workshop-row-context">{formatDate(item.openedAt, 'compact')}</span>
            <WorkshopIcon name="arrow" />
          </Link>
        </li>)}
      </ul>}
    </section>
  );
}
