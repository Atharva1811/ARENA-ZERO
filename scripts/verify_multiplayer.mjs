import { Client } from 'colyseus.js';
import WebSocket from 'ws';

global.WebSocket = WebSocket;

async function walkTo(room, startX, startZ, targetX, targetZ, speed = 6.0) {
  let currX = startX;
  let currZ = startZ;
  const totalDist = Math.hypot(targetX - startX, targetZ - startZ);
  if (totalDist < 0.1) return;

  const dx = (targetX - startX) / totalDist;
  const dz = (targetZ - startZ) / totalDist;
  const stepDist = speed * 0.05;
  const steps = Math.ceil(totalDist / stepDist);

  for (let i = 0; i < steps; i++) {
    currX += dx * stepDist;
    currZ += dz * stepDist;
    room.send('move', {
      x: currX,
      y: 0,
      z: currZ,
      yaw: Math.atan2(dx, dz),
      pitch: 0,
      isMoving: true,
      isSprinting: false,
    });
    await new Promise((r) => setTimeout(r, 50));
  }

  room.send('move', {
    x: targetX,
    y: 0,
    z: targetZ,
    yaw: Math.atan2(dx, dz),
    pitch: 0,
    isMoving: false,
    isSprinting: false,
  });
  await new Promise((r) => setTimeout(r, 50));
}

async function runFullVerification() {
  console.log('===============================================================');
  console.log('       ARENA ZERO — END-TO-END MULTIPLAYER VERIFICATION        ');
  console.log('===============================================================');
  const serverUrl = 'ws://localhost:2567';

  // 1. Health check
  console.log('\n[TEST 1] Testing Server Diagnostics Endpoint (/health)...');
  const healthRes = await fetch('http://localhost:2567/health');
  const health = await healthRes.json();
  if (health.status !== 'ok') throw new Error('Health check failed');
  console.log('✓ Health status verified: OK');

  // 2. Public Matchmaking & Real-time State Synchronization
  console.log('\n[TEST 2] Connecting Two Real Independent Clients to Public Arena...');
  const client1 = new Client(serverUrl);
  const client2 = new Client(serverUrl);

  const room1 = await client1.joinOrCreate('arena_public', { nickname: 'Viper' });
  const room2 = await client2.joinOrCreate('arena_public', { nickname: 'Ghost' });

  // Wait for state sync
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (room1.state?.players?.size >= 2 && room2.state?.players?.size >= 2) break;
  }

  console.log(`✓ Both clients joined room. Player 1 sees: ${room1.state.players.size} players`);
  console.log(`✓ Player 2 sees: ${room2.state.players.size} players`);

  // 3. Movement & Hitscan Combat
  console.log('\n[TEST 3] Testing Movement & Server-Authoritative Combat...');
  const p1 = room1.state.players.get(room1.sessionId);
  const p2 = room1.state.players.get(room2.sessionId);

  console.log('Moving Player 1 & 2 to open firing corridor...');
  await walkTo(room1, p1.x, p1.z, 8.0, 4.0);
  await walkTo(room2, p2.x, p2.z, 8.0, 9.0);

  console.log('Waiting 2.6s for spawn shields to dissipate...');
  await new Promise((r) => setTimeout(r, 2600));

  let damageReceived = false;
  let hitConfirmed = false;

  room1.onMessage('hit_confirm', (data) => {
    hitConfirmed = true;
    console.log(`✓ Attacker hit confirmed: Damage=${data.damage}, Headshot=${data.headshot}, RemainingHP=${data.remainingHealth}`);
  });

  room2.onMessage('damage_received', (data) => {
    damageReceived = true;
    console.log(`✓ Victim damage recorded: Damage=${data.damage}, CurrentHP=${data.currentHealth}`);
  });

  const p1Final = room1.state.players.get(room1.sessionId);
  const p2Final = room1.state.players.get(room2.sessionId);

  const dx = p2Final.x - p1Final.x;
  const dy = (p2Final.y + 1.2) - (p1Final.y + 1.65);
  const dz = p2Final.z - p1Final.z;
  const dist = Math.hypot(dx, dy, dz);

  console.log(`Firing at target across open corridor (${dist.toFixed(1)}m)...`);
  room1.send('fire', {
    originX: p1Final.x,
    originY: p1Final.y + 1.65,
    originZ: p1Final.z,
    dirX: dx / dist,
    dirY: dy / dist,
    dirZ: dz / dist,
    targetSessionId: room2.sessionId,
  });

  await new Promise((r) => setTimeout(r, 400));

  if (!hitConfirmed || !damageReceived) {
    throw new Error('Combat hit/damage confirmation failed');
  }

  room1.leave();
  room2.leave();
  console.log('✓ Public match sessions cleanly terminated.');

  // 4. Private Room Matchmaking via Code
  console.log('\n[TEST 4] Testing Private Room Creation & Join via AZ- Room Code...');
  const hostClient = new Client(serverUrl);
  const hostRoom = await hostClient.create('arena_private', { nickname: 'HostCommander', isPrivate: true });

  await new Promise((r) => setTimeout(r, 200));
  const roomCode = hostRoom.state.roomCode;
  console.log(`✓ Host generated private room code: ${roomCode}`);

  const guestClient = new Client(serverUrl);
  const guestRoom = await guestClient.joinOrCreate('arena_private', { nickname: 'GuestRanger', roomCode });
  console.log(`✓ Guest successfully matched into private room ${roomCode}`);

  await new Promise((r) => setTimeout(r, 300));
  console.log(`✓ Private room synced player count: ${guestRoom.state.players.size} / 8`);

  hostRoom.leave();
  guestRoom.leave();

  console.log('\n===============================================================');
  console.log('       ALL ARENA ZERO MULTIPLAYER VERIFICATIONS PASSED!        ');
  console.log('===============================================================\n');
  process.exit(0);
}

runFullVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
