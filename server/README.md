# ⚡ ARENA ZERO — Multiplayer Server Backend

Authoritative multiplayer game server for **ARENA ZERO**, built on **Node.js**, **Express**, **Colyseus**, and **TypeScript**.

The server acts as the single source of truth for all combat simulation, movement limits, hitscan raycasting, ammunition, damage application, player eliminations, and match timers.

---

## 🏗️ Architecture & Core Modules

```
server/
├── src/
│   ├── index.ts                # Express HTTP app, WebSocket transport, CORS, /health check
│   └── rooms/
│       ├── ArenaRoom.ts        # Authoritative room logic, combat raycast, lifecycle & scoring
│       └── schema/
│           ├── ArenaState.ts   # Synchronized room state (players map, timer, leader, status)
│           └── PlayerState.ts  # Synchronized player state (transform, stats, health, ammo)
├── test-suite.ts               # Automated 15-test headless regression test suite
├── package.json
└── tsconfig.json
```

---

## 🎯 Authoritative Combat & Collision Engine

### 1. 3D Finite Cylinder Hitscan Raycast
All bullets are evaluated authoritatively on the server via `intersectRayCylinder`:
- **Hitbox**: Bounding cylinder of height `1.8m` and radius `0.70m` (or `0.80m` with client target hint).
- **Minimum Distance Threshold**: `0.1m`, allowing accurate point-blank and close-range combat without clipping or discarding valid hits.
- **Headshot Multiplier**: Rays striking `py >= centerY + height - 0.45` apply **45 HP headshot critical damage** (vs **25 HP** body damage).

### 2. Obstacle & Wall Occlusion (`isLineOfSightClear`)
Ray trajectories from shooter weapon origin to target impact points are tested against:
- **Circular Columns**: Reactor core column ($r=1.6\text{m}$, height $6.0\text{m}$) and 4 tactical pillars ($r=0.9\text{m}$, height $4.0\text{m}$).
- **Solid Box Colliders (3D Slab Method)**: Tactical bunkers (`bunker-north/south/east/west`), courtyard cover blocks, obelisks, and flank ramparts.
- Shots cannot penetrate solid walls; obstructed rays are safely discarded with 0 damage applied.

### 3. Damage & Lifecycle Validation
- **Stationary & Active Enemies**: Firing at an enemy (even a stationary player standing at spawn) registers authoritative damage and immediately drops their spawn shield bubble.
- **Atomic Elimination**: At `health <= 0`, the victim is marked `isAlive = false`, incrementing killer kills/score (+100) and broadcasting a single room-wide `kill_feed` item.
- **Dead Player Lockout**: Dead operators cannot fire or receive duplicate damage while waiting for respawn.
- **Authoritative Respawn**: After `RESPAWN_TIME_MS: 3000`, the player respawns with full 100 HP and 24 ammo at the safest spawn point, preserving all match scores.

---

## 📡 Network Protocol & Messages

### Client ➔ Server Messages

| Message | Payload | Description |
|---|---|---|
| `move` | `{ x, y, z, yaw, pitch, isMoving, isSprinting }` | Player input updates (throttled at ~30Hz, clamped to max speed delta) |
| `fire` | `{ originX, originY, originZ, dirX, dirY, dirZ, targetSessionId? }` | Firing request with forward ray and optional client hint |
| `reload` | *(none)* | Initiates 1.6s reload sequence |
| `respawn_request` | *(none)* | Requests respawn after 3.0s elimination countdown |

### Server ➔ Client Broadcasts & Events

| Event | Destination | Description |
|---|---|---|
| `init_spawn` | Joining Client | Authoritative initial spawn coordinates & facing angle |
| `weapon_tracer` | Broadcast | 3D tracer endpoints for laser visuals |
| `hit_confirm` | Shooter | Hit notification with damage amount, crit/headshot, remaining HP, and kill flag |
| `damage_received` | Victim | Directional damage notification with attacker position and remaining HP |
| `kill_feed` | Broadcast | Elimination banner notification for all clients |
| `respawn_confirmed` | Victim | Respawn coordinates & facing yaw confirmation |
| `match_over` | Broadcast | Match conclusion banner with winner details and kills |
| `server_announcement` | Broadcast | System joining/leaving broadcast |

---

## 🚀 Running the Server

### Start in Development Mode (Live Watch)
```bash
npm run dev
```

### Build & Run in Production Mode
```bash
npm run build
npm start
```
Server listens on port `2567`:
- WebSocket endpoint: `ws://localhost:2567`
- HTTP Health check: `http://localhost:2567/health`

---

## 🧪 Automated Regression Testing

The backend includes a headless multi-client test suite testing 15 distinct multiplayer scenarios:

```bash
npm test
```

### Verified Test Cases:
1. Single player join and state registration.
2. Clean model removal on player leave.
3. Sudden WebSocket disconnect cleanup without ghost entities.
4. Token-based session deduplication on reconnection.
5. Rejoin cycles without duplicate listeners or models.
6. Stale room message isolation.
7. Remote player orientation through 0°, 90°, 180°, and 270°.
8. Combat on stationary enemies at close range (1.5m) and medium range (6m).
9. Missed shot safety (100 HP untouched).
10. Solid wall obstacle raycast occlusion.
11. Atomic elimination and single kill feed event.
12. Dead player shooting lockout.
13. Respawn health & ammo restoration with score preservation.
14. Dual-client state consistency.
15. Rapid move & fire stress test (20 packets with zero crashes or errors).
