import * as THREE from 'three';
import type { GameCallbacks, GameSettings, GameState, PlayerInput } from './types';
import { createTerrain, createWater } from './world/Terrain';
import type { TerrainData } from './world/Terrain';
import { buildWorld } from './world/WorldBuilder';
import type { WorldObjects } from './world/WorldBuilder';
import { PlayerController } from './player/PlayerController';
import { CameraController } from './camera/CameraController';
import { InteractionManager } from './interaction/InteractionManager';
import { SoundManager } from './audio/SoundManager';

export class GameEngine {
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private cameraController!: CameraController;
  private terrain!: TerrainData;
  private water!: { mesh: THREE.Mesh; update: (time: number) => void };
  private world!: WorldObjects;
  private player!: PlayerController;
  private interactionManager!: InteractionManager;
  private soundManager: SoundManager;
  private callbacks: GameCallbacks;

  private state: GameState = 'MENU';
  private animationFrameId: number | null = null;
  private clock: THREE.Clock;
  private gameTime: number = 0;

  private inputState: PlayerInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    interact: false,
  };

  private resizeObserver: ResizeObserver | null = null;
  private keydownHandler!: (e: KeyboardEvent) => void;
  private keyupHandler!: (e: KeyboardEvent) => void;
  private clickHandler!: (e: MouseEvent) => void;

  public settings: GameSettings = {
    soundEnabled: true,
    masterVolume: 0.8,
    sfxVolume: 0.8,
    musicVolume: 0.5,
    shadowsEnabled: true,
    mouseSensitivity: 0.003,
    invertY: false,
  };

  constructor(container: HTMLElement, callbacks: GameCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.soundManager = new SoundManager();
    this.clock = new THREE.Clock();

    this.init();
  }

  private init() {
    // 1. Scene setup with stylized warm tropical atmosphere
    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color(0xaae2fa);
    this.scene.background = skyColor;
    this.scene.fog = new THREE.FogExp2(0xaae2fa, 0.016);

    // 2. WebGL Renderer
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      throw new Error('WebGL is not supported on this browser/device.');
    }

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = this.settings.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.container.appendChild(this.renderer.domElement);

    // 3. Lighting: Warm tropical sun & ambient bounce
    const hemiLight = new THREE.HemisphereLight(0xfff7e6, 0x4d7948, 0.85);
    hemiLight.position.set(0, 50, 0);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfffaed, 1.8);
    dirLight.position.set(30, 45, 20);
    dirLight.castShadow = this.settings.shadowsEnabled;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 100;
    const shadowDist = 45;
    dirLight.shadow.camera.left = -shadowDist;
    dirLight.shadow.camera.right = shadowDist;
    dirLight.shadow.camera.top = shadowDist;
    dirLight.shadow.camera.bottom = -shadowDist;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    // Subtle sun flare sphere high in sky
    const sunGeo = new THREE.SphereGeometry(4, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff6cf });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.set(120, 160, 80);
    this.scene.add(sunMesh);

    // 4. World, Terrain & Water
    this.terrain = createTerrain();
    this.scene.add(this.terrain.mesh);

    this.water = createWater();
    this.scene.add(this.water.mesh);

    this.world = buildWorld(this.terrain);
    this.scene.add(this.world.group);

    // 5. Player and Camera
    this.player = new PlayerController(this.terrain, this.world.obstacles, this.soundManager, 0, 18);
    this.scene.add(this.player.mesh);

    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.cameraController = new CameraController(
      55,
      aspect,
      0.1,
      250,
      this.terrain,
      this.renderer.domElement,
      this.world.obstacles
    );

    this.cameraController.onPointerLockChangeCallback = (locked: boolean) => {
      this.callbacks.onPointerLockChange?.(locked);
    };
    this.cameraController.setSensitivity(this.settings.mouseSensitivity);
    this.cameraController.setInvertY(this.settings.invertY);

    // 6. Interaction Manager
    this.interactionManager = new InteractionManager(this.world, this.soundManager, {
      ...this.callbacks,
      onGameCompleted: () => {
        this.setState('COMPLETED');
        this.callbacks.onGameCompleted(Math.round(this.gameTime));
      },
    });

    // 7. Event listeners
    this.setupEvents();

    // 8. Start render loop
    this.startLoop();
  }

  private setupEvents() {
    this.keydownHandler = (e: KeyboardEvent) => {
      // Toggle Pause or release pointer lock with Escape
      if (e.code === 'Escape') {
        if (this.state === 'PLAYING') {
          if (this.cameraController.isPointerLocked) {
            this.cameraController.exitPointerLock();
            return;
          }
          this.pause();
          return;
        } else if (this.state === 'PAUSED') {
          this.resume();
          return;
        }
      }

      if (this.state !== 'PLAYING') return;

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.inputState.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.inputState.backward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.inputState.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.inputState.right = true;
          break;
        case 'Space':
          this.inputState.jump = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.inputState.sprint = true;
          break;
        case 'KeyE':
          this.interactionManager.interact();
          break;
      }
    };

    this.keyupHandler = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.inputState.forward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.inputState.backward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.inputState.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.inputState.right = false;
          break;
        case 'Space':
          this.inputState.jump = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.inputState.sprint = false;
          break;
      }
    };

    // Canvas click to request pointer lock during active gameplay
    this.clickHandler = () => {
      if (this.state === 'PLAYING') {
        this.soundManager.init();
        this.cameraController.requestPointerLock();
      }
    };

    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('keyup', this.keyupHandler);
    this.renderer.domElement.addEventListener('click', this.clickHandler);

    // Responsive resize handling
    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize();
    });
    this.resizeObserver.observe(this.container);
  }

  private handleResize() {
    if (!this.container || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    if (width === 0 || height === 0) return;

    this.cameraController.camera.aspect = width / height;
    this.cameraController.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private startLoop() {
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);

      const delta = Math.min(this.clock.getDelta(), 0.1);
      const elapsedTime = this.clock.getElapsedTime();

      // Update water waves
      this.water.update(elapsedTime);

      // Update world object animations (gem float, shrine beams)
      this.world.update(elapsedTime, delta);

      // Only update player movement and timer during active gameplay
      if (this.state === 'PLAYING') {
        this.gameTime += delta;

        // Player physics and movement
        this.player.update(delta, this.inputState, this.cameraController.yaw);

        // Check interaction proximity
        this.interactionManager.checkProximity(this.player.position);

        // Player position broadcast (e.g. for compass)
        this.callbacks.onPlayerPositionUpdate?.(this.player.position, this.player.rotationY);
      }

      // Smooth camera follow always runs to keep scene beautiful
      this.cameraController.update(this.player.position, delta);

      // Render 3D Scene
      this.renderer.render(this.scene, this.cameraController.camera);
    };

    animate();
  }

  // --- STATE CONTROL ---
  public setState(newState: GameState) {
    this.state = newState;
    this.callbacks.onStateChange(newState);

    if (newState === 'PLAYING') {
      this.soundManager.init();
    } else {
      this.cameraController.exitPointerLock();
      this.resetInput();
    }
  }

  public getState(): GameState {
    return this.state;
  }

  public startGame() {
    this.soundManager.init();
    this.setState('PLAYING');
  }

  public pause() {
    if (this.state === 'PLAYING') {
      this.setState('PAUSED');
    }
  }

  public resume() {
    if (this.state === 'PAUSED') {
      this.setState('PLAYING');
    }
  }

  public restart() {
    // Clear world and rebuild
    this.scene.remove(this.world.group);
    this.world = buildWorld(this.terrain);
    this.scene.add(this.world.group);

    // Update obstacles in player and camera
    this.player.setObstacles(this.world.obstacles);
    this.cameraController.setObstacles(this.world.obstacles);

    // Reset player position and camera state
    this.player.reset(0, 18);
    this.cameraController.reset(0, 0.32);

    // Rebind interaction manager
    this.interactionManager = new InteractionManager(this.world, this.soundManager, {
      ...this.callbacks,
      onGameCompleted: () => {
        this.setState('COMPLETED');
        this.callbacks.onGameCompleted(Math.round(this.gameTime));
      },
    });

    this.gameTime = 0;
    this.resetInput();
    this.setState('PLAYING');
  }

  public interactManually() {
    if (this.state === 'PLAYING') {
      this.interactionManager.interact();
    }
  }

  public requestPointerLock() {
    if (this.state === 'PLAYING') {
      this.soundManager.init();
      this.cameraController.requestPointerLock();
    }
  }

  public exitPointerLock() {
    this.cameraController.exitPointerLock();
  }

  public isPointerLocked(): boolean {
    return this.cameraController.isPointerLocked;
  }

  private resetInput() {
    this.inputState.forward = false;
    this.inputState.backward = false;
    this.inputState.left = false;
    this.inputState.right = false;
    this.inputState.jump = false;
    this.inputState.sprint = false;
  }

  // --- SETTINGS ---
  public updateSettings(newSettings: Partial<GameSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    if (newSettings.soundEnabled !== undefined) {
      this.soundManager.setMuted(!this.settings.soundEnabled);
    }
    if (newSettings.masterVolume !== undefined || newSettings.sfxVolume !== undefined || newSettings.musicVolume !== undefined) {
      this.soundManager.setVolumes(this.settings.masterVolume, this.settings.sfxVolume, this.settings.musicVolume);
    }
    if (newSettings.shadowsEnabled !== undefined && this.renderer) {
      this.renderer.shadowMap.enabled = this.settings.shadowsEnabled;
    }
    if (newSettings.mouseSensitivity !== undefined) {
      this.cameraController.setSensitivity(this.settings.mouseSensitivity);
    }
    if (newSettings.invertY !== undefined) {
      this.cameraController.setInvertY(this.settings.invertY);
    }
  }

  public getSoundManager(): SoundManager {
    return this.soundManager;
  }

  public getCollectibles() {
    return this.world.collectibles;
  }

  public getShrine() {
    return this.world.shrine;
  }

  public getGameTime(): number {
    return Math.round(this.gameTime);
  }

  public dispose() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('keyup', this.keyupHandler);
    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('click', this.clickHandler);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.cameraController?.dispose();
    this.soundManager?.dispose();

    // Clean up Three.js scene geometries and materials
    this.scene?.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      }
    });

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
  }
}
