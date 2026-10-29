import * as THREE from 'three';
import { ArenaMap } from './arena/ArenaMap';
import { FPSController } from './player/FPSController';
import { WeaponModel } from './player/WeaponModel';
import { FPSAudio } from './audio/FPSAudio';
import { EffectManager } from './effects/EffectManager';
import { RemotePlayer } from './remote/RemotePlayer';
import { ColyseusManager } from '../network/ColyseusManager';
import { GAME_CONSTANTS } from '../../shared/constants';
import type { KillFeedItem, MatchWinnerPayload } from '../../shared/types';

export interface PlayerScoreEntry {
  sessionId: string;
  nickname: string;
  color: string;
  score: number;
  kills: number;
  deaths: number;
  ping?: number;
  isSelf: boolean;
}

export interface EngineCallbacks {
  onAmmoChange?: (ammo: number, maxAmmo: number) => void;
  onHealthChange?: (health: number, maxHealth: number) => void;
  onCrosshairHit?: (headshot: boolean) => void;
  onDamageReceived?: () => void;
  onKillFeed?: (item: KillFeedItem) => void;
  onScoreboardUpdate?: (entries: PlayerScoreEntry[]) => void;
  onPlayerDeath?: (killerName: string) => void;
  onPlayerRespawn?: () => void;
  onPointerLockChange?: (isLocked: boolean) => void;
  onMatchOver?: (winner: MatchWinnerPayload) => void;
  onMatchTimeUpdate?: (secondsRemaining: number) => void;
}

export class ArenaEngine {
  public scene: THREE.Scene;
  public renderer: THREE.WebGLRenderer;
  public arenaMap: ArenaMap;
  public fpsController: FPSController;
  public weaponModel: WeaponModel;
  public effectManager: EffectManager;
  public fpsAudio: FPSAudio;
  public colyseus: ColyseusManager;

  private container: HTMLElement;
  private callbacks: EngineCallbacks;

  private remotePlayers = new Map<string, RemotePlayer>();
  private raycaster = new THREE.Raycaster();

  // Local state
  public isAlive: boolean = true;
  public isReloading: boolean = false;
  public ammo: number = GAME_CONSTANTS.MAGAZINE_SIZE;
  public maxAmmo: number = GAME_CONSTANTS.MAGAZINE_SIZE;
  public health: number = GAME_CONSTANTS.MAX_HEALTH;
  public maxHealth: number = GAME_CONSTANTS.MAX_HEALTH;

  private lastFireTime: number = 0;
  private animationFrameId: number | null = null;
  private clock = new THREE.Clock();
  private isDisposed: boolean = false;
  private hasInitialServerSpawn: boolean = false;
  private lastReportedKills: number = 0;
  private lastReportedScore: number = 0;
  private processedShotIds = new Set<string>();

  constructor(container: HTMLElement, colyseus: ColyseusManager, callbacks: EngineCallbacks = {}) {
    this.container = container;
    this.colyseus = colyseus;
    this.callbacks = callbacks;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f19);
    this.scene.fog = new THREE.FogExp2(0x0b0f19, 0.014);

