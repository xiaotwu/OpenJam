import { useCallback } from 'react';
import type {
  Element,
  StickyElement,
  ShapeElement,
  TextElement,
  ConnectorElement,
  WidgetElement,
} from '../lib/elements';
import type { ElementStore } from '../lib/elementStore';
import LayoutProperties from './PropertyInspector/LayoutProperties';
import StickyProperties from './PropertyInspector/StickyProperties';
import ShapeProperties from './PropertyInspector/ShapeProperties';
import TextProperties from './PropertyInspector/TextProperties';
import ConnectorProperties from './PropertyInspector/ConnectorProperties';
import TableProperties from './PropertyInspector/TableProperties';
import TimerProperties from './PropertyInspector/TimerProperties';

interface PropertyInspectorProps {
  element: Element | null;
  elementStore: ElementStore;
}

export default function PropertyInspector({ element, elementStore }: PropertyInspectorProps) {
  if (!element) return null;

  const onUpdate = useCallback(
    (changes: Partial<Element>) => {
      elementStore.updateElement(element.id, changes);
    },
    [element.id, elementStore]
  );

  const onUpdateWidget = useCallback(
    (data: Record<string, unknown>) => {
      const widget = element as WidgetElement;
      elementStore.updateElement(element.id, {
        widgetData: { ...widget.widgetData, ...data },
      } as Partial<Element>);
    },
    [element, elementStore]
  );

  const renderElementProperties = () => {
    switch (element.type) {
      case 'sticky': {
        const sticky = element as StickyElement;
        return (
          <StickyProperties
            color={sticky.color}
            fontSize={sticky.fontSize}
            onUpdate={onUpdate}
          />
        );
      }
      case 'shape': {
        const shape = element as ShapeElement;
        return (
          <ShapeProperties
            fill={shape.fill}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            onUpdate={onUpdate}
          />
        );
      }
      case 'text': {
        const text = element as TextElement;
        return (
          <TextProperties
            fontSize={text.fontSize}
            fontWeight={text.fontWeight}
            fontStyle={text.fontStyle}
            textAlign={text.textAlign}
            color={text.color}
            onUpdate={onUpdate}
          />
        );
      }
      case 'connector': {
        const conn = element as ConnectorElement;
        return (
          <ConnectorProperties
            style={conn.style}
            startArrow={conn.startArrow}
            endArrow={conn.endArrow}
            stroke={conn.stroke}
            strokeWidth={conn.strokeWidth}
            onUpdate={onUpdate}
          />
        );
      }
      case 'widget': {
        const widget = element as WidgetElement;
        switch (widget.widgetType) {
          case 'table':
            return (
              <TableProperties
                widgetData={widget.widgetData as { rows: number; cols: number; cells: { content: string; backgroundColor: string }[][] }}
                onUpdateWidget={onUpdateWidget}
              />
            );
          case 'timer':
            return (
              <TimerProperties
                widgetData={widget.widgetData as { minutes?: number }}
                onUpdateWidget={onUpdateWidget}
              />
            );
          default:
            return null;
        }
      }
      default:
        return null;
    }
  };

  return (
    <div className="glass-elevated w-64 h-full overflow-y-auto p-4 space-y-4">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Properties</h2>

      <LayoutProperties
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        opacity={element.opacity}
        onUpdate={onUpdate}
      />

      <div className="border-t border-[var(--glass-border-strong)]" />

      {renderElementProperties()}
    </div>
  );
}
