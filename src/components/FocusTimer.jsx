import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';

const DURATIONS = { study: 25 * 60, break: 5 * 60 };

export default function FocusTimer({ onClose }) {
  const [mode, setMode] = useState('study'); // 'study' or 'break'
  const [remaining, setRemaining] = useState(DURATIONS.study); // seconds
  const [isRunning, setIsRunning] = useState(false);
  // Wall-clock end time. Browsers throttle timers in background tabs (to about
  // once a minute in Chrome), so we never count ticks; we re-read the clock.
  const endAt = useRef(null);

  useEffect(() => {
    if (!isRunning) return undefined;
    const tick = () => {
      const left = Math.max(0, Math.round((endAt.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setIsRunning(false);
        const nextMode = mode === 'study' ? 'break' : 'study';
        setMode(nextMode);
        setRemaining(DURATIONS[nextMode]);
        window.dispatchEvent(new CustomEvent('woni-toast', {
          detail: { message: `Timer finished! Time for a ${nextMode}.`, type: 'success' }
        }));
      }
    };
    const interval = setInterval(tick, 250);
    // Catch up immediately when the user comes back to the tab.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [isRunning, mode]);

  const toggleTimer = () => {
    if (!isRunning) endAt.current = Date.now() + remaining * 1000;
    setIsRunning(!isRunning);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setRemaining(DURATIONS[mode]);
  };

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const progressPercent = ((DURATIONS[mode] - remaining) / DURATIONS[mode]) * 100;

  return (
    <div className="focus-timer" role="dialog" aria-label="Focus timer">
      <div className="focus-timer-card">
        <header className="focus-timer-head">
          <h2>Focus Timer</h2>
          <button className="btn small" onClick={onClose} style={{ padding: '8px' }} aria-label="Close focus timer">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </header>

        <div className="focus-timer-body">
          <div className="timer-display" role="timer" aria-live="off" style={{
            fontSize: '4rem',
            fontWeight: 'bold',
            fontFamily: 'var(--mono)',
            margin: '2rem 0'
          }}>
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </div>

          <div style={{ width: '80%', height: '8px', background: 'var(--surface2)', borderRadius: '4px', overflow: 'hidden', marginBottom: '2rem' }}>
            <div style={{
              width: `${progressPercent}%`,
              height: '100%',
              background: mode === 'study' ? 'var(--accent)' : 'var(--green)',
              transition: 'width 0.25s linear'
            }}></div>
          </div>

          <div style={{ fontSize: '1.2rem', marginBottom: '2rem', fontWeight: 500 }}>
            {mode === 'study' ? 'Deep Work Session' : 'Relaxing Break'}
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn" onClick={toggleTimer}>
              {isRunning ? 'Pause' : 'Start'}
            </button>
            <button className="btn outline" onClick={resetTimer}>
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
