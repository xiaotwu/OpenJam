// Stopwatch Widget - Track elapsed time with lap support
import { useState, useEffect, useCallback } from 'react';

interface StopwatchWidgetProps {
  id: string;
  x: number;
  y: number;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

export default function StopwatchWidget({ x, y, onDelete, isSelected, onSelect }: StopwatchWidgetProps) {
  const [milliseconds, setMilliseconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);

  useEffect(() => {
    let interval: number | undefined;
    if (isRunning) {
      interval = window.setInterval(() => setMilliseconds((prev) => prev + 10), 10);
    }
    return () => clearInterval(interval);
  }, [isRunning]);

  const formatTime = useCallback((ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  }, []);

  const handleStart = () => setIsRunning(true);
  const handlePause = () => setIsRunning(false);
  const handleReset = () => { setIsRunning(false); setMilliseconds(0); setLaps([]); };
  const handleLap = () => setLaps((prev) => [...prev, milliseconds]);

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="stopwatch">
      <div className={`bg-gray-900 rounded-2xl p-4 shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-gray-700'} min-w-[200px]`}>
        {/* Time display */}
        <div className="text-center mb-4">
          <span className="text-4xl font-mono font-bold text-white">{formatTime(milliseconds)}</span>
        </div>

        {/* Controls */}
        <div className="flex justify-center gap-2 mb-3">
          {isRunning ? (
            <button onClick={handlePause} className="p-2 bg-yellow-500 hover:bg-yellow-600 rounded-lg text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
            </button>
          ) : (
            <button onClick={handleStart} className="p-2 bg-green-500 hover:bg-green-600 rounded-lg text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
          )}
          <button onClick={handleLap} disabled={!isRunning} className="p-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 rounded-lg text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
          </button>
          <button onClick={handleReset} className="p-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Laps */}
        {laps.length > 0 && (
          <div className="max-h-24 overflow-y-auto">
            {laps.map((lap, i) => (
              <div key={i} className="flex justify-between text-xs text-gray-400 py-0.5">
                <span>Lap {i + 1}</span>
                <span className="font-mono">{formatTime(lap)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {isSelected && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 text-xs">✕</button>
      )}
    </div>
  );
}
