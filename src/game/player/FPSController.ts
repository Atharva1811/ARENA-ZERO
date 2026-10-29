import * as THREE from 'three';
import { GAME_CONSTANTS } from '../../../shared/constants';
import { resolveArenaCollision } from '../../../shared/arenaCollision';
import { ColyseusManager } from '../../network/ColyseusManager';

export class FPSController {
  public camera: THREE.PerspectiveCamera;
  public position = new THREE.Vector3(0, 0, 22);
  public yaw: number = 0;
  public pitch: number = 0;
  public hasReceivedSpawn: boolean = false;

  public isMoving: boolean = false;
  public isSprinting: boolean = false;
  public isGrounded: boolean = true;
  private velocityY: number = 0;

  // Tactical Stamina
  public stamina: number = GAME_CONSTANTS.MAX_STAMINA;
  public maxStamina: number = GAME_CONSTANTS.MAX_STAMINA;
  private lastSprintTime: number = 0;
  public onStaminaChange?: (stamina: number, maxStamina: number) => void;

  public isPointerLocked: boolean = false;
  public sensitivity: number = 0.0022;
  public invertY: boolean = false;

  private domElement: HTMLElement;
  private colyseus: ColyseusManager;

  private inputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
  };

  private lastNetworkSendTime: number = 0;
  public onPointerLockChangeCallback?: (locked: boolean) => void;

  constructor(
    fov: number,
    aspect: number,
    near: number,
    far: number,
    domElement: HTMLElement,
    colyseus: ColyseusManager
  ) {
    this.domElement = domElement;
    this.colyseus = colyseus;
    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera.rotation.order = 'YXZ'; // Standard FPS Euler order

    this.setupListeners();
  }

  private setupListeners() {
    const onMouseMove = (e: MouseEvent) => {
      if (!this.isPointerLocked) return;

      const deltaX = e.movementX || 0;
      const deltaY = e.movementY || 0;

      this.yaw -= deltaX * this.sensitivity;
      const pitchFactor = this.invertY ? -1 : 1;
      this.pitch -= deltaY * this.sensitivity * pitchFactor;

      // Clamp vertical pitch to ~82 degrees up and down
      this.pitch = Math.max(-1.43, Math.min(1.43, this.pitch));
    };

    const onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.domElement;
      this.onPointerLockChangeCallback?.(this.isPointerLocked);
    };

    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    this.cleanupListeners = () => {
      window.removeEventListener('mousemove', onMouseMove);
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

  public handleKeyDown(code: string) {
    switch (code) {
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
    }
  }

  public handleKeyUp(code: string) {
    switch (code) {
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
  }

  public resetInput() {
    this.inputState.forward = false;
    this.inputState.backward = false;
    this.inputState.left = false;
    this.inputState.right = false;
    this.inputState.jump = false;
    this.inputState.sprint = false;
  }

  public teleport(x: number, y: number, z: number, yaw?: number) {
    this.hasReceivedSpawn = true;
    this.position.set(x, y, z);
    if (yaw !== undefined) {
      this.yaw = yaw;
    }
    this.velocityY = 0;
    this.isGrounded = true;
    this.stamina = GAME_CONSTANTS.MAX_STAMINA;
    this.isSprinting = false;
    this.lastSprintTime = 0;
    this.onStaminaChange?.(this.stamina, this.maxStamina);
  }

  public update(delta: number, isGameActive: boolean) {
    const dt = Math.min(delta, 0.08);

    if (isGameActive && this.hasReceivedSpawn) {
      // 1. Calculate camera-relative forward and right vectors
      const camForwardX = -Math.sin(this.yaw);
      const camForwardZ = -Math.cos(this.yaw);

      const camRightX = Math.cos(this.yaw);
      const camRightZ = -Math.sin(this.yaw);

      let inF = 0;
      if (this.inputState.forward) inF += 1;
      if (this.inputState.backward) inF -= 1;

      let inR = 0;
      if (this.inputState.right) inR += 1;
      if (this.inputState.left) inR -= 1;

      const hasMove = inF !== 0 || inR !== 0;
      this.isMoving = hasMove;

      // Tactical Stamina & Sprint Evaluation
      const wantsSprint = this.inputState.sprint && this.inputState.forward && !this.inputState.backward && hasMove;

      if (wantsSprint) {
        if (this.isSprinting) {
          // Drain stamina while sprinting continuously
          this.stamina = Math.max(0, this.stamina - GAME_CONSTANTS.SPRINT_STAMINA_DRAIN_PER_SECOND * dt);
          this.lastSprintTime = performance.now();
          if (this.stamina <= 0) {
            this.isSprinting = false;
          }
        } else if (this.stamina >= GAME_CONSTANTS.MIN_STAMINA_TO_SPRINT) {
          // Can only initiate sprint if above minimum threshold (10%)
          this.isSprinting = true;
          this.stamina = Math.max(0, this.stamina - GAME_CONSTANTS.SPRINT_STAMINA_DRAIN_PER_SECOND * dt);
          this.lastSprintTime = performance.now();
        } else {
          this.isSprinting = false;
        }
      } else {
        this.isSprinting = false;
        // Gradual stamina regeneration after configured delay
        const now = performance.now();
        if (now - this.lastSprintTime >= GAME_CONSTANTS.STAMINA_REGEN_DELAY_MS) {
          this.stamina = Math.min(this.maxStamina, this.stamina + GAME_CONSTANTS.STAMINA_REGEN_PER_SECOND * dt);
        }
      }

      this.onStaminaChange?.(this.stamina, this.maxStamina);

      if (hasMove) {
        const len = Math.hypot(inF, inR);
        const normF = inF / len;
        const normR = inR / len;

        const moveDirX = normF * camForwardX + normR * camRightX;
        const moveDirZ = normF * camForwardZ + normR * camRightZ;

        const speed = this.isSprinting ? GAME_CONSTANTS.SPRINT_SPEED : GAME_CONSTANTS.PLAYER_SPEED;

        let nextX = this.position.x + moveDirX * speed * dt;
        let nextZ = this.position.z + moveDirZ * speed * dt;

        // Shared arena obstacle & perimeter collision resolution
        const resolved = resolveArenaCollision(nextX, nextZ, GAME_CONSTANTS.PLAYER_RADIUS);
        this.position.x = resolved.x;
        this.position.z = resolved.z;
      }

      // Vertical jumping & gravity
      if (this.inputState.jump && this.isGrounded) {
        this.velocityY = GAME_CONSTANTS.JUMP_FORCE;
        this.isGrounded = false;
      }

      if (!this.isGrounded) {
        this.velocityY += GAME_CONSTANTS.GRAVITY * dt;
        this.position.y += this.velocityY * dt;

        // Ground elevation (raised center platform at 0.6m or floor at 0m)
        const distToCenter = Math.hypot(this.position.x, this.position.z);
        const floorY = distToCenter <= 6.0 ? 0.6 : 0;

        if (this.position.y <= floorY) {
          this.position.y = floorY;
          this.velocityY = 0;
          this.isGrounded = true;
        }
      } else {
        const distToCenter = Math.hypot(this.position.x, this.position.z);
        this.position.y = distToCenter <= 6.0 ? 0.6 : 0;
      }

      // Send movement to server (throttled at ~30Hz)
      const now = performance.now();
      if (now - this.lastNetworkSendTime >= 1000 / GAME_CONSTANTS.CLIENT_SEND_RATE) {
        this.lastNetworkSendTime = now;
        this.colyseus.sendMove({
          x: this.position.x,
          y: this.position.y,
          z: this.position.z,
          yaw: this.yaw,
          pitch: this.pitch,
          isMoving: this.isMoving,
          isSprinting: this.isSprinting,
        });
      }
    }

    // Camera sits directly at player eye level
    this.camera.position.set(
      this.position.x,
      this.position.y + GAME_CONSTANTS.EYE_HEIGHT,
      this.position.z
    );

    // Apply rotation to camera
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  public getForwardRay(): { origin: THREE.Vector3; direction: THREE.Vector3 } {
    const origin = new THREE.Vector3(
      this.position.x,
      this.position.y + GAME_CONSTANTS.EYE_HEIGHT,
      this.position.z
    );

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    return { origin, direction: dir };
  }

  public dispose() {
    this.cleanupListeners();
    this.exitPointerLock();
  }
}
