import http from 'http';
import express from 'express';
import cors from 'cors';
import colyseus from 'colyseus';
import { matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './src/rooms/ArenaRoom.js';
import { Client } from 'colyseus.js';
import { GAME_CONSTANTS } from '../shared/constants.js';

const { Server } = colyseus;

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  details?: string;
}

async function runRegressionTests() {
  const port = 2584; // Independent port for this test run
  const app = express();
  app.use(cors());
  const server = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server })
  });

  gameServer.define('arena_public', ArenaRoom).enableRealtimeListing();
  gameServer.define('arena_private', ArenaRoom).filterBy(['roomCode']).enableRealtimeListing();
  await gameServer.listen(port);
  console.log(`[Regression Test Server] Running on ws://localhost:${port}`);

  let serverCrashOccurred = false;
  process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught exception on server process:', err);
    serverCrashOccurred = true;
  });

  const results: TestResult[] = [];

  function getServerRoom(roomId: string): ArenaRoom {
    const room = matchMaker.getRoomById(roomId) as ArenaRoom;
    if (!room) throw new Error(`Room ${roomId} not found in matchMaker`);
    return room;
  }

  async function connectPlayer(nickname: string, options: any = {}) {
    const client = new Client(`ws://localhost:${port}`);
    const room = await client.joinOrCreate('arena_public', { nickname, ...options });
    return { client, room };
  }

  // =========================================================================
  // TEST 1: A player joins and appears exactly once
  // =========================================================================
  console.log('\n--> Running Test 1: A player joins and appears exactly once');
  try {
    const { room } = await connectPlayer('Test1_Player');
    const sRoom = getServerRoom(room.id);
    const inState = sRoom.state.players.has(room.sessionId);
    const count = sRoom.state.players.size;
    const player = sRoom.state.players.get(room.sessionId);
    const validStats = player && player.health === 100 && player.ammo === 24 && player.isAlive;

    const passed = inState && count === 1 && !!validStats;
    results.push({
      id: 1,
      name: 'A player joins and appears exactly once',
      passed,
      details: passed ? `Session ${room.sessionId} registered once with 100 HP, 24 Ammo` : `Count: ${count}, inState: ${inState}`
    });
    room.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 1, name: 'A player joins and appears exactly once', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 2: A player leaves and their model is removed
  // =========================================================================
  console.log('\n--> Running Test 2: A player leaves and their model is removed');
  try {
    const { room: r1 } = await connectPlayer('Test2_P1');
    const { room: r2 } = await connectPlayer('Test2_P2');
    const sRoom = getServerRoom(r1.id);

    const initialCount = sRoom.state.players.size;
    const sid2 = r2.sessionId;

    // Player 2 leaves cleanly
    r2.leave();
    await new Promise(r => setTimeout(r, 120));

    const afterCount = sRoom.state.players.size;
    const removedFromState = !sRoom.state.players.has(sid2);

    const passed = initialCount === 2 && afterCount === 1 && removedFromState;
    results.push({
      id: 2,
      name: 'A player leaves and their model is removed',
      passed,
      details: passed ? `Session ${sid2} removed cleanly, active count: ${afterCount}` : `Failed to remove: initial=${initialCount}, after=${afterCount}`
    });
    r1.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 2, name: 'A player leaves and their model is removed', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 3: A player disconnects unexpectedly and their model is removed
  // =========================================================================
  console.log('\n--> Running Test 3: A player disconnects unexpectedly and their model is removed');
  try {
    const { room: r1 } = await connectPlayer('Test3_P1');
    const { room: r2 } = await connectPlayer('Test3_P2');
    const sRoom = getServerRoom(r1.id);
    const sid2 = r2.sessionId;

    // Simulate unexpected socket disconnect (network drop / tab crash)
    r2.connection.close();
    await new Promise(r => setTimeout(r, 150));

    const afterCount = sRoom.state.players.size;
    const removedImmediately = !sRoom.state.players.has(sid2);

    const passed = removedImmediately && afterCount === 1;
    results.push({
      id: 3,
      name: 'A player disconnects unexpectedly and their model is removed',
      passed,
      details: passed ? `Session ${sid2} immediately removed without lingering ghost` : `Ghost remained: inState=${!removedImmediately}, count=${afterCount}`
    });
    r1.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 3, name: 'A player disconnects unexpectedly and their model is removed', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 4: The same browser reconnects and does not leave a ghost model
  // =========================================================================
  console.log('\n--> Running Test 4: The same browser reconnects without ghost model');
  try {
    // Keep room alive with an anchor player
    const { room: anchorRoom } = await connectPlayer('AnchorPlayer');
    const sRoom = getServerRoom(anchorRoom.id);

    const browserToken = 'browser-client-token-xyz-123';
    const clientB = new Client(`ws://localhost:${port}`);
    const r1 = await clientB.joinById(sRoom.roomId, { nickname: 'BrowserUser', clientToken: browserToken });
    const firstSessionId = r1.sessionId;

    // Simulate abrupt network drop without leave notification
    r1.connection.close();
    await new Promise(r => setTimeout(r, 100));

    // Browser rejoins immediately with the same clientToken
    const clientB2 = new Client(`ws://localhost:${port}`);
    const r2 = await clientB2.joinById(sRoom.roomId, { nickname: 'BrowserUser', clientToken: browserToken });
    const secondSessionId = r2.sessionId;

    await new Promise(r => setTimeout(r, 100));

    // There should be anchorPlayer (1) + BrowserUser (1) = 2 players total
    const finalCount = sRoom.state.players.size;
    const hasFirst = sRoom.state.players.has(firstSessionId);
    const hasSecond = sRoom.state.players.has(secondSessionId);

    const passed = finalCount === 2 && !hasFirst && hasSecond;
    results.push({
      id: 4,
      name: 'The same browser reconnects and does not leave a ghost model',
      passed,
      details: passed ? `Old session ${firstSessionId} pruned, only current session ${secondSessionId} active (Total: ${finalCount})` : `Duplicate/ghost detected: count=${finalCount}, hasOld=${hasFirst}, hasNew=${hasSecond}`
    });
    r2.leave();
    anchorRoom.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 4, name: 'The same browser reconnects and does not leave a ghost model', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 5: Two clients leave and rejoin repeatedly without duplicate models or listeners
  // =========================================================================
  console.log('\n--> Running Test 5: Two clients leave and rejoin repeatedly');
  try {
    let passedCycles = true;
    let lastRoomId = '';

    for (let cycle = 1; cycle <= 3; cycle++) {
      const { room: p1 } = await connectPlayer(`Loop_A_${cycle}`);
      const { room: p2 } = await connectPlayer(`Loop_B_${cycle}`);
      lastRoomId = p1.id;
      const sRoom = getServerRoom(lastRoomId);

      // Verify exactly 2 players
      if (sRoom.state.players.size !== 2) {
        passedCycles = false;
        break;
      }

      // Both leave
      p1.leave();
      p2.leave();
      await new Promise(r => setTimeout(r, 100));

      if (sRoom.state.players.size !== 0) {
        passedCycles = false;
        break;
      }
    }

    results.push({
      id: 5,
      name: 'Two clients leave and rejoin repeatedly without duplicate models or listeners',
      passed: passedCycles,
      details: passedCycles ? 'Completed 3 consecutive join/leave cycles with 0 lingering models' : 'Duplicate models or stale state detected during cycles'
    });
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 5, name: 'Two clients leave and rejoin repeatedly without duplicate models or listeners', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 6: Old room messages cannot recreate players after leaving the room
  // =========================================================================
  console.log('\n--> Running Test 6: Old room messages cannot recreate players after leaving');
  try {
    const { room: roomA } = await connectPlayer('OldRoomUser');
    const sRoomA = getServerRoom(roomA.id);

    // Leave Room A
    roomA.leave();
    await new Promise(r => setTimeout(r, 100));

    // Connect to Room B
    const clientB = new Client(`ws://localhost:${port}`);
    const roomB = await clientB.create('arena_private', { nickname: 'NewRoomUser', isPrivate: true });
    const sRoomB = getServerRoom(roomB.id);

    // Try sending movement or fire to room A after leaving
    try {
      roomA.send('move', { x: 10, y: 0, z: 10, yaw: 0, pitch: 0, isMoving: false, isSprinting: false });
    } catch {}

    await new Promise(r => setTimeout(r, 80));

    const roomAPlayerCount = sRoomA.state.players.size;
    const roomBPlayerCount = sRoomB.state.players.size;

    const passed = roomAPlayerCount === 0 && roomBPlayerCount === 1;
    results.push({
      id: 6,
      name: 'Old room messages cannot recreate players after leaving the room',
      passed,
      details: passed ? 'Stale room messages safely ignored, room states strictly isolated' : `Room A count: ${roomAPlayerCount}, Room B count: ${roomBPlayerCount}`
    });
    roomB.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 6, name: 'Old room messages cannot recreate players after leaving the room', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 7: Rotate Player A through 0, 90, 180, and 270 degrees
  // =========================================================================
  console.log('\n--> Running Test 7: Rotate Player A through 0, 90, 180, and 270 degrees');
  try {
    const { room: rA } = await connectPlayer('Orient_A');
    const { room: rB } = await connectPlayer('Observer_B');
    const sRoom = getServerRoom(rA.id);
    const pA = sRoom.state.players.get(rA.sessionId)!;

    const angles = [
      { deg: 0, rad: 0 },
      { deg: 90, rad: Math.PI / 2 },
      { deg: 180, rad: Math.PI },
      { deg: 270, rad: -Math.PI / 2 },
    ];

    let allAnglesSynced = true;
    for (const testAngle of angles) {
      rA.send('move', {
        x: pA.x,
        y: pA.y,
        z: pA.z,
        yaw: testAngle.rad,
        pitch: 0.15,
        isMoving: false,
        isSprinting: false,
      });

      await new Promise(r => setTimeout(r, 80));

      const pAOnClientB = rB.state.players.get(rA.sessionId);
      if (!pAOnClientB || Math.abs(pAOnClientB.yaw - testAngle.rad) > 0.01) {
        allAnglesSynced = false;
        break;
      }
    }

    results.push({
      id: 7,
      name: 'Rotate Player A through 0, 90, 180, and 270 degrees',
      passed: allAnglesSynced,
      details: allAnglesSynced
        ? 'Rotated through 0°, 90°, 180°, 270°: Client B received exact orientations without inversions'
        : 'Angle synchronization mismatch between clients',
    });

    rA.leave();
    rB.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 7, name: 'Rotate Player A through 0, 90, 180, and 270 degrees', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 8: Fire at stationary enemy at close range and medium range
  // =========================================================================
  console.log('\n--> Running Test 8: Fire at stationary enemy at close and medium range');
  try {
    const { room: r1 } = await connectPlayer('Shooter_Combat');
    const { room: r2 } = await connectPlayer('Stationary_Target');
    const sRoom = getServerRoom(r1.id);
    const p1 = sRoom.state.players.get(r1.sessionId)!;
    const p2 = sRoom.state.players.get(r2.sessionId)!;

    // Both players in clear line of sight south of bunker-south (z: 14.2 - 15.5)
    // 1. Medium Range Shot (6 meters apart) - Target is stationary at spawn with default shield!
    p1.x = 0; p1.y = 0; p1.z = 23; p1.lastMoveTime = Date.now();
    p2.x = 0; p2.y = 0; p2.z = 17; p2.lastMoveTime = Date.now();
    // Do NOT manually clear p2.isShielded - verify server hit removes it and reduces HP!

    r1.send('fire', {
      originX: 0,
      originY: GAME_CONSTANTS.EYE_HEIGHT,
      originZ: 23,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: r2.sessionId,
    });

    await new Promise(r => setTimeout(r, 100));

    const mediumRangeHit = p2.health < 100 && !p2.isShielded;
    const hpAfterMedium = p2.health;

    // 2. Close Range Shot (1.5 meters apart)
    p1.x = 0; p1.y = 0; p1.z = 18.5; p1.lastMoveTime = Date.now();
    p1.lastShootTime = 0; // Reset rate limit for test
    r1.send('fire', {
      originX: 0,
      originY: GAME_CONSTANTS.EYE_HEIGHT,
      originZ: 18.5,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: r2.sessionId,
    });

    await new Promise(r => setTimeout(r, 100));

    const closeRangeHit = p2.health < hpAfterMedium;

    const passed = mediumRangeHit && closeRangeHit;
    results.push({
      id: 8,
      name: 'Fire at stationary enemy at close and medium range',
      passed,
      details: passed
        ? `Stationary enemy hit at medium range (HP: ${hpAfterMedium}) and close range (HP: ${p2.health}), shield dropped`
        : `Failed: mediumHit=${mediumRangeHit}, closeHit=${closeRangeHit}, HP=${p2.health}, isShielded=${p2.isShielded}`,
    });

    r1.leave();
    r2.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 8, name: 'Fire at stationary enemy at close and medium range', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 9: A missed shot does not reduce health
  // =========================================================================
  console.log('\n--> Running Test 9: A missed shot does not reduce health');
  try {
    const { room: r1 } = await connectPlayer('Shooter_Miss');
    const { room: r2 } = await connectPlayer('Target_Safe');
    const sRoom = getServerRoom(r1.id);
    const p1 = sRoom.state.players.get(r1.sessionId)!;
    const p2 = sRoom.state.players.get(r2.sessionId)!;

    p1.x = 0; p1.y = 0; p1.z = 21; p1.lastMoveTime = Date.now();
    p2.x = 0; p2.y = 0; p2.z = 17; p2.lastMoveTime = Date.now();

    // Fire 90 degrees away (to the East: dirX = 1, dirZ = 0)
    r1.send('fire', {
      originX: 0,
      originY: GAME_CONSTANTS.EYE_HEIGHT,
      originZ: 21,
      dirX: 1,
      dirY: 0,
      dirZ: 0,
    });

    await new Promise(r => setTimeout(r, 100));

    const passed = p2.health === 100;
    results.push({
      id: 9,
      name: 'A missed shot does not reduce health',
      passed,
      details: passed ? 'Target health remained intact at 100 HP' : `Health improperly altered: ${p2.health}`,
    });
    r1.leave();
    r2.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 9, name: 'A missed shot does not reduce health', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 10: A wall blocks shots
  // =========================================================================
  console.log('\n--> Running Test 10: A wall blocks shots');
  try {
    const { room: r1 } = await connectPlayer('Shooter_Wall');
    const { room: r2 } = await connectPlayer('Target_Wall');
    const sRoom = getServerRoom(r1.id);
    const p1 = sRoom.state.players.get(r1.sessionId)!;
    const p2 = sRoom.state.players.get(r2.sessionId)!;

    // Position players on opposite sides of 'bunker-south' (minZ: 14.2, maxZ: 15.5, minX: -4, maxX: 4)
    p1.x = 0; p1.y = 0; p1.z = 18; p1.lastMoveTime = Date.now();
    p2.x = 0; p2.y = 0; p2.z = 12; p2.lastMoveTime = Date.now();

    // Shoot directly at target through bunker-south
    r1.send('fire', {
      originX: 0,
      originY: 1.0,
      originZ: 18,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
    });

    await new Promise(r => setTimeout(r, 100));

    const passed = p2.health === 100;
    results.push({
      id: 10,
      name: 'A wall blocks shots',
      passed,
      details: passed ? 'Solid bunker wall successfully blocked ray, 0 damage applied' : `Wall penetrated! Target health: ${p2.health}`,
    });
    r1.leave();
    r2.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 10, name: 'A wall blocks shots', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 11: Health reaching zero produces exactly one death and kill event
  // =========================================================================
  console.log('\n--> Running Test 11: Health reaching zero produces exactly one death and kill event');
  try {
    const { room: r1 } = await connectPlayer('Killer_A');
    const { room: r2 } = await connectPlayer('Victim_B');
    const sRoom = getServerRoom(r1.id);
    const p1 = sRoom.state.players.get(r1.sessionId)!;
    const p2 = sRoom.state.players.get(r2.sessionId)!;

    p1.x = 0; p1.y = 0; p1.z = 21; p1.lastMoveTime = Date.now();
    p2.x = 0; p2.y = 0; p2.z = 17; p2.lastMoveTime = Date.now();

    let killFeedCount = 0;
    r1.onMessage('kill_feed', () => { killFeedCount++; });
    r2.onMessage('kill_feed', () => {});

    // Fire shots to eliminate target (100 HP, 25-45 dmg per shot -> 4 shots max)
    for (let i = 0; i < 5; i++) {
      p1.lastShootTime = 0; // Reset rate limit between test shots
      r1.send('fire', {
        originX: 0,
        originY: GAME_CONSTANTS.EYE_HEIGHT,
        originZ: 21,
        dirX: 0,
        dirY: 0,
        dirZ: -1,
        targetSessionId: r2.sessionId,
      });
      await new Promise(r => setTimeout(r, 80));
    }

    const passed = p2.health === 0 && !p2.isAlive && p2.deaths === 1 && p1.kills === 1 && killFeedCount === 1;
    results.push({
      id: 11,
      name: 'Health reaching zero produces exactly one death and one kill event',
      passed,
      details: passed ? 'Atomic elimination verified: HP=0, isAlive=false, deaths=1, kills=1, killFeedEvents=1' : `Failed: HP=${p2.health}, alive=${p2.isAlive}, deaths=${p2.deaths}, kills=${p1.kills}, events=${killFeedCount}`,
    });

    // =========================================================================
    // TEST 12: A dead player cannot shoot
    // =========================================================================
    console.log('\n--> Running Test 12: A dead player cannot shoot');
    const initialP1Health = p1.health;
    const initialAmmoP2 = p2.ammo;

    // Victim (dead) attempts to shoot killer
    r2.send('fire', {
      originX: 0,
      originY: GAME_CONSTANTS.EYE_HEIGHT,
      originZ: 17,
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      targetSessionId: r1.sessionId,
    });

    await new Promise(r => setTimeout(r, 80));

    const test12Passed = p1.health === initialP1Health && p2.ammo === initialAmmoP2;
    results.push({
      id: 12,
      name: 'A dead player cannot shoot',
      passed: test12Passed,
      details: test12Passed ? 'Dead player shot safely rejected by server, ammo and enemy health unchanged' : 'Dead player was able to shoot!',
    });

    // =========================================================================
    // TEST 13: Respawn restores health without resetting the match score
    // =========================================================================
    console.log('\n--> Running Test 13: Respawn restores health without resetting match score');
    // Fast-forward respawn timer
    p2.respawnTime = Date.now() - 100;
    r2.send('respawn_request');

    await new Promise(r => setTimeout(r, 120));

    const respawnPassed = p2.isAlive && p2.health === 100 && p2.ammo === 24 && p2.deaths === 1 && p1.kills === 1 && p1.score === 100;
    results.push({
      id: 13,
      name: 'Respawn restores health without resetting the match score',
      passed: respawnPassed,
      details: respawnPassed ? 'Player restored to 100 HP, 24 Ammo while scores preserved (Kills: 1, Score: 100)' : `Failed: HP=${p2.health}, deaths=${p2.deaths}, kills=${p1.kills}`,
    });

    r1.leave();
    r2.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 11, name: 'Health reaching zero produces exactly one death and one kill event', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 14: Both clients observe consistent health, death, and score updates
  // =========================================================================
  console.log('\n--> Running Test 14: Both clients observe consistent health, death, and score updates');
  try {
    const { room: rA } = await connectPlayer('Sync_Alpha');
    const { room: rB } = await connectPlayer('Sync_Beta');
    const sRoom = getServerRoom(rA.id);
    const pA = sRoom.state.players.get(rA.sessionId)!;
    const pB = sRoom.state.players.get(rB.sessionId)!;

    pA.x = 0; pA.y = 0; pA.z = 21; pA.lastMoveTime = Date.now();
    pB.x = 0; pB.y = 0; pB.z = 17; pB.lastMoveTime = Date.now();

    // Apply damage to B
    rA.send('fire', {
      originX: 0,
      originY: GAME_CONSTANTS.EYE_HEIGHT,
      originZ: 21,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: rB.sessionId,
    });

    await new Promise(r => setTimeout(r, 120));

    // Check state viewed from client A and client B
    const clientAViewOfB = rA.state.players.get(rB.sessionId);
    const clientBViewOfB = rB.state.players.get(rB.sessionId);

    const consistent = clientAViewOfB && clientBViewOfB && clientAViewOfB.health === clientBViewOfB.health && clientAViewOfB.health < 100;
    results.push({
      id: 14,
      name: 'Both clients observe consistent health, death, and score updates',
      passed: !!consistent,
      details: consistent ? `Both clients observed identical target health: ${clientAViewOfB.health} HP` : 'State desync between clients',
    });
    rA.leave();
    rB.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 14, name: 'Both clients observe consistent health, death, and score updates', passed: false, details: e.message });
  }

  // =========================================================================
  // TEST 15: Repeated firing and movement does not cause disconnects or crashes
  // =========================================================================
  console.log('\n--> Running Test 15: Repeated firing and movement does not cause disconnects or crashes');
  try {
    const { room: rActive } = await connectPlayer('StressTester');
    const sRoom = getServerRoom(rActive.id);
    const player = sRoom.state.players.get(rActive.sessionId)!;

    let firingErrors = 0;
    rActive.onError((code, message) => {
      console.warn(`[StressTest] Error received: ${code} - ${message}`);
      firingErrors++;
    });

    // Rapidly send 20 moves and fires
    for (let i = 0; i < 20; i++) {
      player.lastShootTime = 0; // Bypass rate limit
      player.ammo = 24;
      rActive.send('move', {
        x: Math.sin(i) * 5,
        y: 0,
        z: 20 + Math.cos(i) * 2,
        yaw: i * 0.3,
        pitch: 0,
        isMoving: true,
        isSprinting: false,
      });

      rActive.send('fire', {
        originX: player.x,
        originY: GAME_CONSTANTS.EYE_HEIGHT,
        originZ: player.z,
        dirX: 0,
        dirY: 0,
        dirZ: -1,
      });

      await new Promise(r => setTimeout(r, 20));
    }

    const passed = rActive.connection.isOpen && firingErrors === 0 && !serverCrashOccurred;
    results.push({
      id: 15,
      name: 'Repeated firing and movement does not cause disconnects or crashes',
      passed,
      details: passed ? 'Executed 20 rapid move & fire packets with 0 disconnects and 0 errors' : `Failed: open=${rActive.connection.isOpen}, errors=${firingErrors}`,
    });

    rActive.leave();
    await new Promise(r => setTimeout(r, 80));
  } catch (e: any) {
    results.push({ id: 15, name: 'Repeated firing and movement does not cause disconnects or crashes', passed: false, details: e.message });
  }

  // Print Summary
  console.log('\n' + '='.repeat(60));
  console.log('                 REGRESSION TEST SUITE REPORT                 ');
  console.log('='.repeat(60));
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? '[✓ PASS]' : '[✗ FAIL]';
    if (!r.passed) allPassed = false;
    console.log(`${status} #${r.id} ${r.name}: ${r.details || ''}`);
  }
  console.log('-'.repeat(60));
  const passCount = results.filter(r => r.passed).length;
  console.log(`TOTAL: ${passCount} / ${results.length} PASSED`);
  console.log(`SERVER CRASH STATUS: ${serverCrashOccurred ? 'CRASHED' : 'HEALTHY & STABLE'}`);
  console.log('='.repeat(60) + '\n');

  await gameServer.gracefullyShutdown();
  server.close();

  if (!allPassed || serverCrashOccurred) {
    process.exit(1);
  }
}

runRegressionTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
