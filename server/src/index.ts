import http from 'http';
import express from 'express';
import cors from 'cors';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './rooms/ArenaRoom.js';

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

const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
  }),
});

// Register Colyseus rooms
gameServer.define('arena_public', ArenaRoom);
gameServer.define('arena_private', ArenaRoom);

gameServer.listen(port).then(() => {
  console.log(`⚡ Arena Zero Server listening on port ${port}`);
  console.log(`👉 Health check: http://localhost:${port}/health`);
}).catch((err) => {
  console.error('Failed to start server:', err);
});
