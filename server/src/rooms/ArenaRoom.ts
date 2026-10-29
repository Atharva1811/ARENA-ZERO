import colyseus from 'colyseus';
import type { Client } from 'colyseus';
const { Room, ServerError } = colyseus;
import { ArenaState } from './schema/ArenaState.js';
import { PlayerState } from './schema/PlayerState.js';
import { PrivateRoomRegistry } from './PrivateRoomRegistry.js';
import { GAME_CONSTANTS } from '../../../shared/constants.js';
import {
  getLineOfSightObstacle,
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

  const cylinderTop = centerY + height + 0.30; // Upper tolerance for head/slight upward aim
  const cylinderBottom = centerY - 0.15; // Lower tolerance for floor/steps

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
      roomCode: this.state.isPrivate ? this.state.roomCode : '',
      isPrivate: this.state.isPrivate,
      playerCount: this.clients.length,
      maxClients: this.maxClients,
      status: this.state.status,
    });
  }

  onCreate(options: JoinRoomOptions) {
    this.setState(new ArenaState());

    const isPrivateMatch = this.roomName === 'arena_private' || Boolean(options?.isPrivate);
    if (isPrivateMatch) {
      this.state.isPrivate = true;
      // Authoritatively allocate a unique 4-digit code (client cannot select arbitrary codes)
      const allocatedCode = PrivateRoomRegistry.instance.allocate(this);
      this.state.roomCode = allocatedCode;
      this.setPrivate(true); // Exclude private rooms from public matchmaking
    } else {
      this.state.isPrivate = false;
      this.state.roomCode = '';
      this.setPrivate(false);
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

    this.onMessage('toggle_fire_mode', (client, data: { mode?: string }) => {
      try {
        const player = this.state.players.get(client.sessionId);
        if (!player || !player.isAlive) return;
        if (data?.mode === 'SINGLE' || data?.mode === 'AUTO') {
          player.fireMode = data.mode;
        } else {
          player.fireMode = player.fireMode === 'AUTO' ? 'SINGLE' : 'AUTO';
        }
      } catch (err: any) {
        console.error(`[ArenaRoom] Error in toggle_fire_mode (client: ${client.sessionId}):`, err);
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

  public generateRoomCode(): string {
    return PrivateRoomRegistry.instance.generateCode();
  }

  onAuth(client: Client, options: JoinRoomOptions): boolean {
    if (this.state.isPrivate) {
      // 1. Initial room creator is admitted automatically upon room creation
      if (this.clients.length === 0) {
        return true;
      }

      // 2. Room capacity check (enforce ROOM_CAPACITY = 8)
      if (this.clients.length >= this.maxClients) {
        throw new ServerError(409, `Private room is full (${this.maxClients}/${this.maxClients}).`);
      }

      // 3. Match status check
      if (this.state.status === 'finished') {
        throw new ServerError(410, 'Match in this private room has already ended.');
      }

      // 4. Authoritative 4-digit room code validation
      const submittedCode = String(options?.roomCode || '').trim();
      if (!submittedCode || submittedCode !== this.state.roomCode) {
        const identifier = options?.clientToken || client.sessionId;
        PrivateRoomRegistry.instance.recordFailedAttempt(identifier);
        throw new ServerError(403, 'Invalid or missing private room code.');
      }

      const identifier = options?.clientToken || client.sessionId;
      PrivateRoomRegistry.instance.resetFailedAttempts(identifier);
    } else {
      // Public room validation
      if (this.clients.length >= this.maxClients) {
        throw new ServerError(409, 'Public arena is full.');
      }
      if (this.state.status === 'finished') {
        throw new ServerError(410, 'Match has already ended.');
      }
    }

    return true;
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
    if (this.state.isPrivate) {
      PrivateRoomRegistry.instance.release(this.roomId);
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

    if (isFirstMove) {
      // First client move packet: ensure it is close to authoritative spawn position (tolerance 3.5m)
      const distFromSpawn = Math.hypot(resolved.x - player.spawnX, resolved.z - player.spawnZ);
      if (distFromSpawn <= 3.5) {
        player.x = resolved.x;
        player.z = resolved.z;
      } else {
        // Discard uninitialized/stale client coordinates and enforce server authoritative spawn!
        player.x = player.spawnX;
        player.z = player.spawnZ;
      }
    } else if (movedDist <= maxAllowedDist) {
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

    // Server-authoritative sprint validation based on stamina
    if (data.isSprinting && player.isAlive && player.isMoving) {
      if (player.stamina <= 0) {
        player.isSprinting = false;
      } else if (!player.isSprinting && player.stamina < GAME_CONSTANTS.MIN_STAMINA_TO_SPRINT) {
        player.isSprinting = false;
      } else {
        player.isSprinting = true;
      }
    } else {
      player.isSprinting = false;
    }
  }

  private handlePlayerFire(client: Client, data: FireWeaponPayload) {
    const shotId = (data && data.shotId) || `shot_${client.sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Verify client existence and player alive state
    const shooter = this.state.players.get(client.sessionId);
    if (!shooter || !shooter.isAlive || this.state.status !== 'active') {
      console.log(`[CombatDiag:4/11 SERVER_FIRE_REQUEST_RECEIVED] shotId=${shotId} shooterId=${client.sessionId} REJECTED_STATE`);
      console.log(`[CombatDiag:5/11 SERVER_SHOT_VALIDATED] shotId=${shotId} shooterId=${client.sessionId} validation=REJECTED reason=${!shooter ? 'Shooter not found' : !shooter.isAlive ? 'Shooter is dead' : 'Match not active'}`);
      return;
    }

    // 2. Validate payload presence and types
    if (!data || typeof data !== 'object') {
      console.log(`[CombatDiag:5/11 SERVER_SHOT_VALIDATED] shotId=${shotId} shooterId=${client.sessionId} validation=REJECTED reason=Invalid payload`);
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
      console.log(`[CombatDiag:5/11 SERVER_SHOT_VALIDATED] shotId=${shotId} shooterId=${client.sessionId} validation=REJECTED reason=Non-finite coordinates`);
      return;
    }

    console.log(`[CombatDiag:4/11 SERVER_FIRE_REQUEST_RECEIVED] shotId=${shotId} shooterId=${client.sessionId} origin=(${data.originX.toFixed(2)}, ${data.originY.toFixed(2)}, ${data.originZ.toFixed(2)}) dir=(${data.dirX.toFixed(2)}, ${data.dirY.toFixed(2)}, ${data.dirZ.toFixed(2)}) claimedTarget=${data.targetSessionId || 'none'}`);

    // 3. Direction normalization & zero-vector check
    const len = Math.hypot(data.dirX, data.dirY, data.dirZ);
    if (len < 0.001 || !Number.isFinite(len)) {
      console.log(`[CombatDiag:5/11 SERVER_SHOT_VALIDATED] shotId=${shotId} shooterId=${client.sessionId} validation=REJECTED reason=Zero-length direction`);
      return;
    }
    const nx = data.dirX / len;
    const ny = data.dirY / len;
    const nz = data.dirZ / len;

    // 4. Rate-limit validation
    const now = Date.now();
    if (now - shooter.lastShootTime < GAME_CONSTANTS.FIRE_RATE_MS) {
      console.log(`[CombatDiag:5/11 SERVER_SHOT_VALIDATED] shotId=${shotId} shooterId=${client.sessionId} validation=REJECTED reason=Rate limit exceeded`);
      return;
    }

    // 5. Ammunition validation
    if (shooter.ammo <= 0 || shooter.isReloadingInternal) {
      console.log(`[CombatDiag:5/11 SERVER_SHOT_VALIDATED] shotId=${shotId} shooterId=${client.sessionId} ammoRemaining=${shooter.ammo} validation=REJECTED reason=Out of ammo or reloading`);
      return;
    }

    // 6. Authoritative shot origin calculation & reconciliation (Rule 5)
    const serverEyeY = shooter.y + GAME_CONSTANTS.EYE_HEIGHT;
    let authoritativeOriginX = shooter.x;
    let authoritativeOriginY = serverEyeY;
    let authoritativeOriginZ = shooter.z;

    const originDistSq = (data.originX - shooter.x) ** 2 + (data.originZ - shooter.z) ** 2;
    // If client origin is reasonably close (within 3.5m due to movement prediction/interpolation),
    // use client origin for smooth viewmodel alignment; otherwise fallback to authoritative server origin.
    // NEVER reject a valid shot just because of latency-induced position discrepancy.
    if (originDistSq <= 12.25) {
      authoritativeOriginX = data.originX;
      authoritativeOriginY = Number.isFinite(data.originY) ? data.originY : serverEyeY;
      authoritativeOriginZ = data.originZ;
    } else {
      console.log(`[CombatDiag:5/11 SERVER_SHOT_VALIDATED] shotId=${shotId} origin reconciled to authoritative server position (offset=${Math.sqrt(originDistSq).toFixed(2)}m)`);
    }

    // All validations passed: perform state changes
    shooter.lastShootTime = now;
    shooter.ammo = Math.max(0, shooter.ammo - 1);
    shooter.isFiring = true;
    shooter.isShielded = false; // Firing removes spawn protection

    // Automatic reload when magazine is emptied and reserve ammo is available
    if (shooter.ammo === 0 && shooter.reserveAmmo > 0 && !shooter.isReloadingInternal) {
      shooter.isReloading = true;
      shooter.isReloadingInternal = true;
      shooter.reloadExpiryTime = now + GAME_CONSTANTS.RELOAD_TIME_MS;
    }

    console.log(`[CombatDiag:5/11 SERVER_SHOT_VALIDATED] shotId=${shotId} shooterId=${client.sessionId} ammoRemaining=${shooter.ammo} validation=PASSED`);

    const maxRange = GAME_CONSTANTS.MAX_RANGE;
    let hitSomething = false;
    let hitX = authoritativeOriginX + nx * maxRange;
    let hitY = authoritativeOriginY + ny * maxRange;
    let hitZ = authoritativeOriginZ + nz * maxRange;

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

        // Generous, latency-compensated cylinder radius for reliable hit registration
        const isClientClaimedTarget = data.targetSessionId === targetSessionId;
        const targetRadius = isClientClaimedTarget ? 0.95 : 0.85;

        const hitResult = intersectRayCylinder(
          authoritativeOriginX,
          authoritativeOriginY,
          authoritativeOriginZ,
          nx,
          ny,
          nz,
          target.x,
          target.y,
          target.z,
          targetRadius,
          GAME_CONSTANTS.PLAYER_HEIGHT
        );

        if (hitResult.hit && hitResult.dist >= 0.1 && hitResult.dist < bestTargetDist) {
          // Check if ray is occluded by static arena obstacles
          const blockedBy = getLineOfSightObstacle(
            authoritativeOriginX,
            authoritativeOriginY,
            authoritativeOriginZ,
            hitResult.hitX,
            hitResult.hitY,
            hitResult.hitZ
          );

          if (!blockedBy) {
            hitTargetSessionId = targetSessionId;
            bestTargetDist = hitResult.dist;
            hitSomething = true;
            hitX = hitResult.hitX;
            hitY = hitResult.hitY;
            hitZ = hitResult.hitZ;
            isHeadshot = hitResult.isHeadshot;
          } else {
            console.log(`[CombatDiag:6/11 SERVER_RAYCAST_RESULT] shotId=${shotId} shooterId=${client.sessionId} target=${targetSessionId} BLOCKED_BY_OBSTACLE=${blockedBy}`);
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
          authoritativeOriginX,
          authoritativeOriginY,
          authoritativeOriginZ,
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

    console.log(`[CombatDiag:6/11 SERVER_RAYCAST_RESULT] shotId=${shotId} shooterId=${client.sessionId} hitTarget=${hitTargetSessionId || 'none'} hitDist=${hitTargetSessionId ? bestTargetDist.toFixed(2) + 'm' : 'N/A'} hitPos=(${hitX.toFixed(2)}, ${hitY.toFixed(2)}, ${hitZ.toFixed(2)}) headshot=${isHeadshot}`);

    // 8. Broadcast weapon tracer to all players
    try {
      const tracerEvent: WeaponTracerEvent = {
        shotId,
        shooterId: client.sessionId,
        startX: authoritativeOriginX,
        startY: authoritativeOriginY,
        startZ: authoritativeOriginZ,
        endX: Number.isFinite(hitX) ? hitX : authoritativeOriginX,
        endY: Number.isFinite(hitY) ? hitY : authoritativeOriginY,
        endZ: Number.isFinite(hitZ) ? hitZ : authoritativeOriginZ,
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
          bestTarget.lastDamageTime = now; // Armour damage restarts 4-second regen delay
          const healthBefore = bestTarget.health;
          const damage = isHeadshot ? GAME_CONSTANTS.HEADSHOT_DAMAGE : GAME_CONSTANTS.WEAPON_DAMAGE;
          bestTarget.health = Math.max(0, bestTarget.health - damage);
          const healthAfter = bestTarget.health;

          console.log(`[CombatDiag:7/11 SERVER_DAMAGE_APPLIED] shotId=${shotId} shooterId=${client.sessionId} targetId=${bestTarget.sessionId} damage=${damage} headshot=${isHeadshot} hpBefore=${healthBefore} hpAfter=${healthAfter}`);
          console.log(`[CombatDiag:8/11 TARGET_HEALTH_UPDATED] shotId=${shotId} targetId=${bestTarget.sessionId} newHP=${bestTarget.health} isAlive=${bestTarget.isAlive}`);

          // Send hit confirmation to shooter
          try {
            client.send('hit_confirm', {
              shotId,
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
                shotId,
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

          // Check for elimination (strictly once per death)
          if (bestTarget.health <= 0 && bestTarget.isAlive) {
            bestTarget.health = 0;
            bestTarget.isAlive = false;
            bestTarget.deaths++;
            bestTarget.respawnTime = now + GAME_CONSTANTS.RESPAWN_TIME_MS;

            shooter.kills++;
            shooter.score += 100;

            console.log(`[CombatDiag:10/11 TARGET_DEATH_AND_RESPAWN] ELIMINATION: victimId=${bestTarget.sessionId} killerId=${client.sessionId} respawnTimeMs=${bestTarget.respawnTime}`);
            console.log(`[CombatDiag:11/11 SHOOTER_SCORE_UPDATED] shooterId=${client.sessionId} kills=${shooter.kills} score=${shooter.score} leaderId=${this.state.leaderId} leaderScore=${this.state.leaderScore}`);

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
    }
  }

  private handlePlayerReload(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isAlive || player.isReloadingInternal || player.ammo >= GAME_CONSTANTS.MAGAZINE_SIZE || player.reserveAmmo <= 0) {
      return;
    }

    player.isReloading = true;
    player.isReloadingInternal = true;
    player.reloadExpiryTime = Date.now() + GAME_CONSTANTS.RELOAD_TIME_MS;
  }

  private executePlayerRespawn(player: PlayerState) {
    if (!player || player.isAlive) return;

    const now = Date.now();
    const spawn = this.getSafestSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.yaw = spawn.yaw;
    player.spawnX = spawn.x;
    player.spawnZ = spawn.z;
    player.lastMoveTime = 0; // Initialize so respawn movement is accepted smoothly
    player.health = GAME_CONSTANTS.MAX_HEALTH;
    player.maxHealth = GAME_CONSTANTS.MAX_HEALTH;
    player.ammo = GAME_CONSTANTS.MAGAZINE_SIZE;
    player.reserveAmmo = GAME_CONSTANTS.MAX_RESERVE_AMMO;
    player.stamina = GAME_CONSTANTS.MAX_STAMINA;
    player.maxStamina = GAME_CONSTANTS.MAX_STAMINA;
    player.isSprinting = false;
    player.isAlive = true;
    player.isReloading = false;
    player.isReloadingInternal = false;
    player.respawnTime = 0;
    player.lastDamageTime = now; // Reset armour regen delay timer
    player.lastSprintTime = 0;

    // Grant temporary spawn protection shield
    player.isShielded = true;
    player.shieldExpiryTime = now + GAME_CONSTANTS.SPAWN_PROTECTION_MS;

    console.log(`[CombatDiag:10/11 TARGET_DEATH_AND_RESPAWN] RESPAWN_EXECUTED: sessionId=${player.sessionId} nickname=${player.nickname} pos=(${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)})`);

    const client = this.clients.find((c) => c.sessionId === player.sessionId);
    if (client) {
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
  }

  private handleRespawnRequest(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isAlive) return;

    const now = Date.now();
    // Allow a small 150ms network/clock tolerance buffer so client requests aren't dropped prematurely
    if (now < player.respawnTime - 150) return;

    this.executePlayerRespawn(player);
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

  private update(deltaTime: number) {
    const now = Date.now();

    this.state.players.forEach((player) => {
      // 1. Automatic respawn execution when respawn cooldown timer expires
      if (!player.isAlive && player.respawnTime > 0 && now >= player.respawnTime) {
        this.executePlayerRespawn(player);
      }

      // 2. Gradual Armour Integrity Regeneration
      // When armour integrity drops below 100%, wait 4s after last damage.
      // Once delay expires, regenerate armour gradually until exactly 100%.
      if (player.isAlive && player.health < player.maxHealth) {
        if (now - player.lastDamageTime >= GAME_CONSTANTS.ARMOUR_REGEN_DELAY_MS) {
          const dtSeconds = Math.max(0.001, Math.min(0.2, (deltaTime || 50) / 1000));
          const regenAmount = GAME_CONSTANTS.ARMOUR_REGEN_PER_SECOND * dtSeconds;
          player.health = Math.min(player.maxHealth, player.health + regenAmount);
        }
      }

      // 2b. Tactical Stamina Simulation
      if (player.isAlive) {
        const dtSeconds = Math.max(0.001, Math.min(0.2, (deltaTime || 50) / 1000));
        if (player.isSprinting && player.isMoving) {
          player.stamina = Math.max(0, player.stamina - GAME_CONSTANTS.SPRINT_STAMINA_DRAIN_PER_SECOND * dtSeconds);
          player.lastSprintTime = now;
          if (player.stamina <= 0) {
            player.isSprinting = false;
          }
        } else {
          if (now - player.lastSprintTime >= GAME_CONSTANTS.STAMINA_REGEN_DELAY_MS) {
            player.stamina = Math.min(player.maxStamina, player.stamina + GAME_CONSTANTS.STAMINA_REGEN_PER_SECOND * dtSeconds);
          }
        }
      } else {
        player.isSprinting = false;
        player.stamina = player.maxStamina;
      }

      // 3. Check expiry for spawn shields and reloads
      if (player.isShielded && now >= player.shieldExpiryTime) {
        player.isShielded = false;
      }

      if (player.isReloadingInternal && now >= player.reloadExpiryTime) {
        const needed = GAME_CONSTANTS.MAGAZINE_SIZE - player.ammo;
        const transferred = Math.min(needed, player.reserveAmmo);
        player.ammo += transferred;
        player.reserveAmmo -= transferred;
        player.isReloading = false;
        player.isReloadingInternal = false;
      }

      // 4. Reset firing visual state
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
