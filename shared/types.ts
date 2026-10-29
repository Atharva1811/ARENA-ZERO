export type FireMode = 'SINGLE' | 'AUTO';

export type WeaponId = 'knife' | 'pistol' | 'rifle' | 'sniper';
export type WeaponType = 'melee' | 'firearm';

export interface WeaponRecoilConfig {
  pitchKick: number;
  yawSpread: number;
  recoverySpeed: number;
  maxPitch: number;
  singleMultiplier?: number;
  adsMultiplier?: number;
}

export interface WeaponConfig {
  id: WeaponId;
  name: string;
  type: WeaponType;
  damage: number;
  headshotDamage: number;
  headshotMultiplier: number;
  fireRateRpm: number;
  fireRateMs: number;
  magazineSize: number;
  maxReserveAmmo: number;
  reloadTimeMs: number;
  range: number;
  recoil: WeaponRecoilConfig;
  defaultFov: number;
  aimFov: number;
  isScoped?: boolean;
  meleeAngleDot?: number;
}

export interface SwitchWeaponPayload {
  weaponId: WeaponId;
}

export interface JoinRoomOptions {
  nickname: string;
  roomCode?: string;
  isPrivate?: boolean;
  clientToken?: string;
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
  shotId?: string;
  weaponId?: WeaponId;
  isMelee?: boolean;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  targetSessionId?: string; // Client hit claim (strictly validated on server)
}

export interface HitConfirmPayload {
  shotId?: string;
  targetId: string;
  damage: number;
  isKill: boolean;
  headshot: boolean;
  remainingHealth: number;
  weaponId?: WeaponId;
}

export interface DamageReceivedPayload {
  shotId?: string;
  attackerId: string;
  damage: number;
  currentHealth: number;
  attackerX?: number;
  attackerZ?: number;
  weaponId?: WeaponId;
}

export interface KillFeedItem {
  id: string;
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  headshot: boolean;
  timestamp: number;
  weaponId?: WeaponId;
}

export interface WeaponTracerEvent {
  shotId?: string;
  shooterId: string;
  weaponId?: WeaponId;
  isMelee?: boolean;
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  hitTarget: boolean;
  targetId?: string | null;
  timestamp?: number;
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
