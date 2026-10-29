import colyseus from 'colyseus';
import type { Client } from 'colyseus';
const { Room } = colyseus;
import { ArenaState } from './schema/ArenaState.js';
import { PlayerState } from './schema/PlayerState.js';
import { GAME_CONSTANTS } from '../../../shared/constants.js';
import {
  isLineOfSightClear,
  raycastArenaObstacles,
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

interface CylinderHitResult {
  hit: boolean;
  dist: number;
  hitX: number;
  hitY: number;
  hitZ: number;
  isHeadshot: boolean;
}

/**
 * Authoritative 3D Finite Vertical Cylinder Raycast
 */
function intersectRayCylinder(
  originX: number,
  originY: number,
  originZ: number,
  nx: number,
  ny: number,
  nz: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
  height: number
): CylinderHitResult {
  const ox = originX - centerX;
  const oz = originZ - centerZ;

  const a = nx * nx + nz * nz;
  if (a < 1e-6) {
    // Purely vertical ray
    const distSq = ox * ox + oz * oz;
    if (distSq <= radius * radius && ny !== 0) {
      const t1 = (centerY - originY) / ny;
      const t2 = (centerY + height - originY) / ny;
      const tMin = Math.min(t1, t2);
      const tMax = Math.max(t1, t2);
      if (tMax >= 0.1) {
        const tHit = Math.max(0.1, tMin);
        const py = originY + ny * tHit;
        return {
          hit: true,
          dist: tHit,
          hitX: originX,
          hitY: py,
          hitZ: originZ,
          isHeadshot: py >= centerY + height - 0.45,
        };
      }
    }
    return { hit: false, dist: Infinity, hitX: 0, hitY: 0, hitZ: 0, isHeadshot: false };
  }

  const b = 2 * (ox * nx + oz * nz);
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - 4 * a * c;

  if (disc < 0) {
    return { hit: false, dist: Infinity, hitX: 0, hitY: 0, hitZ: 0, isHeadshot: false };
  }

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  if (t2 < 0.1) {
    return { hit: false, dist: Infinity, hitX: 0, hitY: 0, hitZ: 0, isHeadshot: false };
  }

  const tStart = Math.max(0.1, t1);
  const tEnd = t2;

  const yStart = originY + ny * tStart;
  const yEnd = originY + ny * tEnd;
  const minY = Math.min(yStart, yEnd);
  const maxY = Math.max(yStart, yEnd);

  const cylinderTop = centerY + height + 0.15; // Upper tolerance for head
  const cylinderBottom = centerY;

  if (maxY < cylinderBottom || minY > cylinderTop) {
    return { hit: false, dist: Infinity, hitX: 0, hitY: 0, hitZ: 0, isHeadshot: false };
  }

  let tHit = tStart;
  if (yStart > cylinderTop && ny < 0) {
    const tCap = (cylinderTop - originY) / ny;
    if (tCap >= 0.1 && tCap <= tEnd) tHit = tCap;
  } else if (yStart < cylinderBottom && ny > 0) {
    const tCap = (cylinderBottom - originY) / ny;
    if (tCap >= 0.1 && tCap <= tEnd) tHit = tCap;
  }

  const px = originX + nx * tHit;
  const py = originY + ny * tHit;
  const pz = originZ + nz * tHit;
  const isHeadshot = py >= centerY + height - 0.45;

  return {
    hit: true,
    dist: tHit,
    hitX: px,
    hitY: py,
    hitZ: pz,
    isHeadshot,
  };
}

export class ArenaRoom extends Room<ArenaState> {
  maxClients = GAME_CONSTANTS.ROOM_CAPACITY;
  private matchTimerInterval: NodeJS.Timeout | null = null;
  private nextColorIndex = 0;

  onUncaughtException(error: any, methodName: string) {
    console.error(`[ArenaRoom Error in ${methodName}] Room: ${this.roomId}:`, error);
  }

  private updateRoomMetadata() {
    this.setMetadata({
      roomCode: this.state.roomCode,
      isPrivate: this.state.isPrivate,
      playerCount: this.clients.length,
      maxClients: this.maxClients,
      status: this.state.status,
    });
  }

  onCreate(options: JoinRoomOptions) {
    this.setState(new ArenaState());

    if (options.isPrivate || options.roomCode) {
      this.state.isPrivate = true;
      this.state.roomCode = options.roomCode || this.generateRoomCode();
      this.setPrivate(true); // Exclude private rooms from public matchmaking
    }

    this.updateRoomMetadata();

    // Set simulation update rate (20 Hz = 50ms)
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / GAME_CONSTANTS.SERVER_TICK_RATE);

    // Register Network Message Handlers with protective boundaries
    this.onMessage('move', (client, data: PlayerInputPayload) => {
      try {
        this.handlePlayerMove(client, data);
      } catch (err: any) {
        console.error(`[ArenaRoom] Error in handlePlayerMove (client: ${client.sessionId}):`, err);
      }
    });

    this.onMessage('fire', (client, data: FireWeaponPayload) => {
      try {
        this.handlePlayerFire(client, data);
      } catch (err: any) {
        console.error(`[ArenaRoom] Error in handlePlayerFire (client: ${client.sessionId}):`, err);
      }
    });

    this.onMessage('reload', (client) => {
      try {
        this.handlePlayerReload(client);
      } catch (err: any) {
        console.error(`[ArenaRoom] Error in handlePlayerReload (client: ${client.sessionId}):`, err);
      }
    });

    this.onMessage('respawn_request', (client) => {
      try {
        this.handleRespawnRequest(client);
      } catch (err: any) {
        console.error(`[ArenaRoom] Error in handleRespawnRequest (client: ${client.sessionId}):`, err);
      }
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
    // If a clientToken was passed and an existing player has the same token, prune stale session immediately
    if (options?.clientToken) {
      this.state.players.forEach((existingPlayer, sid) => {
        if (existingPlayer.clientToken === options.clientToken && sid !== client.sessionId) {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[ArenaRoom] Pruning stale ghost session ${sid} for clientToken ${options.clientToken}`);
          }
          this.state.players.delete(sid);
        }
      });
    }

    const player = new PlayerState();
    player.id = client.id;
    player.sessionId = client.sessionId;
    player.clientToken = options?.clientToken || '';

    // Sanitize and validate nickname
    let cleanNick = (options?.nickname || '').trim().replace(/[^a-zA-Z0-9_\- ]/g, '');
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
    player.spawnX = spawn.x;
    player.spawnZ = spawn.z;

    // Grant temporary spawn protection shield
    player.isShielded = true;
    player.shieldExpiryTime = Date.now() + GAME_CONSTANTS.SPAWN_PROTECTION_MS;
    player.lastMoveTime = 0; // Initialize so first move is acknowledged smoothly

    this.state.players.set(client.sessionId, player);
    this.updateRoomMetadata();

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Combat Diagnostic] Player joined: ${player.nickname} (${client.sessionId}) at (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)})`);
    }

    // Authoritative spawn notification to newly joined client
    try {
      client.send('init_spawn', {
        x: player.x,
        y: player.y,
        z: player.z,
        yaw: player.yaw,
        isShielded: player.isShielded,
        shieldExpiryTime: player.shieldExpiryTime,
      });
    } catch (e) {
      console.warn(`[ArenaRoom] Failed to send init_spawn to client ${client.sessionId}:`, e);
    }

    try {
      this.broadcast('server_announcement', {
        message: `${player.nickname} joined the battle!`,
      });
    } catch (e) {
      console.warn('[ArenaRoom] Failed to broadcast server_announcement on join:', e);
    }
  }

  async onLeave(client: Client, consented?: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Combat Diagnostic] Player left (${consented ? 'consented' : 'unconsented'}): ${player.nickname} (${client.sessionId})`);
    }

    try {
      this.broadcast('server_announcement', {
        message: `${player.nickname} left the match.`,
      });
    } catch {}

    // Immediately remove from authoritative room state to guarantee no ghost models
    this.state.players.delete(client.sessionId);
    this.updateRoomMetadata();
  }

  onDispose() {
    if (this.matchTimerInterval) {
      clearInterval(this.matchTimerInterval);
    }
  }

  // --- GAME LOGIC & AUTHORITATIVE VALIDATION ---

  private handlePlayerMove(client: Client, data: PlayerInputPayload) {
    if (!data || typeof data !== 'object') return;

    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isAlive || this.state.status === 'finished') return;

    // Sanity check coordinates are valid finite numbers
    if (
      !Number.isFinite(data.x) ||
      !Number.isFinite(data.z) ||
      !Number.isFinite(data.yaw)
    ) {
      return;
    }

    const isFirstMove = player.lastMoveTime === 0;
    const now = Date.now();
    const dt = !isFirstMove ? (now - player.lastMoveTime) / 1000 : 0.05;
    player.lastMoveTime = now;

    // Enforce server-side arena obstacle collision
    const resolved = resolveArenaCollision(data.x, data.z, GAME_CONSTANTS.PLAYER_RADIUS);

    // Speed-limit check to prevent speed hacking or sudden teleports
    const maxAllowedDist = GAME_CONSTANTS.MAX_CLIENT_SPEED_TOLERANCE * Math.max(0.016, dt) + 0.5;
    const movedDist = Math.hypot(resolved.x - player.x, resolved.z - player.z);

    if (isFirstMove || movedDist <= maxAllowedDist) {
      player.x = resolved.x;
      player.z = resolved.z;
    } else {
      // Clamp to max allowed delta
      const angle = Math.atan2(resolved.z - player.z, resolved.x - player.x);
      player.x += Math.cos(angle) * maxAllowedDist;
      player.z += Math.sin(angle) * maxAllowedDist;
    }

    // Moving away from spawn point (> 1.2m) or timer expiry drops spawn protection shield
    if (player.isShielded) {
      const distFromSpawn = Math.hypot(player.x - player.spawnX, player.z - player.spawnZ);
      if (distFromSpawn > 1.2 || now >= player.shieldExpiryTime) {
        player.isShielded = false;
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Combat Diagnostic] Spawn protection dropped for ${player.nickname} (${client.sessionId}) [moved: ${distFromSpawn.toFixed(2)}m]`);
        }
      }
    }

    player.y = Math.max(0, Math.min(8.0, Number.isFinite(data.y) ? data.y : 0));
    player.yaw = data.yaw;
    player.pitch = Math.max(-1.5, Math.min(1.5, Number.isFinite(data.pitch) ? data.pitch : 0));
    player.isMoving = !!data.isMoving;
    player.isSprinting = !!data.isSprinting;
  }

  private handlePlayerFire(client: Client, data: FireWeaponPayload) {
    // 1. Verify client existence and player alive state
    const shooter = this.state.players.get(client.sessionId);
    if (!shooter || !shooter.isAlive || this.state.status !== 'active') {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Combat Diagnostic] Shot rejected from client ${client.sessionId}: ${!shooter ? 'Shooter not found' : !shooter.isAlive ? 'Shooter is dead' : 'Match not active'}`);
      }
      return;
    }

    // 2. Validate payload presence and types
    if (!data || typeof data !== 'object') {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[Combat Diagnostic] Invalid fire payload from client ${client.sessionId}`);
      }
      return;
    }

    if (
      !Number.isFinite(data.originX) ||
      !Number.isFinite(data.originY) ||
      !Number.isFinite(data.originZ) ||
      !Number.isFinite(data.dirX) ||
      !Number.isFinite(data.dirY) ||
      !Number.isFinite(data.dirZ)
    ) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[Combat Diagnostic] Non-finite fire vector from client ${client.sessionId}`);
      }
      return;
    }

    // 3. Direction normalization & zero-vector check
    const len = Math.hypot(data.dirX, data.dirY, data.dirZ);
    if (len < 0.001 || !Number.isFinite(len)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[Combat Diagnostic] Zero-length fire direction from client ${client.sessionId}`);
      }
      return;
    }
    const nx = data.dirX / len;
    const ny = data.dirY / len;
    const nz = data.dirZ / len;

    // 4. Rate-limit validation
    const now = Date.now();
    if (now - shooter.lastShootTime < GAME_CONSTANTS.FIRE_RATE_MS) {
      return; // Rate limit exceeded
    }

    // 5. Ammunition validation
    if (shooter.ammo <= 0 || shooter.isReloadingInternal) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Combat Diagnostic] Shot rejected from ${shooter.nickname} (${client.sessionId}): Out of ammo (${shooter.ammo}) or reloading`);
      }
      return; // Out of ammo or reloading
    }

    // 6. Origin proximity check (prevent spoofing ray origins far from shooter)
    const originDistSq = (data.originX - shooter.x) ** 2 + (data.originZ - shooter.z) ** 2;
    if (originDistSq > 16.0) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[Combat Diagnostic] Fire origin too far from shooter: ${Math.sqrt(originDistSq).toFixed(2)}m (client: ${client.sessionId})`);
      }
      return;
    }

    // All validations passed: perform state changes
    shooter.lastShootTime = now;
    shooter.ammo = Math.max(0, shooter.ammo - 1);
    shooter.isFiring = true;
    shooter.isShielded = false; // Firing removes spawn protection

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Combat Diagnostic] FIRE: Shooter ${shooter.nickname} (${client.sessionId}) origin=(${data.originX.toFixed(2)}, ${data.originY.toFixed(2)}, ${data.originZ.toFixed(2)}) dir=(${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)}) ammo=${shooter.ammo}`);
    }

    const maxRange = GAME_CONSTANTS.MAX_RANGE;
    let hitSomething = false;
    let hitX = data.originX + nx * maxRange;
    let hitY = data.originY + ny * maxRange;
    let hitZ = data.originZ + nz * maxRange;

    // 7. Server-authoritative Hitscan Combat Resolution
    let hitTargetSessionId: string | null = null;
    let bestTargetDist: number = maxRange;
    let isHeadshot = false;

    try {
      this.state.players.forEach((target, targetSessionId) => {
        if (targetSessionId === client.sessionId || !target.isAlive) {
          return;
        }

        if (
          !Number.isFinite(target.x) ||
          !Number.isFinite(target.y) ||
          !Number.isFinite(target.z)
        ) {
          return;
        }

        // Add appropriate tolerance for network latency when player aimed at client target
        const isClientClaimedTarget = data.targetSessionId === targetSessionId;
        const targetRadius = isClientClaimedTarget
          ? (GAME_CONSTANTS.PLAYER_RADIUS + 0.35)
          : (GAME_CONSTANTS.PLAYER_RADIUS + 0.25);

        const hitResult = intersectRayCylinder(
          data.originX,
          data.originY,
          data.originZ,
          nx,
          ny,
          nz,
          target.x,
          target.y,
          target.z,
          targetRadius,
          GAME_CONSTANTS.PLAYER_HEIGHT
        );

        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Combat Diagnostic] Candidate target ${target.nickname} (${targetSessionId}) pos=(${target.x.toFixed(2)}, ${target.z.toFixed(2)}) | hit=${hitResult.hit} dist=${hitResult.hit ? hitResult.dist.toFixed(2) + 'm' : 'N/A'}`);
        }

        if (hitResult.hit && hitResult.dist >= 0.1 && hitResult.dist < bestTargetDist) {
          // Verify line of sight directly to the exact impact point on the player's bounding cylinder
          const losClear = isLineOfSightClear(
            data.originX,
            data.originY,
            data.originZ,
            hitResult.hitX,
            hitResult.hitY,
            hitResult.hitZ
          );

          if (losClear) {
            hitTargetSessionId = targetSessionId;
            bestTargetDist = hitResult.dist;
            hitSomething = true;
            hitX = hitResult.hitX;
            hitY = hitResult.hitY;
            hitZ = hitResult.hitZ;
            isHeadshot = hitResult.isHeadshot;
          } else if (process.env.NODE_ENV !== 'production') {
            console.log(`[Combat Diagnostic] Hit blocked by arena wall: shooter ${client.sessionId} -> target ${targetSessionId}`);
          }
        }
      });
    } catch (hitscanErr) {
      console.error('[ArenaRoom] Hitscan resolution error:', hitscanErr);
    }

    // If no player was hit, raycast against static arena obstacles so misses clip to walls & barriers
    if (!hitSomething) {
      try {
        const obsHit = raycastArenaObstacles(
          data.originX,
          data.originY,
          data.originZ,
          nx,
          ny,
          nz,
          maxRange
        );
        if (obsHit.hit) {
          hitX = obsHit.hitX;
          hitY = obsHit.hitY;
          hitZ = obsHit.hitZ;
        }
      } catch (obsErr) {
        console.error('[ArenaRoom] Obstacle raycast error:', obsErr);
      }
    }

    // 8. Broadcast weapon tracer to all players
    try {
      const shotId = `shot_${client.sessionId}_${now}_${shooter.ammo}`;
      const tracerEvent: WeaponTracerEvent = {
        shotId,
        shooterId: client.sessionId,
        startX: Number.isFinite(data.originX) ? data.originX : shooter.x,
        startY: Number.isFinite(data.originY) ? data.originY : shooter.y + GAME_CONSTANTS.EYE_HEIGHT,
        startZ: Number.isFinite(data.originZ) ? data.originZ : shooter.z,
        endX: Number.isFinite(hitX) ? hitX : data.originX,
        endY: Number.isFinite(hitY) ? hitY : data.originY,
        endZ: Number.isFinite(hitZ) ? hitZ : data.originZ,
        hitTarget: hitSomething,
        targetId: hitTargetSessionId || null,
        timestamp: now,
      };
      this.broadcast('weapon_tracer', tracerEvent);
    } catch (tracerErr) {
      console.error('[ArenaRoom] Broadcast weapon tracer error:', tracerErr);
    }

    // 9. Apply authoritative damage if a player was hit
    if (hitTargetSessionId) {
      try {
        const bestTarget = this.state.players.get(hitTargetSessionId);
        if (bestTarget && bestTarget.isAlive) {
          bestTarget.isShielded = false; // Valid confirmed hit breaks spawn shield
          const healthBefore = bestTarget.health;
          const damage = isHeadshot ? GAME_CONSTANTS.HEADSHOT_DAMAGE : GAME_CONSTANTS.WEAPON_DAMAGE;
          bestTarget.health = Math.max(0, bestTarget.health - damage);
          const healthAfter = bestTarget.health;

          if (process.env.NODE_ENV !== 'production') {
            console.log(`[Combat Diagnostic] HIT: ${shooter.nickname} (${client.sessionId}) -> ${bestTarget.nickname} (${bestTarget.sessionId}) | DMG: ${damage} (${isHeadshot ? 'HEADSHOT' : 'BODY'}) | HP: ${healthBefore} -> ${healthAfter}`);
          }

          // Send hit confirmation to shooter
          try {
            client.send('hit_confirm', {
              targetId: bestTarget.sessionId,
              damage,
              isKill: bestTarget.health <= 0,
              headshot: isHeadshot,
              remainingHealth: bestTarget.health,
            });
          } catch (sendErr) {
            console.warn(`[ArenaRoom] Failed to send hit_confirm to shooter ${client.sessionId}:`, sendErr);
          }

          // Send damage event to victim
          const victimClient = this.clients.find((c) => c.sessionId === bestTarget.sessionId);
          if (victimClient) {
            try {
              victimClient.send('damage_received', {
                attackerId: client.sessionId,
                damage,
                currentHealth: bestTarget.health,
                attackerX: shooter.x,
                attackerZ: shooter.z,
              });
            } catch (sendErr) {
              console.warn(`[ArenaRoom] Failed to send damage_received to victim ${bestTarget.sessionId}:`, sendErr);
            }
          }

          // Check for elimination
          if (bestTarget.health <= 0) {
            bestTarget.isAlive = false;
            bestTarget.deaths++;
            bestTarget.respawnTime = now + GAME_CONSTANTS.RESPAWN_TIME_MS;

            shooter.kills++;
            shooter.score += 100;

            if (process.env.NODE_ENV !== 'production') {
              console.log(`[Combat Diagnostic] ELIMINATION: ${shooter.nickname} eliminated ${bestTarget.nickname}! [Kills: ${shooter.kills}, Score: ${shooter.score}]`);
            }

            // Update leader
            if (shooter.score > this.state.leaderScore) {
              this.state.leaderScore = shooter.score;
              this.state.leaderId = shooter.sessionId;
            }

            // Broadcast kill feed item
            try {
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
            } catch (broadcastErr) {
              console.warn('[ArenaRoom] Failed to broadcast kill_feed:', broadcastErr);
            }

            // Check if score limit reached
            if (shooter.kills >= this.state.scoreLimit) {
              this.endMatch(shooter);
            }
          }
        }
      } catch (dmgErr) {
        console.error('[ArenaRoom] Damage application error:', dmgErr);
      }
    } else if (process.env.NODE_ENV !== 'production') {
      console.log(`[Combat Diagnostic] MISS: Shot from ${shooter.nickname} (${client.sessionId}) did not hit any target.`);
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
    player.spawnX = spawn.x;
    player.spawnZ = spawn.z;
    player.lastMoveTime = 0; // Initialize so respawn movement is accepted smoothly
    player.health = GAME_CONSTANTS.MAX_HEALTH;
    player.ammo = GAME_CONSTANTS.MAGAZINE_SIZE;
    player.isAlive = true;
    player.isReloading = false;
    player.isReloadingInternal = false;

    // Grant temporary spawn protection shield
    player.isShielded = true;
    player.shieldExpiryTime = now + GAME_CONSTANTS.SPAWN_PROTECTION_MS;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Combat Diagnostic] Player ${player.nickname} (${client.sessionId}) respawned at (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}) with 100 HP`);
    }

    try {
      client.send('respawn_confirmed', {
        x: player.x,
        y: player.y,
        z: player.z,
        yaw: player.yaw,
      });
    } catch (e) {
      console.warn(`[ArenaRoom] Failed to send respawn_confirmed to client ${client.sessionId}:`, e);
    }
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
    this.lock();
    this.updateRoomMetadata();

    this.broadcast('match_over', {
      winnerId: winner.sessionId,
      winnerName: winner.nickname,
      kills: winner.kills,
    });
  }

  private endMatchByTime() {
    this.state.status = 'finished';
    this.lock();
    this.updateRoomMetadata();

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
