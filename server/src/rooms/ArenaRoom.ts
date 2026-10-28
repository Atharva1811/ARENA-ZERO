import colyseus from 'colyseus';
import type { Client } from 'colyseus';
const { Room } = colyseus;
import { ArenaState } from './schema/ArenaState.js';
import { PlayerState } from './schema/PlayerState.js';
import { GAME_CONSTANTS } from '../../../shared/constants.js';
import {
  isLineOfSightClear,
  resolveArenaCollision,
  SPAWN_POINTS,
} from '../../../shared/arenaCollision.js';
import type {
  JoinRoomOptions,
  PlayerInputPayload,
  FireWeaponPayload,
  KillFeedItem,
  WeaponTracerEvent,
} from '../../../shared/types.js';

// Predefined stylish player colors
const PLAYER_COLORS = [
  '#00e5ff', // Cyan
  '#ff0055', // Neon Red
  '#ffaa00', // Gold
  '#00ff88', // Emerald
  '#b300ff', // Purple
  '#ff6600', // Orange
  '#0088ff', // Azure
  '#ffff00', // Yellow
];

export class ArenaRoom extends Room<ArenaState> {
  maxClients = GAME_CONSTANTS.ROOM_CAPACITY;
  private matchTimerInterval: NodeJS.Timeout | null = null;
  private nextColorIndex = 0;

  onCreate(options: JoinRoomOptions) {
    this.setState(new ArenaState());

    if (options.isPrivate || options.roomCode) {
      this.state.isPrivate = true;
      this.state.roomCode = options.roomCode || this.generateRoomCode();
    }

    // Set simulation update rate (20 Hz = 50ms)
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / GAME_CONSTANTS.SERVER_TICK_RATE);

    // Register Network Message Handlers
    this.onMessage('move', (client, data: PlayerInputPayload) => {
      this.handlePlayerMove(client, data);
    });

    this.onMessage('fire', (client, data: FireWeaponPayload) => {
      this.handlePlayerFire(client, data);
    });

    this.onMessage('reload', (client) => {
      this.handlePlayerReload(client);
    });

    this.onMessage('respawn_request', (client) => {
      this.handleRespawnRequest(client);
    });

    // Match countdown timer (every 1 sec)
    this.matchTimerInterval = setInterval(() => {
      if (this.state.status === 'active') {
        this.state.matchTimeRemaining--;
        if (this.state.matchTimeRemaining <= 0) {
          this.endMatchByTime();
        }
      }
    }, 1000);
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'AZ-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  onJoin(client: Client, options: JoinRoomOptions) {
    const player = new PlayerState();
    player.id = client.id;
    player.sessionId = client.sessionId;

    // Sanitize and validate nickname
    let cleanNick = (options.nickname || '').trim().replace(/[^a-zA-Z0-9_\- ]/g, '');
    if (cleanNick.length < GAME_CONSTANTS.MIN_NICKNAME_LENGTH) {
      cleanNick = `Soldier-${client.sessionId.slice(0, 4).toUpperCase()}`;
    } else if (cleanNick.length > GAME_CONSTANTS.MAX_NICKNAME_LENGTH) {
      cleanNick = cleanNick.slice(0, GAME_CONSTANTS.MAX_NICKNAME_LENGTH);
    }
    player.nickname = cleanNick;

    // Assign color
    player.color = PLAYER_COLORS[this.nextColorIndex % PLAYER_COLORS.length];
    this.nextColorIndex++;

    // Pick safest spawn point (farthest from active players)
    const spawn = this.getSafestSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.yaw = spawn.yaw;

    // Grant temporary spawn protection shield
    player.isShielded = true;
    player.shieldExpiryTime = Date.now() + GAME_CONSTANTS.SPAWN_PROTECTION_MS;

    this.state.players.set(client.sessionId, player);