    // 2. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 3. Audio & Effects
    this.fpsAudio = new FPSAudio();
    this.effectManager = new EffectManager(this.scene);

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0x1e293b, 1.2);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xe0f2fe, 1.8);
    dirLight.position.set(25, 45, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 120;
    dirLight.shadow.camera.left = -40;
    dirLight.shadow.camera.right = 40;
    dirLight.shadow.camera.top = 40;
    dirLight.shadow.camera.bottom = -40;
    this.scene.add(dirLight);

    // Arena subtle fill light
    const fillLight = new THREE.DirectionalLight(0x06b6d4, 0.6);
    fillLight.position.set(-25, 30, -20);
    this.scene.add(fillLight);

    // 5. Arena Map
    this.arenaMap = new ArenaMap();
    this.scene.add(this.arenaMap.group);

    // 6. FPS Controller & Weapon
    this.fpsController = new FPSController(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      500,
      container,
      colyseus
    );
    this.scene.add(this.fpsController.camera);

    this.weaponModel = new WeaponModel();
    this.fpsController.camera.add(this.weaponModel.group);

    this.fpsController.onPointerLockChangeCallback = (locked) => {
      this.callbacks.onPointerLockChange?.(locked);
    };

    // 7. Hook Network Handlers
    this.setupNetworkHandlers();

    // 8. Input Listeners
    this.setupInputListeners();

    // 9. Resize Listener
    window.addEventListener('resize', this.onWindowResize);

    // Initial HUD notification
    this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);
    this.callbacks.onHealthChange?.(this.health, this.maxHealth);

    // 10. Start Loop
    this.animate();
  }

  private setupNetworkHandlers() {
    // State sync
    this.colyseus.onStateChange = (state) => {
      if (this.isDisposed) return;
      this.handleServerStateChange(state);
    };

    // Immediate player removal notification
    this.colyseus.onPlayerRemove = (_player, sessionId) => {
      if (this.isDisposed) return;
      const remote = this.remotePlayers.get(sessionId);
      if (remote) {
        remote.dispose();
        this.remotePlayers.delete(sessionId);
      }
    };

    // Hit confirmation from server
    this.colyseus.onHitConfirm = (data) => {
      if (this.isDisposed) return;
      console.log(`[CombatDiag:9/11 TARGET_HIT_EVENT_RECEIVED] (Shooter) shotId=${data.shotId || 'N/A'} targetId=${data.targetId} dmg=${data.damage} headshot=${data.headshot} remainingHP=${data.remainingHealth} isKill=${data.isKill}`);
      this.fpsAudio.playHitMarker(data.headshot);
      this.callbacks.onCrosshairHit?.(data.headshot);

      // Instantly apply hit reaction to the target remote player for responsive feedback
      const targetRemote = this.remotePlayers.get(data.targetId);
      if (targetRemote) {
        targetRemote.triggerDamageHit();
        targetRemote.health = data.remainingHealth;
        if (data.isKill) {
          targetRemote.isAlive = false;
        }
        (targetRemote as any).redrawBillboard?.();
      }
    };

    // Damage received from server
    this.colyseus.onDamageReceived = (data) => {
      if (this.isDisposed) return;
      console.log(`[CombatDiag:9/11 TARGET_HIT_EVENT_RECEIVED] (Victim) shotId=${data.shotId || 'N/A'} attackerId=${data.attackerId} dmg=${data.damage} currentHP=${data.currentHealth}`);
      this.health = Math.max(0, data.currentHealth);
      this.fpsAudio.playDamageGrunt();
      this.callbacks.onHealthChange?.(this.health, this.maxHealth);
      this.callbacks.onDamageReceived?.();
    };

    // Kill feed broadcast
    this.colyseus.onKillFeed = (item) => {
      if (this.isDisposed) return;
      this.callbacks.onKillFeed?.(item);
      if (item.victimId === this.colyseus.mySessionId && item.killerName) {
        this.callbacks.onPlayerDeath?.(item.killerName);
      }
    };

    // Remote weapon tracer & shooting feedback
    this.colyseus.onWeaponTracer = (data) => {
      if (!data || this.isDisposed) return;
      if (data.shooterId !== this.colyseus.mySessionId) {
        // Prevent duplicate processing of the same shot event
        if (data.shotId) {
          if (this.processedShotIds.has(data.shotId)) return;
          this.processedShotIds.add(data.shotId);
          if (this.processedShotIds.size > 120) {
            const oldest = this.processedShotIds.values().next().value;
            if (oldest) this.processedShotIds.delete(oldest);
          }
        }

        if (
          Number.isFinite(data.startX) &&
          Number.isFinite(data.startY) &&
          Number.isFinite(data.startZ) &&
          Number.isFinite(data.endX) &&
          Number.isFinite(data.endY) &&
          Number.isFinite(data.endZ)
        ) {
          try {
            let startX = data.startX;
            let startY = data.startY;
            let startZ = data.startZ;

            // 1. Look up shooter in active remote player roster
            const remoteShooter = this.remotePlayers.get(data.shooterId);
            if (remoteShooter) {
              // Trigger visual muzzle flash & arm recoil animation
              remoteShooter.triggerFire(data.endX, data.endY, data.endZ, !!data.hitTarget);

              // Query authoritative muzzle tip world position so the tracer connects from the rifle barrel
              const muzzleWorldPos = remoteShooter.getMuzzleWorldPosition(new THREE.Vector3());
              if (
                Number.isFinite(muzzleWorldPos.x) &&
                Number.isFinite(muzzleWorldPos.y) &&
                Number.isFinite(muzzleWorldPos.z)
              ) {
                startX = muzzleWorldPos.x;
                startY = muzzleWorldPos.y;
                startZ = muzzleWorldPos.z;
              }
            }

            // 2. Spawn 3D laser tracer beam with impact sparks
            this.effectManager.addTracer(
              startX,
              startY,
              startZ,
              data.endX,
              data.endY,
              data.endZ,
              !!data.hitTarget
            );

            // 3. Play distance-attenuated gunshot sound relative to local camera position
            const localCamPos = this.fpsController.camera.position;
            const dist = Math.hypot(startX - localCamPos.x, startY - localCamPos.y, startZ - localCamPos.z);
            this.fpsAudio.playRemoteGunshot(dist);
          } catch (e) {
            console.warn('[ArenaEngine] Failed to add remote tracer:', e);
          }
        }
      }
    };

    // Initial spawn location confirmation from server
    this.colyseus.onInitSpawn = (data) => {
      if (this.isDisposed) return;
      this.fpsController.teleport(data.x, data.y, data.z, data.yaw);
      this.hasInitialServerSpawn = true;
    };

    // Respawn confirmation
    this.colyseus.onRespawnConfirmed = (data) => {
      if (this.isDisposed) return;
      console.log(`[CombatDiag:10/11 TARGET_DEATH_AND_RESPAWN] Respawn confirmed for local player (${this.colyseus.mySessionId}) at (${data.x.toFixed(1)}, ${data.z.toFixed(1)})`);
      this.isAlive = true;
      this.health = this.maxHealth;
      this.ammo = this.maxAmmo;
      this.isReloading = false;

      this.fpsController.teleport(data.x, data.y, data.z, data.yaw);
      this.fpsAudio.playRespawn();

      this.callbacks.onHealthChange?.(this.health, this.maxHealth);
      this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);
      this.callbacks.onPlayerRespawn?.();
    };

    // Match over
    this.colyseus.onMatchOver = (winner) => {
      if (this.isDisposed) return;
      this.callbacks.onMatchOver?.(winner);
    };
  }

  private handleServerStateChange(state: any) {
    if (!state || this.isDisposed) return;

    // Ensure self session never has a ghost RemotePlayer entity
    if (this.colyseus.mySessionId && this.remotePlayers.has(this.colyseus.mySessionId)) {
      const selfGhost = this.remotePlayers.get(this.colyseus.mySessionId);
      if (selfGhost) {
        selfGhost.dispose();
        this.remotePlayers.delete(this.colyseus.mySessionId);
      }
    }

    if (typeof state.matchTimeRemaining === 'number') {
      this.callbacks.onMatchTimeUpdate?.(state.matchTimeRemaining);
    }

    if (!state.players) return;

    const currentSessions = new Set<string>();
    const scoreboardList: PlayerScoreEntry[] = [];

    state.players.forEach((player: any, sessionId: string) => {
      currentSessions.add(sessionId);

      const isSelf = sessionId === this.colyseus.mySessionId;

      scoreboardList.push({
        sessionId,
        nickname: player.nickname,
        color: player.color,
        score: player.score || 0,
        kills: player.kills || 0,
        deaths: player.deaths || 0,
        isSelf,
      });

      if (isSelf) {
        // Authoritative initial teleport to server spawn position if not yet initialized
        if (!this.hasInitialServerSpawn && Number.isFinite(player.x) && Number.isFinite(player.z)) {
          this.fpsController.teleport(player.x, player.y || 0, player.z, player.yaw || 0);
          this.hasInitialServerSpawn = true;
        }

        // Authoritative state for self
        if (typeof player.health === 'number' && player.health !== this.health) {
          this.health = player.health;
          this.callbacks.onHealthChange?.(this.health, this.maxHealth);
        }

        if (typeof player.kills === 'number' && (player.kills !== this.lastReportedKills || player.score !== this.lastReportedScore)) {
          this.lastReportedKills = player.kills;
          this.lastReportedScore = player.score;
          console.log(`[CombatDiag:11/11 SHOOTER_SCORE_UPDATED] Local shooterId=${sessionId} kills=${player.kills} score=${player.score}`);
        }

        if (typeof player.isAlive === 'boolean' && player.isAlive !== this.isAlive) {
          this.isAlive = player.isAlive;
          if (!this.isAlive) {
            this.fpsController.exitPointerLock();
            this.callbacks.onPlayerDeath?.('Opponent');
          }
        }
      } else {
        // Remote player
        let remote = this.remotePlayers.get(sessionId);
        if (!remote) {
          remote = new RemotePlayer(
            player.id,
            player.nickname,
            player.color,
            { x: player.x, y: player.y, z: player.z, yaw: player.yaw }
          );
          this.remotePlayers.set(sessionId, remote);
          this.scene.add(remote.group);
        }
        remote.syncState(player);
      }
    });

    // Cleanup remote players that left
    this.remotePlayers.forEach((remote, sessionId) => {
      if (!currentSessions.has(sessionId)) {
        remote.dispose();
        this.remotePlayers.delete(sessionId);
      }
    });

    // Sort scoreboard by score descending
    scoreboardList.sort((a, b) => b.score - a.score);
    this.callbacks.onScoreboardUpdate?.(scoreboardList);
  }

  private setupInputListeners() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isDisposed) return;

    if (e.code === 'KeyR') {
      this.reloadWeapon();
      return;
    }

    this.fpsController.handleKeyDown(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.isDisposed) return;
    this.fpsController.handleKeyUp(e.code);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.isDisposed) return;

    // Left click to shoot
    if (e.button === 0) {
      if (!this.fpsController.isPointerLocked) {
        this.fpsController.requestPointerLock();
        return;
      }

      this.fireWeapon();
    }
  };

  public fireWeapon() {
    if (!this.isAlive || this.isReloading) return;

    const now = performance.now();
    if (now - this.lastFireTime < GAME_CONSTANTS.FIRE_RATE_MS) return;

    if (this.ammo <= 0) {
      this.fpsAudio.playEmptyClick();
      return;
    }

    const shotId = `shot_${this.colyseus.mySessionId || 'local'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[CombatDiag:1/11 LOCAL_FIRE_INPUT] shotId=${shotId} shooterId=${this.colyseus.mySessionId} ammo=${this.ammo} isAlive=${this.isAlive}`);

    this.lastFireTime = now;
    this.ammo--;
    this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);

    // Audio and weapon viewmodel recoil
    this.fpsAudio.playShoot();
    this.weaponModel.triggerRecoil();

    this.fpsController.camera.updateMatrixWorld(true);
    const muzzlePos = this.weaponModel.getMuzzleWorldPosition(new THREE.Vector3());
    console.log(`[CombatDiag:2/11 LOCAL_MUZZLE_EFFECT] shotId=${shotId} muzzleX=${muzzlePos.x.toFixed(2)} muzzleY=${muzzlePos.y.toFixed(2)} muzzleZ=${muzzlePos.z.toFixed(2)}`);

    // Calculate forward ray
    const { origin, direction } = this.fpsController.getForwardRay();

    // Check hit against remote players using full body hitbox mesh
    let hitSessionId: string | undefined = undefined;
    let hitDistance: number = GAME_CONSTANTS.MAX_RANGE;
    let hitPoint = origin.clone().addScaledVector(direction, hitDistance);

    // Test ray against remote players
    this.raycaster.set(origin, direction);
    const remoteMeshes: THREE.Object3D[] = [];
    const meshToSessionMap = new Map<THREE.Object3D, string>();

    this.remotePlayers.forEach((remote, sid) => {
      if (remote.isAlive) {
        if (remote.hitboxMesh) {
          remoteMeshes.push(remote.hitboxMesh);
          meshToSessionMap.set(remote.hitboxMesh, sid);
        }
        remoteMeshes.push(remote.group);
        meshToSessionMap.set(remote.group, sid);
      }
    });

    const intersects = this.raycaster.intersectObjects(remoteMeshes, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      hitDistance = hit.distance;
      hitPoint = hit.point;

      // Find top group or hitbox mapping
      let cur: THREE.Object3D | null = hit.object;
      while (cur && !meshToSessionMap.has(cur)) {
        cur = cur.parent;
      }
      if (cur) {
        hitSessionId = meshToSessionMap.get(cur);
      }
    }

    // Validate forward ray coordinates
    if (
      !Number.isFinite(origin.x) ||
      !Number.isFinite(origin.y) ||
      !Number.isFinite(origin.z) ||
      !Number.isFinite(direction.x) ||
      !Number.isFinite(direction.y) ||
      !Number.isFinite(direction.z)
    ) {
      return;
    }

    // Spawn local tracer line safely from weapon muzzle
    try {
      const hasValidMuzzle = Number.isFinite(muzzlePos.x) && Number.isFinite(muzzlePos.y) && Number.isFinite(muzzlePos.z);
      const startX = hasValidMuzzle ? muzzlePos.x : origin.x;
      const startY = hasValidMuzzle ? muzzlePos.y : origin.y - 0.1;
      const startZ = hasValidMuzzle ? muzzlePos.z : origin.z;

      this.effectManager.addTracer(
        startX,
        startY,
        startZ,
        hitPoint.x,
        hitPoint.y,
        hitPoint.z,
        !!hitSessionId
      );
    } catch (e) {
      console.warn('[ArenaEngine] Failed to add local tracer:', e);
    }

    console.log(`[CombatDiag:3/11 FIRE_REQUEST_SENT] shotId=${shotId} shooterId=${this.colyseus.mySessionId} origin=(${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}, ${origin.z.toFixed(2)}) dir=(${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)}) targetClaimed=${hitSessionId || 'none'} hitDist=${hitDistance.toFixed(2)}m`);

    // Send fire message to server for authoritative validation
    this.colyseus.sendFire({
      shotId,
      originX: origin.x,
      originY: origin.y,
      originZ: origin.z,
      dirX: direction.x,
      dirY: direction.y,
      dirZ: direction.z,
      targetSessionId: hitSessionId,
    });
  }

  public reloadWeapon() {
    if (this.ammo >= this.maxAmmo || this.isReloading || !this.isAlive) return;

    this.isReloading = true;
    this.fpsAudio.playReload();
    this.weaponModel.startReload(GAME_CONSTANTS.RELOAD_TIME_MS / 1000);
    this.colyseus.sendReload();

    setTimeout(() => {
      if (!this.isDisposed && this.isAlive) {
        this.ammo = this.maxAmmo;
        this.isReloading = false;
        this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);
      }
    }, GAME_CONSTANTS.RELOAD_TIME_MS);
  }

  public requestRespawn() {
    this.colyseus.sendRespawnRequest();
  }

  private onWindowResize = () => {
    if (!this.container || this.isDisposed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.fpsController.camera.aspect = width / height;
    this.fpsController.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private animate = () => {
    if (this.isDisposed) return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    const dt = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    // Update FPS Controller
    this.fpsController.update(dt, this.isAlive);

    // Update Weapon Viewmodel
    this.weaponModel.update(
      dt,
      this.fpsController.isMoving,
      this.fpsController.isSprinting,
      elapsedTime
    );

    // Update remote players
    this.remotePlayers.forEach((player) => {
      player.update(dt);
    });

    // Update tracers & spark effects
    this.effectManager.update(dt);

    // Render Scene
    this.renderer.render(this.scene, this.fpsController.camera);
  };

  public dispose() {
    this.isDisposed = true;

    // Detach all network handlers so stale room messages cannot recreate players or invoke callbacks
    if (this.colyseus) {
      this.colyseus.onStateChange = undefined;
      this.colyseus.onPlayerAdd = undefined;
      this.colyseus.onPlayerRemove = undefined;
      this.colyseus.onHitConfirm = undefined;
      this.colyseus.onDamageReceived = undefined;
      this.colyseus.onKillFeed = undefined;
      this.colyseus.onWeaponTracer = undefined;
      this.colyseus.onInitSpawn = undefined;
      this.colyseus.onRespawnConfirmed = undefined;
      this.colyseus.onMatchOver = undefined;
      this.colyseus.onAnnouncement = undefined;
    }

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);

    this.fpsController.dispose();
    this.weaponModel.dispose();
    this.effectManager.dispose();

    this.remotePlayers.forEach((player) => {
      player.dispose();
    });
    this.remotePlayers.clear();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
