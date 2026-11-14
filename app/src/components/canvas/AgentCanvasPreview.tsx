import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { AgentPreview } from '../../lib/boardAgent';
import type { Element } from '../../lib/elements';
import { ElementRenderer } from '../elements';
import WorkshopIcon from '../workshop/WorkshopIcon';
import { elementBounds } from './boardObjects';

const noInteraction = () => {};

export function AgentPreviewObjects({ elements, scale }: { elements: Element[]; scale: number }) {
  return (
    <div aria-hidden="true" inert className="agent-preview-objects">
      {elements.map((element, index) => (
        <div key={element.id} className="agent-preview-object" style={{ animationDelay: Math.min(index, 24) * 28 + 'ms' }}>
          <ElementRenderer element={{ ...element, id: 'preview-' + element.id }} isSelected={false} isEditing={false} scale={scale}
            onSelect={noInteraction} onStartEdit={noInteraction} onEndEdit={noInteraction}
            onUpdate={noInteraction} onMove={noInteraction} onResize={noInteraction} />
        </div>
      ))}
    </div>
  );
}

export default function AgentCanvasPreview({ preview }: { preview: AgentPreview }) {
  const { messages: { agentIdentity: text } } = useI18n();
  const elements = useMemo(() => preview.operations.flatMap(operation =>
    operation.kind === 'add' && operation.collection === 'elements' && 'type' in operation.value ? [operation.value] : [],
  ), [preview]);
  const [replay, setReplay] = useState(0);
  const [width, setWidth] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const height = 166;

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!elements.length) return null;
  const bounds = elements.map(elementBounds);
  const left = Math.min(...bounds.map(item => item.left));
  const top = Math.min(...bounds.map(item => item.top));
  const itemWidth = Math.max(...bounds.map(item => item.right)) - left;
  const itemHeight = Math.max(...bounds.map(item => item.bottom)) - top;
  const scale = Math.max(0.01, Math.min(1, (width - 24) / Math.max(1, itemWidth), (height - 24) / Math.max(1, itemHeight)));
  const x = (width - itemWidth * scale) / 2 - left * scale;
  const y = (height - itemHeight * scale) / 2 - top * scale;

  return (
    <figure className="agent-canvas-rehearsal">
      <figcaption>
        <span>{text.preview}</span>
        <button type="button" className="board-action-button" aria-label={text.replay} title={text.replay} onClick={() => setReplay(value => value + 1)}>
          <span className="size-4"><WorkshopIcon name="restore" /></span>
        </button>
      </figcaption>
      <div className="agent-preview-viewport" ref={container} style={{ height }}>
        {width > 0 && <div className="absolute origin-top-left" style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}>
          <AgentPreviewObjects key={replay + ':' + elements[0].id} elements={elements} scale={scale} />
        </div>}
      </div>
    </figure>
  );
}
