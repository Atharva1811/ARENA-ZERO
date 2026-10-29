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

  // Weapon specs
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
