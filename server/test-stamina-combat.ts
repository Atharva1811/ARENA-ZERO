import http from 'http';
import colyseus from 'colyseus';
import { matchMaker } from '@colyseus/core';
import { Client, Room } from 'colyseus.js';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ArenaRoom } from './src/rooms/ArenaRoom.js';
import { ArenaState } from './src/rooms/schema/ArenaState.js';
import { GAME_CONSTANTS } from '../shared/constants.js';

const { Server } = colyseus;

async function runStaminaCombatTests() {
  const port = 2596;
  const server = http.createServer();
  const gameServer = new Server({
    transport: new WebSocketTransport({ server }),
  });

  gameServer.define('arena_public', ArenaRoom).enableRealtimeListing();
  gameServer.define('arena_private', ArenaRoom);

  await gameServer.listen(port);
  console.log(`[Stamina & Combat Test Server] Running on ws://localhost:${port}`);

  try {
    const colyseusClientA = new Client(`ws://localhost:${port}`);
    const colyseusClientB = new Client(`ws://localhost:${port}`);

    const roomA: Room<ArenaState> = await colyseusClientA.joinOrCreate('arena_public', {
      nickname: 'CombatTesterA',
      clientToken: 'token_stamina_A',
    });
    const roomB: Room<ArenaState> = await colyseusClientB.joinOrCreate('arena_public', {
      nickname: 'CombatTesterB',
      clientToken: 'token_stamina_B',
    });

    console.log(`Connected: Player A (${roomA.sessionId}), Player B (${roomB.sessionId})`);
    await new Promise((r) => setTimeout(r, 200));

    // Access room instance on server
    const serverRoom = matchMaker.getRoomById(roomA.id) as ArenaRoom;
    if (!serverRoom) {
      throw new Error('Server room instance could not be located in matchMaker.');
    }

    const getPlayerA = () => serverRoom.state.players.get(roomA.sessionId)!;
    const getPlayerB = () => serverRoom.state.players.get(roomB.sessionId)!;
    const pAServer = getPlayerA();
    const pBServer = getPlayerB();

    if (!pAServer || !pBServer) {
      throw new Error('Players not found in server room state.');
    }

    // =========================================================================
    // Scenario 1: Initial state validation
    // =========================================================================
    console.log('\n--- Scenario 1: Initial Player State Validation ---');
    if (pAServer.stamina !== GAME_CONSTANTS.MAX_STAMINA) {
      throw new Error(`Expected initial stamina ${GAME_CONSTANTS.MAX_STAMINA}, got ${pAServer.stamina}`);
    }
    if (pAServer.maxStamina !== GAME_CONSTANTS.MAX_STAMINA) {
      throw new Error(`Expected initial maxStamina ${GAME_CONSTANTS.MAX_STAMINA}, got ${pAServer.maxStamina}`);
    }
    if (pAServer.ammo !== GAME_CONSTANTS.MAGAZINE_SIZE) {
      throw new Error(`Expected initial ammo ${GAME_CONSTANTS.MAGAZINE_SIZE}, got ${pAServer.ammo}`);
    }
    if (pAServer.reserveAmmo !== GAME_CONSTANTS.MAX_RESERVE_AMMO) {
      throw new Error(`Expected initial reserveAmmo ${GAME_CONSTANTS.MAX_RESERVE_AMMO}, got ${pAServer.reserveAmmo}`);
    }
    if (pAServer.fireMode !== 'AUTO') {
      throw new Error(`Expected initial fireMode 'AUTO', got ${pAServer.fireMode}`);
    }
    console.log(`[Scenario 1 PASSED]: Initial stamina=${pAServer.stamina}, ammo=${pAServer.ammo}/${pAServer.reserveAmmo}, fireMode=${pAServer.fireMode}`);

    // =========================================================================
    // Scenario 2: Sprint Stamina Drain (25 pts/sec)
    // =========================================================================
    console.log('\n--- Scenario 2: Sprint Stamina Drain ---');
    roomA.send('move', {
      x: 0,
      y: 0,
      z: 10,
      yaw: 0,
      pitch: 0,
      isMoving: true,
      isSprinting: true,
    });

    // Wait 1.0 second of sprinting
    await new Promise((r) => setTimeout(r, 1000));

    console.log(`Stamina after 1s sprint: ${pAServer.stamina.toFixed(1)} / 100 (isSprinting=${pAServer.isSprinting})`);
    if (pAServer.stamina >= 95 || pAServer.stamina <= 60) {
      throw new Error(`Expected stamina between 65 and 85 after 1s sprint at 25/sec, got ${pAServer.stamina}`);
    }
    if (!pAServer.isSprinting) {
      throw new Error('Expected player to be sprinting.');
    }
    console.log('[Scenario 2 PASSED]: Sprint drains stamina authoritatively.');

    // =========================================================================
    // Scenario 3: Normal Walking Does Not Consume Stamina
    // =========================================================================
    console.log('\n--- Scenario 3: Walking Does Not Consume Stamina ---');
    const staminaBeforeWalk = pAServer.stamina;
    roomA.send('move', {
      x: 0,
      y: 0,
      z: 11,
      yaw: 0,
      pitch: 0,
      isMoving: true,
      isSprinting: false,
    });

    await new Promise((r) => setTimeout(r, 400));
    console.log(`Stamina before walk=${staminaBeforeWalk.toFixed(1)}, after 400ms walk=${pAServer.stamina.toFixed(1)}`);
    if (pAServer.stamina < staminaBeforeWalk - 0.5) {
      throw new Error(`Walking drained stamina! before=${staminaBeforeWalk}, after=${pAServer.stamina}`);
    }
    console.log('[Scenario 3 PASSED]: Walking preserves stamina.');

    // =========================================================================
    // Scenario 4: Stamina Regeneration with 1-Second Delay
    // =========================================================================
    console.log('\n--- Scenario 4: Stamina Regeneration with Delay ---');
    // Sprint again for 1s to ensure a clear deficit
    roomA.send('move', { x: 0, y: 0, z: 12, yaw: 0, pitch: 0, isMoving: true, isSprinting: true });
    await new Promise((r) => setTimeout(r, 1000));
    const staminaAfterSprint = pAServer.stamina;

    // Stop sprint, walk or idle
    roomA.send('move', { x: 0, y: 0, z: 12, yaw: 0, pitch: 0, isMoving: false, isSprinting: false });

    // Check during delay (500ms after sprint stopped)
    await new Promise((r) => setTimeout(r, 500));
    const staminaDuringDelay = pAServer.stamina;
    if (staminaDuringDelay > staminaAfterSprint + 1.0) {
      throw new Error(`Stamina regenerated prematurely before 1s delay! before=${staminaAfterSprint}, during=${staminaDuringDelay}`);
    }

    // Wait another 1.2s (total 1.7s after sprint stopped -> regen active for 0.7s at 20/s = ~14 pts)
    await new Promise((r) => setTimeout(r, 1200));
    const staminaAfterRegen = pAServer.stamina;
    console.log(`Stamina after 1s delay + 0.7s regen: ${staminaAfterRegen.toFixed(1)} (was ${staminaAfterSprint.toFixed(1)})`);
    if (staminaAfterRegen <= staminaDuringDelay + 5.0) {
      throw new Error(`Stamina failed to regenerate after delay! during=${staminaDuringDelay}, after=${staminaAfterRegen}`);
    }
    console.log('[Scenario 4 PASSED]: Stamina delays 1s then regenerates smoothly.');

    // =========================================================================
    // Scenario 5: Sprint Cutoff at 0 Stamina & Minimum Threshold (10)
    // =========================================================================
    console.log('\n--- Scenario 5: Sprint Cutoff at 0 Stamina and Minimum Threshold ---');
    // Artificially set stamina to 5 and sprint to quickly test exhaustion
    pAServer.stamina = 5;
    pAServer.lastSprintTime = Date.now();
    pAServer.isSprinting = true;
    pAServer.isMoving = true;
    roomA.send('move', { x: 0, y: 0, z: 13, yaw: 0, pitch: 0, isMoving: true, isSprinting: true });

    // Wait 350ms (at 25/sec, 5 stamina is exhausted in 200ms)
    await new Promise((r) => setTimeout(r, 350));
    console.log(`Stamina after draining: ${pAServer.stamina.toFixed(1)}, isSprinting=${pAServer.isSprinting}`);
    if (pAServer.stamina > 0.01) {
      throw new Error(`Stamina should be 0, got ${pAServer.stamina}`);
    }
    if (pAServer.isSprinting) {
      throw new Error('isSprinting should be false when stamina hits 0.');
    }

    // Attempt to sprint immediately while stamina is still below MIN_STAMINA_TO_SPRINT (10)
    pAServer.stamina = 4; // Below threshold
    roomA.send('move', { x: 0, y: 0, z: 14, yaw: 0, pitch: 0, isMoving: true, isSprinting: true });
    await new Promise((r) => setTimeout(r, 100));
    if (pAServer.isSprinting) {
      throw new Error('Server allowed sprinting while stamina is below minimum threshold (10)!');
    }

    // Now set stamina above threshold (15) and attempt sprint
    pAServer.stamina = 15;
    roomA.send('move', { x: 0, y: 0, z: 15, yaw: 0, pitch: 0, isMoving: true, isSprinting: true });
    await new Promise((r) => setTimeout(r, 100));
    if (!pAServer.isSprinting) {
      throw new Error('Server rejected sprinting even though stamina is >= 10!');
    }
    console.log('[Scenario 5 PASSED]: Stamina cutoff at 0 and minimum threshold strictly enforced.');

    // Reset player movement and stamina to full
    pAServer.stamina = 100;
    roomA.send('move', { x: 0, y: 0, z: 15, yaw: 0, pitch: 0, isMoving: false, isSprinting: false });

    // =========================================================================
    // Scenario 6: Fire Mode Toggle (AUTO <-> SINGLE)
    // =========================================================================
    console.log('\n--- Scenario 6: Fire Mode Toggle (B Key) ---');
    if (getPlayerA().fireMode !== 'AUTO') throw new Error(`Initial fire mode should be AUTO, got ${getPlayerA().fireMode}`);

    roomA.send('toggle_fire_mode', {});
    await new Promise((r) => setTimeout(r, 100));
    if (getPlayerA().fireMode !== 'SINGLE') throw new Error(`After toggle, expected fireMode SINGLE, got ${getPlayerA().fireMode}`);

    roomA.send('toggle_fire_mode', {});
    await new Promise((r) => setTimeout(r, 100));
    if (getPlayerA().fireMode !== 'AUTO') throw new Error(`After second toggle, expected fireMode AUTO, got ${getPlayerA().fireMode}`);
    console.log('[Scenario 6 PASSED]: Fire mode toggles cleanly between AUTO and SINGLE.');

    // =========================================================================
    // Scenario 7: Firing Mechanics & Server Authoritative Ammo
    // =========================================================================
    console.log('\n--- Scenario 7: Firing Consumption ---');
    const ammoBeforeFire = pAServer.ammo;
    roomA.send('fire', {
      shotId: 'test_shot_1',
      originX: pAServer.x,
      originY: 1.65,
      originZ: pAServer.z,
      dirX: 0,
      dirY: 0,
      dirZ: 1,
    });
    await new Promise((r) => setTimeout(r, 100));
    if (pAServer.ammo !== ammoBeforeFire - 1) {
      throw new Error(`Ammo was not decremented! before=${ammoBeforeFire}, after=${pAServer.ammo}`);
    }
    console.log(`[Scenario 7 PASSED]: Shot decremented ammo to ${pAServer.ammo}.`);

    // =========================================================================
    // Scenario 8: Automatic Reload on Empty Magazine & Reserve Ammo Transfer
    // =========================================================================
    console.log('\n--- Scenario 8: Automatic Reload on Empty Magazine ---');
    // Set ammo to 1 so the next shot empties the magazine
    pAServer.ammo = 1;
    pAServer.reserveAmmo = 72;
    pAServer.isReloading = false;
    pAServer.isReloadingInternal = false;

    roomA.send('fire', {
      shotId: 'test_shot_empty',
      originX: pAServer.x,
      originY: 1.65,
      originZ: pAServer.z,
      dirX: 0,
      dirY: 0,
      dirZ: 1,
    });

    await new Promise((r) => setTimeout(r, 100));
    console.log(`After emptying shot: ammo=${pAServer.ammo}, isReloading=${pAServer.isReloading}, reserveAmmo=${pAServer.reserveAmmo}`);
    if (pAServer.ammo !== 0) {
      throw new Error(`Expected ammo 0, got ${pAServer.ammo}`);
    }
    if (!pAServer.isReloading || !pAServer.isReloadingInternal) {
      throw new Error('Expected auto-reload to be initiated when magazine reached 0!');
    }

    // Try to fire while reloading - server must reject
    roomA.send('fire', {
      shotId: 'test_shot_during_reload',
      originX: pAServer.x,
      originY: 1.65,
      originZ: pAServer.z,
      dirX: 0,
      dirY: 0,
      dirZ: 1,
    });
    await new Promise((r) => setTimeout(r, 100));
    if (pAServer.ammo !== 0) {
      throw new Error('Shooting during reload was not blocked!');
    }

    // Wait for reload completion (1500ms + buffer)
    console.log('Waiting for reload completion (1.6s)...');
    await new Promise((r) => setTimeout(r, 1600));

    console.log(`After reload completion: ammo=${getPlayerA().ammo}, reserveAmmo=${getPlayerA().reserveAmmo}, isReloading=${getPlayerA().isReloading}`);
    if (getPlayerA().ammo !== GAME_CONSTANTS.MAGAZINE_SIZE) {
      throw new Error(`Expected ammo ${GAME_CONSTANTS.MAGAZINE_SIZE}, got ${getPlayerA().ammo}`);
    }
    if (getPlayerA().reserveAmmo !== 72 - GAME_CONSTANTS.MAGAZINE_SIZE) {
      throw new Error(`Expected reserveAmmo ${72 - GAME_CONSTANTS.MAGAZINE_SIZE}, got ${getPlayerA().reserveAmmo}`);
    }
    if (getPlayerA().isReloading) {
      throw new Error('Expected isReloading to be false after reload.');
    }
    console.log('[Scenario 8 PASSED]: Automatic reload accurately transfers ammo from reserve.');

    // =========================================================================
    // Scenario 9: Partial Magazine Reload & Reserve Ammo Exhaustion
    // =========================================================================
    console.log('\n--- Scenario 9: Partial Reload & Reserve Exhaustion ---');
    pAServer.ammo = 0;
    pAServer.reserveAmmo = 10; // Only 10 bullets left in reserve
    pAServer.isReloading = false;
    pAServer.isReloadingInternal = false;

    // Trigger reload
    roomA.send('reload');
    await new Promise((r) => setTimeout(r, 100));
    if (!pAServer.isReloading) {
      throw new Error('Reload was not started for partial reserve!');
    }

    await new Promise((r) => setTimeout(r, 1600));
    console.log(`After partial reload: ammo=${pAServer.ammo}, reserveAmmo=${pAServer.reserveAmmo}`);
    if (pAServer.ammo !== 10) {
      throw new Error(`Expected ammo to be 10, got ${pAServer.ammo}`);
    }
    if (pAServer.reserveAmmo !== 0) {
      throw new Error(`Expected reserveAmmo to be 0, got ${pAServer.reserveAmmo}`);
    }

    // When reserveAmmo === 0 and ammo === 0, reload must not start
    pAServer.ammo = 0;
    pAServer.reserveAmmo = 0;
    roomA.send('reload');
    await new Promise((r) => setTimeout(r, 100));
    if (pAServer.isReloading) {
      throw new Error('Reload should not start when reserveAmmo is 0!');
    }
    console.log('[Scenario 9 PASSED]: Partial reserve and empty reserve handled accurately.');

    // =========================================================================
    // Scenario 10: Death and Respawn Resets
    // =========================================================================
    console.log('\n--- Scenario 10: Death and Respawn Resets ---');
    // Deplete stamina and ammo, set fireMode to SINGLE
    pAServer.stamina = 20;
    pAServer.ammo = 5;
    pAServer.reserveAmmo = 15;
    pAServer.isSprinting = true;

    // Apply lethal damage to Player A
    pAServer.health = 0;
    pAServer.isAlive = false;
    pAServer.respawnTime = Date.now() + 1000;

    // Run a server update cycle
    (serverRoom as any).update(50);

    // Verify dead player cannot sprint
    if (pAServer.isSprinting) {
      throw new Error('Dead player should not be sprinting!');
    }

    // Wait for auto-respawn
    console.log('Waiting for respawn (1.2s)...');
    await new Promise((r) => setTimeout(r, 1200));

    console.log(`After respawn: health=${pAServer.health}, stamina=${pAServer.stamina}, ammo=${pAServer.ammo}, reserveAmmo=${pAServer.reserveAmmo}, isAlive=${pAServer.isAlive}`);
    if (!pAServer.isAlive) throw new Error('Player was not respawned!');
    if (pAServer.health !== GAME_CONSTANTS.MAX_HEALTH) throw new Error('Health not reset on respawn!');
    if (pAServer.stamina !== GAME_CONSTANTS.MAX_STAMINA) throw new Error('Stamina not reset to 100 on respawn!');
    if (pAServer.ammo !== GAME_CONSTANTS.MAGAZINE_SIZE) throw new Error('Ammo not reset to 24 on respawn!');
    if (pAServer.reserveAmmo !== GAME_CONSTANTS.MAX_RESERVE_AMMO) throw new Error('Reserve ammo not reset to 72 on respawn!');
    if (pAServer.isSprinting) throw new Error('isSprinting should be false on respawn!');
    console.log('[Scenario 10 PASSED]: Death and respawn cleanly restore all combat and stamina properties.');

    // =========================================================================
    // Clean Up
    // =========================================================================
    await roomA.leave();
    await roomB.leave();
    await gameServer.gracefullyShutdown();
    server.close();

    console.log('\n==================================================================');
    console.log(' [SUCCESS] ALL 10 STAMINA, FIRING MODES & AUTO-RELOAD TESTS PASSED! ');
    console.log('==================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n[TEST FAILURE]:', err);
    try {
      await gameServer.gracefullyShutdown();
      server.close();
    } catch {}
    process.exit(1);
  }
}

runStaminaCombatTests();
