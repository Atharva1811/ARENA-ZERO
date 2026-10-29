import http from 'http';
import express from 'express';
import cors from 'cors';
import colyseus from 'colyseus';
import { Client, Room } from 'colyseus.js';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './src/rooms/ArenaRoom.js';
import { PrivateRoomRegistry } from './src/rooms/PrivateRoomRegistry.js';
import { ArenaState } from './src/rooms/schema/ArenaState.js';

const { Server } = colyseus;

async function runPrivateRoomTests() {
  const port = 2595;
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Attach authoritative resolution endpoint
  app.post('/api/match/resolve-private', (req, res) => {
    const rawCode = req.body?.roomCode;
    const clientToken = req.body?.clientToken || 'test-client';
    const code = String(rawCode || '').trim();

    if (!/^\d{4}$/.test(code)) {
      return res.status(400).json({ error: 'Private room code must contain exactly 4 numeric digits.' });
    }

    const rateLimit = PrivateRoomRegistry.instance.checkRateLimit(clientToken);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: `Too many failed room code attempts. Please wait ${rateLimit.retryAfterSec}s before retrying.`,
      });
    }

    const entry = PrivateRoomRegistry.instance.getByCode(code);
    if (!entry || !entry.room) {
      PrivateRoomRegistry.instance.recordFailedAttempt(clientToken);
      return res.status(404).json({ error: `Private room '${code}' not found or has expired.` });
    }

    const room = entry.room;
    if (room.state.status === 'finished') {
      return res.status(410).json({ error: `Match in room '${code}' has already ended.` });
    }

    if (room.clients.length >= room.maxClients) {
      return res.status(409).json({ error: `Private room '${code}' is currently full (${room.maxClients}/${room.maxClients}).` });
    }

    PrivateRoomRegistry.instance.resetFailedAttempts(clientToken);
    return res.json({
      status: 'ok',
      roomId: entry.roomId,
      roomCode: code,
    });
  });

  const server = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server }),
  });

  gameServer.define('arena_public', ArenaRoom).enableRealtimeListing();
  gameServer.define('arena_private', ArenaRoom);

  await gameServer.listen(port);
  console.log(`[Private Room Test Server] Running on http/ws://localhost:${port}`);

  try {
    // =========================================================================
    // Test 1: Code generation format & leading zeros
    // =========================================================================
    console.log('\n--> Test 1: Code generation format (4 numeric digits, including leading zeros)');
    let foundLeadingZero = false;
    for (let i = 0; i < 500; i++) {
      const code = PrivateRoomRegistry.instance.generateCode();
      if (!/^\d{4}$/.test(code)) {
        throw new Error(`Generated invalid code: '${code}'`);
      }
      if (code.startsWith('0')) {
        foundLeadingZero = true;
      }
    }
    if (!foundLeadingZero) {
      throw new Error('Over 500 attempts, no code with leading zero generated!');
    }
    console.log('[Test 1 PASSED]: All 500 codes strictly match /^\\d{4}$/ and preserve leading zeros.');

    // =========================================================================
    // Test 2: Uniqueness and collision handling
    // =========================================================================
    console.log('\n--> Test 2: Simultaneous uniqueness & collision handling');
    PrivateRoomRegistry.instance.clear();
    const mockRooms: { roomId: string }[] = [];
    const allocatedCodes = new Set<string>();

    for (let i = 0; i < 200; i++) {
      const mockRoom = { roomId: `mock_room_${i}` } as unknown as ArenaRoom;
      const code = PrivateRoomRegistry.instance.allocate(mockRoom);
      if (allocatedCodes.has(code)) {
        throw new Error(`Duplicate code allocated: '${code}'`);
      }
      allocatedCodes.add(code);
      mockRooms.push(mockRoom);
    }
    if (allocatedCodes.size !== 200) {
      throw new Error('Collision handling failed to maintain unique set.');
    }
    console.log(`[Test 2 PASSED]: 200 distinct private rooms allocated 200 unique 4-digit codes.`);

    // Clean up mock allocations
    PrivateRoomRegistry.instance.clear();

    // =========================================================================
    // Test 3: Exhaustion handling
    // =========================================================================
    console.log('\n--> Test 3: Graceful code exhaustion handling');
    // Artificially saturate registry to MAX_CODES - 100
    for (let i = 0; i < 9900; i++) {
      const pad = i.toString().padStart(4, '0');
      (PrivateRoomRegistry.instance as any).codeToRoom.set(pad, { roomId: `r_${i}` });
    }
    let exhaustionErrorCaught = false;
    try {
      PrivateRoomRegistry.instance.allocate({ roomId: 'overflow_room' } as unknown as ArenaRoom);
    } catch (e: any) {
      exhaustionErrorCaught = true;
      if (!e.message.includes('capacity')) {
        throw new Error(`Unexpected error message on capacity limit: ${e.message}`);
      }
    }
    if (!exhaustionErrorCaught) {
      throw new Error('Exhaustion limit failed to trigger!');
    }
    PrivateRoomRegistry.instance.clear();
    console.log('[Test 3 PASSED]: Graceful error returned when private room capacity reached.');

    // =========================================================================
    // Test 4: Creating a private room assigns authoritative 4-digit code
    // =========================================================================
    console.log('\n--> Test 4: Creating a private room assigns authoritative 4-digit code (client cannot select arbitrary code)');
    const clientCreator = new Client(`ws://localhost:${port}`);
    // Attempt to pass arbitrary code '9999' from client - server MUST ignore it!
    let roomA: Room<ArenaState>;
    try {
      roomA = await clientCreator.create<ArenaState>('arena_private', {
        nickname: 'Creator',
        isPrivate: true,
        roomCode: '9999',
      });
    } catch (createErr: any) {
      console.error('ERROR IN CREATE:', createErr);
      throw createErr;
    }

    await new Promise((r) => roomA.onStateChange.once(r));
    const assignedCode = roomA.state.roomCode;
    if (!/^\d{4}$/.test(assignedCode)) {
      throw new Error(`Room code is not 4 digits: '${assignedCode}'`);
    }
    if (assignedCode === '9999') {
      throw new Error('Server accepted client arbitrary roomCode during creation!');
    }
    if (!roomA.state.isPrivate) {
      throw new Error('Room is not marked private in state!');
    }
    console.log(`[Test 4 PASSED]: Server ignored client code '9999' and authoritatively assigned code: '${assignedCode}'.`);

    // =========================================================================
    // Test 5: Private room is excluded from public matchmaking discovery
    // =========================================================================
    console.log('\n--> Test 5: Private room is excluded from public matchmaking discovery');
    const clientPublicScanner = new Client(`ws://localhost:${port}`);
    const publicRooms = await clientPublicScanner.getAvailableRooms('arena_public');
    const leakedRoom = publicRooms.find((r) => r.roomId === roomA.id);
    if (leakedRoom) {
      throw new Error('Private room was leaked in public matchmaking listing!');
    }
    console.log('[Test 5 PASSED]: Private room is completely absent from arena_public discovery.');

    // =========================================================================
    // Test 6: A valid 4-digit code joins the correct private room
    // =========================================================================
    console.log('\n--> Test 6: A valid 4-digit code joins the correct private room');
    // Resolve via HTTP endpoint
    const resolveRes = await fetch(`http://localhost:${port}/api/match/resolve-private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: assignedCode, clientToken: 'player_b_token' }),
    });
    const resolveData = (await resolveRes.json()) as { status?: string; roomId?: string; roomCode?: string; error?: string };
    if (!resolveRes.ok || !resolveData.roomId) {
      throw new Error(`Failed to resolve code '${assignedCode}': ${JSON.stringify(resolveData)}`);
    }

    const clientJoiner = new Client(`ws://localhost:${port}`);
    const roomB: Room<ArenaState> = await clientJoiner.joinById<ArenaState>(resolveData.roomId, {
      nickname: 'JoinerB',
      roomCode: assignedCode,
      isPrivate: true,
      clientToken: 'player_b_token',
    });

    if (roomB.id !== roomA.id) {
      throw new Error(`Joiner connected to wrong room! expected=${roomA.id}, got=${roomB.id}`);
    }
    console.log(`[Test 6 PASSED]: Joiner successfully routed to exact private room (${roomB.id}) via code '${assignedCode}'.`);

    // =========================================================================
    // Test 7: Direct joinById bypass prevention (without valid code)
    // =========================================================================
    console.log('\n--> Test 7: Direct joinById bypass prevention (without valid 4-digit code)');
    const clientHacker = new Client(`ws://localhost:${port}`);
    let hackerBlocked = false;
    try {
      await clientHacker.joinById(roomA.id, {
        nickname: 'Hacker',
        clientToken: 'hacker_token',
        // Omits roomCode!
      });
    } catch {
      hackerBlocked = true;
    }
    if (!hackerBlocked) {
      throw new Error('Player bypassed 4-digit code validation by calling joinById directly!');
    }

    // Also test with wrong code
    let wrongCodeBlocked = false;
    try {
      await clientHacker.joinById(roomA.id, {
        nickname: 'Hacker',
        roomCode: '0000', // Incorrect code
        clientToken: 'hacker_token',
      });
    } catch {
      wrongCodeBlocked = true;
    }
    if (!wrongCodeBlocked) {
      throw new Error('Player bypassed with incorrect 4-digit code!');
    }
    console.log('[Test 7 PASSED]: Server-side onAuth strictly rejected direct joinById attempts without valid code.');

    // =========================================================================
    // Test 8: Nonexistent and invalid codes are rejected
    // =========================================================================
    console.log('\n--> Test 8: Nonexistent and invalid codes are rejected with useful errors');
    // Non-4-digit input
    const badFormatRes = await fetch(`http://localhost:${port}/api/match/resolve-private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: 'ABC' }),
    });
    if (badFormatRes.status !== 400) {
      throw new Error(`Expected 400 for bad format, got ${badFormatRes.status}`);
    }

    // Nonexistent 4-digit code
    const notFoundRes = await fetch(`http://localhost:${port}/api/match/resolve-private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: '9999' }),
    });
    if (notFoundRes.status !== 404) {
      throw new Error(`Expected 404 for nonexistent code, got ${notFoundRes.status}`);
    }
    console.log('[Test 8 PASSED]: Invalid and nonexistent codes return appropriate HTTP status codes (400, 404).');

    // =========================================================================
    // Test 9: Brute-force & rate limiting
    // =========================================================================
    console.log('\n--> Test 9: Brute-force rate limiting (safe handling of repeated invalid attempts)');
    const spamToken = 'spammer_client_token';
    for (let i = 0; i < 5; i++) {
      await fetch(`http://localhost:${port}/api/match/resolve-private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: `123${i}`, clientToken: spamToken }),
      });
    }
    // 6th attempt should be rate limited with 429
    const rateLimitedRes = await fetch(`http://localhost:${port}/api/match/resolve-private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: '1239', clientToken: spamToken }),
    });
    if (rateLimitedRes.status !== 429) {
      throw new Error(`Expected 429 for rate limited attempt, got ${rateLimitedRes.status}`);
    }
    const rateData = (await rateLimitedRes.json()) as { error?: string };
    if (!rateData.error?.includes('Too many failed')) {
      throw new Error(`Unexpected rate limit message: ${rateData.error}`);
    }
    console.log('[Test 9 PASSED]: Rate limiter returned HTTP 429 after 5 failed code attempts.');

    // =========================================================================
    // Test 10: Disposed room releases code and rejects subsequent joins
    // =========================================================================
    console.log('\n--> Test 10: Disposed room releases code');
    const oldCode = assignedCode;
    await roomA.leave();
    await roomB.leave();

    // Allow Colyseus room disposal lifecycle to complete
    await new Promise((r) => setTimeout(r, 200));

    // Lookup of old code should now return 404 (released)
    const deadRoomRes = await fetch(`http://localhost:${port}/api/match/resolve-private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: oldCode, clientToken: 'clean_client' }),
    });
    if (deadRoomRes.status !== 404) {
      throw new Error(`Expected 404 after room disposal, got ${deadRoomRes.status}`);
    }
    console.log(`[Test 10 PASSED]: Code '${oldCode}' was released upon room disposal and cannot route to old room.`);

    // =========================================================================
    // Test 11: Room capacity enforcement (full private room rejects extra players)
    // =========================================================================
    console.log('\n--> Test 11: Room capacity enforcement (8 players max)');
    const clientNewCreator = new Client(`ws://localhost:${port}`);
    const capacityRoom: Room<ArenaState> = await clientNewCreator.create<ArenaState>('arena_private', {
      nickname: 'CapCreator',
      isPrivate: true,
    });
    await new Promise((r) => capacityRoom.onStateChange.once(r));
    const capCode = capacityRoom.state.roomCode;

    // Fill room with 7 more players (total 8)
    const fillerClients: Client[] = [];
    const fillerRooms: Room<ArenaState>[] = [];
    for (let i = 2; i <= 8; i++) {
      const c = new Client(`ws://localhost:${port}`);
      const r = await c.joinById<ArenaState>(capacityRoom.id, {
        nickname: `Filler_${i}`,
        roomCode: capCode,
        isPrivate: true,
        clientToken: `filler_${i}`,
      });
      fillerClients.push(c);
      fillerRooms.push(r);
    }

    // 9th player attempts to resolve code - should return 409 (room is full)
    const fullRes = await fetch(`http://localhost:${port}/api/match/resolve-private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: capCode, clientToken: 'ninth_player' }),
    });
    if (fullRes.status !== 409) {
      throw new Error(`Expected 409 for full room, got ${fullRes.status}`);
    }

    // 9th player attempts direct joinById - onAuth should reject
    const client9 = new Client(`ws://localhost:${port}`);
    let ninthPlayerBlocked = false;
    try {
      await client9.joinById(capacityRoom.id, {
        nickname: 'NinthPlayer',
        roomCode: capCode,
        isPrivate: true,
        clientToken: 'ninth_player',
      });
    } catch {
      ninthPlayerBlocked = true;
    }
    if (!ninthPlayerBlocked) {
      throw new Error('Ninth player was not rejected by server capacity check!');
    }

    // Cleanup capacity room
    await capacityRoom.leave();
    for (const r of fillerRooms) {
      await r.leave();
    }
    console.log('[Test 11 PASSED]: 9th player strictly rejected with 409 when room reached 8/8 capacity.');

    // =========================================================================
    // Test 12: Public matchmaking continues to operate normally
    // =========================================================================
    console.log('\n--> Test 12: Public matchmaking functions normally and never generates/shows private code');
    const publicClient1 = new Client(`ws://localhost:${port}`);
    const publicClient2 = new Client(`ws://localhost:${port}`);

    const pubRoom1: Room<ArenaState> = await publicClient1.joinOrCreate<ArenaState>('arena_public', {
      nickname: 'PublicP1',
    });
    const pubRoom2: Room<ArenaState> = await publicClient2.joinOrCreate<ArenaState>('arena_public', {
      nickname: 'PublicP2',
    });

    if (pubRoom1.id !== pubRoom2.id) {
      throw new Error('Public matchmaking failed to pair two public players!');
    }
    if (pubRoom1.state.isPrivate || pubRoom1.state.roomCode !== '') {
      throw new Error(`Public room state has private flags! isPrivate=${pubRoom1.state.isPrivate}, code='${pubRoom1.state.roomCode}'`);
    }

    await pubRoom1.leave();
    await pubRoom2.leave();
    console.log('[Test 12 PASSED]: Public match functioning normally without private room codes or leaks.');

    // =========================================================================
    // Test 13: Concurrent private room creation
    // =========================================================================
    console.log('\n--> Test 13: Concurrent private room creation race safety');
    const concurrentClients = Array.from({ length: 6 }, () => new Client(`ws://localhost:${port}`));
    const createdRooms = await Promise.all(
      concurrentClients.map((client, i) =>
        client.create<ArenaState>('arena_private', {
          nickname: `Concurrent_${i}`,
          isPrivate: true,
        })
      )
    );

    await Promise.all(createdRooms.map((r) => new Promise((done) => r.onStateChange.once(done))));
    const concurrentCodes = new Set(createdRooms.map((r) => r.state.roomCode));
    if (concurrentCodes.size !== 6) {
      throw new Error(`Concurrent room creation resulted in duplicate room codes! Codes: ${Array.from(concurrentCodes)}`);
    }

    for (const r of createdRooms) {
      await r.leave();
    }
    console.log(`[Test 13 PASSED]: 6 simultaneous room creation requests all received distinct 4-digit codes.`);

    console.log('\n==================================================================');
    console.log(' [SUCCESS] ALL 13 SERVER & NETWORKING PRIVATE ROOM TESTS PASSED!  ');
    console.log('==================================================================\n');
  } finally {
    await gameServer.gracefullyShutdown();
    server.close();
  }
}

runPrivateRoomTests().catch((err) => {
  console.error('[FATAL ERROR IN PRIVATE ROOM TESTS]:', err);
  process.exit(1);
});
