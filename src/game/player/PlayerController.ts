import * as THREE from 'three';
import type { TerrainData } from '../world/Terrain';
import type { Obstacle } from '../world/WorldBuilder';
import { SoundManager } from '../audio/SoundManager';
import type { PlayerInput } from '../types';

export class PlayerController {
  public mesh: THREE.Group;
  public position: THREE.Vector3;
  public rotationY: number = 0;
  public isMoving: boolean = false;
  public isGrounded: boolean = true;
  public currentSpeed: number = 0;

  private terrain: TerrainData;
  private obstacles: Obstacle[];
  private soundManager: SoundManager;

  private velocityY: number = 0;
  private readonly walkSpeed = 5.8;
  private readonly sprintSpeed = 9.2;
  private readonly jumpForce = 8.5;
  private readonly gravity = -22;
  private readonly playerRadius = 0.45;

  private leftLeg!: THREE.Mesh;
  private rightLeg!: THREE.Mesh;
  private leftArm!: THREE.Mesh;
  private rightArm!: THREE.Mesh;
  private bodyGroup!: THREE.Group;

  private stepTimer: number = 0;
  private walkAnimTime: number = 0;

  // Cached shrine elevations for grounding
  private shrineCenter = new THREE.Vector2(0, 0);
  private shrineBaseY: number = 0;

  constructor(
    terrain: TerrainData,
    obstacles: Obstacle[],
    soundManager: SoundManager,
    initialX: number = 0,
    initialZ: number = 18 // Pleasant sandy beach cove start location
  ) {
    this.terrain = terrain;
    this.obstacles = obstacles;
    this.soundManager = soundManager;

    this.shrineBaseY = this.terrain.getHeight(0, 0);

    this.mesh = new THREE.Group();
    const initialY = this.getSurfaceHeight(initialX, initialZ);
    this.position = new THREE.Vector3(initialX, initialY, initialZ);
    this.mesh.position.copy(this.position);

    // Build Stylized Low-Poly Explorer Character
    const character = this.buildCharacterModel();
    this.mesh.add(character);

    // Face inward toward the island shrine initially
    this.rotationY = Math.PI;
    this.mesh.rotation.y = this.rotationY;
  }

  public setObstacles(obstacles: Obstacle[]) {
    this.obstacles = obstacles;
  }

