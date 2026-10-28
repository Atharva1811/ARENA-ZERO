import * as THREE from 'three';

export class RemotePlayer {
  public id: string;
  public nickname: string;
  public color: string;
  public group: THREE.Group;

  // Sub-components for animation
  private torsoMesh!: THREE.Mesh;
  private headMesh!: THREE.Mesh;
  private visorMesh!: THREE.Mesh;
  private leftArmPivot!: THREE.Group;
  private rightArmPivot!: THREE.Group;
  private leftLegPivot!: THREE.Group;
  private rightLegPivot!: THREE.Group;
  private shieldMesh!: THREE.Mesh;

  // Billboard name & health bar
  private billboardSprite!: THREE.Sprite;
  private billboardCanvas!: HTMLCanvasElement;
  private billboardContext!: CanvasRenderingContext2D;
  private billboardTexture!: THREE.CanvasTexture;

  // Target states for smooth interpolation
  public targetPos: THREE.Vector3 = new THREE.Vector3();
  public targetYaw: number = 0;
  public isAlive: boolean = true;
  public isShielded: boolean = false;
  public health: number = 100;
  public maxHealth: number = 100;
  public isMoving: boolean = false;

  private walkCycleTime: number = 0;
  private shieldPulseTime: number = 0;

  constructor(id: string, nickname: string, colorHex: string, initialPos: { x: number; y: number; z: number; yaw: number }) {
    this.id = id;
    this.nickname = nickname || 'Operator';
    this.color = colorHex || '#3b82f6';
    this.group = new THREE.Group();

    this.group.position.set(initialPos.x, initialPos.y, initialPos.z);
    this.group.rotation.y = initialPos.yaw;
    this.targetPos.copy(this.group.position);
    this.targetYaw = initialPos.yaw;

    this.buildMeshes();
    this.buildBillboard();
  }

