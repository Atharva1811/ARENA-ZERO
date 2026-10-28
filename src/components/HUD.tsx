import React from 'react';
import * as THREE from 'three';
import { Volume2, VolumeX, Pause, Sparkles, MousePointer } from 'lucide-react';
import type { CollectibleItem, InteractionPrompt } from '../game/types';
import { Compass } from './Compass';

interface HUDProps {
  collectibles: CollectibleItem[];
  collectedCount: number;
  totalCrystals: number;
  interactionPrompt: InteractionPrompt | null;
  shrineUnlocked: boolean;
  gameTime: number;
  soundEnabled: boolean;
  isPointerLocked: boolean;
  playerPos: THREE.Vector3;
  playerRotY: number;
  shrinePos: THREE.Vector3;
  notification: { message: string; type: 'info' | 'success' | 'warning' } | null;
  onPause: () => void;
  onToggleSound: () => void;
  onInteract: () => void;
  onRequestPointerLock: () => void;
}

export const HUD: React.FC<HUDProps> = ({
  collectibles,
  collectedCount,
  totalCrystals,
  interactionPrompt,
  shrineUnlocked,
  gameTime,
  soundEnabled,
  isPointerLocked,
  playerPos,
  playerRotY,
  shrinePos,
  notification,
  onPause,
  onToggleSound,
  onInteract,
  onRequestPointerLock,
}) => {
  // Format game time as mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="hud-overlay">
      {/* Top Bar */}
      <header className="hud-top-bar">
        {/* Left: Quest Objective */}
        <div className="hud-objective-card">
          <div className="objective-header">
            <Sparkles className="objective-icon" size={18} />
            <span className="objective-label">CURRENT OBJECTIVE</span>
          </div>
          <div className="objective-text">
            {!shrineUnlocked
              ? `Recover the 3 Elemental Crystals (${collectedCount}/${totalCrystals})`
              : 'The Solis Shrine is unsealed! Return to the island center to awaken it.'}
          </div>
        </div>

        {/* Center: Compass */}
        <Compass
          playerPos={playerPos}
          playerRotY={playerRotY}
          collectibles={collectibles}
          shrinePos={shrinePos}
          shrineUnlocked={shrineUnlocked}
        />

        {/* Right: Timer & Controls */}
        <div className="hud-top-actions">
          <div className="hud-timer">⏱️ {formatTime(gameTime)}</div>

          <button
            className="hud-icon-btn"
            onClick={onToggleSound}
            title={soundEnabled ? 'Mute Audio' : 'Unmute Audio'}
          >
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>

          <button
            className="hud-icon-btn pause-btn"
            onClick={onPause}
            title="Pause Game (ESC)"
          >
            <Pause size={20} />
          </button>
        </div>
      </header>

      {/* Crystal Slots Tracker (Top-Left under objective) */}
      <div className="hud-crystal-tracker">
        <div className="crystal-slots">
          {collectibles.map((crystal) => (
            <div
              key={crystal.id}
              className={`crystal-slot ${crystal.collected ? 'collected' : ''}`}
              title={crystal.name + (crystal.collected ? ' (Collected)' : ' - ' + crystal.hint)}
            >
              <div
                className="crystal-slot-gem"
                style={{
                  backgroundColor: crystal.collected ? crystal.color : 'rgba(255,255,255,0.15)',
                  boxShadow: crystal.collected ? `0 0 15px ${crystal.color}` : 'none',
                }}
              />
              <span className="crystal-slot-name">{crystal.name.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div className={`hud-toast toast-${notification.type}`}>
          <Sparkles size={16} />
          <span>{notification.message}</span>
        </div>
      )}

      {/* Pointer Lock Inactive Instruction Banner */}
      {!isPointerLocked && (
        <div className="hud-pointer-lock-banner" onClick={onRequestPointerLock}>
          <MousePointer size={16} className="pointer-pulse-icon" />
          <span>Click to look around | WASD to move | ESC to release mouse</span>
        </div>
      )}

      {/* Contextual Interaction Prompt (Center Bottom) */}
      {interactionPrompt && interactionPrompt.visible && (
        <div className="hud-interaction-container">
          <button className="interaction-prompt-pill" onClick={onInteract}>
            <span className="key-badge">{interactionPrompt.actionText || '[E]'}</span>
            <span className="prompt-label">{interactionPrompt.text}</span>
          </button>
        </div>
      )}

      {/* Controls Info Badge (Bottom Right) */}
      <footer className="hud-controls-helper">
        <div className="control-item">
          <span className="key-cap">W</span>
          <span className="key-cap">A</span>
          <span className="key-cap">S</span>
          <span className="key-cap">D</span>
          <span>Move</span>
        </div>
        <div className="control-item">
          <span className="key-cap">Shift</span>
          <span>Sprint</span>
        </div>
        <div className="control-item">
          <span className="key-cap">Space</span>
          <span>Jump</span>
        </div>
        <div className="control-item">
          <MousePointer size={14} />
          <span>Click & Drag to Look</span>
        </div>
        <div className="control-item">
          <span className="key-cap">E</span>
          <span>Interact</span>
        </div>
        <div className="control-item">
          <span className="key-cap">ESC</span>
          <span>Pause</span>
        </div>
      </footer>
    </div>
  );
};
