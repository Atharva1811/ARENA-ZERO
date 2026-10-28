export interface JoinRoomOptions {
  nickname: string;
  roomCode?: string;
  isPrivate?: boolean;
}

export interface PlayerInputPayload {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  isMoving: boolean;
  isSprinting: boolean;
}

export interface FireWeaponPayload {
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  targetSessionId?: string; // Client hit claim (strictly validated on server)
}

export interface HitConfirmPayload {
  targetId: string;
  damage: number;
  isKill: boolean;
  headshot: boolean;
  remainingHealth: number;
}

export interface DamageReceivedPayload {
  attackerId: string;
  damage: number;
  currentHealth: number;
  attackerX?: number;
  attackerZ?: number;
}

export interface KillFeedItem {
  id: string;
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  headshot: boolean;
  timestamp: number;
}

export interface WeaponTracerEvent {
  shooterId: string;
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  hitTarget: boolean;
}

export interface MatchWinnerPayload {
  winnerId: string;
  winnerName: string;
  kills: number;
}

export interface SpawnConfirmedPayload {
  x: number;
  y: number;
  z: number;
  yaw: number;
  isShielded?: boolean;
  shieldExpiryTime?: number;
}
