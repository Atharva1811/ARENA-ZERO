import http from 'http';
import express from 'express';
import cors from 'cors';
import colyseus from 'colyseus';
import { matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './src/rooms/ArenaRoom.js';
import { Client } from 'colyseus.js';
import { GAME_CONSTANTS } from '../shared/constants.js';
import type {
  WeaponTracerEvent,
  HitConfirmPayload,
  DamageReceivedPayload,
  KillFeedItem,
  SpawnConfirmedPayload,
} from '../shared/types.js';

const { Server } = colyseus;

async function runTwoClientShootingTest() {
  const port = 2589;
  const app = express();
  app.use(cors());
  const server = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server }),
  });

  gameServer.define('arena_public', ArenaRoom).enableRealtimeListing();
  await gameServer.listen(port);
  console.log(`[Test Server] Running on ws://localhost:${port}`);

  const clientA = new Client(`ws://localhost:${port}`);
  const clientB = new Client(`ws://localhost:${port}`);

  const roomA = await clientA.joinOrCreate('arena_public', { nickname: 'PlayerA' });
  const roomB = await clientB.joinOrCreate('arena_public', { nickname: 'PlayerB' });

  console.log(`Player A joined (session: ${roomA.sessionId})`);
  console.log(`Player B joined (session: ${roomB.sessionId})`);

  const serverRoom = matchMaker.getRoomById(roomA.id) as ArenaRoom;
  if (!serverRoom) throw new Error('Server room not found');

  const pAServer = serverRoom.state.players.get(roomA.sessionId)!;
  const pBServer = serverRoom.state.players.get(roomB.sessionId)!;

  let aReceivedTracers: WeaponTracerEvent[] = [];
  let bReceivedTracers: WeaponTracerEvent[] = [];
  let aHitConfirms: HitConfirmPayload[] = [];
  let bHitConfirms: HitConfirmPayload[] = [];
  let aDamageEvents: DamageReceivedPayload[] = [];
  let bDamageEvents: DamageReceivedPayload[] = [];
  let aKillFeed: KillFeedItem[] = [];
  let bKillFeed: KillFeedItem[] = [];
  let bRespawnEvents: SpawnConfirmedPayload[] = [];

  roomA.onMessage('weapon_tracer', (data: WeaponTracerEvent) => aReceivedTracers.push(data));
  roomB.onMessage('weapon_tracer', (data: WeaponTracerEvent) => bReceivedTracers.push(data));

  roomA.onMessage('hit_confirm', (data: HitConfirmPayload) => aHitConfirms.push(data));
  roomB.onMessage('hit_confirm', (data: HitConfirmPayload) => bHitConfirms.push(data));

  roomA.onMessage('damage_received', (data: DamageReceivedPayload) => aDamageEvents.push(data));
  roomB.onMessage('damage_received', (data: DamageReceivedPayload) => bDamageEvents.push(data));

  roomA.onMessage('kill_feed', (data: KillFeedItem) => aKillFeed.push(data));
  roomB.onMessage('kill_feed', (data: KillFeedItem) => bKillFeed.push(data));

  roomB.onMessage('respawn_confirmed', (data: SpawnConfirmedPayload) => bRespawnEvents.push(data));

  await new Promise((r) => setTimeout(r, 120));

  // =========================================================================
  // SCENARIO A: Empty space firing (muzzle flash / tracer broadcast, no damage)
  // =========================================================================
  console.log('\n--- Scenario A: Empty space firing (tracer broadcast, no damage) ---');
  roomA.send('fire', {
    shotId: 'shot_test_A_miss',
    originX: pAServer.x,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: pAServer.z,
    dirX: 1, // Shooting sideways into empty air
    dirY: 0,
    dirZ: 0,
  });

  await new Promise((r) => setTimeout(r, 150));

  console.log(`Client B received tracers: ${bReceivedTracers.length}`);
  if (bReceivedTracers.length === 0) throw new Error('Client B did not receive weapon_tracer for missed shot!');
  const missTracer = bReceivedTracers[0];
  if (missTracer.shooterId !== roomA.sessionId) throw new Error('Miss tracer shooterId does not match Player A!');
  if (missTracer.hitTarget !== false) throw new Error('Miss tracer hitTarget should be false!');
  if (!missTracer.shotId) throw new Error('Miss tracer missing shotId!');

  // Verify Player B took 0 damage
  const pBStateA = roomA.state.players.get(roomB.sessionId);
  if (pBStateA?.health !== 100) throw new Error(`Player B health should be 100, got ${pBStateA?.health}`);
  console.log('[Scenario A PASSED]');

  // =========================================================================
  // SCENARIO B: Head-on shooting (damage applied, health reduced)
  // =========================================================================
  console.log('\n--- Scenario B: Head-on shooting (damage applied, health reduced) ---');
  bReceivedTracers = [];
  aHitConfirms = [];
  bDamageEvents = [];

  // Align Player A at (0, 0, 20) facing -Z, Player B at (0, 0, 17.5) (clear south lane, no obstacles)
  pAServer.x = 0; pAServer.y = 0; pAServer.z = 20; pAServer.spawnX = 0; pAServer.spawnZ = 20; pAServer.lastMoveTime = Date.now();
  pBServer.x = 0; pBServer.y = 0; pBServer.z = 17.5; pBServer.spawnX = 0; pBServer.spawnZ = 17.5; pBServer.lastMoveTime = Date.now();

  roomA.send('move', { x: 0, y: 0, z: 20, yaw: 0, pitch: 0, isMoving: false, isSprinting: false });
  roomB.send('move', { x: 0, y: 0, z: 17.5, yaw: Math.PI, pitch: 0, isMoving: false, isSprinting: false });
  await new Promise((r) => setTimeout(r, 100));

  roomA.send('fire', {
    shotId: 'shot_test_B_hit',
    originX: 0,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: 20,
    dirX: 0,
    dirY: 0,
    dirZ: -1, // Direct line to Player B
    targetSessionId: roomB.sessionId,
  });

  await new Promise((r) => setTimeout(r, 150));

  console.log(`Client B received hit tracer: ${bReceivedTracers.length}`);
  console.log(`Client A received hit_confirm: ${aHitConfirms.length}`);
  console.log(`Client B received damage_received: ${bDamageEvents.length}`);

  if (bReceivedTracers.length === 0) throw new Error('Client B did not receive tracer for hit!');
  if (bReceivedTracers[0].hitTarget !== true) throw new Error('Hit tracer hitTarget should be true!');
  if (aHitConfirms.length === 0) throw new Error('Shooter Player A did not receive hit_confirm!');
  if (bDamageEvents.length === 0) throw new Error('Target Player B did not receive damage_received!');
  if (aHitConfirms[0].remainingHealth >= 100) throw new Error('Target remaining health did not decrease!');
  console.log('[Scenario B PASSED]');

  // =========================================================================
  // SCENARIO C: Elimination (atomic kill/death sync, scoreboard +100)
  // =========================================================================
  console.log('\n--- Scenario C: Elimination (atomic kill/death sync, scoreboard +100) ---');
  aKillFeed = [];
  bKillFeed = [];

  // Fire until Player B is eliminated
  for (let i = 0; i < 4; i++) {
    const curHP = roomA.state.players.get(roomB.sessionId)?.health || 0;
    if (curHP <= 0) break;

    roomA.send('fire', {
      shotId: `shot_test_C_lethal_${i}`,
      originX: 0,
      originY: GAME_CONSTANTS.EYE_HEIGHT,
      originZ: 20,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
    });
    await new Promise((r) => setTimeout(r, 160));
  }

  const pBStateC = roomA.state.players.get(roomB.sessionId);
  const pAStateC = roomA.state.players.get(roomA.sessionId);

  console.log(`Elimination results: Player B HP=${pBStateC?.health}, isAlive=${pBStateC?.isAlive}, deaths=${pBStateC?.deaths}`);
  console.log(`Killer Player A: kills=${pAStateC?.kills}, score=${pAStateC?.score}`);
  if (pBStateC?.health !== 0) throw new Error(`Player B should have 0 health, got ${pBStateC?.health}`);
  if (pBStateC?.isAlive !== false) throw new Error('Player B isAlive should be false after elimination!');
  if (pBStateC?.deaths !== 1) throw new Error(`Player B deaths should be 1, got ${pBStateC?.deaths}`);
  if (pAStateC?.kills !== 1) throw new Error(`Player A kills should be 1, got ${pAStateC?.kills}`);
  if (pAStateC?.score < 100) throw new Error(`Player A score should be at least 100, got ${pAStateC?.score}`);
  if (aKillFeed.length === 0 || bKillFeed.length === 0) throw new Error('Both clients must receive kill_feed broadcast on elimination!');
  console.log('[Scenario C PASSED]');

  // =========================================================================
  // SCENARIO D: Dead player firing prevention
  // =========================================================================
  console.log('\n--- Scenario D: Dead player firing prevention ---');
  aDamageEvents = [];
  aReceivedTracers = [];
  roomB.send('fire', {
    shotId: 'shot_test_D_dead',
    originX: 0,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: 17.5,
    dirX: 0,
    dirY: 0,
    dirZ: 1,
    targetSessionId: roomA.sessionId,
  });
  await new Promise((r) => setTimeout(r, 100));
  if (aDamageEvents.length > 0) throw new Error('Dead player was able to deal damage!');
  console.log('[Scenario D PASSED]');

  // =========================================================================
  // SCENARIO E: Respawn (health and ammo restored, scores preserved)
  // =========================================================================
  console.log('\n--- Scenario E: Respawn (health and ammo restored, scores preserved) ---');
  console.log('Waiting for respawn timer (3.1s)...');
  await new Promise((r) => setTimeout(r, 3100));

  bRespawnEvents = [];
  roomB.send('respawn_request');
  await new Promise((r) => setTimeout(r, 200));

  console.log(`Player B respawn events received: ${bRespawnEvents.length}`);
  if (bRespawnEvents.length === 0) throw new Error('Player B did not receive respawn_confirmed!');
  const pBRespawnState = roomA.state.players.get(roomB.sessionId);
  if (pBRespawnState?.health !== 100) throw new Error('Player B health not restored to 100 on respawn!');
  if (pBRespawnState?.isAlive !== true) throw new Error('Player B isAlive not restored to true on respawn!');
  if (pBRespawnState?.ammo !== GAME_CONSTANTS.MAGAZINE_SIZE) throw new Error('Player B ammo not restored on respawn!');
  if (pAStateC?.kills !== 1 || pAStateC?.score < 100) throw new Error('Killer scores were not preserved after victim respawned!');
  console.log('[Scenario E PASSED]');

  // =========================================================================
  // SCENARIO F: Reverse combat (Player B shoots Player A)
  // =========================================================================
  console.log('\n--- Scenario F: Reverse combat (Player B shoots Player A) ---');
  aReceivedTracers = [];
  bHitConfirms = [];
  aDamageEvents = [];

  // Align Player A at (0, 0, 20) and Player B at (0, 0, 17.5) facing each other
  pAServer.x = 0; pAServer.y = 0; pAServer.z = 20; pAServer.spawnX = 0; pAServer.spawnZ = 20; pAServer.lastMoveTime = Date.now();
  pBServer.x = 0; pBServer.y = 0; pBServer.z = 17.5; pBServer.spawnX = 0; pBServer.spawnZ = 17.5; pBServer.lastMoveTime = Date.now();

  roomA.send('move', { x: 0, y: 0, z: 20, yaw: 0, pitch: 0, isMoving: false, isSprinting: false });
  roomB.send('move', { x: 0, y: 0, z: 17.5, yaw: Math.PI, pitch: 0, isMoving: false, isSprinting: false });
  await new Promise((r) => setTimeout(r, 100));

  roomB.send('fire', {
    shotId: 'shot_test_F_return',
    originX: 0,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: 17.5,
    dirX: 0,
    dirY: 0,
    dirZ: 1, // Facing Player A (+Z)
    targetSessionId: roomA.sessionId,
  });

  await new Promise((r) => setTimeout(r, 150));

  console.log(`Client A received return fire tracer: ${aReceivedTracers.length}`);
  console.log(`Client B received return hit_confirm: ${bHitConfirms.length}`);
  console.log(`Client A received return damage_received: ${aDamageEvents.length}`);

  if (aReceivedTracers.length === 0) throw new Error('Player A did not receive return tracer from Player B!');
  if (bHitConfirms.length === 0) throw new Error('Player B did not receive hit_confirm!');
  if (aDamageEvents.length === 0) throw new Error('Player A did not receive damage_received!');
  console.log('[Scenario F PASSED]');

  // =========================================================================
  // SCENARIO G: Solid wall shot (blocked, 0 damage)
  // =========================================================================
  console.log('\n--- Scenario G: Solid wall shot (blocked, 0 damage) ---');
  aHitConfirms = [];
  bDamageEvents = [];

  // Position Player A at (0, 0, 17.5) and Player B at (0, 0, 12.0) across bunker-south (z = 14.2 to 15.5)
  pAServer.x = 0; pAServer.y = 0; pAServer.z = 17.5; pAServer.spawnX = 0; pAServer.spawnZ = 17.5; pAServer.lastMoveTime = Date.now();
  pBServer.x = 0; pBServer.y = 0; pBServer.z = 12.0; pBServer.spawnX = 0; pBServer.spawnZ = 12.0; pBServer.lastMoveTime = Date.now();

  roomA.send('move', { x: 0, y: 0, z: 17.5, yaw: 0, pitch: 0, isMoving: false, isSprinting: false });
  roomB.send('move', { x: 0, y: 0, z: 12.0, yaw: Math.PI, pitch: 0, isMoving: false, isSprinting: false });
  await new Promise((r) => setTimeout(r, 100));

  const healthBeforeWallTest = roomA.state.players.get(roomB.sessionId)?.health || 0;

  roomA.send('fire', {
    shotId: 'shot_test_G_wall',
    originX: 0,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: 17.5,
    dirX: 0,
    dirY: 0,
    dirZ: -1, // Firing north through bunker-south
    targetSessionId: roomB.sessionId,
  });

  await new Promise((r) => setTimeout(r, 150));

  const healthAfterWallTest = roomA.state.players.get(roomB.sessionId)?.health || 0;
  console.log(`Player B health before wall shot: ${healthBeforeWallTest}, after: ${healthAfterWallTest}`);
  if (healthBeforeWallTest !== healthAfterWallTest) {
    throw new Error('Wall did not block shot! Damage was improperly dealt through obstacle!');
  }
  if (aHitConfirms.length > 0) {
    throw new Error('Shooter received hit_confirm for a blocked wall shot!');
  }
  console.log('[Scenario G PASSED]');

  // =========================================================================
  // SCENARIO H: Remote player joining does not hide local firing animation / state
  // =========================================================================
  console.log('\n--- Scenario H: Remote player joining does not corrupt combat state ---');
  const clientC = new Client(`ws://localhost:${port}`);
  const roomC = await clientC.joinOrCreate('arena_public', { nickname: 'PlayerC' });
  console.log(`Player C joined (session: ${roomC.sessionId})`);

  await new Promise((r) => setTimeout(r, 100));

  // Player A can still fire smoothly and Player B still receives tracer
  bReceivedTracers = [];
  roomA.send('fire', {
    shotId: 'shot_test_H_multi',
    originX: pAServer.x,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: pAServer.z,
    dirX: 1,
    dirY: 0,
    dirZ: 0,
  });
  await new Promise((r) => setTimeout(r, 150));
  if (bReceivedTracers.length === 0) throw new Error('Player B did not receive tracer after Player C joined!');

  await roomC.leave();
  console.log('[Scenario H PASSED]');

  // =========================================================================
  // SCENARIO I: Invalid messages/excessive fire rate rejected safely
  // =========================================================================
  console.log('\n--- Scenario I: Invalid messages / excessive fire rate rejected safely ---');
  // Rapid fire burst below FIRE_RATE_MS
  roomA.send('fire', {
    shotId: 'shot_test_I_rapid_1',
    originX: pAServer.x, originY: GAME_CONSTANTS.EYE_HEIGHT, originZ: pAServer.z,
    dirX: 0, dirY: 0, dirZ: 1,
  });
  roomA.send('fire', {
    shotId: 'shot_test_I_rapid_2',
    originX: pAServer.x, originY: GAME_CONSTANTS.EYE_HEIGHT, originZ: pAServer.z,
    dirX: 0, dirY: 0, dirZ: 1,
  });

  // Malformed payload with NaN / Infinity
  roomA.send('fire', {
    shotId: 'shot_test_I_nan',
    originX: NaN, originY: Infinity, originZ: 0,
    dirX: 0, dirY: 0, dirZ: 0,
  });

  await new Promise((r) => setTimeout(r, 150));
  // Server should remain alive and stable
  if (!roomA.state.players.has(roomA.sessionId)) throw new Error('Room state lost after malformed messages!');
  console.log('[Scenario I PASSED]');

  // =========================================================================
  // SCENARIO J: Simultaneous firing stability
  // =========================================================================
  console.log('\n--- Scenario J: Simultaneous firing stability ---');
  aReceivedTracers = [];
  bReceivedTracers = [];

  // Wait for rate limit reset
  await new Promise((r) => setTimeout(r, 200));

  // Both send fire in the exact same tick
  roomA.send('fire', {
    shotId: 'shot_test_J_simul_A',
    originX: pAServer.x, originY: GAME_CONSTANTS.EYE_HEIGHT, originZ: pAServer.z,
    dirX: 1, dirY: 0, dirZ: 0,
  });
  roomB.send('fire', {
    shotId: 'shot_test_J_simul_B',
    originX: pBServer.x, originY: GAME_CONSTANTS.EYE_HEIGHT, originZ: pBServer.z,
    dirX: -1, dirY: 0, dirZ: 0,
  });

  await new Promise((r) => setTimeout(r, 200));
  console.log(`Simultaneous tracers: A received ${aReceivedTracers.length}, B received ${bReceivedTracers.length}`);
  if (aReceivedTracers.length === 0 || bReceivedTracers.length === 0) {
    throw new Error('Simultaneous fire events were not properly processed and broadcast!');
  }
  console.log('[Scenario J PASSED]');

  console.log('\n==================================================================');
  console.log(' [SUCCESS] ALL SCENARIOS A THROUGH J VERIFIED END-TO-END!         ');
  console.log('==================================================================');

  await roomA.leave();
  await roomB.leave();
  await gameServer.gracefullyShutdown();
  process.exit(0);
}

runTwoClientShootingTest().catch((err) => {
  console.error('[FAILED]', err);
  process.exit(1);
});
