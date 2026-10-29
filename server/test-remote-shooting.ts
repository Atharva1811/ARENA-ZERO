import http from 'http';
import express from 'express';
import cors from 'cors';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './src/rooms/ArenaRoom.js';
import { Client } from 'colyseus.js';
import { GAME_CONSTANTS } from '../shared/constants.js';
import type { WeaponTracerEvent } from '../shared/types.js';

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
  let aHitConfirms: any[] = [];
  let bHitConfirms: any[] = [];
  let aDamageEvents: any[] = [];
  let bDamageEvents: any[] = [];

  roomA.onMessage('weapon_tracer', (data) => aReceivedTracers.push(data));
  roomB.onMessage('weapon_tracer', (data) => bReceivedTracers.push(data));

  roomA.onMessage('hit_confirm', (data) => aHitConfirms.push(data));
  roomB.onMessage('hit_confirm', (data) => bHitConfirms.push(data));

  roomA.onMessage('damage_received', (data) => aDamageEvents.push(data));
  roomB.onMessage('damage_received', (data) => bDamageEvents.push(data));

  await new Promise((r) => setTimeout(r, 100));

  // --- TEST CASE 1: Player A fires and MISSES Player B ---
  console.log('\n--- Test 1: Player A fires and misses Player B ---');
  roomA.send('fire', {
    originX: 0,
    originY: GAME_CONSTANTS.EYE_HEIGHT,
    originZ: 20,
    dirX: 1, // Shooting sideways into empty space / wall
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

  // Verify Player A didn't register this as an opponent event
  console.log(`Client A received tracers: ${aReceivedTracers.length}`);

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

  // --- TEST CASE 3: Player B fires back at Player A ---
  console.log('\n--- Test 3: Player B fires back at Player A ---');
  aReceivedTracers = [];
  bHitConfirms = [];
  aDamageEvents = [];

  roomB.send('fire', {
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

  console.log('\n[SUCCESS] All two-client combat feedback and hit registration tests PASSED!');

  await roomA.leave();
  await roomB.leave();
  await gameServer.gracefullyShutdown();
  process.exit(0);
}

runTwoClientShootingTest().catch((err) => {
  console.error('[FAILED]', err);
  process.exit(1);
});
