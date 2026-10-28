import http from 'http';
import express from 'express';
import cors from 'cors';
import colyseus from 'colyseus';
import { matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './src/rooms/ArenaRoom.js';
import { Client } from 'colyseus.js';

const { Server } = colyseus;

async function runAll12Tests() {
  const port = 2581;
  const app = express();
  app.use(cors());
  const server = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server })
  });

  gameServer.define('arena_public', ArenaRoom);
  await gameServer.listen(port);
  console.log(`[Test Server] Running on ws://localhost:${port}`);

  let serverCrashOccurred = false;
  process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught exception on server process:', err);
    serverCrashOccurred = true;
  });

  const results: { id: number; name: string; passed: boolean; details?: string }[] = [];

  function getServerRoom(roomId: string): ArenaRoom {
    const room = matchMaker.getRoomById(roomId) as ArenaRoom;
    if (!room) throw new Error(`Room ${roomId} not found in matchMaker`);
    return room;
  }

  async function connectPlayer(nickname: string) {
    const client = new Client(`ws://localhost:${port}`);
    const room = await client.joinOrCreate('arena_public', { nickname });
    return { client, room };
  }

  // -------------------------------------------------------------------------
  // Test 1: Valid shot with no target
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 1: Valid shot with no target');
  try {
    const { client: _client, room } = await connectPlayer('Test1_Shooter');
    const serverRoom = getServerRoom(room.id);
    const p = serverRoom.state.players.get(room.sessionId)!;

    let tracerReceived = false;
    room.onMessage('weapon_tracer', () => {
      tracerReceived = true;
    });

    // Fire from player's exact coordinates
    room.send('fire', {
      originX: p.x, originY: p.y + 1.65, originZ: p.z,
      dirX: 0, dirY: 0, dirZ: -1
    });

    await new Promise(r => setTimeout(r, 200));
    const passed = room.connection.isOpen && tracerReceived;
    results.push({
      id: 1,
      name: 'Valid shot with no target',
      passed,
      details: passed ? 'Shot accepted and tracer broadcast without target' : 'Tracer not received or room disconnected'
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 1, name: 'Valid shot with no target', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 2: Valid shot hitting another player
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 2: Valid shot hitting another player');
  try {
    const { room: shooterRoom } = await connectPlayer('Test2_Shooter');
    const { room: targetRoom } = await connectPlayer('Test2_Target');

    const serverRoom = getServerRoom(shooterRoom.id);
    const shooterState = serverRoom.state.players.get(shooterRoom.sessionId)!;
    const targetState = serverRoom.state.players.get(targetRoom.sessionId)!;

    // Position shooter at (5, 0, 5) and target at (5, 0, 2) in unobstructed open zone
    shooterState.x = 5; shooterState.y = 0; shooterState.z = 5; shooterState.isShielded = false;
    targetState.x = 5; targetState.y = 0; targetState.z = 2; targetState.isShielded = false;

    let hitConfirmReceived = false;
    let damageReceived = false;
    shooterRoom.onMessage('hit_confirm', () => {
      hitConfirmReceived = true;
    });
    targetRoom.onMessage('damage_received', () => {
      damageReceived = true;
    });

    shooterRoom.send('fire', {
      originX: 5, originY: 1.65, originZ: 5,
      dirX: 0, dirY: 0, dirZ: -1,
      targetSessionId: targetRoom.sessionId
    });

    await new Promise(r => setTimeout(r, 300));
    const passed = shooterRoom.connection.isOpen && targetRoom.connection.isOpen && hitConfirmReceived && damageReceived && targetState.health < 100;
    results.push({
      id: 2,
      name: 'Valid shot hitting another player',
      passed,
      details: passed ? `Hit confirmed, target health reduced to ${targetState.health}` : `Hit confirmation failed`
    });
    shooterRoom.leave();
    targetRoom.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 2, name: 'Valid shot hitting another player', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 3: Invalid or missing payload
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 3: Invalid or missing payload');
  try {
    const { room } = await connectPlayer('Test3_Player');

    // Send null, undefined, empty object, string, array payloads
    room.send('fire', null as any);
    room.send('fire', undefined as any);
    room.send('fire', {} as any);
    room.send('fire', 'not_a_payload' as any);
    room.send('fire', [1, 2, 3] as any);

    await new Promise(r => setTimeout(r, 200));
    const passed = room.connection.isOpen && !serverCrashOccurred;
    results.push({
      id: 3,
      name: 'Invalid or missing payload',
      passed,
      details: passed ? 'All malformed payloads safely rejected without crashing room or server' : 'Room disconnected'
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 3, name: 'Invalid or missing payload', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 4: NaN and infinite coordinates
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 4: NaN and infinite coordinates');
  try {
    const { room } = await connectPlayer('Test4_Player');

    room.send('fire', {
      originX: NaN, originY: NaN, originZ: NaN,
      dirX: NaN, dirY: NaN, dirZ: NaN
    });
    room.send('fire', {
      originX: Infinity, originY: -Infinity, originZ: 0,
      dirX: 0, dirY: 0, dirZ: 1
    });
    room.send('fire', {
      originX: 0, originY: 1.65, originZ: 0,
      dirX: 0, dirY: 0, dirZ: 0 // zero direction vector
    });

    await new Promise(r => setTimeout(r, 200));
    const passed = room.connection.isOpen && !serverCrashOccurred;
    results.push({
      id: 4,
      name: 'NaN and infinite coordinates',
      passed,
      details: passed ? 'NaN/Infinity/zero coordinates guarded and rejected safely' : 'Failed on non-finite input'
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 4, name: 'NaN and infinite coordinates', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 5: Shooting while dead
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 5: Shooting while dead');
  try {
    const { room } = await connectPlayer('Test5_DeadPlayer');
    const serverRoom = getServerRoom(room.id);
    const p = serverRoom.state.players.get(room.sessionId)!;
    p.isAlive = false;

    let tracerReceived = false;
    room.onMessage('weapon_tracer', () => { tracerReceived = true; });

    room.send('fire', {
      originX: p.x, originY: p.y + 1.65, originZ: p.z,
      dirX: 0, dirY: 0, dirZ: 1
    });

    await new Promise(r => setTimeout(r, 200));
    const passed = room.connection.isOpen && !tracerReceived;
    results.push({
      id: 5,
      name: 'Shooting while dead',
      passed,
      details: passed ? 'Dead player shot ignored without error' : 'Dead player was permitted to shoot'
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 5, name: 'Shooting while dead', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 6: Shooting after disconnect
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 6: Shooting after disconnect');
  try {
    const { room } = await connectPlayer('Test6_Disconnect');
    room.leave(); // disconnect client

    try {
      room.send('fire', {
        originX: 0, originY: 1.65, originZ: 0,
        dirX: 0, dirY: 0, dirZ: 1
      });
    } catch {}

    await new Promise(r => setTimeout(r, 200));
    const passed = !serverCrashOccurred;
    results.push({
      id: 6,
      name: 'Shooting after disconnect',
      passed,
      details: passed ? 'Post-disconnect firing safely handled' : 'Server crashed on disconnected fire'
    });
  } catch (err: any) {
    results.push({ id: 6, name: 'Shooting after disconnect', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 7: Fire-rate violations
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 7: Fire-rate violations');
  try {
    const { room } = await connectPlayer('Test7_Spammer');
    const serverRoom = getServerRoom(room.id);
    const p = serverRoom.state.players.get(room.sessionId)!;

    let shotsCount = 0;
    room.onMessage('weapon_tracer', () => { shotsCount++; });

    // Send 10 fire messages instantly in a tight loop
    for (let i = 0; i < 10; i++) {
      room.send('fire', {
        originX: p.x, originY: p.y + 1.65, originZ: p.z,
        dirX: 0, dirY: 0, dirZ: 1
      });
    }

    await new Promise(r => setTimeout(r, 250));
    // Only 1 shot should have passed rate limit cooldown
    const passed = room.connection.isOpen && shotsCount === 1;
    results.push({
      id: 7,
      name: 'Fire-rate violations',
      passed,
      details: passed ? `Exactly 1 shot accepted out of 10 rapid triggers` : `Accepted ${shotsCount} shots, expected 1`
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 7, name: 'Fire-rate violations', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 8: Empty ammunition and reload behavior
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 8: Empty ammunition and reload behavior');
  try {
    const { room } = await connectPlayer('Test8_Ammo');
    const serverRoom = getServerRoom(room.id);
    const p = serverRoom.state.players.get(room.sessionId)!;
    p.ammo = 0; // Empty magazine

    let shotFired = false;
    room.onMessage('weapon_tracer', () => { shotFired = true; });

    room.send('fire', {
      originX: p.x, originY: p.y + 1.65, originZ: p.z,
      dirX: 0, dirY: 0, dirZ: 1
    });

    await new Promise(r => setTimeout(r, 150));
    const outOfAmmoPassed = !shotFired;

    // Trigger reload
    room.send('reload');
    await new Promise(r => setTimeout(r, 100));
    const isReloading = p.isReloadingInternal;

    const passed = room.connection.isOpen && outOfAmmoPassed && isReloading;
    results.push({
      id: 8,
      name: 'Empty ammunition and reload behavior',
      passed,
      details: passed ? 'Blocked firing on 0 ammo and initiated reload successfully' : 'Ammo check or reload failed'
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 8, name: 'Empty ammunition and reload behavior', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 9: Player death, respawn, and subsequent shooting
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 9: Player death, respawn, and subsequent shooting');
  try {
    const { room: shooterRoom } = await connectPlayer('Test9_Shooter');
    const { room: victimRoom } = await connectPlayer('Test9_Victim');

    const serverRoom = getServerRoom(shooterRoom.id);
    const shooterState = serverRoom.state.players.get(shooterRoom.sessionId)!;
    const victimState = serverRoom.state.players.get(victimRoom.sessionId)!;

    shooterState.x = 5; shooterState.y = 0; shooterState.z = 5; shooterState.isShielded = false;
    victimState.x = 5; victimState.y = 0; victimState.z = 2; victimState.isShielded = false;
    victimState.health = 25; // 1 shot away from elimination

    let victimRespawnConfirmed = false;
    victimRoom.onMessage('respawn_confirmed', () => {
      victimRespawnConfirmed = true;
    });

    // Shooter eliminates victim
    shooterRoom.send('fire', {
      originX: 5, originY: 1.65, originZ: 5,
      dirX: 0, dirY: 0, dirZ: -1
    });

    await new Promise(r => setTimeout(r, 300));
    const victimDied = !victimState.isAlive && victimState.health === 0;

    // Fast-forward respawn time
    victimState.respawnTime = Date.now() - 1000;
    victimRoom.send('respawn_request');

    await new Promise(r => setTimeout(r, 300));
    const respawnSucceeded = victimRespawnConfirmed && victimState.isAlive && victimState.health === 100;

    // Victim shoots after respawn
    let postRespawnShotFired = false;
    victimRoom.onMessage('weapon_tracer', () => {
      postRespawnShotFired = true;
    });

    victimRoom.send('fire', {
      originX: victimState.x,
      originY: victimState.y + 1.65,
      originZ: victimState.z,
      dirX: 0, dirY: 0, dirZ: 1
    });

    await new Promise(r => setTimeout(r, 300));
    const passed = victimDied && respawnSucceeded && postRespawnShotFired && !victimState.isShielded;
    results.push({
      id: 9,
      name: 'Player death, respawn, and subsequent shooting',
      passed,
      details: passed ? 'Elimination, respawn cycle, and subsequent shooting validated' : 'Failed in death/respawn flow'
    });
    shooterRoom.leave();
    victimRoom.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 9, name: 'Player death, respawn, and subsequent shooting', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 10: Multiple players firing concurrently
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 10: Multiple players firing concurrently');
  try {
    const p1 = await connectPlayer('Multi_1');
    const p2 = await connectPlayer('Multi_2');
    const p3 = await connectPlayer('Multi_3');
    const p4 = await connectPlayer('Multi_4');

    const serverRoom = getServerRoom(p1.room.id);
    const s1 = serverRoom.state.players.get(p1.room.sessionId)!;
    const s2 = serverRoom.state.players.get(p2.room.sessionId)!;
    const s3 = serverRoom.state.players.get(p3.room.sessionId)!;
    const s4 = serverRoom.state.players.get(p4.room.sessionId)!;

    s1.x = 0; s1.y = 0; s1.z = 10;
    s2.x = 5; s2.y = 0; s2.z = 5;
    s3.x = -5; s3.y = 0; s3.z = -5;
    s4.x = 10; s4.y = 0; s4.z = 0;

    let totalTracers = 0;
    p1.room.onMessage('weapon_tracer', () => totalTracers++);

    // Fire from all 4 players simultaneously
    await Promise.all([
      p1.room.send('fire', { originX: s1.x, originY: 1.65, originZ: s1.z, dirX: 0, dirY: 0, dirZ: -1 }),
      p2.room.send('fire', { originX: s2.x, originY: 1.65, originZ: s2.z, dirX: -1, dirY: 0, dirZ: 0 }),
      p3.room.send('fire', { originX: s3.x, originY: 1.65, originZ: s3.z, dirX: 1, dirY: 0, dirZ: 0 }),
      p4.room.send('fire', { originX: s4.x, originY: 1.65, originZ: s4.z, dirX: -1, dirY: 0, dirZ: 0 }),
    ]);

    await new Promise(r => setTimeout(r, 400));
    const allOpen = p1.room.connection.isOpen && p2.room.connection.isOpen && p3.room.connection.isOpen && p4.room.connection.isOpen;
    const passed = allOpen && totalTracers === 4 && !serverCrashOccurred;
    results.push({
      id: 10,
      name: 'Multiple players firing concurrently',
      passed,
      details: passed ? `All 4 concurrent shots processed, ${totalTracers} tracers broadcast` : `Concurrent firing failed (open: ${allOpen}, tracers: ${totalTracers})`
    });

    p1.room.leave(); p2.room.leave(); p3.room.leave(); p4.room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 10, name: 'Multiple players firing concurrently', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 11: An exception in one shot handler while other players remain connected
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 11: Exception in one shot handler while other players stay connected');
  try {
    const playerA = await connectPlayer('SafePlayer_A');
    const playerB = await connectPlayer('SafePlayer_B');

    // Player A sends extreme garbage designed to trigger potential parser or runtime exceptions
    playerA.room.send('fire', {
      originX: { toString: () => { throw new Error('Malicious getter bomb'); } } as any,
      dirX: null as any
    } as any);

    await new Promise(r => setTimeout(r, 150));

    // Player B sends a normal valid shot
    let playerBTracer = false;
    playerB.room.onMessage('weapon_tracer', () => { playerBTracer = true; });

    const serverRoom = getServerRoom(playerB.room.id);
    const pbState = serverRoom.state.players.get(playerB.room.sessionId)!;

    playerB.room.send('fire', {
      originX: pbState.x, originY: pbState.y + 1.65, originZ: pbState.z,
      dirX: 0, dirY: 0, dirZ: -1
    });

    await new Promise(r => setTimeout(r, 300));
    const passed = playerA.room.connection.isOpen && playerB.room.connection.isOpen && playerBTracer && !serverCrashOccurred;
    results.push({
      id: 11,
      name: 'Exception isolation in shot handler',
      passed,
      details: passed ? 'Exception isolated, other players remained connected and functional' : 'Room crashed or player disconnected'
    });

    playerA.room.leave(); playerB.room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 11, name: 'Exception isolation in shot handler', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 12: Client disconnect and reconnection
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 12: Client disconnect and reconnection');
  try {
    const { client, room } = await connectPlayer('ReconnectingPlayer');
    const roomId = room.id;
    const reconnectionToken = room.reconnectionToken;
    const originalSessionId = room.sessionId;

    const serverRoom = getServerRoom(roomId);
    const p = serverRoom.state.players.get(originalSessionId)!;
    p.score = 350; // Give some score to verify state preservation

    // Simulate network drop with custom close code 4001 (unconsented)
    (room.connection as any).transport.ws.close(4001);
    await new Promise(r => setTimeout(r, 200));

    // Reconnect using Colyseus reconnection token
    let reconnected = false;
    try {
      const reconnectedRoom = await client.reconnect(reconnectionToken);
      const reconnectedPlayer = serverRoom.state.players.get(reconnectedRoom.sessionId);
      reconnected = reconnectedRoom.connection.isOpen && (reconnectedPlayer?.score === 350);
      reconnectedRoom.leave();
    } catch (e: any) {
      console.error('Reconnection failed:', e.message);
    }

    const passed = reconnected && !serverCrashOccurred;
    results.push({
      id: 12,
      name: 'Client disconnect and reconnection',
      passed,
      details: passed ? 'Client successfully reconnected into existing room state via token' : 'Reconnection failed'
    });
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 12, name: 'Client disconnect and reconnection', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  console.log('\n============================================================');
  console.log('                 FINAL TEST SUITE REPORT                    ');
  console.log('============================================================');
  let totalPassed = 0;
  results.forEach(r => {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    if (r.passed) totalPassed++;
    console.log(`[${status}] #${r.id} ${r.name}: ${r.details || ''}`);
  });
  console.log('------------------------------------------------------------');
  console.log(`TOTAL: ${totalPassed} / ${results.length} PASSED`);
  console.log(`SERVER CRASH STATUS: ${serverCrashOccurred ? 'CRASHED' : 'HEALTHY & STABLE'}`);
  console.log('============================================================\n');

  await gameServer.gracefullyShutdown();
  process.exit(totalPassed === results.length ? 0 : 1);
}

runAll12Tests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
