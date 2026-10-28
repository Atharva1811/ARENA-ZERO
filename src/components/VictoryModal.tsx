import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Trophy, RotateCcw, Compass, Sparkles } from 'lucide-react';

interface VictoryModalProps {
  timeElapsed: number;
  totalCrystals: number;
  onExploreFreely: () => void;
  onRestart: () => void;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  timeElapsed,
  totalCrystals,
  onExploreFreely,
  onRestart,
}) => {
  useEffect(() => {
    // Trigger festive multi-burst confetti
    try {
      const duration = 3 * 1000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 4,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#00e5ff', '#ffaa00', '#00ff88', '#ffffff'],
        });
        confetti({
          particleCount: 4,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#00e5ff', '#ffaa00', '#00ff88', '#ffffff'],
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      frame();
    } catch {}
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="menu-backdrop victory-backdrop">
      <div className="victory-modal-card">
        <div className="victory-crown">
          <Trophy size={48} className="trophy-icon" />
          <Sparkles size={24} className="trophy-sparkle left" />
          <Sparkles size={24} className="trophy-sparkle right" />
        </div>

        <h2 className="victory-title">ISLAND RESTORED!</h2>
        <p className="victory-subtitle">The Solis Shrine is awakened with radiant eternal light.</p>

        <div className="victory-stats-grid">
          <div className="stat-card">
            <span className="stat-label">TIME TO COMPLETE</span>
            <span className="stat-val">{formatTime(timeElapsed)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">CRYSTALS GATHERED</span>
            <span className="stat-val">{totalCrystals} / {totalCrystals}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">EXPEDITION RANK</span>
            <span className="stat-val gold-text">Master Adventurer ⭐</span>
          </div>
        </div>

        <div className="victory-lore-text">
          <p>
            As you place the final crystal upon the ancient altar, a column of golden azure light pierces the sky!
            The ancient guardian enchantments hum in harmony across the tides. You have conquered the secrets of the Lost Island.
          </p>
        </div>

        <div className="victory-actions">
          <button className="btn-primary" onClick={onExploreFreely}>
            <Compass size={20} />
            <span>Explore Island Freely</span>
          </button>

          <button className="btn-secondary" onClick={onRestart}>
            <RotateCcw size={20} />
            <span>Play Again</span>
          </button>
        </div>
      </div>
    </div>
  );
};
