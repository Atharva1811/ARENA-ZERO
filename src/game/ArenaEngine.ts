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
      this.handleServerStateChange(state);
    };

    // Hit confirmation from server
    this.colyseus.onHitConfirm = (data) => {
      this.fpsAudio.playHitMarker(data.headshot);
      this.callbacks.onCrosshairHit?.(data.headshot);
    };

    // Damage received from server
    this.colyseus.onDamageReceived = (data) => {
      this.health = Math.max(0, data.currentHealth);
      this.fpsAudio.playDamageGrunt();
      this.callbacks.onHealthChange?.(this.health, this.maxHealth);
      this.callbacks.onDamageReceived?.();
    };

    // Kill feed broadcast
    this.colyseus.onKillFeed = (item) => {
      this.callbacks.onKillFeed?.(item);
    };

    // Remote weapon tracer
    this.colyseus.onWeaponTracer = (data) => {
      if (data.shooterId !== this.colyseus.mySessionId) {
        this.effectManager.addTracer(
          data.startX,
          data.startY,
          data.startZ,
          data.endX,
          data.endY,
          data.endZ,
          data.hitTarget
        );
      }
    };

    // Respawn confirmation
    this.colyseus.onRespawnConfirmed = (data) => {
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
      this.callbacks.onMatchOver?.(winner);
    };
  }

  private handleServerStateChange(state: any) {
    if (!state) return;

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
        // Authoritative state for self
        if (typeof player.health === 'number' && player.health !== this.health) {
          this.health = player.health;
          this.callbacks.onHealthChange?.(this.health, this.maxHealth);
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

    this.lastFireTime = now;
    this.ammo--;
    this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);

    // Audio and weapon viewmodel recoil
    this.fpsAudio.playShoot();
    this.weaponModel.triggerRecoil();

    // Calculate forward ray
    const { origin, direction } = this.fpsController.getForwardRay();

    // Check hit against remote players
    let hitSessionId: string | undefined = undefined;
    let hitDistance: number = GAME_CONSTANTS.MAX_RANGE;
    let hitPoint = origin.clone().addScaledVector(direction, hitDistance);

    // Test ray against remote players
    this.raycaster.set(origin, direction);
    const remoteMeshes: THREE.Object3D[] = [];
    const meshToSessionMap = new Map<THREE.Object3D, string>();

    this.remotePlayers.forEach((remote, sid) => {
      if (remote.isAlive) {
        remoteMeshes.push(remote.group);
        meshToSessionMap.set(remote.group, sid);
      }
    });

    const intersects = this.raycaster.intersectObjects(remoteMeshes, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      hitDistance = hit.distance;
      hitPoint = hit.point;

      // Find top group
      let cur: THREE.Object3D | null = hit.object;
      while (cur && !meshToSessionMap.has(cur)) {
        cur = cur.parent;
      }
      if (cur) {
        hitSessionId = meshToSessionMap.get(cur);
      }
    }

    // Spawn local tracer line
    const weaponMuzzlePos = origin.clone().addScaledVector(direction, 0.4);
    weaponMuzzlePos.y -= 0.1;
    this.effectManager.addTracer(
      weaponMuzzlePos.x,
      weaponMuzzlePos.y,
      weaponMuzzlePos.z,
      hitPoint.x,
      hitPoint.y,
      hitPoint.z,
      !!hitSessionId
    );

    // Send fire message to server for authoritative validation
    this.colyseus.sendFire({
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
