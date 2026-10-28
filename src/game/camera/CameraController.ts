import * as THREE from 'three';
import type { TerrainData } from '../world/Terrain';
import type { Obstacle } from '../world/WorldBuilder';

export class CameraController {
  public camera: THREE.PerspectiveCamera;
  public yaw: number = 0; // Horizontal rotation angle in radians
  public pitch: number = 0.32; // Vertical rotation angle in radians

  private terrain: TerrainData;
  private obstacles: Obstacle[] = [];
  private domElement: HTMLElement;

  private currentTarget = new THREE.Vector3();
  private currentCameraPos = new THREE.Vector3();
  private idealOffset = new THREE.Vector3();

  private isDragging: boolean = false;
  private previousMousePosition = { x: 0, y: 0 };
  public isPointerLocked: boolean = false;
  public onPointerLockChangeCallback?: (locked: boolean) => void;

  // Configuration
  private readonly minPitch = -0.12; // Looking upwards toward sky/character (~-7 deg)
  private readonly maxPitch = 1.22;  // Looking downwards toward ground (~70 deg)
  public defaultDistance = 6.0;
  private currentDistance = 6.0;
  public playerHeightOffset = 1.65; // Focus on adventurer chest/shoulders
  public sensitivity = 0.0024;     // Moderate, responsive default sensitivity
  public invertY = false;

  constructor(
    fov: number,
    aspect: number,
    near: number,
    far: number,
    terrain: TerrainData,
    domElement: HTMLElement,
    obstacles: Obstacle[] = []
  ) {
    this.terrain = terrain;
    this.domElement = domElement;
    this.obstacles = obstacles;
    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.setupListeners();
  }

  public setObstacles(obstacles: Obstacle[]) {
    this.obstacles = obstacles;
  }

  public setSensitivity(val: number) {
    this.sensitivity = Math.max(0.0005, Math.min(0.01, val));
  }

  public setInvertY(invert: boolean) {
    this.invertY = invert;
  }

  private setupListeners() {
    // Mouse Drag support (fallback when pointer lock is not engaged)
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
        this.previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (this.isPointerLocked) {
        const deltaX = e.movementX || 0;
        const deltaY = e.movementY || 0;
        this.rotateCamera(deltaX, deltaY);
      } else if (this.isDragging) {
        const deltaX = e.clientX - this.previousMousePosition.x;
        const deltaY = e.clientY - this.previousMousePosition.y;
        this.previousMousePosition = { x: e.clientX, y: e.clientY };
        this.rotateCamera(deltaX, deltaY);
      }
    };

    const onMouseUp = () => {
      this.isDragging = false;
    };

    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    // Pointer Lock change listener
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === this.domElement;
      this.isPointerLocked = locked;
      this.onPointerLockChangeCallback?.(locked);
    };

    this.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    this.domElement.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    this.cleanupListeners = () => {
      this.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      this.domElement.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    };
  }

  private cleanupListeners: () => void = () => {};

  public requestPointerLock() {
    try {
      if (document.pointerLockElement !== this.domElement) {
        this.domElement.requestPointerLock();
      }
    } catch {}
  }

  public exitPointerLock() {
    try {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    } catch {}
  }

  private rotateCamera(deltaX: number, deltaY: number) {
    // Horizontal mouse movement rotates camera around player (yaw)
    this.yaw -= deltaX * this.sensitivity;

    // Vertical mouse movement adjusts camera pitch (clamped to prevent inversion)
    const pitchFactor = this.invertY ? -1 : 1;
    this.pitch += deltaY * this.sensitivity * pitchFactor;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
  }

  public update(playerPos: THREE.Vector3, delta: number) {
    const dt = Math.min(delta, 0.08);

    // 1. Calculate target look-at point (smooth follow of player)
    const target = new THREE.Vector3(
      playerPos.x,
      playerPos.y + this.playerHeightOffset,
      playerPos.z
    );

    // Initial camera placement on start/reset
    if (this.currentTarget.lengthSq() === 0) {
      this.currentTarget.copy(target);
    } else {
      // Smooth interpolation without lag or rubber-banding
      this.currentTarget.lerp(target, Math.min(1.0, dt * 14));
    }

    // 2. Compute camera line of sight and obstacle clearance (raycasting)
    let targetDist = this.defaultDistance;

    // Direction from target towards camera
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);
    const dirX = Math.sin(this.yaw) * cosPitch;
    const dirZ = Math.cos(this.yaw) * cosPitch;

    // Test line-of-sight against solid obstacles (pillars, walls, large boulders)
    for (const obs of this.obstacles) {
      // Ray-circle test in horizontal plane
      const ox = this.currentTarget.x - obs.x;
      const oz = this.currentTarget.z - obs.z;
      const b = 2 * (ox * dirX + oz * dirZ);
      const c = ox * ox + oz * oz - (obs.radius + 0.35) * (obs.radius + 0.35);
      const disc = b * b - 4 * c;

      if (disc > 0) {
        const t1 = (-b - Math.sqrt(disc)) / 2;
        if (t1 > 0.4 && t1 < targetDist) {
          targetDist = Math.max(1.8, t1 - 0.3);
        }
      }
    }

    // Smooth distance transitions
    this.currentDistance += (targetDist - this.currentDistance) * Math.min(1.0, dt * 10);

    const horizontalDistance = this.currentDistance * cosPitch;
    const verticalDistance = this.currentDistance * sinPitch;

    this.idealOffset.set(
      Math.sin(this.yaw) * horizontalDistance,
      verticalDistance,
      Math.cos(this.yaw) * horizontalDistance
    );

    const desiredCameraPos = new THREE.Vector3().copy(this.currentTarget).add(this.idealOffset);

    // 3. Terrain collision avoidance for camera
    const groundHeightAtCam = this.terrain.getHeight(desiredCameraPos.x, desiredCameraPos.z);
    const minCameraY = groundHeightAtCam + 0.65;
    if (desiredCameraPos.y < minCameraY) {
      desiredCameraPos.y = minCameraY;
    }

    // Initialize or smooth camera position
    if (this.currentCameraPos.lengthSq() === 0) {
      this.currentCameraPos.copy(desiredCameraPos);
    } else {
      this.currentCameraPos.lerp(desiredCameraPos, Math.min(1.0, dt * 14));
    }

    this.camera.position.copy(this.currentCameraPos);
    this.camera.lookAt(this.currentTarget);
  }

  public reset(yaw: number = 0, pitch: number = 0.32) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.currentTarget.set(0, 0, 0);
    this.currentCameraPos.set(0, 0, 0);
  }

  public dispose() {
    this.cleanupListeners();
    this.exitPointerLock();
  }
}
