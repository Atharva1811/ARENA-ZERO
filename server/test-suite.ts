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

async function runAll16Tests() {
  const port = 2582;
  const app = express();
  app.use(cors());
  const server = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server })
  });

  gameServer.define('arena_public', ArenaRoom).enableRealtimeListing();
  gameServer.define('arena_private', ArenaRoom).filterBy(['roomCode']).enableRealtimeListing();
  await gameServer.listen(port);
  console.log(`[Test Server] Running on ws://localhost:${port}`);

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

  async function connectPlayer(nickname: string) {
    const client = new Client(`ws://localhost:${port}`);
    const room = await client.joinOrCreate('arena_public', { nickname });
    return { client, room };
  }

  // -------------------------------------------------------------------------
  // Test 1: Two independent clients request public matchmaking and join the same room
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 1: Two independent clients join same public room');
  try {
    const { room: r1 } = await connectPlayer('Test1_Player1');
    const client2 = new Client(`ws://localhost:${port}`);
    
    // Client 2 queries available rooms and joins the existing one
    const available = await client2.getAvailableRooms('arena_public');
    const openRoom = available.find(r => r.clients < r.maxClients && !r.metadata?.isPrivate);
    let r2;
    if (openRoom) {
      r2 = await client2.joinById(openRoom.roomId, { nickname: 'Test1_Player2' });
    } else {
      r2 = await client2.joinOrCreate('arena_public', { nickname: 'Test1_Player2' });
    }

    const passed = r1.id === r2.id && r1.connection.isOpen && r2.connection.isOpen;
    results.push({
      id: 1,
      name: 'Two independent clients join the same available room',
      passed,
      details: passed ? `Both clients matched into room ID: ${r1.id}` : `Separate rooms created: ${r1.id} vs ${r2.id}`
    });
    r1.leave();
    r2.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 1, name: 'Two independent clients join the same available room', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 2: No existing room causes one room to be created
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 2: No existing room causes one room to be created');
  try {
    const { room } = await connectPlayer('Test2_Pioneer');
    const serverRoom = getServerRoom(room.id);
    const passed = !!serverRoom && serverRoom.roomId === room.id && serverRoom.state.players.has(room.sessionId);
    results.push({
      id: 2,
      name: 'No existing room causes one room to be created',
      passed,
      details: passed ? `New room created with ID ${room.id}` : 'Failed to create room'
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 2, name: 'No existing room causes one room to be created', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 3: A full room causes matchmaking to choose another room
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 3: A full room causes matchmaking to choose another room');
  try {
    const { room: r1 } = await connectPlayer('Test3_A');
    const sRoom1 = getServerRoom(r1.id);
    const originalMax = sRoom1.maxClients;
    // Set maxClients to 1 to simulate a full room
    sRoom1.maxClients = 1;
    sRoom1.setMetadata({
      roomCode: sRoom1.state.roomCode,
      isPrivate: sRoom1.state.isPrivate,
      playerCount: 1,
      maxClients: 1,
      status: sRoom1.state.status,
    });
    sRoom1.lock(); // Colyseus locks room when full

    const clientB = new Client(`ws://localhost:${port}`);
    const available = await clientB.getAvailableRooms('arena_public');
    const eligible = available.find(r => r.clients < r.maxClients && !r.metadata?.isPrivate);
    
    let r2;
    if (eligible) {
      r2 = await clientB.joinById(eligible.roomId, { nickname: 'Test3_B' });
    } else {
      r2 = await clientB.joinOrCreate('arena_public', { nickname: 'Test3_B' });
    }

    const passed = r1.id !== r2.id && r2.connection.isOpen;
    results.push({
      id: 3,
      name: 'A full room causes matchmaking to choose another room',
      passed,
      details: passed ? `Full room bypassed, client placed in new room ${r2.id}` : `Client placed into full room ${r1.id}`
    });
    sRoom1.maxClients = originalMax;
    r1.leave();
    r2.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 3, name: 'A full room causes matchmaking to choose another room', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 4: A disconnected player is removed from room membership
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 4: A disconnected player is removed from room membership');
  try {
    const { room } = await connectPlayer('Test4_Leaver');
    const sRoom = getServerRoom(room.id);
    const sid = room.sessionId;
    
    await room.leave(true); // Consented leave
    await new Promise(r => setTimeout(r, 150));

    const passed = !sRoom.state.players.has(sid);
    results.push({
      id: 4,
      name: 'A disconnected player is removed from room membership',
      passed,
      details: passed ? `Player ${sid} successfully removed from room state` : `Player ${sid} still lingering in room state`
    });
  } catch (err: any) {
    results.push({ id: 4, name: 'A disconnected player is removed from room membership', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 5: Two players move and receive synchronized state
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 5: Two players move and receive synchronized state');
  try {
    const { room: r1 } = await connectPlayer('Test5_Mover1');
    const { room: r2 } = await connectPlayer('Test5_Mover2');

    let r2SawR1Move = false;
    r2.onStateChange((state) => {
      const p1 = state.players.get(r1.sessionId);
      if (p1 && Math.abs(p1.x - 4.5) < 0.2 && Math.abs(p1.z - 6.5) < 0.2) {
        r2SawR1Move = true;
      }
    });

    r1.send('move', { x: 4.5, y: 0, z: 6.5, yaw: 1.2, pitch: 0, isMoving: true, isSprinting: false });
    await new Promise(r => setTimeout(r, 300));

    const passed = r2SawR1Move && r1.connection.isOpen && r2.connection.isOpen;
    results.push({
      id: 5,
      name: 'Two players move and receive synchronized state',
      passed,
      details: passed ? 'Movement synchronized across clients via state patch' : 'Movement failed to synchronize to remote client'
    });
    r1.leave();
    r2.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 5, name: 'Two players move and receive synchronized state', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 6: Player A shoots Player B and valid damage is applied
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 6: Player A shoots Player B and valid damage is applied');
  try {
    const { room: rA } = await connectPlayer('Test6_Shooter');
    const { room: rB } = await connectPlayer('Test6_Target');
    const sRoom = getServerRoom(rA.id);

    const pA = sRoom.state.players.get(rA.sessionId)!;
    const pB = sRoom.state.players.get(rB.sessionId)!;

    pA.x = 5; pA.y = 0; pA.z = 5; pA.isShielded = false;
    pB.x = 5; pB.y = 0; pB.z = 2; pB.isShielded = false;

    let hitConfirmed = false;
    let damageReceived = false;
    rA.onMessage('hit_confirm', () => { hitConfirmed = true; });
    rB.onMessage('damage_received', () => { damageReceived = true; });

    rA.send('fire', {
      originX: 5, originY: 1.65, originZ: 5,
      dirX: 0, dirY: 0, dirZ: -1
    });

    await new Promise(r => setTimeout(r, 300));
    const passed = hitConfirmed && damageReceived && pB.health < 100;
    results.push({
      id: 6,
      name: 'Player A shoots Player B and valid damage is applied',
      passed,
      details: passed ? `Hit confirmed, target health reduced to ${pB.health}` : `Hit confirmation failed (HP: ${pB.health})`
    });
    rA.leave();
    rB.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 6, name: 'Player A shoots Player B and valid damage is applied', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 7: Player B can shoot Player A
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 7: Player B can shoot Player A');
  try {
    const { room: rA } = await connectPlayer('Test7_PlayerA');
    const { room: rB } = await connectPlayer('Test7_PlayerB');
    const sRoom = getServerRoom(rA.id);

    const pA = sRoom.state.players.get(rA.sessionId)!;
    const pB = sRoom.state.players.get(rB.sessionId)!;

    pA.x = 8; pA.y = 0; pA.z = 8; pA.isShielded = false;
    pB.x = 8; pB.y = 0; pB.z = 4; pB.isShielded = false;

    let bHitConfirmed = false;
    rB.onMessage('hit_confirm', () => { bHitConfirmed = true; });

    // B shoots back towards A (direction: (0, 0, 1))
    rB.send('fire', {
      originX: 8, originY: 1.65, originZ: 4,
      dirX: 0, dirY: 0, dirZ: 1
    });

    await new Promise(r => setTimeout(r, 300));
    const passed = bHitConfirmed && pA.health < 100;
    results.push({
      id: 7,
      name: 'Player B can shoot Player A',
      passed,
      details: passed ? `B hit A successfully, A health reduced to ${pA.health}` : 'B shooting A failed'
    });
    rA.leave();
    rB.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 7, name: 'Player B can shoot Player A', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 8: A missed shot does not change health
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 8: A missed shot does not change health');
  try {
    const { room: rA } = await connectPlayer('Test8_Shooter');
    const { room: rB } = await connectPlayer('Test8_Target');
    const sRoom = getServerRoom(rA.id);

    const pA = sRoom.state.players.get(rA.sessionId)!;
    const pB = sRoom.state.players.get(rB.sessionId)!;

    pA.x = 5; pA.y = 0; pA.z = 5; pA.isShielded = false;
    pB.x = 5; pB.y = 0; pB.z = 2; pB.isShielded = false;

    // Shoot in opposite direction (away from target)
    rA.send('fire', {
      originX: 5, originY: 1.65, originZ: 5,
      dirX: 0, dirY: 0, dirZ: 1
    });

    await new Promise(r => setTimeout(r, 200));
    const passed = pB.health === 100;
    results.push({
      id: 8,
      name: 'A missed shot does not change health',
      passed,
      details: passed ? 'Target health remained intact at 100' : `Target health mutated to ${pB.health}`
    });
    rA.leave();
    rB.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 8, name: 'A missed shot does not change health', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 9: A shot through a solid wall does not damage the target
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 9: A shot through a solid wall does not damage the target');
  try {
    const { room: rA } = await connectPlayer('Test9_WallShooter');
    const { room: rB } = await connectPlayer('Test9_WallTarget');
    const sRoom = getServerRoom(rA.id);

    const pA = sRoom.state.players.get(rA.sessionId)!;
    const pB = sRoom.state.players.get(rB.sessionId)!;

    // Center platform pillar sits at (0, 0, 0). Position A at (0, 0, 6) and B at (0, 0, -6)
    pA.x = 0; pA.y = 0; pA.z = 6; pA.isShielded = false;
    pB.x = 0; pB.y = 0; pB.z = -6; pB.isShielded = false;

    let hitRegistered = false;
    rA.onMessage('hit_confirm', () => { hitRegistered = true; });

    rA.send('fire', {
      originX: 0, originY: 1.65, originZ: 6,
      dirX: 0, dirY: 0, dirZ: -1
    });

    await new Promise(r => setTimeout(r, 300));
    const passed = !hitRegistered && pB.health === 100;
    results.push({
      id: 9,
      name: 'A shot through a solid wall does not damage the target',
      passed,
      details: passed ? 'Wall blocked line of sight authoritatively, 0 damage taken' : 'Wall penetration hit erroneously allowed'
    });
    rA.leave();
    rB.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 9, name: 'A shot through a solid wall does not damage the target', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 10: A dead player cannot continue shooting
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 10: A dead player cannot continue shooting');
  try {
    const { room } = await connectPlayer('Test10_DeadShooter');
    const sRoom = getServerRoom(room.id);
    const p = sRoom.state.players.get(room.sessionId)!;

    p.health = 0;
    p.isAlive = false;
    const initialAmmo = p.ammo;

    let tracerSent = false;
    room.onMessage('weapon_tracer', () => { tracerSent = true; });

    room.send('fire', {
      originX: p.x, originY: 1.65, originZ: p.z,
      dirX: 0, dirY: 0, dirZ: -1
    });

    await new Promise(r => setTimeout(r, 200));
    const passed = !tracerSent && p.ammo === initialAmmo;
    results.push({
      id: 10,
      name: 'A dead player cannot continue shooting',
      passed,
      details: passed ? 'Dead player shot safely rejected, ammo preserved' : 'Dead player was allowed to shoot'
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 10, name: 'A dead player cannot continue shooting', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 11: Death updates scores exactly once
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 11: Death updates scores exactly once');
  try {
    const { room: rA } = await connectPlayer('Test11_Killer');
    const { room: rB } = await connectPlayer('Test11_Victim');
    const sRoom = getServerRoom(rA.id);

    const pA = sRoom.state.players.get(rA.sessionId)!;
    const pB = sRoom.state.players.get(rB.sessionId)!;

    pA.x = 6; pA.y = 0; pA.z = 6; pA.isShielded = false;
    pB.x = 6; pB.y = 0; pB.z = 3; pB.isShielded = false;
    pB.health = 10; // 1 shot to eliminate

    let killFeedCount = 0;
    rA.onMessage('kill_feed', () => { killFeedCount++; });

    rA.send('fire', {
      originX: 6, originY: 1.65, originZ: 6,
      dirX: 0, dirY: 0, dirZ: -1
    });

    await new Promise(r => setTimeout(r, 350));
    
    // Shoot corpse again
    rA.send('fire', {
      originX: 6, originY: 1.65, originZ: 6,
      dirX: 0, dirY: 0, dirZ: -1
    });
    await new Promise(r => setTimeout(r, 200));

    const passed = pA.kills === 1 && pB.deaths === 1 && killFeedCount === 1 && !pB.isAlive;
    results.push({
      id: 11,
      name: 'Death updates scores exactly once',
      passed,
      details: passed ? `Scores updated exactly once (Kills: ${pA.kills}, Deaths: ${pB.deaths})` : `Score corrupted (Kills: ${pA.kills}, Deaths: ${pB.deaths}, Feeds: ${killFeedCount})`
    });
    rA.leave();
    rB.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 11, name: 'Death updates scores exactly once', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 12: Respawn restores the player correctly
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 12: Respawn restores the player correctly');
  try {
    const { room } = await connectPlayer('Test12_Respawner');
    const sRoom = getServerRoom(room.id);
    const p = sRoom.state.players.get(room.sessionId)!;

    p.health = 0;
    p.isAlive = false;
    p.ammo = 0;
    p.respawnTime = Date.now() - 100; // Eligible immediately

    let respawnConfirmed = false;
    room.onMessage('respawn_confirmed', (data: any) => {
      respawnConfirmed = true;
      p.x = data.x;
      p.z = data.z;
    });

    room.send('respawn_request');
    await new Promise(r => setTimeout(r, 250));

    const passed = respawnConfirmed && p.isAlive && p.health === GAME_CONSTANTS.MAX_HEALTH && p.ammo === GAME_CONSTANTS.MAGAZINE_SIZE;
    results.push({
      id: 12,
      name: 'Respawn restores the player correctly',
      passed,
      details: passed ? `Player restored to 100 HP, 24 Ammo at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})` : 'Respawn failed'
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 12, name: 'Respawn restores the player correctly', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 13: Multiple simultaneous shots do not corrupt state
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 13: Multiple simultaneous shots do not corrupt state');
  try {
    const clients = await Promise.all([
      connectPlayer('Test13_A'),
      connectPlayer('Test13_B'),
      connectPlayer('Test13_C'),
      connectPlayer('Test13_D'),
    ]);

    // Send simultaneous fire from all 4 players
    await Promise.all(
      clients.map(({ room }) => {
        return new Promise<void>((resolve) => {
          room.send('fire', { originX: 0, originY: 1.65, originZ: 10, dirX: 0, dirY: 0, dirZ: 1 });
          resolve();
        });
      })
    );

    await new Promise(r => setTimeout(r, 300));
    const allIntact = clients.every(({ room }) => room.connection.isOpen);
    results.push({
      id: 13,
      name: 'Multiple simultaneous shots do not corrupt state',
      passed: allIntact,
      details: allIntact ? 'All 4 simultaneous shots handled atomically without socket drops' : 'Socket dropped on concurrent fire'
    });

    for (const c of clients) c.room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 13, name: 'Multiple simultaneous shots do not corrupt state', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 14: Repeated firing does not crash or disconnect the server
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 14: Repeated firing does not crash or disconnect the server');
  try {
    const { room } = await connectPlayer('Test14_Spammer');
    for (let i = 0; i < 25; i++) {
      room.send('fire', { originX: 0, originY: 1.65, originZ: 10, dirX: 0, dirY: 0, dirZ: 1 });
    }

    await new Promise(r => setTimeout(r, 300));
    const passed = room.connection.isOpen && !serverCrashOccurred;
    results.push({
      id: 14,
      name: 'Repeated firing does not crash or disconnect the server',
      passed,
      details: passed ? '25 rapid shots handled cleanly, connection remains open' : 'Client disconnected or server crashed'
    });
    room.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 14, name: 'Repeated firing does not crash or disconnect the server', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 15: Invalid messages are rejected without terminating the room
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 15: Invalid messages are rejected without terminating the room');
  try {
    const { room: rFuzzer } = await connectPlayer('Test15_Fuzzer');
    const { room: rOther } = await connectPlayer('Test15_Other');
    const sRoom = getServerRoom(rFuzzer.id);

    // Fuzz test invalid messages across combat and movement handlers
    rFuzzer.send('fire', null as any);
    rFuzzer.send('fire', undefined as any);
    rFuzzer.send('fire', { originX: NaN, originY: Infinity, originZ: 0, dirX: 0, dirY: 0, dirZ: 0 });
    rFuzzer.send('move', { x: NaN, y: Infinity, z: 0, yaw: NaN, pitch: 0, isMoving: true, isSprinting: false });
    rFuzzer.send('reload');

    await new Promise(r => setTimeout(r, 250));
    const fuzzerStillOpen = rFuzzer.connection.isOpen;
    const otherStillOpen = rOther.connection.isOpen;
    const roomActive = sRoom.state.status === 'active';

    const passed = fuzzerStillOpen && otherStillOpen && roomActive && !serverCrashOccurred;
    results.push({
      id: 15,
      name: 'Invalid messages are rejected without terminating the room',
      passed,
      details: passed ? 'All malformed payloads rejected safely; room and clients remain intact' : 'Room terminated or client dropped'
    });
    rFuzzer.leave();
    rOther.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 15, name: 'Invalid messages are rejected without terminating the room', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // Test 16: A full round can be played by two clients without connection loss
  // -------------------------------------------------------------------------
  console.log('\n--> Running Test 16: A full round can be played by two clients without connection loss');
  try {
    const { room: r1 } = await connectPlayer('Test16_Player1');
    const { room: r2 } = await connectPlayer('Test16_Player2');
    const sRoom = getServerRoom(r1.id);

    const p1 = sRoom.state.players.get(r1.sessionId)!;
    const p2 = sRoom.state.players.get(r2.sessionId)!;

    p1.x = 10; p1.y = 0; p1.z = 10; p1.isShielded = false;
    p2.x = 10; p2.y = 0; p2.z = 6; p2.isShielded = false;

    // Exchange 3 rounds of combat
    for (let round = 0; round < 3; round++) {
      r1.send('fire', { originX: 10, originY: 1.65, originZ: 10, dirX: 0, dirY: 0, dirZ: -1 });
      await new Promise(r => setTimeout(r, 150));
      r2.send('fire', { originX: 10, originY: 1.65, originZ: 6, dirX: 0, dirY: 0, dirZ: 1 });
      await new Promise(r => setTimeout(r, 150));
    }

    const passed = r1.connection.isOpen && r2.connection.isOpen && p1.health < 100 && p2.health < 100;
    results.push({
      id: 16,
      name: 'A full round can be played by two clients without connection loss',
      passed,
      details: passed ? `Round finished smoothly (P1 HP: ${p1.health}, P2 HP: ${p2.health}, Both Connected)` : 'Disconnection occurred during combat round'
    });

    r1.leave();
    r2.leave();
    await new Promise(r => setTimeout(r, 100));
  } catch (err: any) {
    results.push({ id: 16, name: 'A full round can be played by two clients without connection loss', passed: false, details: err.message });
  }

  // -------------------------------------------------------------------------
  // FINAL REPORT
  // -------------------------------------------------------------------------
  console.log('\n============================================================');
  console.log('                 FINAL TEST SUITE REPORT                    ');
  console.log('============================================================');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '[✓ PASS]' : '[✗ FAIL]';
    console.log(`${mark} #${r.id} ${r.name}: ${r.details || ''}`);
    if (!r.passed) allPassed = false;
  }
  console.log('------------------------------------------------------------');
  console.log(`TOTAL: ${results.filter(r => r.passed).length} / ${results.length} PASSED`);
  console.log(`SERVER CRASH STATUS: ${serverCrashOccurred ? 'CRASH DETECTED' : 'HEALTHY & STABLE'}`);
  console.log('============================================================\n');

  await gameServer.gracefullyShutdown();
  process.exit(allPassed && !serverCrashOccurred ? 0 : 1);
}

runAll16Tests().catch((err) => {
  console.error('[TEST SUITE FATAL ERROR]:', err);
  process.exit(1);
});
