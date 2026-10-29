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
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyCode = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  const handleCopyLink = () => {
    if (!roomCode) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
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

        {/* Room Share Section (Private Matches Only) */}
        {roomCode && (
          <div className="ingame-share-card">
            <div className="share-info">
              <span className="share-label">PRIVATE MATCH CODE:</span>
              <span className="share-code">{roomCode}</span>
            </div>
            <div className="share-actions">
              <button
                type="button"
                className="btn-secondary share-btn"
                onClick={handleCopyCode}
                title="Copy 4-digit room code"
              >
                {codeCopied ? <Check size={15} className="text-emerald" /> : <Copy size={15} />}
                <span>{codeCopied ? 'Code Copied!' : 'Copy Code'}</span>
              </button>
              <button
                type="button"
                className="btn-secondary share-btn"
                onClick={handleCopyLink}
                title="Copy full invite link"
              >
                {linkCopied ? <Check size={15} className="text-emerald" /> : <Copy size={15} />}
                <span>{linkCopied ? 'Link Copied!' : 'Copy Link'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Settings Adjustments / Tab */}
        <div className="ingame-settings-group">
          <div className="setting-header-bar">
            <div className="setting-header-title">
              <Sliders size={16} />
              <span>AIM & CONTROLS</span>
            </div>

            {/* Authoritative Private Match Code in Top-Right Corner of Settings */}
            {roomCode && (
              <div className="settings-private-code-corner" title="4-Digit Private Room Code">
                <div className="corner-code-meta">
                  <span className="corner-code-label">PRIVATE MATCH CODE</span>
                  <span className="corner-code-val">{roomCode}</span>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-corner-copy"
                  onClick={handleCopyCode}
                  title="Copy 4-digit code"
                >
                  {codeCopied ? <Check size={13} className="text-emerald" /> : <Copy size={13} />}
                  <span>{codeCopied ? 'COPIED' : 'COPY'}</span>
                </button>
              </div>
            )}
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
