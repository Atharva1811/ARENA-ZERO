import React from 'react';
import { Trophy, LogOut, Users } from 'lucide-react';
import type { PlayerScoreEntry } from '../game/ArenaEngine';
import type { MatchWinnerPayload } from '../../shared/types';

interface MatchOverModalProps {
  winner: MatchWinnerPayload | null;
  players: PlayerScoreEntry[];
  mySessionId: string;
  onReturnToLobby: () => void;
}

export const MatchOverModal: React.FC<MatchOverModalProps> = ({
  winner,
  players,
  mySessionId,
  onReturnToLobby,
}) => {
  const isWinner = winner && winner.winnerId === mySessionId;

  return (
    <div className="menu-backdrop">
      <div className="main-menu-card match-over-card">
        {/* Crest */}
        <div className="match-over-emblem">
          <Trophy size={48} className={isWinner ? 'trophy-gold' : 'trophy-silver'} />
        </div>

        <h1 className={`match-over-title ${isWinner ? 'title-victory' : 'title-defeat'}`}>
          {isWinner ? 'VICTORY SECURED' : 'MATCH CONCLUDED'}
        </h1>

        {winner && (
          <p className="match-over-winner">
            Top Operator: <strong>{winner.winnerName}</strong> ({winner.kills} Kills)
          </p>
        )}

        {/* Final Standings */}
        <div className="final-standings-card">
          <div className="standings-header">
            <Users size={16} />
            <span>FINAL STANDINGS</span>
          </div>

          <div className="scoreboard-table-container">
            <table className="scoreboard-table">
              <thead>
                <tr>
                  <th className="th-rank">RANK</th>
                  <th className="th-player">OPERATOR</th>
                  <th className="th-stat">KILLS</th>
                  <th className="th-stat">DEATHS</th>
                  <th className="th-score">SCORE</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, idx) => (
                  <tr key={p.sessionId} className={`scoreboard-row ${p.isSelf ? 'self-row' : ''}`}>
                    <td className="td-rank">#{idx + 1}</td>
                    <td className="td-player">
                      <div className="player-cell">
                        <span className="player-color-dot" style={{ backgroundColor: p.color }} />
                        <span>{p.nickname}</span>
                        {p.isSelf && <span className="self-tag">YOU</span>}
                      </div>
                    </td>
                    <td className="td-stat kill-val">{p.kills}</td>
                    <td className="td-stat death-val">{p.deaths}</td>
                    <td className="td-score score-val">{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <button className="btn-primary match-over-btn" onClick={onReturnToLobby}>
          <LogOut size={18} />
          <span>RETURN TO HEADQUARTERS</span>
        </button>
      </div>
    </div>
  );
};
