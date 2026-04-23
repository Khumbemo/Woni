import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';

export default function FocusTimer({ onClose }) {
  const [minutes, setMinutes] = useState(25);
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState('study'); // 'study' or 'break'

  useEffect(() => {
    let interval = null;
    if (isRunning) {
      interval = setInterval(() => {
        setSeconds((s) => {
          if (s > 0) return s - 1;
          if (minutes > 0) {
            setMinutes((m) => m - 1);
            return 59;
          }
          // Timer finished
          clearInterval(interval);
          setIsRunning(false);
          const nextMode = mode === 'study' ? 'break' : 'study';
          setMode(nextMode);
          setMinutes(nextMode === 'study' ? 25 : 5);
          setSeconds(0);
          
          // Trigger global toast
          window.dispatchEvent(new CustomEvent('woni-toast', { 
            detail: { message: `Timer Finished! Time for a ${nextMode}.`, type: 'success' } 
          }));
          return 0;
        });
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isRunning, minutes, mode]);

  const toggleTimer = () => setIsRunning(!isRunning);
  
  const resetTimer = () => {
    setIsRunning(false);
    setMinutes(mode === 'study' ? 25 : 5);
    setSeconds(0);
  };

  const totalTime = mode === 'study' ? 25 * 60 : 5 * 60;
  const currentTime = minutes * 60 + seconds;
  const progressPercent = ((totalTime - currentTime) / totalTime) * 100;

  return (
    <div className="overlay active">
      <div className="view-container">
        <header className="header">
          <h2>Focus Timer</h2>
          <button className="btn small" onClick={onClose} style={{ padding: '8px' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </header>
        
        <div className="scroll-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div className="timer-display" style={{ 
            fontSize: '4rem', 
            fontWeight: 'bold', 
            fontFamily: 'JetBrains Mono',
            margin: '2rem 0' 
          }}>
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </div>

          <div style={{ width: '80%', height: '8px', background: 'var(--surface-color)', borderRadius: '4px', overflow: 'hidden', marginBottom: '2rem' }}>
            <div style={{ 
              width: `${progressPercent}%`, 
              height: '100%', 
              background: mode === 'study' ? 'var(--accent-color)' : '#4CAF50',
              transition: 'width 1s linear'
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
