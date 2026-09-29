import React, { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from './Button';

export function ErrorMessage({ message = 'Pit lane warning: connection stall', onRetry }) {
  useEffect(() => {
    speechSynthesis.speak(new SpeechSynthesisUtterance('Congratulations, you just lost 20 seconds of your life.'));
  }, []);

  return (
    <div
      className="glass-card"
      style={{
        border: '1px solid rgba(255, 51, 102, 0.4)',
        background: 'rgba(255, 51, 102, 0.05)',
        padding: '24px',
        textAlign: 'center',
        margin: '16px auto',
        maxWidth: '500px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '14px',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: 'rgba(255, 51, 102, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--neon-crimson)',
        }}
      >
        <AlertTriangle size={26} />
      </div>

      <div>
        <h4 style={{ color: 'var(--neon-crimson)', fontSize: '1.2rem', marginBottom: '6px' }}>
          TRACK ANOMALY DETECTED
        </h4>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {message}
        </p>
      </div>

      {onRetry && (
        <Button variant="nitro" size="sm" onClick={onRetry} icon={RefreshCw}>
          Retry Telemetry
        </Button>
      )}
    </div>
  );
}

export default ErrorMessage;