  private buildMeshes() {
    const primaryColor = new THREE.Color(this.color);
    const armorDarkMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.6,
    });
    const armorTrimMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.3,
      metalness: 0.8,
    });
    const visorMat = new THREE.MeshBasicMaterial({
      color: primaryColor,
    });

    // 1. Torso (center at y = 1.05)
    const torsoGeo = new THREE.BoxGeometry(0.55, 0.65, 0.3);
    this.torsoMesh = new THREE.Mesh(torsoGeo, armorDarkMat);
    this.torsoMesh.position.y = 1.05;
    this.torsoMesh.castShadow = true;
    this.torsoMesh.receiveShadow = true;
    this.group.add(this.torsoMesh);

    // Chest armor plate with player color
    const chestPlateGeo = new THREE.BoxGeometry(0.48, 0.4, 0.08);
    const chestPlate = new THREE.Mesh(chestPlateGeo, armorTrimMat);
    chestPlate.position.set(0, 0.05, 0.16);
    this.torsoMesh.add(chestPlate);

    // 2. Head & Helmet (center at y = 1.55)
    const headGeo = new THREE.BoxGeometry(0.36, 0.36, 0.36);
    this.headMesh = new THREE.Mesh(headGeo, armorDarkMat);
    this.headMesh.position.y = 1.55;
    this.headMesh.castShadow = true;
    this.group.add(this.headMesh);

    // Visor
    const visorGeo = new THREE.BoxGeometry(0.3, 0.1, 0.08);
    this.visorMesh = new THREE.Mesh(visorGeo, visorMat);
    this.visorMesh.position.set(0, 0.02, 0.19);
    this.headMesh.add(this.visorMesh);

    // 3. Left Arm Pivot (shoulder at y = 1.3, x = -0.38)
    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-0.38, 1.3, 0);
    const armGeo = new THREE.BoxGeometry(0.18, 0.6, 0.18);
    const leftArmMesh = new THREE.Mesh(armGeo, armorDarkMat);
    leftArmMesh.position.y = -0.28;
    this.leftArmPivot.add(leftArmMesh);
    this.group.add(this.leftArmPivot);

    // 4. Right Arm Pivot (holding rifle)
    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.38, 1.3, 0);
    const rightArmMesh = new THREE.Mesh(armGeo, armorDarkMat);
    rightArmMesh.position.y = -0.28;
    this.rightArmPivot.add(rightArmMesh);

    // Low-poly rifle attached to right arm
    const rifleGroup = new THREE.Group();
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.8 })
    );
    receiver.position.set(0, 0, 0.1);
    rifleGroup.add(receiver);

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9, roughness: 0.2 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, 0.45);
    rifleGroup.add(barrel);

    const energyCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.06, 0.16),
      new THREE.MeshBasicMaterial({ color: primaryColor })
    );
    energyCore.position.set(0, 0.02, 0.08);
    rifleGroup.add(energyCore);

    rifleGroup.position.set(0, -0.45, 0.2);
    this.rightArmPivot.add(rifleGroup);
    this.group.add(this.rightArmPivot);

    // 5. Left Leg Pivot (hip at y = 0.75, x = -0.16)
    this.leftLegPivot = new THREE.Group();
    this.leftLegPivot.position.set(-0.16, 0.75, 0);
    const legGeo = new THREE.BoxGeometry(0.2, 0.75, 0.2);
    const leftLegMesh = new THREE.Mesh(legGeo, armorDarkMat);
    leftLegMesh.position.y = -0.375;
    leftLegMesh.castShadow = true;
    this.leftLegPivot.add(leftLegMesh);
    this.group.add(this.leftLegPivot);

    // 6. Right Leg Pivot (hip at y = 0.75, x = 0.16)
    this.rightLegPivot = new THREE.Group();
    this.rightLegPivot.position.set(0.16, 0.75, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, armorDarkMat);
    rightLegMesh.position.y = -0.375;
    rightLegMesh.castShadow = true;
    this.rightLegPivot.add(rightLegMesh);
    this.group.add(this.rightLegPivot);

    // 7. Spawn Shield Bubble
    const shieldGeo = new THREE.SphereGeometry(1.25, 16, 12);
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.35,
      wireframe: true,
    });
    this.shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    this.shieldMesh.position.y = 1.1;
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);
  }

  private buildBillboard() {
    this.billboardCanvas = document.createElement('canvas');
    this.billboardCanvas.width = 256;
    this.billboardCanvas.height = 64;
    this.billboardContext = this.billboardCanvas.getContext('2d')!;

    this.billboardTexture = new THREE.CanvasTexture(this.billboardCanvas);
    this.billboardTexture.minFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
      map: this.billboardTexture,
      transparent: true,
      depthTest: false,
    });

    this.billboardSprite = new THREE.Sprite(spriteMat);
    this.billboardSprite.scale.set(2.4, 0.6, 1);
    this.billboardSprite.position.set(0, 2.15, 0);
    this.group.add(this.billboardSprite);

    this.redrawBillboard();
  }

  private redrawBillboard() {
    const ctx = this.billboardContext;
    ctx.clearRect(0, 0, 256, 64);

    // Nickname background pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.roundRect(16, 4, 224, 30, 8);
    ctx.fill();

    // Nickname text
    ctx.font = 'bold 18px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.nickname, 128, 19);

    // Health Bar Outline
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.roundRect(24, 40, 208, 12, 6);
    ctx.fill();

    // Health Bar Fill
    const pct = Math.max(0, Math.min(1, this.health / this.maxHealth));
    const barWidth = Math.round(204 * pct);
    if (barWidth > 0) {
      if (pct > 0.5) {
        ctx.fillStyle = '#10b981'; // Green
      } else if (pct > 0.25) {
        ctx.fillStyle = '#f59e0b'; // Amber
      } else {
        ctx.fillStyle = '#ef4444'; // Red
      }
      ctx.beginPath();
      ctx.roundRect(26, 42, barWidth, 8, 4);
      ctx.fill();
    }

    this.billboardTexture.needsUpdate = true;
  }

  public syncState(state: any) {
    if (!state) return;

    if (typeof state.x === 'number') this.targetPos.x = state.x;
    if (typeof state.y === 'number') this.targetPos.y = state.y;
    if (typeof state.z === 'number') this.targetPos.z = state.z;
    if (typeof state.yaw === 'number') this.targetYaw = state.yaw;

    if (typeof state.isMoving === 'boolean') this.isMoving = state.isMoving;
    if (typeof state.isShielded === 'boolean') this.isShielded = state.isShielded;

    let redraw = false;
    if (typeof state.health === 'number' && state.health !== this.health) {
      this.health = state.health;
      redraw = true;
    }
    if (typeof state.isAlive === 'boolean' && state.isAlive !== this.isAlive) {
      this.isAlive = state.isAlive;
      redraw = true;
    }

    if (redraw) {
      this.redrawBillboard();
    }
  }

  public update(dt: number) {
    // 1. Lerp Position
    const lerpRate = Math.min(1, dt * 18);
    this.group.position.lerp(this.targetPos, lerpRate);

    // 2. Shortest Angle Lerp Yaw
    let diff = this.targetYaw - this.group.rotation.y;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, dt * 15);

    // 3. Alive vs Dead visual representation
    if (!this.isAlive) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // 4. Walk cycle animation when moving
    if (this.isMoving) {
      this.walkCycleTime += dt * 10;
      const swing = Math.sin(this.walkCycleTime) * 0.45;
      this.leftLegPivot.rotation.x = swing;
      this.rightLegPivot.rotation.x = -swing;
      this.leftArmPivot.rotation.x = -swing * 0.7;
      // Right arm holds rifle steady, subtle sway
      this.rightArmPivot.rotation.x = -Math.PI / 4 + Math.cos(this.walkCycleTime) * 0.05;
    } else {
      // Idle pose
      this.leftLegPivot.rotation.x = THREE.MathUtils.lerp(this.leftLegPivot.rotation.x, 0, dt * 10);
      this.rightLegPivot.rotation.x = THREE.MathUtils.lerp(this.rightLegPivot.rotation.x, 0, dt * 10);
      this.leftArmPivot.rotation.x = THREE.MathUtils.lerp(this.leftArmPivot.rotation.x, 0, dt * 10);
      this.rightArmPivot.rotation.x = THREE.MathUtils.lerp(this.rightArmPivot.rotation.x, -Math.PI / 4, dt * 10);
    }

    // 5. Shield bubble animation
    if (this.isShielded) {
      this.shieldMesh.visible = true;
      this.shieldPulseTime += dt * 4;
      const s = 1.0 + Math.sin(this.shieldPulseTime) * 0.05;
      this.shieldMesh.scale.set(s, s, s);
    } else {
      this.shieldMesh.visible = false;
    }
  }

  public dispose() {
    this.billboardTexture.dispose();
    this.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      }
    });
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}
