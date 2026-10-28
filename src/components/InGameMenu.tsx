import React, { useState } from 'react';
import { Play, LogOut, Copy, Check, Sliders, Volume2, VolumeX, Shield } from 'lucide-react';

interface InGameMenuProps {
  roomCode?: string;
  sensitivity: number;
  onSensitivityChange: (val: number) => void;
  invertY: boolean;
  onInvertYChange: (val: boolean) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onResume: () => void;
  onLeave: () => void;
}

export const InGameMenu: React.FC<InGameMenuProps> = ({
  roomCode,
  sensitivity,
  onSensitivityChange,
  invertY,
  onInvertYChange,
  soundEnabled,
  onToggleSound,
  onResume,
  onLeave,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    if (!roomCode) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="menu-backdrop">
      <div className="main-menu-card ingame-menu-card">
        {/* Header */}
        <div className="ingame-header">
          <div className="ingame-title-row">
            <Shield size={24} className="text-cyan" />
            <h2 className="ingame-title">TACTICAL PAUSE</h2>
          </div>
          <p className="ingame-sub">Match is active in real-time</p>
        </div>

        {/* Room Share Section */}
        {roomCode && (
          <div className="ingame-share-card">
            <div className="share-info">
              <span className="share-label">ROOM CODE:</span>
              <span className="share-code">{roomCode}</span>
            </div>
            <button className="btn-secondary share-btn" onClick={handleCopyLink}>
              {copied ? <Check size={16} className="text-emerald" /> : <Copy size={16} />}
              <span>{copied ? 'Copied!' : 'Copy Invite Link'}</span>
            </button>
          </div>
        )}

        {/* Settings Adjustments */}
        <div className="ingame-settings-group">
          <div className="setting-header">
            <Sliders size={16} />
            <span>AIM & CONTROLS</span>
          </div>

          {/* Mouse Sensitivity */}
          <div className="setting-row">
            <div className="setting-label-row">
              <span className="setting-name">Mouse Sensitivity</span>
              <span className="setting-val">{(sensitivity * 1000).toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="6.0"
              step="0.1"
              value={sensitivity * 1000}
              className="arena-slider"
              onChange={(e) => onSensitivityChange(parseFloat(e.target.value) / 1000)}
            />
          </div>

          {/* Invert Y */}
          <div className="setting-row toggle-row">
            <span className="setting-name">Invert Vertical Look (Y-Axis)</span>
            <button
              className={`arena-toggle ${invertY ? 'active' : ''}`}
              onClick={() => onInvertYChange(!invertY)}
              type="button"
            >
              <span className="toggle-handle" />
            </button>
          </div>

          {/* Sound Toggle */}
          <div className="setting-row toggle-row">
            <span className="setting-name">Audio Effects</span>
            <button
              className="btn-secondary btn-compact"
              onClick={onToggleSound}
              type="button"
            >
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              <span>{soundEnabled ? 'Enabled' : 'Muted'}</span>
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="ingame-actions-row">
          <button className="btn-primary" onClick={onResume}>
            <Play size={18} fill="currentColor" />
            <span>RESUME COMBAT</span>
          </button>

          <button className="btn-danger" onClick={onLeave}>
            <LogOut size={18} />
            <span>LEAVE MATCH</span>
          </button>
        </div>
      </div>
    </div>
  );
};
