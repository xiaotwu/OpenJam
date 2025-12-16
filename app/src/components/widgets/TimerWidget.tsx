// Timer Widget - Countdown timer for activities
import { useState, useEffect, useCallback } from 'react';

type TimerState = 'idle' | 'running' | 'paused' | 'completed';

interface TimerWidgetProps {
  id: string;
  x: number;
  y: number;
  initialMinutes?: number;
  onUpdate?: (data: { minutes: number }) => void;
  onDelete: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

const PRESETS = [1, 3, 5, 10, 15, 30];

export default function TimerWidget({ x, y, initialMinutes = 5, onDelete, isSelected, onSelect }: TimerWidgetProps) {
  const [totalSeconds, setTotalSeconds] = useState(initialMinutes * 60);
  const [remainingSeconds, setRemainingSeconds] = useState(initialMinutes * 60);
  const [state, setState] = useState<TimerState>('idle');
  const [showPresets, setShowPresets] = useState(false);

  const playAlarm = useCallback(() => {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.frequency.value = 800;
    gain.gain.value = 0.3;
    oscillator.start();
    setTimeout(() => oscillator.stop(), 500);
  }, []);

  useEffect(() => {
    let interval: number | undefined;
    if (state === 'running' && remainingSeconds > 0) {
      interval = window.setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            setState('completed');
            playAlarm();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [state, remainingSeconds, playAlarm]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStart = () => setState('running');
  const handlePause = () => setState('paused');
  const handleReset = () => { setRemainingSeconds(totalSeconds); setState('idle'); };
  const handleSetTime = (minutes: number) => {
    setTotalSeconds(minutes * 60);
    setRemainingSeconds(minutes * 60);
    setState('idle');
    setShowPresets(false);
  };

  const progress = totalSeconds > 0 ? (remainingSeconds / totalSeconds) * 100 : 0;
  const progressColor = state === 'completed' ? '#EF4444' : state === 'running' ? '#3B82F6' : '#9CA3AF';

  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={onSelect} data-widget="timer">
      <div className={`bg-gray-900 rounded-2xl p-4 shadow-xl border-2 ${isSelected ? 'border-blue-500' : 'border-gray-700'} min-w-[180px]`}>
        {/* Progress ring */}
        <div className="relative w-32 h-32 mx-auto mb-3">
          <svg className="w-full h-full transform -rotate-90">
            <circle cx="64" cy="64" r="58" fill="none" stroke="#374151" strokeWidth="8" />
            <circle cx="64" cy="64" r="58" fill="none" stroke={progressColor} strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 58}`} strokeDashoffset={`${2 * Math.PI * 58 * (1 - progress / 100)}`}
              strokeLinecap="round" className="transition-all duration-1000" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-3xl font-mono font-bold ${state === 'completed' ? 'text-red-500 animate-pulse' : 'text-white'}`}>
              {formatTime(remainingSeconds)}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex justify-center gap-2 mb-2">
          {state === 'running' ? (
            <button onClick={handlePause} className="p-2 bg-yellow-500 hover:bg-yellow-600 rounded-lg text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
            </button>
          ) : (
            <button onClick={handleStart} className="p-2 bg-green-500 hover:bg-green-600 rounded-lg text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
          )}
          <button onClick={handleReset} className="p-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button onClick={() => setShowPresets(!showPresets)} className="p-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>

        {/* Presets */}
        {showPresets && (
          <div className="flex flex-wrap gap-1 justify-center">
            {PRESETS.map((min) => (
              <button key={min} onClick={() => handleSetTime(min)}
                className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white">{min}m</button>
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