  private buildCharacterModel(): THREE.Group {
    const group = new THREE.Group();
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.position.y = 0.75;

    // Materials
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffd1a4, roughness: 0.7, flatShading: true });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x3d7ea6, roughness: 0.6, flatShading: true }); // Explorer teal jacket
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8, flatShading: true }); // Khaki shorts
    const hatMat = new THREE.MeshStandardMaterial({ color: 0xd9a74a, roughness: 0.5, flatShading: true });   // Safari hat
    const hatBandMat = new THREE.MeshStandardMaterial({ color: 0xb22222, roughness: 0.5 });                  // Ruby band
    const packMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9, flatShading: true });  // Leather backpack
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2e1d0f, roughness: 0.8, flatShading: true });

    // Torso / Jacket
    const torsoGeo = new THREE.BoxGeometry(0.55, 0.65, 0.38);
    const torso = new THREE.Mesh(torsoGeo, shirtMat);
    torso.position.y = 0.35;
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.bodyGroup.add(torso);

    // Explorer Backpack on back (-Z)
    const packGeo = new THREE.BoxGeometry(0.42, 0.48, 0.22);
    const backpack = new THREE.Mesh(packGeo, packMat);
    backpack.position.set(0, 0.35, -0.26);
    backpack.castShadow = true;
    this.bodyGroup.add(backpack);

    // Head
    const headGeo = new THREE.BoxGeometry(0.38, 0.38, 0.36);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 0.85;
    head.castShadow = true;
    this.bodyGroup.add(head);

    // Safari Hat
    const hatBrimGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.05, 12);
    const hatBrim = new THREE.Mesh(hatBrimGeo, hatMat);
    hatBrim.position.y = 1.05;
    hatBrim.castShadow = true;
    this.bodyGroup.add(hatBrim);

    const hatCrownGeo = new THREE.CylinderGeometry(0.28, 0.34, 0.28, 10);
    const hatCrown = new THREE.Mesh(hatCrownGeo, hatMat);
    hatCrown.position.y = 1.2;
    hatCrown.castShadow = true;
    this.bodyGroup.add(hatCrown);

    const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12), hatBandMat);
    hatBand.position.y = 1.1;
    this.bodyGroup.add(hatBand);

    // Eyes on front (+Z)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const eyeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.04);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(0.1, 0.88, 0.19);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(-0.1, 0.88, 0.19);
    this.bodyGroup.add(leftEye, rightEye);

    // Arms
    const armGeo = new THREE.BoxGeometry(0.14, 0.55, 0.15);
    armGeo.translate(0, -0.22, 0); // Pivot at shoulder

    this.leftArm = new THREE.Mesh(armGeo, shirtMat);
    this.leftArm.position.set(0.36, 0.6, 0);
    this.leftArm.castShadow = true;
    this.bodyGroup.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, shirtMat);
    this.rightArm.position.set(-0.36, 0.6, 0);
    this.rightArm.castShadow = true;
    this.bodyGroup.add(this.rightArm);

    group.add(this.bodyGroup);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.18, 0.65, 0.2);
    legGeo.translate(0, -0.3, 0); // Pivot at hip

    this.leftLeg = new THREE.Mesh(legGeo, pantsMat);
    this.leftLeg.position.set(0.16, 0.65, 0);
    this.leftLeg.castShadow = true;

    // Boots
    const bootGeo = new THREE.BoxGeometry(0.2, 0.16, 0.26);
    const leftBoot = new THREE.Mesh(bootGeo, shoeMat);
    leftBoot.position.set(0, -0.55, 0.03);
    this.leftLeg.add(leftBoot);
    group.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeo, pantsMat);
    this.rightLeg.position.set(-0.16, 0.65, 0);
    this.rightLeg.castShadow = true;

    const rightBoot = new THREE.Mesh(bootGeo, shoeMat);
    rightBoot.position.set(0, -0.55, 0.03);
    this.rightLeg.add(rightBoot);
    group.add(this.rightLeg);

    return group;
  }

  /**
   * Calculates surface elevation accounting for terrain and solid shrine structure/stairs
   */
  public getSurfaceHeight(x: number, z: number): number {
    const terrainH = this.terrain.getHeight(x, z);

    // Solis Shrine platform grounding
    const distToShrine = Math.hypot(x - this.shrineCenter.x, z - this.shrineCenter.y);
    const platformFloorY = this.shrineBaseY + 0.65;

    // Inside temple platform perimeter
    if (distToShrine <= 5.4) {
      return Math.max(terrainH, platformFloorY);
    }

    // On entrance staircase (z between 4.8 and 6.6, x between -2.2 and 2.2)
    if (distToShrine <= 6.6 && Math.abs(x) <= 2.2 && z > 0) {
      const t = (6.6 - distToShrine) / 1.2;
      const stairY = terrainH + t * (platformFloorY - terrainH);
      return Math.max(terrainH, stairY);
    }

    return terrainH;
  }

  public update(delta: number, input: PlayerInput, cameraYaw: number) {
    const dt = Math.min(delta, 0.08);

    // 1. Calculate camera-relative movement vectors
    // Camera forward vector in XZ plane (looking toward target)
    const camForwardX = -Math.sin(cameraYaw);
    const camForwardZ = -Math.cos(cameraYaw);

    // Camera right vector (perpendicular to forward, 90 deg clockwise)
    const camRightX = Math.cos(cameraYaw);
    const camRightZ = -Math.sin(cameraYaw);

    // Raw directional input
    let inputForward = 0;
    if (input.forward) inputForward += 1;
    if (input.backward) inputForward -= 1;

    let inputRight = 0;
    if (input.right) inputRight += 1;
    if (input.left) inputRight -= 1;

    const hasInput = inputForward !== 0 || inputRight !== 0;
    this.isMoving = hasInput;

    if (hasInput) {
      // Normalize combined input vector so diagonals do not move faster
      const inputLen = Math.hypot(inputForward, inputRight);
      const normF = inputForward / inputLen;
      const normR = inputRight / inputLen;

      // Camera-relative horizontal movement direction
      const moveDirX = normF * camForwardX + normR * camRightX;
      const moveDirZ = normF * camForwardZ + normR * camRightZ;

      // Smoothly rotate character toward actual movement direction
      const targetAngle = Math.atan2(moveDirX, moveDirZ);
      let angleDiff = targetAngle - this.rotationY;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      this.rotationY += angleDiff * Math.min(1.0, dt * 16);
      this.mesh.rotation.y = this.rotationY;

      // Movement speed
      const targetSpeed = input.sprint ? this.sprintSpeed : this.walkSpeed;
      this.currentSpeed = targetSpeed;

      // Desired position delta
      let nextX = this.position.x + moveDirX * targetSpeed * dt;
      let nextZ = this.position.z + moveDirZ * targetSpeed * dt;

      // 2. Multi-pass collision resolution with solid obstacles (shrine walls, pillars, rocks, trees)
      for (let iter = 0; iter < 3; iter++) {
        for (const obs of this.obstacles) {
          const dx = nextX - obs.x;
          const dz = nextZ - obs.z;
          const dist = Math.hypot(dx, dz);
          const minDist = obs.radius + this.playerRadius;

          if (dist < minDist && dist > 0.0001) {
            // Push out along collision normal
            const overlap = minDist - dist;
            nextX += (dx / dist) * overlap;
            nextZ += (dz / dist) * overlap;
          }
        }
      }

      // 3. Island perimeter & deep water collision check
      if (this.terrain.isWalkable(nextX, nextZ)) {
        this.position.x = nextX;
        this.position.z = nextZ;
      } else {
        // Slide along walkable axis if hitting shoreline boundary
        if (this.terrain.isWalkable(nextX, this.position.z)) {
          this.position.x = nextX;
        } else if (this.terrain.isWalkable(this.position.x, nextZ)) {
          this.position.z = nextZ;
        }
      }
    } else {
      this.currentSpeed = 0;
    }

    // 4. Vertical Physics (Jump, Gravity & Grounding)
    const surfaceY = this.getSurfaceHeight(this.position.x, this.position.z);

    if (input.jump && this.isGrounded) {
      this.velocityY = this.jumpForce;
      this.isGrounded = false;
      this.soundManager.playJump();
    }

    if (!this.isGrounded) {
      this.velocityY += this.gravity * dt;
      this.position.y += this.velocityY * dt;

      if (this.position.y <= surfaceY) {
        this.position.y = surfaceY;
        this.velocityY = 0;
        this.isGrounded = true;
      }
    } else {
      // Smoothly snap to terrain or shrine surface elevation
      this.position.y = surfaceY;
      this.velocityY = 0;
    }

    this.mesh.position.copy(this.position);

    // Procedural limb animation & footstep sounds
    this.animateLimbs(dt, hasInput, input.sprint);
  }

  private animateLimbs(dt: number, isMoving: boolean, isSprinting: boolean) {
    if (isMoving && this.isGrounded) {
      const animFreq = isSprinting ? 14 : 9.5;
      this.walkAnimTime += dt * animFreq;

      const swing = Math.sin(this.walkAnimTime);
      this.leftLeg.rotation.x = swing * 0.75;
      this.rightLeg.rotation.x = -swing * 0.75;

      this.leftArm.rotation.x = -swing * 0.65;
      this.rightArm.rotation.x = swing * 0.65;

      // Vertical bounce while walking
      this.bodyGroup.position.y = 0.75 + Math.abs(Math.sin(this.walkAnimTime * 2)) * 0.08;

      // Footstep sound trigger
      const stepInterval = isSprinting ? 0.26 : 0.38;
      this.stepTimer += dt;
      if (this.stepTimer >= stepInterval) {
        this.stepTimer = 0;
        const distToShrine = Math.hypot(this.position.x, this.position.z);
        const surf = distToShrine <= 5.8 ? 'stone' : this.terrain.getSurfaceType(this.position.x, this.position.z);
        this.soundManager.playFootstep(surf);
      }
    } else if (!this.isGrounded) {
      // Airborne pose
      this.leftLeg.rotation.x = 0.35;
      this.rightLeg.rotation.x = -0.25;
      this.leftArm.rotation.x = -0.5;
      this.rightArm.rotation.x = -0.5;
      this.bodyGroup.position.y = 0.8;
      this.stepTimer = 0;
    } else {
      // Idle pose
      this.leftLeg.rotation.x *= 0.8;
      this.rightLeg.rotation.x *= 0.8;
      this.leftArm.rotation.x *= 0.8;
      this.rightArm.rotation.x *= 0.8;

      // Gentle breathing
      this.walkAnimTime += dt * 2.0;
      this.bodyGroup.position.y = 0.75 + Math.sin(this.walkAnimTime) * 0.02;
      this.stepTimer = 0;
    }
  }

  public reset(x: number = 0, z: number = 18) {
    const y = this.getSurfaceHeight(x, z);
    this.position.set(x, y, z);
    this.mesh.position.copy(this.position);
    this.rotationY = Math.PI;
    this.mesh.rotation.y = this.rotationY;
    this.velocityY = 0;
    this.isGrounded = true;
    this.isMoving = false;
  }
}
