import React, { useEffect, useState } from 'react';
import { Skull, RefreshCw } from 'lucide-react';
import { GAME_CONSTANTS } from '../../shared/constants';

interface DeathScreenProps {
  killerName?: string;
  onRespawn: () => void;
}

export const DeathScreen: React.FC<DeathScreenProps> = ({ killerName, onRespawn }) => {
  const [countdown, setCountdown] = useState(
    Math.ceil(GAME_CONSTANTS.RESPAWN_TIME_MS / 1000)
  );

  useEffect(() => {
    const startTime = Date.now();
    const durationMs = GAME_CONSTANTS.RESPAWN_TIME_MS;
    let hasTriggered = false;

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingSec = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      setCountdown(remainingSec);

      if (remainingSec <= 0 && !hasTriggered) {
        hasTriggered = true;
        clearInterval(timer);
        onRespawn();
      }
    }, 100);

    return () => clearInterval(timer);
  }, [onRespawn]);

  return (
    <div className="death-screen-backdrop">
      <div className="death-screen-modal">
        <div className="death-icon-wrapper">
          <Skull size={48} className="death-skull-icon" />
        </div>

        <h1 className="death-title">OPERATOR ELIMINATED</h1>

        {killerName && (
          <p className="death-subtitle">
            Killed by <strong className="killer-highlight">{killerName}</strong>
          </p>
        )}

        <div className="respawn-timer-ring">
          {countdown > 0 ? (
            <div className="respawn-digits">
              <span>RESPAWNING IN</span>
              <strong className="seconds-count">{countdown}s</strong>
            </div>
          ) : (
            <div className="respawn-ready">
              <span>SYSTEM READY</span>
            </div>
          )}
        </div>

        <button
          className="btn-primary death-respawn-btn"
          onClick={onRespawn}
          disabled={countdown > 0}
        >
          <RefreshCw size={18} className={countdown > 0 ? 'spin-icon' : ''} />
          <span>{countdown > 0 ? 'CALIBRATING SPAWN...' : 'DEPLOY TO ARENA'}</span>
        </button>
      </div>
    </div>
  );
};
