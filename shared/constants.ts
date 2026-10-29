import type { WeaponConfig, WeaponId } from './types.js';

export const WEAPON_CONFIGS: Record<WeaponId, WeaponConfig> = {
  knife: {
    id: 'knife',
    name: 'Tactical Blade',
    type: 'melee',
    damage: 45,
    headshotDamage: 45,
    headshotMultiplier: 1.0,
    fireRateRpm: 92,
    fireRateMs: 650,
    magazineSize: 0,
    maxReserveAmmo: 0,
    reloadTimeMs: 0,
    range: 2.0,
    recoil: {
      pitchKick: -0.012,
      yawSpread: 0.008,
      recoverySpeed: 14.0,
      maxPitch: 0.03,
      singleMultiplier: 1.0,
      adsMultiplier: 1.0,
    },
    defaultFov: 75,
    aimFov: 75,
    isScoped: false,
    meleeAngleDot: 0.4, // ~66 degree forward attack arc
  },
  pistol: {
    id: 'pistol',
    name: 'Sidearm Apex-9',
    type: 'firearm',
    damage: 25,
    headshotDamage: 50,
    headshotMultiplier: 2.0,
    fireRateRpm: 300,
    fireRateMs: 200,
    magazineSize: 12,
    maxReserveAmmo: 48,
    reloadTimeMs: 1500,
    range: 75,
    recoil: {
      pitchKick: 0.024,
      yawSpread: 0.008,
      recoverySpeed: 10.0,
      maxPitch: 0.065,
      singleMultiplier: 1.0,
      adsMultiplier: 0.65,
    },
    defaultFov: 75,
    aimFov: 60,
    isScoped: false,
  },
  rifle: {
    id: 'rifle',
    name: 'Pulse Rifle Z-1',
    type: 'firearm',
    damage: 25,
    headshotDamage: 45,
    headshotMultiplier: 1.8,
    fireRateRpm: 600,
    fireRateMs: 100,
    magazineSize: 24,
    maxReserveAmmo: 72,
    reloadTimeMs: 1600,
    range: 120,
    recoil: {
      pitchKick: 0.018,
      yawSpread: 0.012,
      recoverySpeed: 8.5,
      maxPitch: 0.12,
      singleMultiplier: 0.7,
      adsMultiplier: 0.6,
    },
    defaultFov: 75,
    aimFov: 50,
    isScoped: false,
  },
  sniper: {
    id: 'sniper',
    name: 'Vanguard AMR-50',
    type: 'firearm',
    damage: 90,
    headshotDamage: 180,
    headshotMultiplier: 2.0,
    fireRateRpm: 45,
    fireRateMs: 1333,
    magazineSize: 5,
    maxReserveAmmo: 20,
    reloadTimeMs: 2500,
    range: 250,
    recoil: {
      pitchKick: 0.07,
      yawSpread: 0.006,
      recoverySpeed: 5.5,
      maxPitch: 0.16,
      singleMultiplier: 1.0,
      adsMultiplier: 0.75,
    },
    defaultFov: 75,
    aimFov: 28,
    isScoped: true,
  },
};

export const GAME_CONSTANTS = {
  MAX_HEALTH: 100,
  PLAYER_SPEED: 7.2,
  SPRINT_SPEED: 11.0,
  JUMP_FORCE: 8.5,
  GRAVITY: -22,
  PLAYER_RADIUS: 0.45,
  PLAYER_HEIGHT: 1.8,
  EYE_HEIGHT: 1.65,

  // Movement & Stamina rules
  MAX_STAMINA: 100,
  SPRINT_STAMINA_DRAIN_PER_SECOND: 25, // 4 seconds continuous sprint
  STAMINA_REGEN_PER_SECOND: 20,       // 5 seconds from 0 to 100
  STAMINA_REGEN_DELAY_MS: 1000,       // 1 second delay before regen starts
  MIN_STAMINA_TO_SPRINT: 10,          // Must reach 10% before resuming sprint

  // Weapon specs (backward compatible with baseline rifle)
  WEAPON_NAME: 'Pulse Rifle Z-1',
  WEAPON_DAMAGE: 25,
  HEADSHOT_DAMAGE: 45,
  RIFLE_FIRE_RATE_RPM: 600,  // 600 RPM
  FIRE_RATE_MS: 100,         // 100ms interval (60,000 / 600)
  MAGAZINE_SIZE: 24,
  MAX_RESERVE_AMMO: 72,      // 3 reserve magazines
  RELOAD_TIME_MS: 1600,
  MAX_RANGE: 120,
  FIRE_MODES: {
    SINGLE: 'SINGLE',
    AUTO: 'AUTO',
  },

  // Combat rules
  RESPAWN_TIME_MS: 3000,
  SPAWN_PROTECTION_MS: 2500, // Invulnerability shield upon spawn
  ARMOUR_REGEN_DELAY_MS: 4000, // 4 second delay after taking armour damage
  ARMOUR_REGEN_PER_SECOND: 15, // Regenerate 15 armour points per second
  KILL_FEED_EXPIRY_MS: 5000, // Kill notifications disappear after 5 seconds
  MATCH_SCORE_LIMIT: 20,     // First to 20 kills wins
  MATCH_DURATION_SEC: 600,   // 10 minute match timer
  ROOM_CAPACITY: 8,
  SERVER_TICK_RATE: 20,      // 20Hz state broadcast
  CLIENT_SEND_RATE: 30,      // 30Hz input send rate

  // Validation limits
  MAX_NICKNAME_LENGTH: 15,
  MIN_NICKNAME_LENGTH: 2,
  MAX_CLIENT_SPEED_TOLERANCE: 14.5, // Max speed including lag spikes

  // Private match constants
  PRIVATE_ROOM_CODE_LENGTH: 4,
  MAX_PRIVATE_ROOM_CODES: 10000,
} as const;
