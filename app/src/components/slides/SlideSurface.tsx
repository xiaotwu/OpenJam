import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useBoardFont } from '../../lib/boardFonts';
import type { SlideBox, SlideImage, SlideObject, SlidePage, SlideText } from '../../lib/slides';
import WorkshopIcon from '../workshop/WorkshopIcon';

export interface TextEdit {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onFinish: () => void;
  onCancel: () => void;
  readOnly?: boolean;
}

interface SlideInteraction {
  selected?: string;
  drag?: { id: string; box: SlideBox };
  edit?: TextEdit;
  onClear: () => void;
  onSelect: (item: SlideObject) => void;
  onEditText: (item: SlideText) => void;
  onDragStart: (event: PointerEvent<HTMLElement>, item: SlideObject, mode: 'move' | 'resize', scale: number) => void;
  onDragMove: (event: PointerEvent<HTMLElement>) => void;
  onDragEnd: (event: PointerEvent<HTMLElement>, cancel: boolean) => void;
}

interface SurfaceProps {
  page: SlidePage;
  items: SlideObject[];
  images: ReadonlyMap<string, string | null>;
  label?: string;
  interaction?: SlideInteraction;
  compact?: boolean;
  onEmpty?: () => void;
  className?: string;
  areaRef?: RefObject<HTMLDivElement | null>;
}

function Picture({ item, image, compact }: { item: SlideImage; image?: string | null; compact?: boolean }) {
  const crop = item.crop;
  let style: CSSProperties | undefined;
  if (crop) {
    const w = 100000 - crop.left - crop.right;
    const h = 100000 - crop.top - crop.bottom;
    style = { width: 10000000 / w + '%', height: 10000000 / h + '%',
      left: -100 * crop.left / w + '%', top: -100 * crop.top / h + '%' };
  }
  return <span className="slide-picture-mask">
    {image ? <img className="slide-picture" src={image} alt={compact ? '' : item.caption ?? ''}
      draggable={false} decoding="async" style={style} /> : <span className="slide-picture-placeholder" aria-hidden={compact || undefined}>
      {compact ? null : image === null ? 'Image unavailable' : 'Loading image…'}
    </span>}
  </span>;
}

function TextContent({ item, edit }: { item: SlideText; edit?: TextEdit }) {
  const font = useBoardFont(item.fontFamily);
  const input = useRef<HTMLTextAreaElement>(null);
  const editing = edit?.id === item.id;
  useEffect(() => {
    if (!editing || !input.current) return;
    input.current.focus({ preventScroll: true });
    const end = input.current.value.length;
    input.current.setSelectionRange(end, end);
  }, [editing]);
  const style: CSSProperties = {
    fontFamily: font + ', sans-serif', fontSize: item.fontSize, color: item.color,
    fontWeight: item.fontWeight, fontStyle: item.fontStyle, textAlign: item.textAlign,
  };
  if (!editing || !edit) return <span className="slide-text" style={style}>{item.text}</span>;

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      edit?.onCancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      edit?.onFinish();
    }
  }

  return <textarea ref={input} className="slide-text-input" aria-label="Slide Text" style={style} value={edit.value}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()} onChange={event => edit.onChange(event.target.value)}
    onBlur={edit.onFinish} onKeyDown={keyDown} readOnly={edit.readOnly} />;
}

export default function SlideSurface({ page, items, images, label, interaction, compact, onEmpty, className = '', areaRef }: SurfaceProps) {
  const local = useRef<HTMLDivElement>(null);
  const ref = areaRef ?? local;
  const [space, setSpace] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    const resize = () => setSpace({ width: area.clientWidth, height: area.clientHeight });
    const observer = new ResizeObserver(resize);
    resize();
    observer.observe(area);
    return () => observer.disconnect();
  }, [ref]);
  const scale = Math.min(space.width / page.width, space.height / page.height);
  const aspect = { '--slide-ratio': page.width + ' / ' + page.height } as CSSProperties;
  return <div ref={ref} className={'slide-fit ' + className} style={aspect}
    onPointerMove={interaction?.onDragMove}
    onPointerUp={interaction && (event => interaction.onDragEnd(event, false))}
    onPointerCancel={interaction && (event => interaction.onDragEnd(event, true))}
    onLostPointerCapture={interaction && (event => interaction.onDragEnd(event, true))}>
    {scale > 0 && <div className="slide-paper" aria-label={label} role={label ? 'region' : undefined}
      style={{ width: page.width * scale, height: page.height * scale, backgroundColor: page.background }}
      onPointerDown={event => { if (event.target === event.currentTarget) interaction?.onClear(); }}>
      <div className="slide-content" style={{ width: page.width, height: page.height, transform: 'scale(' + scale + ')' }}
        onPointerDown={event => { if (event.target === event.currentTarget) interaction?.onClear(); }}>
        {items.map(item => {
          const selected = interaction?.selected === item.id;
          const box = interaction?.drag?.id === item.id ? interaction.drag.box : item;
          const label = item.type === 'text' ? item.text?.split('\n')[0].slice(0, 90) || 'Text Box' : item.caption || 'Image';
          return <div className="slide-object" data-object={item.type} data-selected={selected || undefined} data-layer={item.id} key={item.id}
            tabIndex={interaction ? 0 : undefined} role={interaction ? 'group' : undefined} aria-label={interaction ? label : undefined}
            style={{ left: box.x, top: box.y, width: box.width, height: box.height, transform: 'rotate(' + box.rotation + 'deg)',
              '--slide-scale': scale } as CSSProperties}
            onFocus={event => { if (event.target === event.currentTarget) interaction?.onSelect(item); }}
            onClick={() => interaction?.onSelect(item)}
            onPointerDown={interaction && (event => interaction.onDragStart(event, item, 'move', scale))}
            onDoubleClick={() => { if (item.type === 'text') interaction?.onEditText(item); }}
            onKeyDown={event => {
              if (item.type === 'text' && (event.key === 'Enter' || event.key === 'F2')) {
                event.preventDefault();
                interaction?.onEditText(item);
              }
            }}>
            {item.type === 'text' ? <TextContent item={item} edit={interaction?.edit} /> : <Picture item={item} image={images.get(item.assetId)} compact={compact} />}
            {selected && interaction?.edit?.id !== item.id && <button type="button" className="slide-resize" tabIndex={-1}
              aria-label="Resize Object" onPointerDown={event => {
                event.stopPropagation();
                interaction?.onDragStart(event, item, 'resize', scale);
              }} />}
          </div>;
        })}
      </div>
      {onEmpty && items.length === 0 && <div className="slide-empty">
        <button type="button" className="doc-edit-action" onClick={onEmpty}><WorkshopIcon name="text" />Add Text</button>
      </div>}
    </div>}
  </div>;
}
