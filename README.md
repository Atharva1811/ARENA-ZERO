# ⚡ ARENA ZERO — No-Login Multiplayer Browser FPS

A complete, playable, stylized 3D multiplayer first-person shooter (FPS) running directly in modern web browsers.

Players join instantly using just a callsign/nickname — **no registration, accounts, passwords, or OAuth required**.

---

## 🌟 Highlights & Features

- **Instant Frictionless Combat**: Jump directly into public matchmaking or create private invite-only matches with 4-character codes (`AZ-XXXX`) or shareable URLs (`?room=AZ-XXXX`).
- **First-Person Tactical Controls**: Full Pointer Lock API mouse-look, camera-relative WASD movement, thruster jump, sprint, and reload mechanics.
- **Accurate Remote Player Orientation & Aiming**: Remote players visually face their exact networked look direction across 360 degrees using a unified coordinate system and model root offset, with vertical aim pitch tracking and independent camera-relative movement.
- **Server-Authoritative Real Combat**: The Colyseus Node.js server validates ammunition, fire rate cooldowns, 3D finite cylinder raycasts against both stationary and moving enemies (with 0.1m close-range tolerance), line-of-sight wall occlusion, atomic elimination, and match scoring. Client claims of damage are never trusted.
- **Anti-Wallhack & Obstacle Occlusion**: Server-side line-of-sight raycasting checks prevent shots from passing through solid arena walls or cover blocks.
- **Low-Poly Sci-Fi Arena**: Compact 28m combat ring featuring a central reactor core, 4 corner obelisk towers, raised central platform, tactical cover bunkers, and flank ramparts.
- **Dynamic Spawn Shields**: Freshly spawned players receive a temporary bubble shield that immediately drops upon firing or receiving valid combat damage.
- **Zero-Ghost Reconnection Lifecycle**: Clean 1-to-1 session lifecycle ensures disconnections and reconnects never leave stale ghost player models in the arena.
- **Heads-Up Display & UI**: Dynamic crosshair with hitmarker flair (headshot crit indicator), armor integrity bar, pulse rifle ammo counter, kill feed banner, live match timer, and Tab-overlay scoreboard.
- **Zero External Media Dependencies**: Procedural Web Audio API sound synthesis (pulse rifle shots, hitmarker dings, damage grunts, reloads) and Three.js low-poly geometric assets.

---

## 🎮 Controls

| Action | Key / Input |
|---|---|
| **Move** | `W`, `A`, `S`, `D` / Arrow Keys |
| **Aim & Look** | `Mouse` (click viewport to lock cursor) |
| **Fire Pulse Rifle** | `Left Mouse Button` |
| **Reload Battery** | `R` key |
| **Tactical Sprint** | Hold `Shift` |
| **Thruster Jump** | `Spacebar` |
| **Live Leaderboard** | Hold `Tab` |
| **Tactical Pause / Cursor Unlock** | `Escape` key |

---

