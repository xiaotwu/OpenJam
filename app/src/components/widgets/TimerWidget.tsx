import { useEffect, useRef, useState } from 'react';
import { idleTimer, normalizeTimer, timerView, type TimerData, type WidgetData } from '../../lib/workshopWidgets';

interface TimerWidgetProps {
  x: number;
  y: number;
  data: WidgetData;
  editable: boolean;
  onUpdate: (data: TimerData) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

const PRESETS = [1, 3, 5, 10, 15, 30];
const buttonClass = 'rounded-lg bg-gray-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-600';

function formatTime(remainingMs: number) {
  const seconds = Math.ceil(remainingMs / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function playAlarm() {
  if (typeof AudioContext === 'undefined') return;
  const audio = new AudioContext();
  if (audio.state !== 'running') {
    void audio.close().catch(() => undefined);
    return;
  }
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.frequency.value = 800;
  gain.gain.value = 0.15;
  oscillator.onended = () => { void audio.close().catch(() => undefined); };
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.35);
}

export default function TimerWidget({ x, y, data, editable, onUpdate, onDelete, isSelected, onSelect }: TimerWidgetProps) {
  const [now, setNow] = useState(Date.now);
  const [showPresets, setShowPresets] = useState(false);
  const startedHere = useRef<number | null>(null);
  const timer = normalizeTimer(data);
  const { deadlineAt } = timer;
  const { status, remainingMs, progress } = timerView(timer, Math.max(now, timer.startedAt ?? 0));

  useEffect(() => {
    if (deadlineAt === null) return;
    const end = deadlineAt;
    function tick() {
      const observed = Date.now();
      setNow(observed);
      if (observed >= end) {
        window.clearInterval(interval);
        if (startedHere.current === end) {
          startedHere.current = null;
          playAlarm();
        }
      }
    }
    const interval = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(interval);
  }, [deadlineAt]);

  function start() {
    const startedAt = Date.now();
    const view = timerView(timer, startedAt);
    const deadlineAt = startedAt + (view.remainingMs || timer.minutes * 60_000);
    startedHere.current = deadlineAt;
    setNow(startedAt);
    onUpdate({ ...timer, startedAt, deadlineAt, remainingMs: null });
  }

  function pause() {
    startedHere.current = null;
    onUpdate({ ...idleTimer(timer.minutes), remainingMs: timerView(timer, Date.now()).remainingMs });
  }

  function reset(minutes = timer.minutes) {
    startedHere.current = null;
    setShowPresets(false);
    onUpdate(idleTimer(minutes));
  }

  const progressColor = status === 'completed' ? '#EF4444' : status === 'running' ? '#60A5FA' : '#9CA3AF';
  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="timer">
      <div className={`min-w-[180px] rounded-2xl border-2 canvas-widget-surface widget-dark p-4 shadow-xl ${isSelected ? 'border-blue-500' : 'border-gray-700'}`}>
        <div className="relative mx-auto mb-3 h-32 w-32">
          <svg className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="64" cy="64" r="58" fill="none" stroke="#374151" strokeWidth="8" />
            <circle cx="64" cy="64" r="58" fill="none" stroke={progressColor} strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 58}`} strokeDashoffset={`${2 * Math.PI * 58 * (1 - progress)}`}
              strokeLinecap="round" className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span role="timer" aria-label="Time remaining" className={`font-mono text-3xl font-bold tabular-nums ${status === 'completed' ? 'text-red-400' : 'text-white'}`}>
              {formatTime(remainingMs)}
            </span>
            <span className="text-xs capitalize text-gray-300">{status === 'idle' ? 'Ready' : status}</span>
          </div>
        </div>
        {editable && (
          <div className="flex justify-center gap-1.5">
            {status === 'running' ? <button type="button" onClick={pause} className={buttonClass}>Pause</button>
              : <button type="button" onClick={start} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">
                {status === 'paused' ? 'Resume' : 'Start'}</button>}
            <button type="button" onClick={() => reset()} className={buttonClass}>Reset</button>
            <button type="button" aria-expanded={showPresets} onClick={() => setShowPresets(value => !value)} className={buttonClass}>Duration</button>
          </div>
        )}
        {editable && showPresets && (
          <div className="mt-2 flex flex-wrap justify-center gap-1" aria-label="Timer presets">
            {PRESETS.map(minutes => (
              <button type="button" key={minutes} aria-pressed={minutes === timer.minutes}
                onClick={() => reset(minutes)} className={buttonClass}>{minutes}m</button>
            ))}
          </div>
        )}
      </div>
      {editable && isSelected && <button type="button" aria-label="Delete timer" onClick={event => { event.stopPropagation(); onDelete(); }}
        className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-red-600 text-xs text-white hover:bg-red-700">✕</button>}
    </div>
  );
}
