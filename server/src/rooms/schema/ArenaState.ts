import { Schema, MapSchema, type } from '@colyseus/schema';
import { PlayerState } from './PlayerState.js';
import { GAME_CONSTANTS } from '../../../../shared/constants.js';

export class ArenaState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  @type('string') roomCode: string = '';
  @type('boolean') isPrivate: boolean = false;
  @type('number') matchTimeRemaining: number = GAME_CONSTANTS.MATCH_DURATION_SEC;
  @type('number') scoreLimit: number = GAME_CONSTANTS.MATCH_SCORE_LIMIT;
  @type('string') status: string = 'active'; // 'waiting' | 'active' | 'finished'

  @type('string') leaderId: string = '';
  @type('number') leaderScore: number = 0;
  @type('string') winnerId: string = '';
  @type('string') winnerName: string = '';
}
