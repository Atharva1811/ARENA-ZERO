import http from 'http';
import colyseus from 'colyseus';
import { matchMaker } from '@colyseus/core';
import { Client, Room } from 'colyseus.js';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './src/rooms/ArenaRoom.js';
import { ArenaState } from './src/rooms/schema/ArenaState.js';

const { Server } = colyseus;

async function runMultiWeaponTests() {
  const port = 2598;
  const server = http.createServer();
  const gameServer = new Server({
    transport: new WebSocketTransport({ server }),
  });

  gameServer.define('arena_public', ArenaRoom).enableRealtimeListing();

  await gameServer.listen(port);
  console.log(`[Multi-Weapon Test Server] Running on ws://localhost:${port}`);

  try {
    const colyseusClientA = new Client(`ws://localhost:${port}`);
    const colyseusClientB = new Client(`ws://localhost:${port}`);

    const roomA: Room<ArenaState> = await colyseusClientA.joinOrCreate('arena_public', {
      nickname: 'WeaponTesterA',
      clientToken: 'token_weapon_A',
    });
    const roomB: Room<ArenaState> = await colyseusClientB.joinOrCreate('arena_public', {
      nickname: 'WeaponTesterB',
      clientToken: 'token_weapon_B',
    });

    console.log(`Connected: Player A (${roomA.sessionId}), Player B (${roomB.sessionId})`);
    await new Promise((r) => setTimeout(r, 200));

    const serverRoom = matchMaker.getRoomById(roomA.id) as ArenaRoom;
    if (!serverRoom) {
      throw new Error('Server room instance could not be located.');
    }

    const getPlayerA = () => serverRoom.state.players.get(roomA.sessionId)!;
    const getPlayerB = () => serverRoom.state.players.get(roomB.sessionId)!;

    // Helper to position players
    const positionPlayers = (pA: { x: number; y: number; z: number; yaw: number }, pB: { x: number; y: number; z: number }) => {
      const a = getPlayerA();
      const b = getPlayerB();
      a.x = pA.x;
      a.y = pA.y;
      a.z = pA.z;
      a.yaw = pA.yaw;
      b.x = pB.x;
      b.y = pB.y;
      b.z = pB.z;
      b.health = 100;
      b.isAlive = true;
    };

    // =========================================================================
    // Scenario 1: Initial Spawning and Default Weapon State
    // =========================================================================
    console.log('\n--- Scenario 1: Initial Spawning and Default Weapon State ---');
    const pA = getPlayerA();
    if (pA.currentWeapon !== 'rifle') {
      throw new Error(`Expected initial currentWeapon 'rifle', got ${pA.currentWeapon}`);
    }
    if (pA.ammo !== 24) {
      throw new Error(`Expected initial rifle ammo 24, got ${pA.ammo}`);
    }
    if (pA.reserveAmmo !== 72) {
      throw new Error(`Expected initial rifle reserve 72, got ${pA.reserveAmmo}`);
    }
    console.log(`[Scenario 1 PASSED]: Default equipped weapon: ${pA.currentWeapon}, ammo: ${pA.ammo}/${pA.reserveAmmo}`);

    // =========================================================================
    // Scenario 2: Weapon Switching Flow & State Synchronization
    // =========================================================================
    console.log('\n--- Scenario 2: Weapon Switching & Ammunition Preservation ---');

    // Switch to Pistol
    roomA.send('switch_weapon', { weaponId: 'pistol' });
    await new Promise((r) => setTimeout(r, 150));
    if (pA.currentWeapon !== 'pistol' || pA.ammo !== 12 || pA.reserveAmmo !== 48) {
      throw new Error(`Expected pistol state (12/48), got ${pA.currentWeapon} (${pA.ammo}/${pA.reserveAmmo})`);
    }

    // Switch to Knife
    roomA.send('switch_weapon', { weaponId: 'knife' });
    await new Promise((r) => setTimeout(r, 150));
    if (pA.currentWeapon !== 'knife' || pA.ammo !== 0 || pA.reserveAmmo !== 0) {
      throw new Error(`Expected knife state (0/0), got ${pA.currentWeapon} (${pA.ammo}/${pA.reserveAmmo})`);
    }

    // Switch to Sniper
    roomA.send('switch_weapon', { weaponId: 'sniper' });
    await new Promise((r) => setTimeout(r, 150));
    if (pA.currentWeapon !== 'sniper' || pA.ammo !== 5 || pA.reserveAmmo !== 20) {
      throw new Error(`Expected sniper state (5/20), got ${pA.currentWeapon} (${pA.ammo}/${pA.reserveAmmo})`);
    }

    // Switch back to Rifle
    roomA.send('switch_weapon', { weaponId: 'rifle' });
    await new Promise((r) => setTimeout(r, 150));
    if (pA.currentWeapon !== 'rifle' || pA.ammo !== 24 || pA.reserveAmmo !== 72) {
      throw new Error(`Expected rifle state (24/72), got ${pA.currentWeapon} (${pA.ammo}/${pA.reserveAmmo})`);
    }
    console.log('[Scenario 2 PASSED]: Seamless weapon switching across all 4 weapon types verified.');

    // =========================================================================
    // Scenario 3: Combat Knife Melee Validation (Range, Angle, Cooldown, Damage)
    // =========================================================================
    console.log('\n--- Scenario 3: Combat Knife Melee Validation ---');
    roomA.send('switch_weapon', { weaponId: 'knife' });
    await new Promise((r) => setTimeout(r, 150));

    // Sub-case 3A: Out-of-range melee attack (> 2.0m)
    positionPlayers({ x: 0, y: 0, z: 20, yaw: 0 }, { x: 0, y: 0, z: 16.5 }); // Distance = 3.5m
    const pB = getPlayerB();
    roomA.send('fire', {
      shotId: 'shot_knife_far',
      originX: 0,
      originY: 1.6,
      originZ: 20,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'knife',
      isMelee: true,
    });
    await new Promise((r) => setTimeout(r, 150));
    if (pB.health !== 100) {
      throw new Error(`Expected target to take 0 damage from out-of-range knife (3.5m), got HP=${pB.health}`);
    }
    console.log('Out-of-range knife melee correctly rejected (0 damage).');

    // Wait for knife cooldown (650 ms) before next attack
    await new Promise((r) => setTimeout(r, 700));

    // Sub-case 3B: In-range melee attack (1.2m, facing target)
    positionPlayers({ x: 0, y: 0, z: 20, yaw: 0 }, { x: 0, y: 0, z: 18.8 }); // Distance = 1.2m
    roomA.send('fire', {
      shotId: 'shot_knife_hit_1',
      originX: 0,
      originY: 1.6,
      originZ: 20,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'knife',
      isMelee: true,
    });
    await new Promise((r) => setTimeout(r, 150));
    if (pB.health !== 55) {
      throw new Error(`Expected target HP=55 after 45 HP knife damage, got HP=${pB.health}`);
    }
    console.log(`In-range knife strike dealt exactly 45 damage (Target HP=${pB.health}).`);

    // Sub-case 3C: Rapid knife slash during cooldown (< 650 ms)
    roomA.send('fire', {
      shotId: 'shot_knife_rapid',
      originX: 0,
      originY: 1.6,
      originZ: 20,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'knife',
      isMelee: true,
    });
    await new Promise((r) => setTimeout(r, 100));
    if (pB.health !== 55) {
      throw new Error(`Expected cooldown rejection for rapid knife slash, got HP=${pB.health}`);
    }
    console.log('Rapid knife attack during 650ms cooldown correctly rejected.');

    // Sub-case 3D: Knife attack after cooldown (> 650 ms)
    await new Promise((r) => setTimeout(r, 600));
    roomA.send('fire', {
      shotId: 'shot_knife_hit_2',
      originX: 0,
      originY: 1.6,
      originZ: 20,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'knife',
      isMelee: true,
    });
    await new Promise((r) => setTimeout(r, 150));
    if (pB.health !== 10) {
      throw new Error(`Expected target HP=10 after second knife slash, got HP=${pB.health}`);
    }
    console.log(`[Scenario 3 PASSED]: Melee knife range (2.0m), cooldown (650ms), and 45 HP damage verified.`);

    // =========================================================================
    // Scenario 4: Pistol Semi-Automatic Fire, Damage & Rate Limiting
    // =========================================================================
    console.log('\n--- Scenario 4: Pistol Semi-Automatic Combat ---');
    roomA.send('switch_weapon', { weaponId: 'pistol' });
    await new Promise((r) => setTimeout(r, 150));
    positionPlayers({ x: 0, y: 0, z: 20, yaw: 0 }, { x: 0, y: 0, z: 15 }); // 5m distance

    // Body shot: 25 HP damage
    roomA.send('fire', {
      shotId: 'shot_pistol_body',
      originX: 0,
      originY: 1.2,
      originZ: 20,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'pistol',
      isMelee: false,
    });
    await new Promise((r) => setTimeout(r, 150));
    if (pB.health !== 75) {
      throw new Error(`Expected HP=75 after 25 HP pistol body shot, got HP=${pB.health}`);
    }
    if (pA.ammo !== 11) {
      throw new Error(`Expected pistol ammo 11, got ${pA.ammo}`);
    }
    console.log(`Pistol body shot dealt 25 damage (Target HP=${pB.health}, Ammo=${pA.ammo}/48).`);

    // Rapid rate limit check (300 RPM = 200 ms interval)
    roomA.send('fire', {
      shotId: 'shot_pistol_rapid_reject',
      originX: 0,
      originY: 1.2,
      originZ: 20,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'pistol',
      isMelee: false,
    });
    await new Promise((r) => setTimeout(r, 50));
    if (pB.health !== 75) {
      throw new Error(`Expected rapid shot to be rejected by 300 RPM rate limit, got HP=${pB.health}`);
    }
    console.log('Pistol 300 RPM (200ms) rate limiter correctly enforced.');

    // Wait out cooldown (220 ms) then deliver headshot (50 HP damage)
    await new Promise((r) => setTimeout(r, 220));
    roomA.send('fire', {
      shotId: 'shot_pistol_headshot',
      originX: 0,
      originY: 1.65,
      originZ: 20,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'pistol',
      isMelee: false,
    });
    await new Promise((r) => setTimeout(r, 150));
    if (pB.health !== 25) {
      throw new Error(`Expected HP=25 after 50 HP pistol headshot, got HP=${pB.health}`);
    }
    console.log(`[Scenario 4 PASSED]: Pistol semi-auto 25 body / 50 headshot damage and 300 RPM limits verified.`);

    // =========================================================================
    // Scenario 5: Precision Sniper Rifle 1-Hit Lethal Headshot Elimination
    // =========================================================================
    console.log('\n--- Scenario 5: Precision Sniper Rifle High-Caliber Combat ---');
    roomA.send('switch_weapon', { weaponId: 'sniper' });
    await new Promise((r) => setTimeout(r, 150));
    positionPlayers({ x: 5, y: 0, z: 25, yaw: 0 }, { x: 5, y: 0, z: 5 }); // 20m distance along clear corridor

    // Wait for sniper chamber cycle (1333 ms)
    await new Promise((r) => setTimeout(r, 1400));

    // Body shot: 90 HP damage
    roomA.send('fire', {
      shotId: 'shot_sniper_body',
      originX: 5,
      originY: 1.2,
      originZ: 25,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'sniper',
      isMelee: false,
    });
    await new Promise((r) => setTimeout(r, 150));
    if (pB.health !== 10) {
      throw new Error(`Expected target HP=10 after 90 HP sniper body shot, got HP=${pB.health}`);
    }
    console.log(`Sniper body shot delivered 90 damage (Target HP=${pB.health}, Ammo=${pA.ammo}/20).`);

    // Reset Player B to full 100 HP to test 1-shot lethal headshot (180 damage)
    pB.health = 100;
    pB.isAlive = true;

    // Rate limit check: 45 RPM (1333 ms interval). Immediate fire must be rejected!
    roomA.send('fire', {
      shotId: 'shot_sniper_rapid_reject',
      originX: 5,
      originY: 1.65,
      originZ: 25,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'sniper',
      isMelee: false,
    });
    await new Promise((r) => setTimeout(r, 100));
    if (pB.health !== 100) {
      throw new Error(`Expected sniper shot during 1333ms cooldown to be rejected, got HP=${pB.health}`);
    }
    console.log('Sniper 45 RPM (1333ms) heavy chambering cooldown correctly enforced.');

    // Wait for sniper chamber cycle (1350 ms)
    await new Promise((r) => setTimeout(r, 1350));

    // High-power headshot: 180 HP damage -> 1-shot lethal elimination!
    const killerScoreBefore = pA.score;
    const killerKillsBefore = pA.kills;
    roomA.send('fire', {
      shotId: 'shot_sniper_lethal_headshot',
      originX: 5,
      originY: 1.65,
      originZ: 25,
      dirX: 0,
      dirY: 0,
      dirZ: -1,
      targetSessionId: roomB.sessionId,
      weaponId: 'sniper',
      isMelee: false,
    });
    await new Promise((r) => setTimeout(r, 200));

    if (pB.isAlive || pB.health !== 0) {
      throw new Error(`Expected Player B eliminated (isAlive=false, HP=0) by sniper headshot, got HP=${pB.health}, isAlive=${pB.isAlive}`);
    }
    if (pA.kills !== killerKillsBefore + 1) {
      throw new Error(`Expected killer kills to increase by 1, got ${pA.kills}`);
    }
    if (pA.score !== killerScoreBefore + 100) {
      throw new Error(`Expected killer score to increase by 100, got ${pA.score}`);
    }
    console.log(`[Scenario 5 PASSED]: Sniper 1-shot lethal headshot (180 DMG) elimination verified. Killer kills=${pA.kills}, score=${pA.score}.`);

    // =========================================================================
    // Scenario 6: Per-Weapon Reload & Reserve Ammunition Deduction
    // =========================================================================
    console.log('\n--- Scenario 6: Per-Weapon Reload & Reserve Ammunition ---');
    // Currently sniper ammo was 5 - 2 = 3, reserve = 20
    const ammoBeforeReload = pA.ammo;
    const reserveBeforeReload = pA.reserveAmmo;
    console.log(`Sniper ammo before reload: ${ammoBeforeReload} / ${reserveBeforeReload}`);

    // Trigger reload
    roomA.send('reload');
    // Wait for sniper reload duration (2500 ms) + small margin
    await new Promise((r) => setTimeout(r, 2600));

    if (pA.ammo !== 5) {
      throw new Error(`Expected sniper magazine filled to 5, got ${pA.ammo}`);
    }
    const expectedReserve = reserveBeforeReload - (5 - ammoBeforeReload);
    if (pA.reserveAmmo !== expectedReserve) {
      throw new Error(`Expected sniper reserve ${expectedReserve}, got ${pA.reserveAmmo}`);
    }
    console.log(`[Scenario 6 PASSED]: Reload complete. Magazine restored to ${pA.ammo}, reserve deducted to ${pA.reserveAmmo}.`);

    console.log('\n=======================================================');
    console.log('ALL MULTI-WEAPON COMBAT SUITE SCENARIOS PASSED WITH 100% SUCCESS!');
    console.log('=======================================================\n');
  } catch (err: any) {
    console.error('CRITICAL ERROR IN MULTI-WEAPON TEST:', err?.message || err);
    console.error(err?.stack);
    throw err;
  } finally {
    await gameServer.gracefullyShutdown();
    server.close();
  }
}

runMultiWeaponTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Multi-Weapon Test Failed:', err);
    process.exit(1);
  });
