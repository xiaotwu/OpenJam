import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useWorkshopResource, workshopPath, type RecentResource, type SearchHit, type SearchKind,
} from '../../lib/workshop';
import { useI18n } from '../../i18n';
import WorkbenchIcon, { type WorkbenchIconName } from './WorkbenchIcon';

const categories: Record<SearchKind, { label: string; icon: WorkbenchIconName }> = {
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
    <section className="wb-surface wb-search-results" aria-label="Search Results">
      <div className="wb-section-head">
        <div className="wb-segmented" role="group" aria-label="Result Type">
          <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All</button>
          {(Object.keys(categories) as SearchKind[]).map(kind => (
            <button key={kind} type="button" aria-pressed={category === kind} onClick={() => setCategory(kind)}>
              {categories[kind].label}
            </button>
          ))}
        </div>
        {teamId && <select className="wb-select" aria-label="Search Scope" value={global ? 'all' : 'team'}
          onChange={event => setGlobal(event.target.value === 'all')}>
          <option value="team">{teamName ?? 'This Team'}</option>
          <option value="all">All Workshop</option>
        </select>}
      </div>
      {(result.loading || !path) && <p role="status" className="wb-inline-empty">Searching…</p>}
      {result.error && <p role="alert" className="wb-inline-empty">{result.error}</p>}
      {result.data && filtered.length === 0 && <p role="status" className="wb-inline-empty">No matching results.</p>}
      {filtered.length > 0 && <ul className="wb-result-list">
        {filtered.map((hit, index) => (
          <li key={[hit.kind, hit.url, index].join(':')}>
            <Link to={hit.url} onClick={onOpen} className="wb-result-row">
              <span className="wb-result-icon"><WorkbenchIcon name={hit.resourceKind === 'doc' ? 'document' : categories[hit.kind].icon} /></span>
              <span className="wb-row-content">
                <strong>{hit.title}</strong>
                {hit.snippet && <span>{hit.snippet}</span>}
              </span>
              <span className="wb-row-context">{hit.context || categories[hit.kind].label}</span>
              <WorkbenchIcon name="arrow" />
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
    <section className="wb-surface" aria-label="Recently Opened">
      {result.loading && <p role="status" className="wb-inline-empty">Loading recent files…</p>}
      {result.error && <p role="alert" className="wb-inline-empty">{result.error}</p>}
      {result.data && result.data.items.length === 0 && <p className="wb-inline-empty">Files you open will appear here.</p>}
      {!!result.data?.items.length && <ul className="wb-result-list">
        {result.data.items.map(item => <li key={item.id}>
          <Link className="wb-result-row" to={item.url}>
            <span className="wb-result-icon"><WorkbenchIcon name={item.resourceKind === 'doc' ? 'document' : 'board'} /></span>
            <span className="wb-row-content"><strong>{item.title}</strong>{item.context && <span>{item.context}</span>}</span>
            <span className="wb-row-context">{formatDate(item.openedAt, 'compact')}</span>
            <WorkbenchIcon name="arrow" />
          </Link>
        </li>)}
      </ul>}
    </section>
  );
}