## 🏛️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Pages Frontend                    │
│   (React 19 + TypeScript + Vite + Three.js + Colyseus.js)   │
│                                                             │
│   • FPSController: Pointer Lock, camera-relative movement   │
│   • WeaponModel: Viewmodel recoil, muzzle flash, bobbing    │
│   • RemotePlayer: Interpolated meshes, overhead billboards  │
│   • ArenaEngine: Render loop, local effects & audio         │
│   • UI Overlay: HUD, Scoreboard, Menus & Modals             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                WebSocket Sync │ (wss://...)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                Colyseus Multiplayer Server                  │
│               (Node.js + Express + TypeScript)              │
│                                                             │
│   • ArenaRoom: Authoritative room lifecycle & match timer   │
│   • Hitscan Validation: Line-of-sight obstacle checks       │
│   • Anti-Cheat: Movement speed limit tolerance clamp        │
│   • State Broadcast: 20Hz state patch to all clients        │
│   • Health Endpoint: GET /health for cloud monitoring       │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
├── .github/workflows/
│   └── deploy.yml              # Automated GitHub Pages static build & deploy
├── server/                     # Standalone Node.js Colyseus Multiplayer Server
│   ├── src/
│   │   ├── index.ts            # Server entrypoint, CORS, HTTP & /health endpoint
│   │   └── rooms/
│   │       ├── ArenaRoom.ts    # Authoritative room logic, combat, and scoring
│   │       └── schema/
│   │           ├── ArenaState.ts   # Synchronized room state schema
│   │           └── PlayerState.ts  # Synchronized player state schema
│   ├── package.json
│   └── tsconfig.json
├── shared/                     # Shared physics, collision, and types
│   ├── constants.ts            # Speeds, damage, health, timers, and rates
│   ├── types.ts                # Network payloads & event interfaces
│   └── arenaCollision.ts       # Shared colliders, raycaster, & resolution
├── src/                        # Client Frontend
│   ├── components/
│   │   ├── MainMenu.tsx        # Title, callsign input, quick play & room codes
│   │   ├── FPSHUD.tsx          # Crosshairs, hitmarkers, health & ammo bars
│   │   ├── Scoreboard.tsx      # Tab-overlay live leaderboard
│   │   ├── DeathScreen.tsx     # Elimination banner & respawn timer
│   │   ├── InGameMenu.tsx      # Settings, sensitivity slider, invite link
│   │   └── MatchOverModal.tsx  # Victory/defeat screen & final standings
│   ├── game/
│   │   ├── ArenaEngine.ts      # Core 3D engine, loop, and network bridge
│   │   ├── arena/ArenaMap.ts   # 3D low-poly arena meshes & materials
│   │   ├── audio/FPSAudio.ts   # Procedural Web Audio API sound synthesizer
│   │   ├── effects/EffectManager.ts # Laser tracers & impact sparks
│   │   ├── player/
│   │   │   ├── FPSController.ts# First-person camera, pointer lock, movement
│   │   │   └── WeaponModel.ts  # Viewmodel recoil, muzzle flash & bobbing
│   │   └── remote/RemotePlayer.ts # Remote player model, lerp & billboards
│   ├── network/ColyseusManager.ts # Colyseus client connection manager
│   ├── App.tsx                 # Root React application
│   └── App.css                 # Cyberpunk styling system
├── Dockerfile                  # Production container for Colyseus backend
├── render.yaml                 # 1-click cloud deployment specification
└── vite.config.ts              # Vite config with base: './' for GitHub Pages
```

---

## 🚀 Running Locally

### 1. Start the Multiplayer Server

In terminal 1:
```bash
cd server
npm install
npm start
```
The server will start listening on port `2567`:
- WebSocket endpoint: `ws://localhost:2567`
- Health diagnostic check: `http://localhost:2567/health`

### 2. Start the Frontend Client

In terminal 2:
```bash
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 👥 Two-Player Testing Workflow

To test multiplayer locally with two real browser sessions:

1. Open `http://localhost:5173` in **Browser Window A**.
2. Enter callsign `Striker` and click **QUICK PLAY (PUBLIC MATCH)**.
3. Open `http://localhost:5173` in an **Incognito / Private Window B** (or another browser).
4. Enter callsign `Viper` and click **QUICK PLAY (PUBLIC MATCH)**.
5. Both players will be matched into the public arena room!
   - You will see each other in real-time with smooth movement interpolation.
   - Overhead billboards display the other player's name and health bar.
   - Firing the pulse rifle validates hitscan rays on the server and applies authoritative damage.
   - Press and hold `Tab` to observe real-time scoreboard statistics.

### Private Room Invite Workflow:
1. Player 1 enters callsign and clicks **CREATE PRIVATE MATCH**.
2. An invite code (e.g. `AZ-K7X2`) appears in the HUD top bar. Click it to copy the direct invite link.
3. Player 2 opens the link or pastes `AZ-K7X2` into **JOIN WITH CODE**.
4. Both players enter the private room together!

---

## 🌐 Production Deployment

### Frontend Deployment (GitHub Pages)

GitHub Pages hosts only static frontend bundles. The workflow `.github/workflows/deploy.yml` automatically builds and publishes the client:

1. Push your changes to the `main` branch on GitHub.
2. Under repository **Settings** → **Pages**, set **Build and deployment** source to **GitHub Actions**.
3. (Optional) In repository **Settings** → **Secrets and variables** → **Actions**, add a variable:
   - `VITE_GAME_SERVER_URL`: `wss://your-arena-server.onrender.com` (your deployed server's public WebSocket URL).
4. Every push to `main` will build the static bundle and deploy it to GitHub Pages at `https://<username>.github.io/<repo>/`.

### Server Deployment (Node.js / Docker)

The Colyseus multiplayer backend can be deployed to any Node.js hosting platform with WebSocket support.

#### Option A — Render (Recommended)
1. Fork or push this repository to GitHub.
2. In [Render Dashboard](https://dashboard.render.com/), click **New** → **Web Service**.
3. Connect your repository.
4. Render will automatically detect `render.yaml` or you can manually configure:
   - **Environment**: Docker (uses the root `Dockerfile`)
   - **Port**: `2567`
   - **Health Check Path**: `/health`
5. Once deployed, copy your service's URL (e.g., `arena-zero-server.onrender.com`).
6. Set `VITE_GAME_SERVER_URL=wss://arena-zero-server.onrender.com` in your GitHub repository secrets/variables.

#### Option B — Railway / Fly.io
The included `Dockerfile` builds a lightweight Node.js 22 Alpine image:
```bash
docker build -t arena-zero-server .
docker run -p 2567:2567 arena-zero-server
```

---

## 🎯 Combat & Coordinate Systems Architecture

### World Coordinate System & Facing Direction Convention

ARENA ZERO strictly adheres to a standard Three.js right-handed coordinate system across client and server:
- `+X` = East / Right
- `+Y` = Up
- `+Z` = South
- `-Z` = North (Camera forward when `yaw = 0, pitch = 0`)
- `-X` = West / Left

#### Visual Offset on Remote Character Mesh
* **Native Axis**: The procedural low-poly operator mesh is modeled with its visor, chest plate, and rifle facing `+Z`.
* **Single Model Root Offset**: To align the mesh with the world facing direction (`-Z` at `yaw = 0`), an internal `visualRoot` group has `rotation.y = Math.PI` applied **exactly once**.
* **Aim Direction Independence**: WASD movement vectors are computed relative to camera forward, while mouse aim controls `yaw` and `pitch`. Strafing or walking backward never causes arbitrary 180° facing-direction flips on remote screens.
* **Vertical Aim Tracking**: Remote players smoothly pitch their head mesh and weapon arm to mirror vertical aim angles (`pitch`), giving realistic opponent telegraphing.
* **Inward Spawn Orientations**: All 8 symmetrical arena spawn points are explicitly calibrated so newly spawned and respawned operators immediately face inward toward the central courtyard `(0, 0, 0)`.

---

### Server-Authoritative Combat Pipeline

ARENA ZERO combat is strictly verified on the backend:
```
[Client Mouse Click]
         │
         ▼
[Check Local Cooldown & Ammo]
         │
         ▼
[Send Fire Message (origin, dir, targetHint?)]
         │
         ▼
[Server Validation] ──► Checks shooter alive, rate-limit (140ms), ammo > 0, origin proximity
         │
         ▼
[Authoritative 3D Finite Cylinder Raycast] ──► Evaluates all active enemies (radius: 0.70m - 0.80m, height: 1.8m)
         │
         ▼
[Server-Side Line-of-Sight Occlusion] ──► Raycasts against all obstacles, bunkers & pillars (isLineOfSightClear)
         │
         ▼
[Authoritative Damage Application] ──► Pops spawn shield, deducts HP (Body: 25 HP, Headshot: 45 HP)
         │
         ▼
[State Mutation & Broadcast] ──► Colyseus schema syncs health, sends hit_confirm & damage_received events
         │
         ▼
[Elimination (HP <= 0)] ──► isAlive = false, increments killer score (+100) & kills, broadcasts kill_feed
         │
         ▼
[Authoritative Respawn] ──► After 3.0s delay, restores full 100 HP & 24 ammo at safest spawn point
```

- **Stationary & Active Hit Registration**: Firing at an enemy (even a stationary player at spawn) deals full authoritative damage and immediately pops their spawn bubble.
- **Close-Range Hitscan Threshold**: The raycast minimum distance threshold is set to `0.1m`, guaranteeing responsive hits at point-blank range through maximum weapon range (`120m`).
- **Dead Player Lockout**: Eliminated operators cannot fire weapons or receive duplicate death transitions while awaiting respawn.

---

## 🧪 Automated Verification & Regression Suites

### 1. Colyseus Multi-Client Regression Suite (15 Automated Tests)

Run the automated 15-test multiplayer test suite in `server/`:
```bash
cd server
npm test
```

This headless test suite starts an independent Colyseus game server and connects real WebSocket clients to validate all edge cases:

| Test ID | Test Name | Verified Behavior |
|---|---|---|
| **#1** | Single Player Join & Registration | Player appears exactly once in room state with 100 HP, 24 Ammo |
| **#2** | Clean Leave & Model Cleanup | Session and visual model cleanly removed upon leaving |
| **#3** | Abrupt WebSocket Disconnection | Drops connection without leaving lingering ghost entities |
| **#4** | Reconnect Without Ghost Models | Prunes old stale sessions matching `clientToken`, keeps 1 active model |
| **#5** | Rejoin Stress Cycle | 3 consecutive join/leave cycles complete with 0 lingering models |
| **#6** | Cross-Room Isolation | Stale messages to previous rooms are ignored; room states strictly isolated |
| **#7** | **Remote Player Orientation (0°, 90°, 180°, 270°)** | **Remote clients observe exact look angles without inversions or backward flips** |
| **#8** | **Combat on Stationary Enemies (Close & Medium Range)** | **Stationary target hit at 6m and 1.5m; spawn shield drops and HP reduces** |
| **#9** | **Missed Shot Safety** | Shots aimed away from targets apply 0 damage (target HP remains 100) |
| **#10** | **Wall & Obstacle Occlusion** | Solid bunker wall blocks shot trajectory; 0 damage penetrates |
| **#11** | **Atomic Elimination & Single Kill Event** | 4 shots reduce HP to 0; triggers exactly 1 death and 1 kill feed broadcast |
| **#12** | **Dead Player Shooting Lockout** | Dead player firing packets safely rejected; enemy HP and ammo unchanged |
| **#13** | **Respawn Restores Health & Ammo** | Respawn sets 100 HP and 24 Ammo while preserving match scores (kills/score) |
| **#14** | **Dual-Client State Consistency** | Both clients observe identical synchronized target health |
| **#15** | **Rapid Move & Fire Stress Test** | 20 rapid move & fire packets executed with 0 disconnects and 0 errors |

```
============================================================
                 REGRESSION TEST SUITE REPORT                 
============================================================
[✓ PASS] #1 A player joins and appears exactly once
[✓ PASS] #2 A player leaves and their model is removed
[✓ PASS] #3 A player disconnects unexpectedly and their model is removed
[✓ PASS] #4 The same browser reconnects and does not leave a ghost model
[✓ PASS] #5 Two clients leave and rejoin repeatedly without duplicate models or listeners
[✓ PASS] #6 Old room messages cannot recreate players after leaving the room
[✓ PASS] #7 Rotate Player A through 0, 90, 180, and 270 degrees
[✓ PASS] #8 Fire at stationary enemy at close and medium range
[✓ PASS] #9 A missed shot does not reduce health
[✓ PASS] #10 A wall blocks shots
[✓ PASS] #11 Health reaching zero produces exactly one death and kill event
[✓ PASS] #12 A dead player cannot shoot
[✓ PASS] #13 Respawn restores health without resetting the match score
[✓ PASS] #14 Both clients observe consistent health, death, and score updates
[✓ PASS] #15 Repeated firing and movement does not cause disconnects or crashes
------------------------------------------------------------
TOTAL: 15 / 15 PASSED
SERVER CRASH STATUS: HEALTHY & STABLE
============================================================
```

### 2. End-to-End Simulation Script

Run the multi-client simulation script:
```bash
node scripts/verify_multiplayer.mjs
```

---

## 🛡️ Security & Anti-Cheat Measures

- **No Client Damage Authority**: Clients send only origin and ray angle vectors; the server performs the authoritative raycast and calculates damage.
- **Line-of-Sight Occlusion**: Raycasts are tested against solid arena bounding boxes (`isLineOfSightClear`). Shots cannot penetrate obstacles.
- **Speed Limiting**: Client movement deltas are validated against `MAX_CLIENT_SPEED_TOLERANCE` on every tick, preventing speed hacking and coordinate tampering.
- **Ammunition & Rate Cooldowns**: Mag sizes (24 rounds) and 140ms fire rate cooldowns are enforced strictly on the server.
- **Nickname Sanitization**: Callsigns are stripped of non-alphanumeric characters, clamped to 15 characters, and rendered safely.
