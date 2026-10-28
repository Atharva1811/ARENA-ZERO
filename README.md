# ⚡ ARENA ZERO — No-Login Multiplayer Browser FPS

A complete, playable, stylized 3D multiplayer first-person shooter (FPS) running directly in modern web browsers.

Players join instantly using just a callsign/nickname — **no registration, accounts, passwords, or OAuth required**.

---

## 🌟 Highlights & Features

- **Instant Frictionless Combat**: Jump directly into public matchmaking or create private invite-only matches with 4-character codes (`AZ-XXXX`) or shareable URLs (`?room=AZ-XXXX`).
- **First-Person Tactical Controls**: Full Pointer Lock API mouse-look, camera-relative WASD movement, thruster jump, sprint, and reload mechanics.
- **Server-Authoritative Combat**: The Colyseus Node.js server validates ammunition, fire rate cooldowns, line-of-sight raycasting against arena obstacles, player health, kills, respawns, and match scoring. Client claims of damage or coordinates are never trusted.
- **Anti-Wallhack & Obstacle Occlusion**: Server-side line-of-sight raycasting checks prevent shots from passing through solid arena walls or cover blocks.
- **Low-Poly Sci-Fi Arena**: Compact 28m combat ring featuring a central reactor core, 4 corner obelisk towers, raised central platform, tactical cover bunkers, and flank ramparts.
- **Spawn Protection**: Freshly spawned or respawned players receive a temporary 2.5s invulnerability shield to mitigate spawn camping.
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

## 🧪 Automated Verification Suite

Run the full end-to-end automated verification script:
```bash
node scripts/verify_multiplayer.mjs
```

This script spins up two independent Colyseus clients in Node, connects them to the backend, tests room synchronization, moves them, waits for spawn shields to dissipate, executes hitscan combat, verifies server-validated damage deduction, and tests private room code creation and joining.

```
===============================================================
       ALL ARENA ZERO MULTIPLAYER VERIFICATIONS PASSED!        
===============================================================
```

---

## 🛡️ Security & Anti-Cheat Measures

- **No Client Damage Authority**: Clients send only origin and ray angle vectors; the server performs the authoritative raycast and calculates damage.
- **Line-of-Sight Occlusion**: Raycasts are tested against solid arena bounding boxes (`isLineOfSightClear`). Shots cannot penetrate obstacles.
- **Speed Limiting**: Client movement deltas are validated against `MAX_CLIENT_SPEED_TOLERANCE` on every tick, preventing speed hacking and coordinate tampering.
- **Ammunition & Rate Cooldowns**: Mag sizes and 140ms fire rate cooldowns are enforced strictly on the server.
- **Nickname Sanitization**: Callsigns are stripped of non-alphanumeric characters, clamped to 14 characters, and rendered safely.
