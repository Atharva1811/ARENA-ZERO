import http from 'http';
import express from 'express';
import cors from 'cors';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './src/rooms/ArenaRoom.js';
import { Client } from 'colyseus.js';
import { GAME_CONSTANTS } from '../shared/constants.js';
import type { WeaponTracerEvent, HitConfirmPayload, DamageReceivedPayload, KillFeedItem, SpawnConfirmedPayload } from '../shared/types.js';

const { Server } = colyseus;

async function runTwoClientShootingTest() {
  const port = 2589;
  const app = express();
  app.use(cors());
  const server = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server })
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

  await new Promise((r) => setTimeout(r, 100));

  // --- TEST CASE 1: Player A fires and MISSES Player B ---
  console.log('\n--- Test 1: Player A fires and misses Player B ---');
  roomA.send('fire', {
    shotId: 'shot_test_miss_001',
    originX: 0,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: 20,
    dirX: 1, // Shooting sideways into empty space
    dirY: 0,
    dirZ: 0,
  });

  await new Promise((r) => setTimeout(r, 150));

  console.log(`Client B received tracers: ${bReceivedTracers.length}`);
  if (bReceivedTracers.length === 0) throw new Error('Client B did not receive weapon_tracer for missed shot!');
  const missTracer = bReceivedTracers[0];
  console.log(`Miss tracer details: shooter=${missTracer.shooterId}, hitTarget=${missTracer.hitTarget}, shotId=${missTracer.shotId}`);
  if (missTracer.shooterId !== roomA.sessionId) throw new Error('Miss tracer shooterId does not match Player A!');
  if (missTracer.hitTarget !== false) throw new Error('Miss tracer hitTarget should be false!');
  if (!missTracer.shotId) throw new Error('Miss tracer missing shotId!');

  // Verify Player B took 0 damage
  const pBState1 = roomA.state.players.get(roomB.sessionId);
  if (pBState1?.health !== 100) throw new Error(`Player B health should be 100, got ${pBState1?.health}`);

  // --- TEST CASE 2: Player A fires and HITS Player B ---
  console.log('\n--- Test 2: Player A fires and hits Player B ---');
  bReceivedTracers = [];
  aHitConfirms = [];
  bDamageEvents = [];

  // Position Player A at (0, 0, 20) facing -Z, Player B at (0, 0, 17.5) (clear of bunker wall at 14.2-15.5)
  roomA.send('move', { x: 0, y: 0, z: 20, yaw: 0, pitch: 0, isMoving: false, isSprinting: false });
  roomB.send('move', { x: 0, y: 0, z: 17.5, yaw: Math.PI, pitch: 0, isMoving: false, isSprinting: false });

  await new Promise((r) => setTimeout(r, 100));

  roomA.send('fire', {
    shotId: 'shot_test_hit_002',
    originX: 0,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: 20,
    dirX: 0,
    dirY: 0,
    dirZ: -1, // Directed straight at Player B
    targetSessionId: roomB.sessionId,
  });

  await new Promise((r) => setTimeout(r, 150));

  console.log(`Client B received hit tracer: ${bReceivedTracers.length}`);
  console.log(`Client A received hit_confirm: ${aHitConfirms.length}`);
  console.log(`Client B received damage_received: ${bDamageEvents.length}`);

  if (bReceivedTracers.length === 0) throw new Error('Client B did not receive tracer for hit!');
  const hitTracer = bReceivedTracers[0];
  if (hitTracer.hitTarget !== true) throw new Error('Hit tracer hitTarget should be true!');
  if (aHitConfirms.length === 0) throw new Error('Shooter Player A did not receive hit_confirm!');
  if (bDamageEvents.length === 0) throw new Error('Target Player B did not receive damage_received!');
  if (aHitConfirms[0].remainingHealth >= 100) throw new Error('Target remaining health did not decrease!');

  // --- TEST CASE 3: Player B fires back at Player A ---
  console.log('\n--- Test 3: Player B fires back at Player A ---');
  aReceivedTracers = [];
  bHitConfirms = [];
  aDamageEvents = [];

  roomB.send('fire', {
    shotId: 'shot_test_return_003',
    originX: 0,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: 17.5,
    dirX: 0,
    dirY: 0,
    dirZ: 1, // Directed back at Player A
    targetSessionId: roomA.sessionId,
  });

  await new Promise((r) => setTimeout(r, 150));

  console.log(`Client A received return fire tracer: ${aReceivedTracers.length}`);
  console.log(`Client B received return hit_confirm: ${bHitConfirms.length}`);
  console.log(`Client A received return damage_received: ${aDamageEvents.length}`);

  if (aReceivedTracers.length === 0) throw new Error('Player A did not receive return tracer from Player B!');
  if (bHitConfirms.length === 0) throw new Error('Player B did not receive hit_confirm!');
  if (aDamageEvents.length === 0) throw new Error('Player A did not receive damage_received!');

  // --- TEST CASE 4: Wall Occlusion — Bunker wall blocks shot ---
  console.log('\n--- Test 4: Wall Occlusion — Solid bunker wall blocks shot ---');
  aHitConfirms = [];
  bDamageEvents = [];

  // Position Player A at (0, 0, 17.5) and Player B at (0, 0, 12.0) across bunker-south (z = 14.2 to 15.5)
  roomA.send('move', { x: 0, y: 0, z: 17.5, yaw: 0, pitch: 0, isMoving: false, isSprinting: false });
  roomB.send('move', { x: 0, y: 0, z: 12.0, yaw: Math.PI, pitch: 0, isMoving: false, isSprinting: false });

  await new Promise((r) => setTimeout(r, 100));

  const healthBeforeWallTest = roomA.state.players.get(roomB.sessionId)?.health || 0;

  roomA.send('fire', {
    shotId: 'shot_test_wall_004',
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

  // --- TEST CASE 5: Lethal Damage & Elimination Sequence ---
  console.log('\n--- Test 5: Lethal Damage & Elimination Sequence ---');
  aKillFeed = [];
  bKillFeed = [];

  // Move back into clear line of sight
  roomA.send('move', { x: 0, y: 0, z: 20, yaw: 0, pitch: 0, isMoving: false, isSprinting: false });
  roomB.send('move', { x: 0, y: 0, z: 17.5, yaw: Math.PI, pitch: 0, isMoving: false, isSprinting: false });
  await new Promise((r) => setTimeout(r, 100));

  // Fire until Player B is eliminated
  for (let i = 0; i < 4; i++) {
    const curHP = roomA.state.players.get(roomB.sessionId)?.health || 0;
    if (curHP <= 0) break;

    roomA.send('fire', {
      shotId: `shot_test_lethal_${i}`,
      originX: 0,
      originY: GAME_CONSTANTS.EYE_HEIGHT,
      originZ: 20,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
    });
    await new Promise((r) => setTimeout(r, 160)); // respect fire rate
  }

  const pBFinalState = roomA.state.players.get(roomB.sessionId);
  const pAFinalState = roomA.state.players.get(roomA.sessionId);

  console.log(`Elimination results: Player B HP=${pBFinalState?.health}, isAlive=${pBFinalState?.isAlive}, deaths=${pBFinalState?.deaths}`);
  console.log(`Killer Player A: kills=${pAFinalState?.kills}, score=${pAFinalState?.score}`);
  console.log(`Kill feed items received: A=${aKillFeed.length}, B=${bKillFeed.length}`);

  if (pBFinalState?.health !== 0) throw new Error(`Player B should have 0 health, got ${pBFinalState?.health}`);
  if (pBFinalState?.isAlive !== false) throw new Error('Player B isAlive should be false after elimination!');
  if (pBFinalState?.deaths !== 1) throw new Error(`Player B deaths should be 1, got ${pBFinalState?.deaths}`);
  if (pAFinalState?.kills !== 1) throw new Error(`Player A kills should be 1, got ${pAFinalState?.kills}`);
  if (pAFinalState?.score < 100) throw new Error(`Player A score should be at least 100, got ${pAFinalState?.score}`);
  if (aKillFeed.length === 0 || bKillFeed.length === 0) throw new Error('Both clients must receive kill_feed broadcast on elimination!');

  // --- TEST CASE 6: Dead Player Cannot Shoot ---
  console.log('\n--- Test 6: Dead Player Cannot Shoot ---');
  aDamageEvents = [];
  roomB.send('fire', {
    shotId: 'shot_test_dead_006',
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

  // --- TEST CASE 7: Respawn Flow ---
  console.log('\n--- Test 7: Respawn Flow ---');
  // Wait out the respawn timer (3000ms)
  console.log('Waiting for respawn timer (3.1s)...');
  await new Promise((r) => setTimeout(r, 3100));

  bRespawnEvents = [];
  roomB.send('respawn_request');
  await new Promise((r) => setTimeout(r, 200));

  console.log(`Player B respawn events received: ${bRespawnEvents.length}`);
  if (bRespawnEvents.length === 0) throw new Error('Player B did not receive respawn_confirmed!');
  const pBRespawnState = roomA.state.players.get(roomB.sessionId);
  console.log(`Player B after respawn: HP=${pBRespawnState?.health}, isAlive=${pBRespawnState?.isAlive}, ammo=${pBRespawnState?.ammo}`);
  if (pBRespawnState?.health !== 100) throw new Error('Player B health not restored to 100 on respawn!');
  if (pBRespawnState?.isAlive !== true) throw new Error('Player B isAlive not restored to true on respawn!');
  if (pBRespawnState?.ammo !== GAME_CONSTANTS.MAGAZINE_SIZE) throw new Error('Player B ammo not restored on respawn!');

  console.log('\n[SUCCESS] All two-client combat feedback, hit registration, elimination, and respawn tests PASSED!');

  await roomA.leave();
  await roomB.leave();
  await gameServer.gracefullyShutdown();
  process.exit(0);
}

runTwoClientShootingTest().catch((err) => {
  console.error('[FAILED]', err);
  process.exit(1);
});
