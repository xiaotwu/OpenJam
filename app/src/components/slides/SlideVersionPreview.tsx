import { useMemo, useState } from 'react';
import type { BoardDocument } from '../../lib/boardSync';
import { slideItems, slidePages } from '../../lib/slides';
import WorkbenchIcon from '../workbench/WorkbenchIcon';
import SlideSurface from './SlideSurface';
import { useSlideMedia } from './useSlideMedia';

export default function SlideVersionPreview({ document, deckId }: { document: BoardDocument; deckId: string }) {
  const pages = useMemo(() => slidePages(document.pages), [document.pages]);
  const [index, setIndex] = useState(0);
  const selected = Math.min(index, pages.length - 1);
  const page = pages[selected];
  const items = useMemo(() => slideItems(document.elements).filter(item => item.pageId === page?.id), [document.elements, page?.id]);
  const images = useSlideMedia(deckId, items.flatMap(item => item.type === 'image' ? [item.assetId] : []));
  if (!page) return null;
  return <section className="slide-version-preview" aria-label="Presentation Preview">
    <SlideSurface page={page} items={items} images={images} label={'Version Slide ' + (selected + 1)} />
    <div className="slide-preview-actions">
      <button type="button" className="doc-tool" aria-label="Previous Version Slide" disabled={selected === 0}
        onClick={() => setIndex(selected - 1)}><WorkbenchIcon name="previous" /></button>
      <span>{selected + 1} / {pages.length}</span>
      <button type="button" className="doc-tool" aria-label="Next Version Slide" disabled={selected === pages.length - 1}
        onClick={() => setIndex(selected + 1)}><WorkbenchIcon name="next" /></button>
    </div>
  </section>;
}