    this.broadcast('server_announcement', {
      message: `${player.nickname} joined the battle!`,
    });
  }

  onLeave(client: Client, _consented?: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.broadcast('server_announcement', {
        message: `${player.nickname} left the match.`,
      });
      this.state.players.delete(client.sessionId);
    }
  }

  onDispose() {
    if (this.matchTimerInterval) {
      clearInterval(this.matchTimerInterval);
    }
  }

  // --- GAME LOGIC & AUTHORITATIVE VALIDATION ---

  private handlePlayerMove(client: Client, data: PlayerInputPayload) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isAlive || this.state.status === 'finished') return;

    const now = Date.now();
    const dt = player.lastMoveTime > 0 ? (now - player.lastMoveTime) / 1000 : 0.05;
    player.lastMoveTime = now;

    // Sanity check coordinates
    if (isNaN(data.x) || isNaN(data.z) || isNaN(data.yaw)) return;

    // Enforce server-side arena obstacle collision
    const resolved = resolveArenaCollision(data.x, data.z, GAME_CONSTANTS.PLAYER_RADIUS);

    // Speed-limit check to prevent speed hacking or sudden teleports
    const maxAllowedDist = GAME_CONSTANTS.MAX_CLIENT_SPEED_TOLERANCE * Math.max(0.016, dt) + 0.5;
    const movedDist = Math.hypot(resolved.x - player.x, resolved.z - player.z);

    if (movedDist <= maxAllowedDist || player.lastMoveTime === 0) {
      player.x = resolved.x;
      player.z = resolved.z;
    } else {
      // Clamp to max allowed delta
      const angle = Math.atan2(resolved.z - player.z, resolved.x - player.x);
      player.x += Math.cos(angle) * maxAllowedDist;
      player.z += Math.sin(angle) * maxAllowedDist;
    }

    player.y = Math.max(0, Math.min(8.0, data.y || 0));
    player.yaw = data.yaw;
    player.pitch = Math.max(-1.5, Math.min(1.5, data.pitch || 0));
    player.isMoving = data.isMoving;
    player.isSprinting = data.isSprinting;
  }

  private handlePlayerFire(client: Client, data: FireWeaponPayload) {
    const shooter = this.state.players.get(client.sessionId);
    if (!shooter || !shooter.isAlive || this.state.status !== 'active') return;

    const now = Date.now();

    // 1. Validate fire rate cooldown
    if (now - shooter.lastShootTime < GAME_CONSTANTS.FIRE_RATE_MS) {
      return; // Rate limit exceeded
    }

    // 2. Validate ammunition
    if (shooter.ammo <= 0 || shooter.isReloadingInternal) {
      return; // Empty magazine
    }

    shooter.lastShootTime = now;
    shooter.ammo--;
    shooter.isFiring = true;

    // Firing removes spawn protection
    shooter.isShielded = false;

    // Normalize firing direction
    const len = Math.hypot(data.dirX, data.dirY, data.dirZ);
    if (len < 0.001) return;
    const nx = data.dirX / len;
    const ny = data.dirY / len;
    const nz = data.dirZ / len;

    // Broadcast tracer event for visual and audio feedback
    const maxRange = GAME_CONSTANTS.MAX_RANGE;
    let hitSomething = false;
    let hitX = data.originX + nx * maxRange;
    let hitY = data.originY + ny * maxRange;
    let hitZ = data.originZ + nz * maxRange;

    // 3. Server-authoritative Hitscan Combat Resolution
    let hitTargetSessionId: string | null = null;
    let bestTargetDist: number = maxRange;
    let isHeadshot = false;

    this.state.players.forEach((target, targetSessionId) => {
      if (targetSessionId === client.sessionId || !target.isAlive) return;

      // Cannot damage players who have active spawn shield
      if (target.isShielded) return;

      // Test ray-cylinder intersection against target bounding volume
      const targetCenterY = target.y + GAME_CONSTANTS.PLAYER_HEIGHT / 2;
      const targetRadius = GAME_CONSTANTS.PLAYER_RADIUS + 0.22; // Forgiving hitbox

      // Vector from ray origin to target center
      const ox = target.x - data.originX;
      const oy = targetCenterY - data.originY;
      const oz = target.z - data.originZ;

      // Projection along ray direction
      const t = ox * nx + oy * ny + oz * nz;
      if (t > 0.4 && t < bestTargetDist) {
        // Closest point on ray to target center
        const px = data.originX + nx * t;
        const py = data.originY + ny * t;
        const pz = data.originZ + nz * t;

        const distSq = (target.x - px) ** 2 + (target.z - pz) ** 2;
        const verticalDiff = Math.abs(targetCenterY - py);

        if (distSq <= targetRadius * targetRadius && verticalDiff <= GAME_CONSTANTS.PLAYER_HEIGHT / 2) {
          // Verify that line of sight between shooter and target is not blocked by solid arena walls!
          const losClear = isLineOfSightClear(
            data.originX, data.originY, data.originZ,
            target.x, target.y + GAME_CONSTANTS.EYE_HEIGHT, target.z
          );

          if (losClear) {
            hitTargetSessionId = targetSessionId;
            bestTargetDist = t;
            hitSomething = true;
            hitX = px;
            hitY = py;
            hitZ = pz;
            // Check headshot (top 20% of player height)
            isHeadshot = py >= target.y + 1.35;
          }
        }
      }
    });

    // Broadcast weapon tracer to all players
    const tracerEvent: WeaponTracerEvent = {
      shooterId: client.sessionId,
      startX: data.originX,
      startY: data.originY,
      startZ: data.originZ,
      endX: hitX,
      endY: hitY,
      endZ: hitZ,
      hitTarget: hitSomething,
    };
    this.broadcast('weapon_tracer', tracerEvent);

    // Apply authoritative damage if a player was hit
    if (hitTargetSessionId) {
      const bestTarget = this.state.players.get(hitTargetSessionId);
      if (bestTarget) {
        const damage = isHeadshot ? GAME_CONSTANTS.HEADSHOT_DAMAGE : GAME_CONSTANTS.WEAPON_DAMAGE;
        bestTarget.health = Math.max(0, bestTarget.health - damage);

        // Send hit confirmation to shooter
        client.send('hit_confirm', {
          targetId: bestTarget.sessionId,
          damage,
          isKill: bestTarget.health <= 0,
          headshot: isHeadshot,
          remainingHealth: bestTarget.health,
        });

        // Send damage event to victim
        const victimClient = this.clients.find((c) => c.sessionId === bestTarget.sessionId);
        if (victimClient) {
          victimClient.send('damage_received', {
            attackerId: client.sessionId,
            damage,
            currentHealth: bestTarget.health,
            attackerX: shooter.x,
            attackerZ: shooter.z,
          });
        }

        // Check for elimination
        if (bestTarget.health <= 0) {
          bestTarget.isAlive = false;
          bestTarget.deaths++;
          bestTarget.respawnTime = now + GAME_CONSTANTS.RESPAWN_TIME_MS;

          shooter.kills++;
          shooter.score += 100;

          // Update leader
          if (shooter.score > this.state.leaderScore) {
            this.state.leaderScore = shooter.score;
            this.state.leaderId = shooter.sessionId;
          }

          // Broadcast kill feed item
          const killItem: KillFeedItem = {
            id: `${now}-${Math.random()}`,
            killerId: client.sessionId,
            killerName: shooter.nickname,
            victimId: bestTarget.sessionId,
            victimName: bestTarget.nickname,
            headshot: isHeadshot,
            timestamp: now,
          };
          this.broadcast('kill_feed', killItem);

          // Check if score limit reached
          if (shooter.kills >= this.state.scoreLimit) {
            this.endMatch(shooter);
          }
        }
      }
    }
  }

  private handlePlayerReload(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isAlive || player.isReloadingInternal || player.ammo === GAME_CONSTANTS.MAGAZINE_SIZE) {
      return;
    }

    player.isReloading = true;
    player.isReloadingInternal = true;
    player.reloadExpiryTime = Date.now() + GAME_CONSTANTS.RELOAD_TIME_MS;
  }

  private handleRespawnRequest(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isAlive) return;

    const now = Date.now();
    if (now < player.respawnTime) return; // Must wait for respawn timer

    const spawn = this.getSafestSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.yaw = spawn.yaw;
    player.health = GAME_CONSTANTS.MAX_HEALTH;
    player.ammo = GAME_CONSTANTS.MAGAZINE_SIZE;
    player.isAlive = true;
    player.isReloading = false;
    player.isReloadingInternal = false;

    // Grant spawn protection shield
    player.isShielded = true;
    player.shieldExpiryTime = now + GAME_CONSTANTS.SPAWN_PROTECTION_MS;

    client.send('respawn_confirmed', {
      x: player.x,
      y: player.y,
      z: player.z,
      yaw: player.yaw,
    });
  }

  private getSafestSpawnPoint(): { x: number; y: number; z: number; yaw: number } {
    let bestSpawn = SPAWN_POINTS[0];
    let maxMinDistance = -1;

    for (const spawn of SPAWN_POINTS) {
      let minDistanceToAnyPlayer = 99999;

      this.state.players.forEach((player) => {
        if (player.isAlive) {
          const dist = Math.hypot(player.x - spawn.x, player.z - spawn.z);
          if (dist < minDistanceToAnyPlayer) {
            minDistanceToAnyPlayer = dist;
          }
        }
      });

      if (minDistanceToAnyPlayer > maxMinDistance) {
        maxMinDistance = minDistanceToAnyPlayer;
        bestSpawn = spawn;
      }
    }

    return bestSpawn;
  }

  private update(_deltaTime: number) {
    const now = Date.now();

    // Check expiry for spawn shields and reloads
    this.state.players.forEach((player) => {
      if (player.isShielded && now >= player.shieldExpiryTime) {
        player.isShielded = false;
      }

      if (player.isReloadingInternal && now >= player.reloadExpiryTime) {
        player.ammo = GAME_CONSTANTS.MAGAZINE_SIZE;
        player.isReloading = false;
        player.isReloadingInternal = false;
      }

      // Reset firing visual state
      if (player.isFiring) {
        player.isFiring = false;
      }
    });
  }

  private endMatch(winner: PlayerState) {
    this.state.status = 'finished';
    this.state.winnerId = winner.sessionId;
    this.state.winnerName = winner.nickname;

    this.broadcast('match_over', {
      winnerId: winner.sessionId,
      winnerName: winner.nickname,
      kills: winner.kills,
    });
  }

  private endMatchByTime() {
    this.state.status = 'finished';

    // Find highest score player
    let topPlayer: PlayerState | null = null;
    let topScore = -1;

    this.state.players.forEach((p) => {
      if (p.score > topScore) {
        topScore = p.score;
        topPlayer = p;
      }
    });

    if (topPlayer) {
      this.state.winnerId = (topPlayer as PlayerState).sessionId;
      this.state.winnerName = (topPlayer as PlayerState).nickname;
      this.broadcast('match_over', {
        winnerId: (topPlayer as PlayerState).sessionId,
        winnerName: (topPlayer as PlayerState).nickname,
        kills: (topPlayer as PlayerState).kills,
      });
    }
  }
}
