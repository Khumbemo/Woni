import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';

const TOAST_COLORS = {
  error:   'linear-gradient(135deg, #ef4444, #dc2626)',
  success: 'linear-gradient(135deg, #10b981, #059669)',
  info:    'linear-gradient(135deg, #3b82f6, #2563eb)',
};

export default function Toast() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleToast = (e) => {
      const { message, type = 'info' } = e.detail;
      const id = Date.now();
      setToasts((prev) => [...prev, { id, message, type }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    };

    window.addEventListener('woni-toast', handleToast);
    return () => window.removeEventListener('woni-toast', handleToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '90px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      zIndex: 9999,
      pointerEvents: 'none',
      width: '90%',
      maxWidth: '400px',
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: TOAST_COLORS[t.type] || TOAST_COLORS.info,
          color: '#fff',
          padding: '12px 20px',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          fontSize: '13px',
          fontWeight: 500,
          fontFamily: 'var(--sans)',
          lineHeight: 1.4,
          animation: 'toastSlideUp 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
          backdropFilter: 'blur(8px)',
          textAlign: 'center',
        }}>
          {t.message}
        </div>
      ))}
      <style>{`
        @keyframes toastSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
