import { useEffect, useRef, useState } from 'react';
import type { SlideObject, SlidePage } from '../../lib/slides';
import WorkbenchIcon from '../workbench/WorkbenchIcon';
import SlideSurface from './SlideSurface';

const empty: SlideObject[] = [];

function Thumbnail({ page, items, images, index, active, editable, onSelect, onDrop, onVisible }: {
  page: SlidePage;
  items: SlideObject[];
  images: ReadonlyMap<string, string | null>;
  index: number;
  active: boolean;
  editable: boolean;
  onSelect: () => void;
  onDrop: (id: string) => void;
  onVisible: (id: string, visible: boolean) => void;
}) {
  const node = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState(false);
  useEffect(() => {
    const element = node.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => onVisible(page.id, entry.isIntersecting), { rootMargin: '80px' });
    observer.observe(element);
    return () => { observer.disconnect(); onVisible(page.id, false); };
  }, [onVisible, page.id]);
  useEffect(() => {
    if (active) node.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  const title = items.find(item => item.type === 'text' && item.text?.trim());
  const detail = title?.type === 'text' ? title.text?.trim().split('\n')[0] : page.name !== 'Slide' ? page.name : 'Blank slide';
  return <button ref={node} type="button" className="slide-thumbnail" aria-current={active ? 'page' : undefined}
    aria-label={'Slide ' + (index + 1) + (detail ? ' · ' + detail.slice(0, 90) : '')}
    onClick={onSelect} draggable={editable} data-drop-target={target || undefined}
    onDragStart={event => {
      event.dataTransfer.setData('application/x-openjam-slide', page.id);
      event.dataTransfer.effectAllowed = 'move';
    }}
    onDragOver={event => {
      if (!editable || !event.dataTransfer.types.includes('application/x-openjam-slide')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setTarget(true);
    }}
    onDragLeave={event => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setTarget(false);
    }}
    onDragEnd={() => setTarget(false)}
    onDrop={event => {
      event.preventDefault();
      setTarget(false);
      const source = event.dataTransfer.getData('application/x-openjam-slide');
      if (editable && source) onDrop(source);
    }}>
    <span className="slide-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
    <div className="slide-miniature" aria-hidden="true">
      <SlideSurface page={page} items={items} images={images} compact />
    </div>
    <span className="slide-thumbnail-caption" aria-hidden="true">{detail}</span>
  </button>;
}

export default function SlideRail({ pages, layers, images, active, editable, canAdd, onSelect, onReorder, onAdd, onDelete, onVisible }: {
  pages: SlidePage[];
  layers: ReadonlyMap<string, SlideObject[]>;
  images: ReadonlyMap<string, string | null>;
  active: number;
  editable: boolean;
  canAdd: boolean;
  onSelect: (id: string) => void;
  onReorder: (id: string, index: number) => void;
  onAdd: () => void;
  onDelete: () => void;
  onVisible: (id: string, visible: boolean) => void;
}) {
  return <aside className="slide-rail" aria-label="Slides">
    <div className="slide-rail-head"><span>Slides</span>
      {editable && <button type="button" className="doc-tool" aria-label="Add Slide" title="Add Slide" onClick={onAdd}
        disabled={!canAdd}><WorkbenchIcon name="plus" /></button>}
    </div>
    <nav className="slide-thumbnails" aria-label="Slide Order">
      {pages.map((page, index) => <Thumbnail key={page.id} page={page} items={layers.get(page.id) ?? empty} images={images}
        index={index} active={index === active} editable={editable} onSelect={() => onSelect(page.id)}
        onDrop={id => onReorder(id, index)} onVisible={onVisible} />)}
    </nav>
    {editable && <div className="slide-rail-actions" aria-label="Arrange Slides">
      <button type="button" className="doc-tool" aria-label="Move Slide Earlier" title="Move Earlier" disabled={active <= 0}
        onClick={() => onReorder(pages[active].id, active - 1)}><WorkbenchIcon name="up" /></button>
      <button type="button" className="doc-tool" aria-label="Move Slide Later" title="Move Later" disabled={active >= pages.length - 1}
        onClick={() => onReorder(pages[active].id, active + 1)}><WorkbenchIcon name="down" /></button>
      <button type="button" className="doc-tool" aria-label="Delete Slide" title="Delete Slide" disabled={pages.length <= 1}
        onClick={onDelete}><WorkbenchIcon name="trash" /></button>
    </div>}
  </aside>;
}
