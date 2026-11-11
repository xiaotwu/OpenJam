import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { useWorkshopResource, workshopPath, type GraphNode, type TeamGraph } from '../../lib/workshop';
import WorkbenchIcon from './WorkbenchIcon';

const relationshipLabels = {
  owns: ['Owns', 'Owned by'],
  participates: ['Participates in', 'Participant'],
  contains: ['Contains', 'In Project'],
  references: ['References', 'Referenced by'],
} as const;

const kindLabel = { member: 'Member', project: 'Project', resource: 'File' } as const;
const emptyGraph: TeamGraph = { nodes: [], edges: [], truncated: false };
type Point = GraphNode & SimulationNodeDatum;
type Spring = SimulationLinkDatum<Point> & { source: string | Point; target: string | Point };
type Position = { x: number; y: number };

function radius(node: GraphNode) {
  return node.kind === 'project' ? 23 : node.kind === 'member' ? 20 : 18;
}

function icon(node: GraphNode) {
  return node.kind === 'project' ? 'folder' : node.kind === 'member' ? 'shared'
    : node.resourceKind === 'doc' ? 'document' : 'board';
}

function edgePath(from: Position, to: Position, fromRadius: number, toRadius: number, reference: boolean) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const x = dx / distance;
  const y = dy / distance;
  const start = { x: from.x + x * fromRadius, y: from.y + y * fromRadius };
  const end = { x: to.x - x * toRadius, y: to.y - y * toRadius };
  if (!reference) return `M${start.x},${start.y}L${end.x},${end.y}`;
  const bend = Math.min(distance * 0.18, 32);
  return `M${start.x},${start.y}Q${(start.x + end.x) / 2 - y * bend},${(start.y + end.y) / 2 + x * bend} ${end.x},${end.y}`;
}

