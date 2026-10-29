import http from 'http';
import express from 'express';
import cors from 'cors';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './rooms/ArenaRoom.js';
import { PrivateRoomRegistry } from './rooms/PrivateRoomRegistry.js';

const { Server } = colyseus;

const port = Number(process.env.PORT || 2567);
const app = express();

app.use(cors());
app.use(express.json());

// Health check endpoint for deployment monitoring
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    game: 'Arena Zero Server',
    uptime: Math.round(process.uptime()),
    timestamp: Date.now(),
  });
});

// Authoritative Private Room Code Resolution Endpoint
app.post('/api/match/resolve-private', (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const rawCode = req.body?.roomCode;
  const clientToken = req.body?.clientToken || clientIp;

  // 1. Enforce strict 4-digit numeric format (e.g. 0047, 0821, 6394)
  const code = String(rawCode || '').trim();
  if (!/^\d{4}$/.test(code)) {
    return res.status(400).json({ error: 'Private room code must contain exactly 4 numeric digits.' });
  }

  // 2. Brute-force & abuse protection: rate limit check
  const rateLimit = PrivateRoomRegistry.instance.checkRateLimit(clientToken);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: `Too many failed room code attempts. Please wait ${rateLimit.retryAfterSec}s before retrying.`,
    });
  }

  // 3. Authoritative registry lookup
  const entry = PrivateRoomRegistry.instance.getByCode(code);
  if (!entry || !entry.room) {
    PrivateRoomRegistry.instance.recordFailedAttempt(clientToken);
    return res.status(404).json({ error: `Private room '${code}' not found or has expired.` });
  }

  const room = entry.room;

  // 4. Validate match status & room capacity
  if (room.state.status === 'finished') {
    return res.status(410).json({ error: `Match in room '${code}' has already ended.` });
  }

  if (room.clients.length >= room.maxClients) {
    return res.status(409).json({ error: `Private room '${code}' is currently full (${room.maxClients}/${room.maxClients}).` });
  }

  // Success - reset any previous failed attempts
  PrivateRoomRegistry.instance.resetFailedAttempts(clientToken);

  return res.json({
    status: 'ok',
    roomId: entry.roomId,
    roomCode: code,
  });
});

const server = http.createServer(app);

// Safe process-level error handlers to protect against unexpected termination
process.on('uncaughtException', (err) => {
  console.error('[Server UncaughtException]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server UnhandledRejection]:', reason);
});

const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
  }),
});

// Register Colyseus rooms with matchmaking rules
// Public arena: discoverable via matchmaking and realtime listings
gameServer.define('arena_public', ArenaRoom)
  .enableRealtimeListing();

// Private arena: EXCLUDED from public matchmaking and realtime listings
gameServer.define('arena_private', ArenaRoom);

gameServer.listen(port).then(() => {
  console.log(`⚡ Arena Zero Server listening on port ${port}`);
  console.log(`👉 Health check: http://localhost:${port}/health`);
}).catch((err) => {
  console.error('Failed to start server:', err);
});
