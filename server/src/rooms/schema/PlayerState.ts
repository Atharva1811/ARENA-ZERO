import { Schema, type } from '@colyseus/schema';

export class PlayerState extends Schema {
  @type('string') id: string = '';
  @type('string') sessionId: string = '';
  @type('string') nickname: string = 'Soldier';
  @type('string') color: string = '#00e5ff';

  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') z: number = 0;
  @type('number') yaw: number = 0;
  @type('number') pitch: number = 0;

  @type('number') health: number = 100;
  @type('number') maxHealth: number = 100;
  @type('number') stamina: number = 100;
  @type('number') maxStamina: number = 100;
  @type('number') score: number = 0;
  @type('number') kills: number = 0;
  @type('number') deaths: number = 0;
  @type('number') ammo: number = 24;
  @type('number') reserveAmmo: number = 72;
  @type('string') fireMode: string = 'AUTO';
  @type('string') currentWeapon: string = 'rifle';

  @type('boolean') isMoving: boolean = false;
  @type('boolean') isSprinting: boolean = false;
  @type('boolean') isFiring: boolean = false;
  @type('boolean') isReloading: boolean = false;
  @type('boolean') isShielded: boolean = true;
  @type('boolean') isAlive: boolean = true;

  // Server internal tracking (not synced over network)
  clientToken: string = '';
  spawnX: number = 0;
  spawnZ: number = 0;
  lastShootTime: number = 0;
  lastMoveTime: number = 0;
  lastSprintTime: number = 0;
  shieldExpiryTime: number = 0;
  respawnTime: number = 0;
  lastDamageTime: number = 0;
  isReloadingInternal: boolean = false;
  reloadExpiryTime: number = 0;

  // Per-weapon loaded ammo & reserve tracking
  weaponAmmo: Record<string, { ammo: number; reserveAmmo: number }> = {
    knife: { ammo: 0, reserveAmmo: 0 },
    pistol: { ammo: 12, reserveAmmo: 48 },
    rifle: { ammo: 24, reserveAmmo: 72 },
    sniper: { ammo: 5, reserveAmmo: 20 },
  };

  // Convenient accessors for armour integrity representation
  get armor(): number {
    return this.health;
  }
  set armor(val: number) {
    this.health = val;
  }
  get armour(): number {
    return this.health;
  }
  set armour(val: number) {
    this.health = val;
  }
}
