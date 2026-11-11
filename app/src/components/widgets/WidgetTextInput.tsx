import { useEffect, useRef } from 'react';

export type EditDirection = 'previous' | 'next' | 'down';

interface WidgetTextInputProps {
  label: string;
  value: string;
  className: string;
  maxLength?: number;
  canTraverse?: (direction: EditDirection) => boolean;
  onCommit: (value: string, direction?: EditDirection) => void;
  onCancel: () => void;
}

export default function WidgetTextInput({ label, value, className, maxLength, canTraverse, onCommit, onCancel }: WidgetTextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);

  function commit(value: string, direction?: EditDirection) {
    if (finished.current) return;
    finished.current = true;
    onCommit(value, direction);
  }

  return (
    <input
      ref={inputRef}
      aria-label={label}
      defaultValue={value}
      maxLength={maxLength}
      className={className}
      onBlur={event => commit(event.currentTarget.value)}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          finished.current = true;
          onCancel();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          commit(event.currentTarget.value, canTraverse?.('down') ? 'down' : undefined);
        } else if (event.key === 'Tab') {
          const direction = event.shiftKey ? 'previous' : 'next';
          if (canTraverse?.(direction)) {
            event.preventDefault();
            commit(event.currentTarget.value, direction);
          }
        }
      }}
    />
  );
}
