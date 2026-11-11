import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useWorkshopResource, workshopPath, type GraphNode, type RecentResource, type SearchHit, type SearchKind, type TeamGraph,
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
              <span className="wb-result-icon"><WorkbenchIcon name={categories[hit.kind].icon} /></span>
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

const columns = [
  { kind: 'member', label: 'Members', icon: 'shared' },
  { kind: 'project', label: 'Projects', icon: 'folder' },
  { kind: 'resource', label: 'Resources', icon: 'board' },
] as const;

function graphLayout(nodes: GraphNode[]) {
  return columns.flatMap((column, columnIndex) =>
    nodes.filter(node => node.kind === column.kind).map((node, row) => ({
      ...node, icon: column.icon, x: 24 + 300 * columnIndex, y: 54 + row * 46,
    })));
}

const relationshipLabels = {
  owns: ['Owns', 'Owned by'],
  participates: ['Participates in', 'Participant'],
  contains: ['Contains', 'In Project'],
  references: ['References', 'Referenced by'],
};

export function TeamRelationships({ teamId }: { teamId: string }) {
  const marker = useId();
  const result = useWorkshopResource<TeamGraph>(workshopPath + '/teams/' + encodeURIComponent(teamId) + '/graph', 8_000);
  const [selectedId, setSelectedId] = useState<string>();
  const nodes = graphLayout(result.data?.nodes ?? []);
  const edges = result.data?.edges ?? [];
  const indexed = new Map(nodes.map(node => [node.id, node]));
  const selected = selectedId ? indexed.get(selectedId) : undefined;
  const related = selected ? edges.filter(edge => edge.from === selected.id || edge.to === selected.id) : [];
  const connected = new Set(related.flatMap(edge => [edge.from, edge.to]));
  const height = Math.max(252, ...nodes.map(node => node.y + 48));

  return (
    <section className="wb-surface wb-network" aria-label="Team Relationships">
      <div className="wb-section-head">
        <h2>Relationships</h2>
        {selected ? (
          <div className="wb-inline-actions">
            <Link className="wb-link" to={selected.url}><span>{selected.title}</span><WorkbenchIcon name="arrow" /></Link>
            <button type="button" className="wb-icon-button" onClick={() => setSelectedId(undefined)} aria-label="Clear Selection">
              <WorkbenchIcon name="close" />
            </button>
          </div>
        ) : (
          <span className="wb-graph-legend"><i />Reference</span>
        )}
      </div>
      {result.loading && <p role="status" className="wb-inline-empty">Loading relationships…</p>}
      {result.error && <p role="alert" className="wb-inline-empty">{result.error}</p>}
      {result.data && !nodes.length && <p className="wb-inline-empty">No visible relationships.</p>}
      {nodes.length > 0 && <div className="wb-graph-scroll">
        <div className="wb-graph-map" style={{ height }}>
          <div className="wb-graph-columns">
            {columns.map(column => <span key={column.kind}><WorkbenchIcon name={column.icon} />{column.label}</span>)}
          </div>
          <svg className="wb-graph-lines" viewBox={`0 0 900 ${height}`} preserveAspectRatio="none" aria-hidden="true">
            <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
              <polygon points="0,0 6,3 0,6" fill="var(--wb-accent)" />
            </marker></defs>
            {edges.map(edge => {
              const from = indexed.get(edge.from);
              const to = indexed.get(edge.to);
              if (!from || !to) return null;
              const sy = from.y + 17;
              const ty = to.y + 17;
              const sx = from.x + 242;
              const tx = edge.kind === 'references' ? to.x + 242 : to.x;
              const control = edge.kind === 'references' ? 889 : (sx + tx) / 2;
              return <path key={edge.kind + edge.from + edge.to}
                data-reference={edge.kind === 'references'}
                markerEnd={edge.kind === 'references' ? `url(#${marker})` : undefined}
                data-muted={Boolean(selected && edge.from !== selected.id && edge.to !== selected.id)}
                d={`M ${sx} ${sy} C ${control} ${sy}, ${control} ${ty}, ${tx} ${ty}`} />;
            })}
          </svg>
          {nodes.map(node => (
            <button key={node.id} type="button" className="wb-graph-node"
              aria-pressed={selected?.id === node.id} data-muted={Boolean(selected && selected.id !== node.id && !connected.has(node.id))}
              style={{ left: node.x / 9 + '%', top: node.y, width: 242 / 9 + '%' }}
              title={node.title} onClick={() => setSelectedId(selected?.id === node.id ? undefined : node.id)}>
              {node.kind === 'member' ? <i style={{ backgroundColor: node.color }} /> : <WorkbenchIcon name={node.icon} />}
              <span>{node.title}</span>
            </button>
          ))}
        </div>
      </div>}
      {selected && related.length > 0 && <ul className="wb-graph-connections" aria-label="Selected Relationships">
        {related.map(edge => {
          const outgoing = edge.from === selected.id;
          const node = indexed.get(outgoing ? edge.to : edge.from);
          return node && <li key={edge.kind + ':' + node.id}>
            <span>{relationshipLabels[edge.kind][outgoing ? 0 : 1]}</span>
            <Link className="wb-link" to={node.url}><span>{node.title}</span><WorkbenchIcon name="arrow" /></Link>
          </li>;
        })}
      </ul>}
      {result.data?.truncated && <p className="wb-inline-empty">The graph shows the first visible items. Search to find a specific source.</p>}
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
            <span className="wb-result-icon"><WorkbenchIcon name="board" /></span>
            <span className="wb-row-content"><strong>{item.title}</strong>{item.context && <span>{item.context}</span>}</span>
            <span className="wb-row-context">{formatDate(item.openedAt, 'compact')}</span>
            <WorkbenchIcon name="arrow" />
          </Link>
        </li>)}
      </ul>}
    </section>
  );
}
