import React from 'react';
import { X, Volume2, Sun, MousePointer } from 'lucide-react';
import type { GameSettings } from '../game/types';

interface SettingsModalProps {
  settings: GameSettings;
  onUpdateSettings: (newSettings: Partial<GameSettings>) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onUpdateSettings,
  onClose,
}) => {
  return (
    <div className="modal-overlay">
      <div className="settings-modal-card">
        <div className="settings-header">
          <h3 className="modal-title">SETTINGS</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="settings-body">
          {/* Controls & Mouse Section */}
          <div className="settings-section">
            <h4 className="section-title">
              <MousePointer size={16} />
              <span>MOUSE LOOK & CONTROLS</span>
            </h4>

            <div className="setting-row">
              <label htmlFor="mouse-sens">Look Sensitivity ({Math.round((settings.mouseSensitivity / 0.0024) * 100)}%)</label>
              <input
                id="mouse-sens"
                type="range"
                min="0.001"
                max="0.006"
                step="0.0002"
                value={settings.mouseSensitivity}
                onChange={(e) => onUpdateSettings({ mouseSensitivity: parseFloat(e.target.value) })}
              />
            </div>

            <div className="setting-row">
              <label htmlFor="invert-y">Invert Vertical Look (Pitch)</label>
              <input
                id="invert-y"
                type="checkbox"
                checked={settings.invertY}
                onChange={(e) => onUpdateSettings({ invertY: e.target.checked })}
              />
            </div>
          </div>

          {/* Audio Section */}
          <div className="settings-section">
            <h4 className="section-title">
              <Volume2 size={16} />
              <span>AUDIO</span>
            </h4>

            <div className="setting-row">
              <label htmlFor="sound-toggle">Sound Enabled</label>
              <input
                id="sound-toggle"
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => onUpdateSettings({ soundEnabled: e.target.checked })}
              />
            </div>

            <div className="setting-row">
              <label htmlFor="master-vol">Master Volume ({Math.round(settings.masterVolume * 100)}%)</label>
              <input
                id="master-vol"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.masterVolume}
                onChange={(e) => onUpdateSettings({ masterVolume: parseFloat(e.target.value) })}
              />
            </div>

            <div className="setting-row">
              <label htmlFor="sfx-vol">SFX Volume ({Math.round(settings.sfxVolume * 100)}%)</label>
              <input
                id="sfx-vol"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.sfxVolume}
                onChange={(e) => onUpdateSettings({ sfxVolume: parseFloat(e.target.value) })}
              />
            </div>

            <div className="setting-row">
              <label htmlFor="music-vol">Ambient Ocean Breeze ({Math.round(settings.musicVolume * 100)}%)</label>
              <input
                id="music-vol"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.musicVolume}
                onChange={(e) => onUpdateSettings({ musicVolume: parseFloat(e.target.value) })}
              />
            </div>
          </div>

          {/* Graphics Section */}
          <div className="settings-section">
            <h4 className="section-title">
              <Sun size={16} />
              <span>GRAPHICS</span>
            </h4>

            <div className="setting-row">
              <label htmlFor="shadows-toggle">Dynamic Sunlight & Shadows</label>
              <input
                id="shadows-toggle"
                type="checkbox"
                checked={settings.shadowsEnabled}
                onChange={(e) => onUpdateSettings({ shadowsEnabled: e.target.checked })}
              />
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
