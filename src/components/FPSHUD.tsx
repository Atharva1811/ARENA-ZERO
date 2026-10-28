import React, { useState } from 'react';
import { Crosshair, Shield, Clock, Copy, Check, Skull } from 'lucide-react';
import type { KillFeedItem } from '../../shared/types';

interface FPSHUDProps {
  health: number;
  maxHealth: number;
  ammo: number;
  maxAmmo: number;
  isReloading: boolean;
  matchTimeSeconds: number;
  roomCode?: string;
  playerCount?: number;
  maxClients?: number;
  killFeed: KillFeedItem[];
  showHitmarker: boolean;
  isHeadshotHit: boolean;
  showDamageVignette: boolean;
  isPointerLocked: boolean;
  onRequestPointerLock: () => void;
}

export const FPSHUD: React.FC<FPSHUDProps> = ({
  health,
  maxHealth,
  ammo,
  maxAmmo,
  isReloading,
  matchTimeSeconds,
  roomCode,
  playerCount = 1,
  maxClients = 8,
  killFeed,
  showHitmarker,
  isHeadshotHit,
  showDamageVignette,
  isPointerLocked,
  onRequestPointerLock,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);

  // Format match timer (mm:ss)
  const minutes = Math.floor(matchTimeSeconds / 60);
  const seconds = matchTimeSeconds % 60;
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const handleCopyLink = () => {
    if (!roomCode) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  const healthPct = Math.max(0, Math.min(100, (health / maxHealth) * 100));

  return (
    <div className="fps-hud-root">
      {/* 1. Fullscreen Damage Vignette Flash */}
      <div
        className={`hud-damage-vignette ${showDamageVignette ? 'active' : ''}`}
        aria-hidden="true"
      />

      {/* 2. Top Header Bar: Room Code & Match Timer */}
      <header className="hud-top-bar">
        {roomCode && (
          <div className="hud-room-badge" onClick={handleCopyLink} title="Click to copy invite link">
            <span className="room-label">ROOM:</span>
            <span className="room-code">{roomCode}</span>
            <button className="btn-copy-code" aria-label="Copy room invite link">
              {copiedCode ? <Check size={14} className="text-emerald" /> : <Copy size={14} />}
            </button>
            {copiedCode && <span className="copied-tooltip">Link Copied!</span>}
          </div>
        )}

        {/* Player Count & Matchmaking Status */}
        <div className="hud-players-badge">
          <span className="players-label">COMBATANTS:</span>
          <span className="players-count">{playerCount} / {maxClients}</span>
          {playerCount <= 1 && (
            <span className="waiting-tag">WAITING FOR FOES</span>
          )}
        </div>

        <div className="hud-match-timer">
          <Clock size={16} className="timer-icon" />
          <span className="timer-digits">{formattedTime}</span>
        </div>
      </header>

      {/* 3. Kill Feed (Top Right) */}
      <aside className="hud-killfeed">
        {killFeed.slice(-5).map((item) => (
          <div key={item.id} className="killfeed-item">
            <span className="killer-name">{item.killerName}</span>
            <span className="kill-icon-wrapper">
              <Skull size={14} className={item.headshot ? 'headshot-skull' : 'normal-skull'} />
              {item.headshot && <span className="headshot-tag">CRIT</span>}
            </span>
            <span className="victim-name">{item.victimName}</span>
          </div>
        ))}
      </aside>

      {/* 4. Center Reticle / Crosshair */}
      <div className="hud-center-crosshair">
        <div className="crosshair-reticle">
          <div className="reticle-line top" />
          <div className="reticle-line bottom" />
          <div className="reticle-line left" />
          <div className="reticle-line right" />
          <div className="reticle-center-dot" />
        </div>

        {/* Dynamic Hitmarker 'X' Overlay */}
        {showHitmarker && (
          <div className={`hitmarker-flair ${isHeadshotHit ? 'headshot' : 'bodyshot'}`}>
            <div className="hit-slash slash-1" />
            <div className="hit-slash slash-2" />
          </div>
        )}
      </div>

      {/* 5. Pointer Lock Prompt (if cursor unlocked during match) */}
      {!isPointerLocked && (
        <div className="hud-pointerlock-banner" onClick={onRequestPointerLock}>
          <Crosshair size={20} className="pulse-slow" />
          <span>CLICK SCREEN TO ENGAGE TARGETS • PRESS ESC TO UNLOCK CURSOR</span>
        </div>
      )}

      {/* 6. Bottom Combat Dashboard (Health & Ammo) */}
      <footer className="hud-bottom-bar">
        {/* Health Plate (Bottom Left) */}
        <div className="hud-health-card">
          <div className="health-header">
            <div className="health-icon-group">
              <Shield size={16} className="health-icon" />
              <span className="label">ARMOR INTEGRITY</span>
            </div>
            <span className={`health-digits ${health < 30 ? 'critical' : ''}`}>
              {Math.round(health)} <span className="max-hp">/ {maxHealth}</span>
            </span>
          </div>

          <div className="health-track">
            <div
              className={`health-fill ${health < 30 ? 'critical' : health < 60 ? 'warning' : 'healthy'}`}
              style={{ width: `${healthPct}%` }}
            />
          </div>
        </div>

        {/* Ammunition Counter (Bottom Right) */}
        <div className="hud-ammo-card">
          <div className="ammo-header">
            <span className="ammo-weapon-name">PULSE RIFLE MK-IV</span>
            <span className="ammo-status-tag">{isReloading ? 'RELOADING...' : 'CHARGED'}</span>
          </div>

          <div className="ammo-display">
            <div className="ammo-count">
              <span className={`current-rounds ${ammo <= 6 ? 'ammo-low' : ''}`}>{ammo}</span>
              <span className="capacity"> / {maxAmmo}</span>
            </div>

            {/* Visual bullet cell indicators */}
            <div className="ammo-cartridge-cells">
              {Array.from({ length: 12 }).map((_, i) => (
                <span
                  key={i}
                  className={`ammo-cell ${i < Math.ceil(ammo / 2) ? 'charged' : 'depleted'}`}
                />
              ))}
            </div>
          </div>
          {ammo === 0 && !isReloading && (
            <div className="reload-prompt-chip">PRESS [R] TO RELOAD</div>
          )}
        </div>
      </footer>
    </div>
  );
};
