import React, { useState } from 'react';
import { Crosshair, Play, Lock, Users, Zap, AlertCircle, RefreshCw, Volume2, VolumeX } from 'lucide-react';

interface MainMenuProps {
  onJoinPublic: (nickname: string) => void;
  onCreatePrivate: (nickname: string) => void;
  onJoinPrivate: (nickname: string, code: string) => void;
  serverUrl: string;
  isConnecting: boolean;
  connectionError: string | null;
  onClearError: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  onJoinPublic,
  onCreatePrivate,
  onJoinPrivate,
  serverUrl,
  isConnecting,
  connectionError,
  onClearError,
  soundEnabled,
  onToggleSound,
}) => {
  const [nickname, setNickname] = useState(() => {
    return localStorage.getItem('arena_zero_nickname') || `Operator-${Math.floor(100 + Math.random() * 900)}`;
  });
  
  // Read URL query parameter directly on initial render (?room=AZ-XXXX)
  const initialRoomCode = () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() || '';
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [showJoinCodeInput, setShowJoinCodeInput] = useState(() => !!initialRoomCode());

  const handleSaveNickname = (val: string) => {
    const clean = val.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 14);
    setNickname(clean);
    localStorage.setItem('arena_zero_nickname', clean);
  };

  const handleQuickPlay = () => {
    if (!nickname.trim() || isConnecting) return;
    onClearError();
    onJoinPublic(nickname.trim());
  };

  const handleCreatePrivate = () => {
    if (!nickname.trim() || isConnecting) return;
    onClearError();
    onCreatePrivate(nickname.trim());
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !roomCode.trim() || isConnecting) return;
    onClearError();
    onJoinPrivate(nickname.trim(), roomCode.trim());
  };

  return (
    <div className="menu-backdrop">
      <div className="main-menu-card arena-card">
        {/* Futuristic Hex Crest Header */}
        <div className="arena-logo-wrapper">
          <div className="arena-logo-glow" />
          <div className="arena-logo-emblem">
            <Crosshair size={38} className="arena-crosshair-icon" />
          </div>
          <h1 className="arena-game-title">ARENA ZERO</h1>
          <p className="arena-tagline">STYLIZED MULTIPLAYER FIRST-PERSON SHOOTER</p>
        </div>

        {/* Server Connection Banner */}
        <div className="arena-server-badge">
          <span className="server-dot pulse" />
          <span className="server-label">MULTIPLAYER NETWORK:</span>
          <span className="server-url-tag" title={serverUrl}>
            {serverUrl.replace(/^wss?:\/\//, '')}
          </span>
        </div>

        {/* Connection Error Message */}
        {connectionError && (
          <div className="arena-error-box">
            <AlertCircle size={20} className="error-icon" />
            <div className="error-content">
              <strong>Connection Failed</strong>
              <p>{connectionError}</p>
            </div>
            <button className="error-close-btn" onClick={onClearError} title="Dismiss">
              ×
            </button>
          </div>
        )}

        {/* Nickname Selection */}
        <div className="input-group">
          <label htmlFor="arena-nickname" className="input-label">
            CALLSIGN / NICKNAME
          </label>
          <div className="input-wrapper">
            <input
              id="arena-nickname"
              type="text"
              className="arena-input"
              value={nickname}
              maxLength={14}
              placeholder="Enter Callsign..."
              onChange={(e) => handleSaveNickname(e.target.value)}
              disabled={isConnecting}
            />
            <span className="char-counter">{nickname.length}/14</span>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="arena-action-stack">
          {/* Quick Play Matchmaking */}
          <button
            className="btn-primary arena-btn-play"
            onClick={handleQuickPlay}
            disabled={!nickname.trim() || isConnecting}
          >
            {isConnecting ? (
              <>
                <RefreshCw size={22} className="spin-icon" />
                <span>CONNECTING TO ARENA...</span>
              </>
            ) : (
              <>
                <Play size={22} fill="currentColor" />
                <span>QUICK PLAY (PUBLIC MATCH)</span>
              </>
            )}
          </button>

          {/* Private Room Controls */}
          <div className="arena-secondary-actions">
            <button
              className="btn-secondary arena-btn-sub"
              onClick={handleCreatePrivate}
              disabled={!nickname.trim() || isConnecting}
            >
              <Zap size={18} />
              <span>CREATE PRIVATE MATCH</span>
            </button>

            <button
              className="btn-secondary arena-btn-sub"
              onClick={() => setShowJoinCodeInput(!showJoinCodeInput)}
              disabled={isConnecting}
            >
              <Lock size={18} />
              <span>JOIN WITH CODE</span>
            </button>
          </div>

          {/* Join with Room Code Form */}
          {showJoinCodeInput && (
            <form className="join-code-row" onSubmit={handleJoinByCode}>
              <input
                type="text"
                className="arena-input code-input"
                value={roomCode}
                maxLength={8}
                placeholder="ROOM CODE (AZ-XXXX)"
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                disabled={isConnecting}
              />
              <button
                type="submit"
                className="btn-primary btn-join-code"
                disabled={!roomCode.trim() || isConnecting}
              >
                JOIN
              </button>
            </form>
          )}
        </div>

        {/* Operational Field Guide */}
        <div className="arena-briefing">
          <div className="briefing-title">TACTICAL CONTROLS</div>
          <div className="briefing-grid">
            <div className="tactical-chip">
              <span className="key-badge">WASD</span>
              <span className="key-name">Vector Movement</span>
            </div>
            <div className="tactical-chip">
              <span className="key-badge">MOUSE</span>
              <span className="key-name">Aim / Look</span>
            </div>
            <div className="tactical-chip">
              <span className="key-badge">LEFT CLICK</span>
              <span className="key-name">Fire Pulse Rifle</span>
            </div>
            <div className="tactical-chip">
              <span className="key-badge">R</span>
              <span className="key-name">Reload Mag</span>
            </div>
            <div className="tactical-chip">
              <span className="key-badge">SHIFT</span>
              <span className="key-name">Tactical Sprint</span>
            </div>
            <div className="tactical-chip">
              <span className="key-badge">SPACE</span>
              <span className="key-name">Thruster Jump</span>
            </div>
            <div className="tactical-chip">
              <span className="key-badge">TAB</span>
              <span className="key-name">Live Scoreboard</span>
            </div>
            <div className="tactical-chip">
              <span className="key-badge">ESC</span>
              <span className="key-name">Unlock Cursor / Menu</span>
            </div>
          </div>
        </div>

        {/* Footer info & audio toggle */}
        <div className="menu-footer-actions">
          <div className="footer-status-pill">
            <Users size={14} />
            <span>8-Player Capacity • Server Authoritative Combat</span>
          </div>

          <button className="btn-icon-subtle" onClick={onToggleSound} title="Toggle Audio">
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
};
