import React from 'react';
import { Trophy, Users, Crosshair, Skull } from 'lucide-react';
import type { PlayerScoreEntry } from '../game/ArenaEngine';

interface ScoreboardProps {
  players: PlayerScoreEntry[];
  roomCode?: string;
  isOpen: boolean;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({ players, roomCode, isOpen }) => {
  if (!isOpen) return null;

  return (
    <div className="scoreboard-overlay" aria-modal="true" role="dialog">
      <div className="scoreboard-modal">
        {/* Header */}
        <header className="scoreboard-header">
          <div className="scoreboard-title-group">
            <Trophy size={22} className="trophy-icon" />
            <h2 className="scoreboard-title">MATCH LEADERBOARD</h2>
          </div>

          <div className="scoreboard-meta">
            {roomCode && (
              <span className="room-meta-pill">ROOM: {roomCode}</span>
            )}
            <span className="players-meta-pill">
              <Users size={14} />
              {players.length} / 8 OPERATORS
            </span>
          </div>
        </header>

        {/* Win Condition Callout */}
        <div className="scoreboard-condition-bar">
          TARGET: <strong>FIRST TO 20 KILLS</strong> OR HIGHEST SCORE AT TIMEOUT
        </div>

        {/* Table */}
        <div className="scoreboard-table-container">
          <table className="scoreboard-table">
            <thead>
              <tr>
                <th className="th-rank">RANK</th>
                <th className="th-player">OPERATOR</th>
                <th className="th-stat">
                  <Crosshair size={14} />
                  <span>KILLS</span>
                </th>
                <th className="th-stat">
                  <Skull size={14} />
                  <span>DEATHS</span>
                </th>
                <th className="th-stat">K / D</th>
                <th className="th-score">SCORE</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, idx) => {
                const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(1) : p.kills.toString();
                return (
                  <tr key={p.sessionId} className={`scoreboard-row ${p.isSelf ? 'self-row' : ''}`}>
                    <td className="td-rank">#{idx + 1}</td>
                    <td className="td-player">
                      <div className="player-cell">
                        <span className="player-color-dot" style={{ backgroundColor: p.color }} />
                        <span className="player-name">{p.nickname}</span>
                        {p.isSelf && <span className="self-tag">YOU</span>}
                      </div>
                    </td>
                    <td className="td-stat kill-val">{p.kills}</td>
                    <td className="td-stat death-val">{p.deaths}</td>
                    <td className="td-stat kd-val">{kd}</td>
                    <td className="td-score score-val">{p.score}</td>
                  </tr>
                );
              })}

              {players.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-players-cell">
                    Awaiting battle participants...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer tip */}
        <footer className="scoreboard-footer">
          <span>HOLD [TAB] TO VIEW LEADERBOARD</span>
        </footer>
      </div>
    </div>
  );
};
