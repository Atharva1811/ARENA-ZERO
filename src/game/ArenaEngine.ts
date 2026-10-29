import * as THREE from 'three';
import { ArenaMap } from './arena/ArenaMap';
import { FPSController } from './player/FPSController';
import { WeaponModel } from './player/WeaponModel';
import { FPSAudio } from './audio/FPSAudio';
import { EffectManager } from './effects/EffectManager';
import { RemotePlayer } from './remote/RemotePlayer';
import { ColyseusManager } from '../network/ColyseusManager';
import { GAME_CONSTANTS, WEAPON_CONFIGS } from '../../shared/constants';
import { raycastArenaObstacles } from '../../shared/arenaCollision';
import type { KillFeedItem, MatchWinnerPayload, WeaponId } from '../../shared/types';

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
  onReserveAmmoChange?: (reserveAmmo: number) => void;
  onHealthChange?: (health: number, maxHealth: number) => void;
  onStaminaChange?: (stamina: number, maxStamina: number) => void;
  onFireModeChange?: (fireMode: 'SINGLE' | 'AUTO') => void;
  onWeaponChange?: (weaponId: WeaponId) => void;
  onScopeChange?: (isScoped: boolean) => void;
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
  public currentWeapon: WeaponId = 'rifle';
  public isAiming: boolean = false;
  public ammo: number = GAME_CONSTANTS.MAGAZINE_SIZE;
  public maxAmmo: number = GAME_CONSTANTS.MAGAZINE_SIZE;
  public reserveAmmo: number = GAME_CONSTANTS.MAX_RESERVE_AMMO;
  public health: number = GAME_CONSTANTS.MAX_HEALTH;
  public maxHealth: number = GAME_CONSTANTS.MAX_HEALTH;
  public fireMode: 'SINGLE' | 'AUTO' = 'AUTO';

  private weaponAmmoMap: Record<WeaponId, { ammo: number; reserveAmmo: number }> = {
    knife: { ammo: 1, reserveAmmo: 0 },
    pistol: { ammo: 12, reserveAmmo: 48 },
    rifle: { ammo: 24, reserveAmmo: 72 },
    sniper: { ammo: 5, reserveAmmo: 20 },
  };
  private reloadTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isTriggerHeld: boolean = false;
  private autoFireIntervalId: ReturnType<typeof setInterval> | null = null;
  private singleFiredThisPress: boolean = false;
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

    // Hook tactical stamina change callback
    this.fpsController.onStaminaChange = (stamina, maxStamina) => {
      this.callbacks.onStaminaChange?.(stamina, maxStamina);
    };

    // Initial HUD notifications
    this.callbacks.onWeaponChange?.(this.currentWeapon);
    this.callbacks.onScopeChange?.(false);
    this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);
    this.callbacks.onReserveAmmoChange?.(this.reserveAmmo);
    this.callbacks.onHealthChange?.(this.health, this.maxHealth);
    this.callbacks.onStaminaChange?.(this.fpsController.stamina, this.fpsController.maxStamina);
    this.callbacks.onFireModeChange?.(this.fireMode);

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

            const isMelee = !!data.isMelee || data.weaponId === 'knife';
            const weaponId = (data.weaponId || 'rifle') as WeaponId;

            // 1. Look up shooter in active remote player roster
            const remoteShooter = this.remotePlayers.get(data.shooterId);
            if (remoteShooter) {
              // Trigger visual muzzle flash & arm recoil animation or melee slash
              remoteShooter.triggerFire(data.endX, data.endY, data.endZ, !!data.hitTarget, weaponId, isMelee);

              // Query authoritative muzzle tip world position so the tracer connects from the weapon barrel
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

            const localCamPos = this.fpsController.camera.position;
            const dist = Math.hypot(startX - localCamPos.x, startY - localCamPos.y, startZ - localCamPos.z);

            if (isMelee) {
              if (dist < 18) {
                this.fpsAudio.playKnifeSlash();
              }
            } else {
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
              this.fpsAudio.playRemoteGunshot(dist, weaponId);
            }
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
      this.cancelReload();
      this.setAiming(false);
      this.fpsController.resetRecoil();
      this.health = this.maxHealth;

      this.weaponAmmoMap = {
        knife: { ammo: 1, reserveAmmo: 0 },
        pistol: { ammo: 12, reserveAmmo: 48 },
        rifle: { ammo: 24, reserveAmmo: 72 },
        sniper: { ammo: 5, reserveAmmo: 20 },
      };
      this.currentWeapon = 'rifle';
      this.weaponModel.setWeapon('rifle');
      this.ammo = this.weaponAmmoMap.rifle.ammo;
      this.maxAmmo = WEAPON_CONFIGS.rifle.magazineSize;
      this.reserveAmmo = this.weaponAmmoMap.rifle.reserveAmmo;

      this.fpsController.teleport(data.x, data.y, data.z, data.yaw);
      this.fpsAudio.playRespawn();

      this.callbacks.onWeaponChange?.('rifle');
      this.callbacks.onScopeChange?.(false);
      this.callbacks.onHealthChange?.(this.health, this.maxHealth);
      this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);
      this.callbacks.onReserveAmmoChange?.(this.reserveAmmo);
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

        // Authoritative weapon and ammunition state sync
        if (
          typeof player.currentWeapon === 'string' &&
          player.currentWeapon !== this.currentWeapon &&
          WEAPON_CONFIGS[player.currentWeapon as WeaponId]
        ) {
          this.currentWeapon = player.currentWeapon as WeaponId;
          this.weaponModel.setWeapon(this.currentWeapon);
          this.maxAmmo = WEAPON_CONFIGS[this.currentWeapon].magazineSize;
          this.callbacks.onWeaponChange?.(this.currentWeapon);
        }

        if (typeof player.ammo === 'number' && !this.isReloading && player.ammo !== this.ammo) {
          this.ammo = player.ammo;
          this.weaponAmmoMap[this.currentWeapon].ammo = this.ammo;
          this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);
        }

        if (typeof player.reserveAmmo === 'number' && player.reserveAmmo !== this.reserveAmmo) {
          this.reserveAmmo = player.reserveAmmo;
          this.weaponAmmoMap[this.currentWeapon].reserveAmmo = this.reserveAmmo;
          this.callbacks.onReserveAmmoChange?.(this.reserveAmmo);
        }

        if (typeof player.isAlive === 'boolean' && player.isAlive !== this.isAlive) {
          this.isAlive = player.isAlive;
          if (this.isAlive) {
            // Player respawned via server state sync
            this.cancelReload();
            this.setAiming(false);
            this.fpsController.resetRecoil();
            this.health = player.health;
            if (player.currentWeapon && WEAPON_CONFIGS[player.currentWeapon as WeaponId]) {
              this.currentWeapon = player.currentWeapon as WeaponId;
              this.weaponModel.setWeapon(this.currentWeapon);
            }
            this.ammo = typeof player.ammo === 'number' ? player.ammo : WEAPON_CONFIGS[this.currentWeapon].magazineSize;
            this.maxAmmo = WEAPON_CONFIGS[this.currentWeapon].magazineSize;
            this.reserveAmmo =
              typeof player.reserveAmmo === 'number'
                ? player.reserveAmmo
                : WEAPON_CONFIGS[this.currentWeapon].maxReserveAmmo;
            this.weaponAmmoMap[this.currentWeapon] = { ammo: this.ammo, reserveAmmo: this.reserveAmmo };
            this.isTriggerHeld = false;
            this.singleFiredThisPress = false;
            this.stopAutoFire();
            this.callbacks.onWeaponChange?.(this.currentWeapon);
            this.callbacks.onScopeChange?.(false);
            this.callbacks.onHealthChange?.(this.health, this.maxHealth);
            this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);
            this.callbacks.onReserveAmmoChange?.(this.reserveAmmo);
            this.callbacks.onPlayerRespawn?.();
          } else {
            this.cancelReload();
            this.setAiming(false);
            this.fpsController.resetRecoil();
            this.stopAutoFire();
            this.isTriggerHeld = false;
            this.singleFiredThisPress = false;
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
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
  }

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private onWheel = (e: WheelEvent) => {
    if (this.isDisposed || !this.isAlive || !this.fpsController.isPointerLocked) return;
    e.preventDefault();
    const WEAPON_ORDER: WeaponId[] = ['knife', 'pistol', 'rifle', 'sniper'];
    const currentIndex = WEAPON_ORDER.indexOf(this.currentWeapon);
    if (e.deltaY > 0) {
      const nextIndex = (currentIndex + 1) % WEAPON_ORDER.length;
      this.switchWeapon(WEAPON_ORDER[nextIndex]);
    } else if (e.deltaY < 0) {
      const prevIndex = (currentIndex - 1 + WEAPON_ORDER.length) % WEAPON_ORDER.length;
      this.switchWeapon(WEAPON_ORDER[prevIndex]);
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isDisposed) return;

    // Number keys 1, 2, 3, 4 for weapon selection
    if (e.code === 'Digit1' || e.code === 'Numpad1') {
      this.switchWeapon('knife');
      return;
    }
    if (e.code === 'Digit2' || e.code === 'Numpad2') {
      this.switchWeapon('pistol');
      return;
    }
    if (e.code === 'Digit3' || e.code === 'Numpad3') {
      this.switchWeapon('rifle');
      return;
    }
    if (e.code === 'Digit4' || e.code === 'Numpad4') {
      this.switchWeapon('sniper');
      return;
    }

    if (e.code === 'KeyB') {
      this.toggleFireMode();
      return;
    }

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

  public switchWeapon(weaponId: WeaponId) {
    if (this.isDisposed || !this.isAlive || this.currentWeapon === weaponId) return;

    // Cache current weapon ammo
    this.weaponAmmoMap[this.currentWeapon] = {
      ammo: this.ammo,
      reserveAmmo: this.reserveAmmo,
    };

    // Cancel active reload & auto-fire
    this.cancelReload();
    this.stopAutoFire();
    this.isTriggerHeld = false;
    this.singleFiredThisPress = false;
    this.setAiming(false);

    this.currentWeapon = weaponId;
    this.weaponModel.setWeapon(weaponId);

    const cfg = WEAPON_CONFIGS[weaponId];
    const cached = this.weaponAmmoMap[weaponId];
    this.ammo = cached ? cached.ammo : cfg.magazineSize;
    this.maxAmmo = cfg.magazineSize;
    this.reserveAmmo = cached ? cached.reserveAmmo : cfg.maxReserveAmmo;

    this.callbacks.onWeaponChange?.(weaponId);
    this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);
    this.callbacks.onReserveAmmoChange?.(this.reserveAmmo);

    this.fpsAudio.playSwitchWeapon();
    this.colyseus.sendSwitchWeapon(weaponId);
  }

  public setAiming(aim: boolean) {
    if (this.isDisposed || !this.isAlive) {
      aim = false;
    }
    // Knife cannot aim down sights
    if (this.currentWeapon === 'knife') {
      aim = false;
    }
    // If sprinting, cancel aiming
    if (aim && this.fpsController.isSprinting) {
      aim = false;
    }

    if (this.isAiming === aim) return;
    this.isAiming = aim;

    const isSniperScoped = aim && this.currentWeapon === 'sniper';
    const targetFov = !aim ? 75 : this.currentWeapon === 'sniper' ? 28 : this.currentWeapon === 'pistol' ? 60 : 50;

    this.fpsController.setAiming(aim, targetFov);
    this.weaponModel.setAiming(aim, isSniperScoped);
    this.callbacks.onScopeChange?.(isSniperScoped);

    if (this.currentWeapon === 'sniper') {
      if (aim) {
        this.fpsAudio.playScopeIn();
      } else {
        this.fpsAudio.playScopeOut();
      }
    }
  }

  public toggleFireMode() {
    this.fireMode = this.fireMode === 'AUTO' ? 'SINGLE' : 'AUTO';
    if (this.fireMode === 'SINGLE') {
      this.stopAutoFire();
    }
    this.callbacks.onFireModeChange?.(this.fireMode);
    this.colyseus.sendToggleFireMode(this.fireMode);
  }

  private startAutoFire() {
    this.stopAutoFire();
    if (this.currentWeapon !== 'rifle' || this.fireMode !== 'AUTO') return;

    this.autoFireIntervalId = setInterval(() => {
      if (
        this.isDisposed ||
        !this.isAlive ||
        !this.isTriggerHeld ||
        this.currentWeapon !== 'rifle' ||
        this.fireMode !== 'AUTO'
      ) {
        this.stopAutoFire();
        return;
      }
      if (this.isReloading) {
        this.stopAutoFire();
        return;
      }
      this.fireWeapon();
    }, WEAPON_CONFIGS.rifle.fireRateMs);
  }

  private stopAutoFire() {
    if (this.autoFireIntervalId !== null) {
      clearInterval(this.autoFireIntervalId);
      this.autoFireIntervalId = null;
    }
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.isDisposed) return;

    // Left click to shoot
    if (e.button === 0) {
      if (!this.fpsController.isPointerLocked) {
        this.fpsController.requestPointerLock();
        return;
      }

      this.isTriggerHeld = true;
      if (this.currentWeapon === 'rifle' && this.fireMode === 'AUTO') {
        this.fireWeapon();
        this.startAutoFire();
      } else {
        // Semi-automatic for knife, pistol, sniper, or rifle SINGLE
        if (!this.singleFiredThisPress) {
          this.singleFiredThisPress = true;
          this.fireWeapon();
        }
      }
    } else if (e.button === 2) {
      // Right click ADS / Scope
      if (this.fpsController.isPointerLocked) {
        this.setAiming(true);
      }
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.isTriggerHeld = false;
      this.singleFiredThisPress = false;
      this.stopAutoFire();
    } else if (e.button === 2) {
      this.setAiming(false);
    }
  };

  private onBlur = () => {
    this.isTriggerHeld = false;
    this.singleFiredThisPress = false;
    this.stopAutoFire();
    this.setAiming(false);
  };

  public fireWeapon() {
    if (!this.isAlive || this.isReloading) return;

    const now = performance.now();
    const config = WEAPON_CONFIGS[this.currentWeapon];
    if (now - this.lastFireTime < config.fireRateMs) return;

    const shotId = `shot_${this.colyseus.mySessionId || 'local'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Melee attack (Knife)
    if (this.currentWeapon === 'knife') {
      this.lastFireTime = now;
      this.fpsAudio.playKnifeSlash();
      this.weaponModel.triggerMeleeSlash();

      const { origin, direction } = this.fpsController.getForwardRay();
      const eyePos = origin;
      const fwd = direction.clone().normalize();

      // Check melee target within 2.0m and forward angle cone (~66 deg, dot >= 0.4)
      let hitSessionId: string | undefined = undefined;
      let minDistance = 2.0;

      this.remotePlayers.forEach((remote, sid) => {
        if (!remote.isAlive) return;
        const targetPos = new THREE.Vector3(remote.group.position.x, remote.group.position.y + 1.0, remote.group.position.z);
        const toTarget = targetPos.clone().sub(eyePos);
        const dist = toTarget.length();
        if (dist <= 2.0 && dist < minDistance) {
          const dirToTarget = toTarget.clone().normalize();
          const dot = fwd.dot(dirToTarget);
          if (dot >= 0.4) {
            // Validate line of sight against arena obstacles
            const obsHit = raycastArenaObstacles(eyePos.x, eyePos.y, eyePos.z, dirToTarget.x, dirToTarget.y, dirToTarget.z, dist);
            if (!obsHit.hit || obsHit.dist >= dist) {
              minDistance = dist;
              hitSessionId = sid;
            }
          }
        }
      });

      if (hitSessionId) {
        this.fpsAudio.playKnifeHit();
      }

      this.colyseus.sendFire({
        shotId,
        originX: origin.x,
        originY: origin.y,
        originZ: origin.z,
        dirX: direction.x,
        dirY: direction.y,
        dirZ: direction.z,
        targetSessionId: hitSessionId,
        weaponId: 'knife',
        isMelee: true,
      });
      return;
    }

    // 2. Firearms (Pistol, Rifle, Sniper)
    if (this.ammo <= 0) {
      this.fpsAudio.playEmptyClick();
      if (this.reserveAmmo > 0) {
        this.reloadWeapon();
      }
      return;
    }

    this.lastFireTime = now;
    this.ammo--;
    this.weaponAmmoMap[this.currentWeapon].ammo = this.ammo;
    this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);

    if (this.ammo === 0) {
      this.stopAutoFire();
      if (this.reserveAmmo > 0) {
        this.reloadWeapon();
      }
    }

    // Audio & Viewmodel / Camera Recoil
    this.fpsAudio.playShoot(this.currentWeapon);
    this.weaponModel.triggerRecoil(this.currentWeapon);
    this.fpsController.applyRecoil(config.recoil);

    this.fpsController.camera.updateMatrixWorld(true);
    const muzzlePos = this.weaponModel.getMuzzleWorldPosition(new THREE.Vector3());

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

      let cur: THREE.Object3D | null = hit.object;
      while (cur && !meshToSessionMap.has(cur)) {
        cur = cur.parent;
      }
      if (cur) {
        hitSessionId = meshToSessionMap.get(cur);
      }
    }

    // Test ray against static arena obstacles (walls, pillars, bunkers)
    const obsHit = raycastArenaObstacles(
      origin.x,
      origin.y,
      origin.z,
      direction.x,
      direction.y,
      direction.z,
      hitDistance
    );
    if (obsHit.hit && obsHit.dist < hitDistance) {
      hitDistance = obsHit.dist;
      hitPoint.set(obsHit.hitX, obsHit.hitY, obsHit.hitZ);
      hitSessionId = undefined; // Occluded by static obstacle
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
      weaponId: this.currentWeapon,
      isMelee: false,
    });
  }

  public cancelReload() {
    if (this.reloadTimeoutId !== null) {
      clearTimeout(this.reloadTimeoutId);
      this.reloadTimeoutId = null;
    }
    this.isReloading = false;
  }

  public reloadWeapon() {
    if (this.currentWeapon === 'knife') return; // Knife has no ammo/reload
    if (this.ammo >= this.maxAmmo || this.isReloading || !this.isAlive || this.reserveAmmo <= 0) return;

    this.isReloading = true;
    this.stopAutoFire();
    this.setAiming(false);
    this.fpsAudio.playReload();

    const reloadTimeMs = WEAPON_CONFIGS[this.currentWeapon].reloadTimeMs;
    this.weaponModel.startReload(reloadTimeMs / 1000);
    this.colyseus.sendReload();

    if (this.reloadTimeoutId !== null) {
      clearTimeout(this.reloadTimeoutId);
    }

    this.reloadTimeoutId = setTimeout(() => {
      this.reloadTimeoutId = null;
      if (!this.isDisposed && this.isAlive && this.isReloading) {
        const needed = this.maxAmmo - this.ammo;
        const toLoad = Math.min(needed, this.reserveAmmo);
        this.ammo += toLoad;
        this.reserveAmmo -= toLoad;
        this.weaponAmmoMap[this.currentWeapon].ammo = this.ammo;
        this.weaponAmmoMap[this.currentWeapon].reserveAmmo = this.reserveAmmo;
        this.isReloading = false;
        this.callbacks.onAmmoChange?.(this.ammo, this.maxAmmo);
        this.callbacks.onReserveAmmoChange?.(this.reserveAmmo);

        // In AUTO mode: if trigger is still held when reload completes, resume firing immediately
        if (this.isTriggerHeld && this.currentWeapon === 'rifle' && this.fireMode === 'AUTO' && this.ammo > 0) {
          this.fireWeapon();
          this.startAutoFire();
        }
      }
    }, reloadTimeMs);
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

    // If player starts sprinting while aiming, cancel aiming smoothly
    if (this.isAiming && this.fpsController.isSprinting) {
      this.setAiming(false);
    }

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

    this.stopAutoFire();
    this.cancelReload();
    this.setAiming(false);
    this.isTriggerHeld = false;
    this.singleFiredThisPress = false;

    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);

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
