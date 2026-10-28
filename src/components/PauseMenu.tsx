import React from 'react';
import { Play, RotateCcw, Settings, Home } from 'lucide-react';

interface PauseMenuProps {
  onResume: () => void;
  onRestart: () => void;
  onOpenSettings: () => void;
  onMainMenu: () => void;
  collectedCount: number;
  totalCrystals: number;
}

export const PauseMenu: React.FC<PauseMenuProps> = ({
  onResume,
  onRestart,
  onOpenSettings,
  onMainMenu,
  collectedCount,
  totalCrystals,
}) => {
  return (
    <div className="menu-backdrop">
      <div className="pause-modal-card">
        <h2 className="modal-title">GAME PAUSED</h2>
        <p className="modal-subtitle">
          Crystals Gathered: <strong>{collectedCount} / {totalCrystals}</strong>
        </p>

        <div className="pause-actions-list">
          <button className="btn-primary" onClick={onResume}>
            <Play size={20} fill="currentColor" />
            <span>Resume Game</span>
          </button>

          <button className="btn-secondary" onClick={onRestart}>
            <RotateCcw size={20} />
            <span>Restart Island</span>
          </button>

          <button className="btn-secondary" onClick={onOpenSettings}>
            <Settings size={20} />
            <span>Audio & Controls Settings</span>
          </button>

          <button className="btn-secondary btn-danger-hover" onClick={onMainMenu}>
            <Home size={20} />
            <span>Return to Main Menu</span>
          </button>
        </div>

        <div className="pause-tip">
          <span>Tip: You can press <strong>ESC</strong> at any time to resume.</span>
        </div>
      </div>
    </div>
  );
};
