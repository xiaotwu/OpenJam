import { useEffect, useRef } from 'react';
import type { SlideObject, SlidePage } from '../../lib/slides';
import WorkshopIcon from '../workshop/WorkshopIcon';
import SlideSurface from './SlideSurface';

export default function SlidePlayback({ page, items, images, index, count, onGo, onExit }: {
  page: SlidePage;
  items: SlideObject[];
  images: ReadonlyMap<string, string | null>;
  index: number;
  count: number;
  onGo: (index: number) => void;
  onExit: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.focus(); }, []);
  return <div className="slide-playback" ref={root} role="dialog" aria-modal="true" aria-label="Slideshow" tabIndex={-1}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onExit(); return; }
      if (event.key === ' ' && event.target instanceof HTMLButtonElement) return;
      const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp'];
      if (forward.includes(event.key) || back.includes(event.key) || event.key === 'Home' || event.key === 'End') {
        if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        onGo(event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : index + (forward.includes(event.key) ? 1 : -1));
      }
    }}>
    <SlideSurface page={page} items={items} images={images} label={'Presenting Slide ' + (index + 1)} />
    <div className="slide-playback-controls" aria-label="Slideshow Controls">
      <button type="button" className="doc-tool" aria-label="Previous Slide" title="Previous Slide" disabled={index === 0}
        onClick={() => onGo(index - 1)}><WorkshopIcon name="previous" /></button>
      <span role="status">{index + 1} / {count}</span>
      <button type="button" className="doc-tool" aria-label="Next Slide" title="Next Slide" disabled={index === count - 1}
        onClick={() => onGo(index + 1)}><WorkshopIcon name="next" /></button>
      <button type="button" className="doc-tool" aria-label="Exit Slideshow" title="Exit Slideshow"
        onClick={onExit}><WorkshopIcon name="close" /></button>
    </div>
  </div>;
}