export default function TeamRelationships({ teamId }: { teamId: string }) {
  const marker = useId();
  const result = useWorkshopResource<TeamGraph>(workshopPath + '/teams/' + encodeURIComponent(teamId) + '/graph', 8_000);
  const signature = useMemo(() => JSON.stringify(result.data ?? emptyGraph), [result.data]);
  const { nodes, edges, truncated } = useMemo(() => JSON.parse(signature) as TeamGraph, [signature]);
  const [selectedId, setSelectedId] = useState<string>();
  const [width, setWidth] = useState(620);
  const [positions, setPositions] = useState<Map<string, Position>>(() => new Map());
  const [fit, setFit] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const physics = useRef<Simulation<Point, Spring>>(null);
  const previous = useRef<Map<string, Position>>(new Map());
  const appliedFit = useRef(0);
  const drag = useRef<{ node: Point; x: number; y: number; moved: boolean }>(null);
  const ignoreClick = useRef(false);
  const height = Math.min(580, Math.max(width < 450 ? 330 : 360, 320 + nodes.length * 5));
  const lookup = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const selected = selectedId ? lookup.get(selectedId) : undefined;
  const related = selected ? edges.filter(edge => edge.from === selected.id || edge.to === selected.id) : [];
  const connected = new Set(related.flatMap(edge => [edge.from, edge.to]));

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [nodes.length]);

  useEffect(() => {
    const reset = fit !== appliedFit.current;
    appliedFit.current = fit;
    const points: Point[] = nodes.map((node, index) => {
      const existing = reset ? undefined : previous.current.get(node.id);
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const offset = 16 + 12 * Math.sqrt(index);
      return {
        ...node,
        x: existing?.x ?? width / 2 + Math.cos(angle) * offset,
        y: existing?.y ?? height / 2 + Math.sin(angle) * offset,
      };
    });
    const links: Spring[] = edges.filter(edge => lookup.has(edge.from) && lookup.has(edge.to))
      .map(edge => ({ source: edge.from, target: edge.to }));
    const simulation = forceSimulation<Point, Spring>(points)
      .force('center', forceCenter(width / 2, height * 0.47).strength(0.12))
      .force('links', forceLink<Point, Spring>(links).id(node => node.id).distance(width < 450 ? 72 : 108).strength(0.39))
      .force('charge', forceManyBody().strength(width < 450 ? -150 : -245))
      .force('spacing', forceCollide<Point>(node => radius(node) + (nodes.length > 35 ? 5 : 16)).iterations(2))
      .alphaDecay(0.043);
    physics.current = simulation;
    let lastFrame = 0;

    function publish() {
      for (const node of points) {
        node.x = Math.min(width - 46, Math.max(46, node.x ?? width / 2));
        node.y = Math.min(height - 54, Math.max(31, node.y ?? height / 2));
      }
      const frame = new Map(points.map(node => [node.id, { x: node.x!, y: node.y! }]));
      previous.current = frame;
      setPositions(frame);
    }

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) {
      simulation.stop().tick(140);
      publish();
    } else {
      simulation.stop().tick(24);
      publish();
      simulation.restart().on('tick', () => {
        const now = performance.now();
        if (now - lastFrame >= 28) { lastFrame = now; publish(); }
      }).on('end', publish);
    }
    return () => { simulation.stop(); physics.current = null; drag.current = null; };
  }, [edges, fit, height, lookup, nodes, width]);

  function startDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const node = physics.current?.nodes().find(point => point.id === id);
    if (!node) return;
    drag.current = { node, x: event.clientX, y: event.clientY, moved: false };
    ignoreClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    const box = stage.current?.getBoundingClientRect();
    if (!active || !box || (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 5)) return;
    active.moved = true;
    active.node.fx = Math.min(width - 46, Math.max(46, event.clientX - box.left));
    active.node.fy = Math.min(height - 54, Math.max(31, event.clientY - box.top));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPositions(current => new Map(current).set(active.node.id, { x: active.node.fx!, y: active.node.fy! }));
    } else {
      physics.current?.alphaTarget(0.22).restart();
    }
  }

  function finishDrag() {
    const active = drag.current;
    if (!active) return;
    ignoreClick.current = active.moved;
    active.node.fx = null;
    active.node.fy = null;
    drag.current = null;
    physics.current?.alphaTarget(0);
  }

  return <section className="wb-surface wb-network" aria-label="Team Relationships">
    <div className="wb-section-head wb-network-heading">
      <h2><WorkbenchIcon name="graph" />Relationships</h2>
      <div className="wb-inline-actions">
        {selected && <button type="button" className="wb-icon-button" aria-label="Clear Selection" title="Clear Selection"
          onClick={() => setSelectedId(undefined)}><WorkbenchIcon name="close" /></button>}
        {!!nodes.length && <button type="button" className="wb-icon-button" aria-label="Reset Network Layout" title="Reset Layout"
          onClick={() => setFit(value => value + 1)}><WorkbenchIcon name="expand" /></button>}
      </div>
    </div>
    {result.loading && <p role="status" className="wb-inline-empty">Loading relationships…</p>}
    {result.error && <p role="alert" className="wb-inline-empty">{result.error}</p>}
    {result.data && !nodes.length && <p className="wb-inline-empty">No visible relationships.</p>}
    {!!nodes.length && <div ref={stage} className="wb-network-stage" style={{ height }} data-dense={nodes.length > 32}>
      <svg className="wb-graph-lines" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id={marker} markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
          <polygon points="0,0 6,3 0,6" fill="var(--wb-graph-reference)" />
        </marker></defs>
        {edges.map(edge => {
          const from = lookup.get(edge.from);
          const to = lookup.get(edge.to);
          const start = positions.get(edge.from);
          const end = positions.get(edge.to);
          if (!from || !to || !start || !end) return null;
          const reference = edge.kind === 'references';
          const active = selected && (selected.id === from.id || selected.id === to.id);
          return <path key={edge.kind + ':' + edge.from + ':' + edge.to}
            data-reference={reference} data-active={Boolean(active)} data-muted={Boolean(selected && !active)}
            markerEnd={reference ? `url(#${marker})` : undefined}
            d={edgePath(start, end, radius(from), radius(to) + 2, reference)} />;
        })}
      </svg>
      {nodes.map(node => {
        const position = positions.get(node.id);
        if (!position) return null;
        return <button type="button" className="wb-network-node" key={node.id}
          aria-label={node.title} aria-pressed={selected?.id === node.id} title={node.title + ' · ' + kindLabel[node.kind]}
          data-kind={node.kind} data-muted={Boolean(selected && selected.id !== node.id && !connected.has(node.id))}
          style={{ left: position.x / width * 100 + '%', top: position.y + 'px', width: radius(node) * 2, height: radius(node) * 2 }}
          onPointerDown={event => startDrag(event, node.id)} onPointerMove={moveDrag} onPointerUp={finishDrag}
          onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
          onClick={event => {
            if (event.detail && ignoreClick.current) { ignoreClick.current = false; return; }
            setSelectedId(selected?.id === node.id ? undefined : node.id);
          }}>
          {node.kind === 'member'
            ? <span className="wb-network-avatar" style={{ backgroundColor: node.color }}>{Array.from(node.title)[0]?.toUpperCase()}</span>
            : <WorkbenchIcon name={icon(node)} />}
          <span className="wb-network-name">{node.title}</span>
        </button>;
      })}
    </div>}
    {selected && <div className="wb-network-selection">
      <Link className="wb-link" to={selected.url}><span>{selected.title}</span><WorkbenchIcon name="arrow" /></Link>
      {!!related.length && <ul className="wb-graph-connections" aria-label="Selected Relationships">
        {related.map(edge => {
          const outgoing = edge.from === selected.id;
          const node = lookup.get(outgoing ? edge.to : edge.from);
          return node && <li key={edge.kind + ':' + node.id}>
            <span>{relationshipLabels[edge.kind][outgoing ? 0 : 1]}</span>
            <Link className="wb-link" to={node.url}><span>{node.title}</span><WorkbenchIcon name="arrow" /></Link>
          </li>;
        })}
      </ul>}
    </div>}
    {truncated && <p className="wb-inline-empty">Showing part of this network. Search to find a specific file or member.</p>}
  </section>;
}
