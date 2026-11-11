import { useEffect, useState } from 'react';
import { newWidgetPartId, type WidgetData } from '../../lib/workshopWidgets';

type Lap = { id: string; elapsedMs: number };
type StopwatchData = { startedAt: number | null; elapsedMs: number; laps: Lap[] };

interface StopwatchWidgetProps {
  x: number;
  y: number;
  data: WidgetData;
  editable: boolean;
  onUpdate: (data: StopwatchData) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

function elapsedValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readStopwatch(data: WidgetData): StopwatchData {
  return {
    startedAt: elapsedValue(data.startedAt) && data.startedAt > 0 ? data.startedAt : null,
    elapsedMs: elapsedValue(data.elapsedMs) ? data.elapsedMs : 0,
    laps: Array.isArray(data.laps) ? data.laps.flatMap((value: unknown, index): Lap[] => {
      if (elapsedValue(value)) return [{ id: `legacy-lap-${index}`, elapsedMs: value }];
      if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
        && 'elapsedMs' in value && elapsedValue(value.elapsedMs)) return [{ id: value.id, elapsedMs: value.elapsedMs }];
      return [];
    }) : [],
  };
}

function elapsed(stopwatch: StopwatchData, now: number) {
  return stopwatch.elapsedMs + (stopwatch.startedAt === null ? 0 : Math.max(0, now - stopwatch.startedAt));
}

function formatTime(ms: number) {
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
}

const control = 'rounded-lg bg-gray-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-600 disabled:opacity-45';

export default function StopwatchWidget({ x, y, data, editable, onUpdate, onDelete, isSelected, onSelect }: StopwatchWidgetProps) {
  const [now, setNow] = useState(Date.now);
  const stopwatch = readStopwatch(data);
  const running = stopwatch.startedAt !== null;

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="stopwatch">
      <div className={`min-w-[200px] rounded-2xl border-2 canvas-widget-surface widget-dark p-4 shadow-xl ${isSelected ? 'border-blue-500' : 'border-gray-700'}`}>
        <div className="mb-3 text-center">
          <span role="timer" aria-label="Elapsed time" className="font-mono text-3xl font-bold tabular-nums text-white">{formatTime(elapsed(stopwatch, now))}</span>
        </div>
        {editable && (
          <div className="mb-3 flex justify-center gap-1.5">
            <button type="button" className={control} onClick={() => {
              const currentTime = Date.now();
              setNow(currentTime);
              onUpdate(running ? { ...stopwatch, elapsedMs: elapsed(stopwatch, currentTime), startedAt: null }
                : { ...stopwatch, startedAt: currentTime });
            }}>{running ? 'Pause' : 'Start'}</button>
            <button type="button" className={control} disabled={!running || stopwatch.laps.length >= 100}
              onClick={() => onUpdate({ ...stopwatch, laps: [...stopwatch.laps, { id: newWidgetPartId('lap'), elapsedMs: elapsed(stopwatch, Date.now()) }] })}>Lap</button>
            <button type="button" className={control} onClick={() => onUpdate({ startedAt: null, elapsedMs: 0, laps: [] })}>Reset</button>
          </div>
        )}
        {stopwatch.laps.length > 0 && (
          <ol className="max-h-24 overflow-y-auto" aria-label="Laps">
            {stopwatch.laps.map((lap, index) => (
              <li key={lap.id} className="flex justify-between py-0.5 text-xs text-gray-300">
                <span>Lap {index + 1}</span>
                <span className="font-mono">{formatTime(lap.elapsedMs)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {editable && isSelected && <button type="button" aria-label="Delete stopwatch" onClick={event => { event.stopPropagation(); onDelete(); }}
        className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-red-600 text-xs text-white hover:bg-red-700">✕</button>}
    </div>
  );
}
