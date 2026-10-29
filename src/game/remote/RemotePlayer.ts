import * as THREE from 'three';

export class RemotePlayer {
  public id: string;
  public nickname: string;
  public color: string;
  public group: THREE.Group;

  // Sub-components for animation
  private visualRoot: THREE.Group = new THREE.Group();
  private torsoMesh!: THREE.Mesh;
  private headMesh!: THREE.Mesh;
  private visorMesh!: THREE.Mesh;
  private leftArmPivot!: THREE.Group;
  private rightArmPivot!: THREE.Group;
  private rifleGroup!: THREE.Group;
  private muzzleSocket!: THREE.Group;
  private muzzleFlashCore!: THREE.Mesh;
  private muzzleFlashCross!: THREE.Mesh;
  private muzzleLight!: THREE.PointLight;
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
  public targetPitch: number = 0;
  public currentPitch: number = 0;
  public isAlive: boolean = true;
  public isShielded: boolean = false;
  public health: number = 100;
  public maxHealth: number = 100;
  public isMoving: boolean = false;

  private walkCycleTime: number = 0;
  private shieldPulseTime: number = 0;

  // Firing effects and recoil animation
  private muzzleFlashTimer: number = 0;
  private armRecoil: number = 0;
  private weaponKickZ: number = 0;

  constructor(id: string, nickname: string, colorHex: string, initialPos: { x: number; y: number; z: number; yaw: number }) {
    this.id = id;
    this.nickname = nickname || 'Operator';
    this.color = colorHex || '#3b82f6';
    this.group = new THREE.Group();

    // The character model's native forward axis is +Z (chest plate, visor, and rifle barrel).
    // In Three.js and Arena Zero world space, yaw = 0 points towards -Z (standard FPS convention).
    // We apply a model-specific visual rotation offset of Math.PI (180 deg) exactly once to visualRoot.
    // This perfectly aligns the model's forward axis with the world facing direction.
    this.visualRoot = new THREE.Group();
    this.visualRoot.rotation.y = Math.PI;
    this.group.add(this.visualRoot);

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
      flatShading: true,
    });
    const armorTrimMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.3,
      metalness: 0.8,
      flatShading: true,
    });
    const visorMat = new THREE.MeshBasicMaterial({
      color: primaryColor,
    });

    const polymerMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.85,
      metalness: 0.25,
      flatShading: true,
    });

    const metallicMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.3,
      metalness: 0.85,
    });

    // 1. Torso (center at y = 1.05)
    const torsoGeo = new THREE.BoxGeometry(0.55, 0.65, 0.3);
    this.torsoMesh = new THREE.Mesh(torsoGeo, armorDarkMat);
    this.torsoMesh.position.y = 1.05;
    this.torsoMesh.castShadow = true;
    this.torsoMesh.receiveShadow = true;
    this.visualRoot.add(this.torsoMesh);

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
    this.visualRoot.add(this.headMesh);

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
    this.visualRoot.add(this.leftArmPivot);

    // 4. Right Arm Pivot (holding rifle)
    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.38, 1.3, 0);
    const rightArmMesh = new THREE.Mesh(armGeo, armorDarkMat);
    rightArmMesh.position.y = -0.28;
    this.rightArmPivot.add(rightArmMesh);

    // --- Stylized Tactical Assault Carbine attached to right arm ---
    this.rifleGroup = new THREE.Group();

    // Receiver chassis
    const receiverUpper = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.32),
      armorDarkMat
    );
    receiverUpper.position.set(0, 0.02, 0.06);
    this.rifleGroup.add(receiverUpper);

    const receiverLower = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.06, 0.22),
      polymerMat
    );
    receiverLower.position.set(0, -0.04, 0.04);
    this.rifleGroup.add(receiverLower);

    // Tactical top rail
    const railMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.018, 0.34),
      metallicMat
    );
    railMesh.position.set(0, 0.065, 0.06);
    this.rifleGroup.add(railMesh);

    // Glowing energy receiver stripe
    const energyStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.084, 0.014, 0.18),
      visorMat
    );
    energyStripe.position.set(0, 0.015, 0.06);
    this.rifleGroup.add(energyStripe);

    // Buffer tube & tactical stock extending backward (-Z relative to rifle)
    const bufferGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8);
    bufferGeo.rotateX(Math.PI / 2);
    const bufferTube = new THREE.Mesh(bufferGeo, metallicMat);
    bufferTube.position.set(0, 0.01, -0.16);
    this.rifleGroup.add(bufferTube);

    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.11, 0.14),
      polymerMat
    );
    stock.position.set(0, -0.02, -0.18);
    stock.rotation.x = 0.12;
    this.rifleGroup.add(stock);

    // Vented barrel handguard extending forward (+Z)
    const handguard = new THREE.Mesh(
      new THREE.BoxGeometry(0.072, 0.082, 0.24),
      armorDarkMat
    );
    handguard.position.set(0, 0.01, 0.30);
    this.rifleGroup.add(handguard);

    // Angled foregrip
    const foregrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.07, 0.05),
      polymerMat
    );
    foregrip.position.set(0, -0.065, 0.30);
    foregrip.rotation.x = -0.25;
    this.rifleGroup.add(foregrip);

    // Extended rifled barrel
    const barrelGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.30, 8);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, metallicMat);
    barrel.position.set(0, 0.01, 0.52);
    this.rifleGroup.add(barrel);

    // Slotted muzzle brake
    const brakeGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8);
    brakeGeo.rotateX(Math.PI / 2);
    const brake = new THREE.Mesh(brakeGeo, metallicMat);
    brake.position.set(0, 0.01, 0.68);
    this.rifleGroup.add(brake);

    // Curved magazine angled forward
    const magMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.18, 0.08),
      polymerMat
    );
    magMesh.position.set(0, -0.14, 0.08);
    magMesh.rotation.x = -0.18;
    this.rifleGroup.add(magMesh);

    // Magazine energy stripe
    const magStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.13, 0.015),
      visorMat
    );
    magStripe.position.set(0, -0.14, 0.12);
    magStripe.rotation.x = -0.18;
    this.rifleGroup.add(magStripe);

    // Holographic sight
    const sightBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.04, 0.08),
      polymerMat
    );
    sightBase.position.set(0, 0.09, 0.06);
    this.rifleGroup.add(sightBase);

    const sightReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.012, 0.022, 8),
      visorMat
    );
    sightReticle.position.set(0, 0.11, 0.02);
    this.rifleGroup.add(sightReticle);

    // Muzzle Socket & Multi-Layer Remote Flash
    this.muzzleSocket = new THREE.Group();
    this.muzzleSocket.position.set(0, 0.01, 0.73);
    this.rifleGroup.add(this.muzzleSocket);

    // Flash core octahedron
    const coreGeo = new THREE.OctahedronGeometry(0.12, 0);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
    });
    this.muzzleFlashCore = new THREE.Mesh(coreGeo, coreMat);
    this.muzzleSocket.add(this.muzzleFlashCore);

    // Flash cross starburst plane
    const crossGeo = new THREE.BoxGeometry(0.36, 0.36, 0.01);
    const crossMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.muzzleFlashCross = new THREE.Mesh(crossGeo, crossMat);
    this.muzzleSocket.add(this.muzzleFlashCross);

    // Dynamic point light for remote muzzle flash
    this.muzzleLight = new THREE.PointLight(0x00e5ff, 0, 7);
    this.muzzleSocket.add(this.muzzleLight);

    // Mount rifle to right arm
    this.rifleGroup.position.set(0, -0.45, 0.2);
    this.rightArmPivot.add(this.rifleGroup);
    this.visualRoot.add(this.rightArmPivot);

    // 5. Left Leg Pivot (hip at y = 0.75, x = -0.16)
    this.leftLegPivot = new THREE.Group();
    this.leftLegPivot.position.set(-0.16, 0.75, 0);
    const legGeo = new THREE.BoxGeometry(0.2, 0.75, 0.2);
    const leftLegMesh = new THREE.Mesh(legGeo, armorDarkMat);
    leftLegMesh.position.y = -0.375;
    leftLegMesh.castShadow = true;
    this.leftLegPivot.add(leftLegMesh);
    this.visualRoot.add(this.leftLegPivot);

    // 6. Right Leg Pivot (hip at y = 0.75, x = 0.16)
    this.rightLegPivot = new THREE.Group();
    this.rightLegPivot.position.set(0.16, 0.75, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, armorDarkMat);
    rightLegMesh.position.y = -0.375;
    rightLegMesh.castShadow = true;
    this.rightLegPivot.add(rightLegMesh);
    this.visualRoot.add(this.rightLegPivot);

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
    this.visualRoot.add(this.shieldMesh);
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

  /**
   * Queries the world-space position of this remote player's rifle muzzle.
   */
  public getMuzzleWorldPosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    if (this.muzzleSocket) {
      return this.muzzleSocket.getWorldPosition(target);
    }
    return target.copy(this.group.position).add(new THREE.Vector3(0, 1.25, 0));
  }

  /**
   * Triggers visual shooting feedback on this remote player:
   * - Illuminates bright multi-layer muzzle flash & point light
   * - Kicks the arm and weapon with snappy recoil animation
   */
  public triggerFire(_endX?: number, _endY?: number, _endZ?: number, _hitTarget: boolean = false) {
    this.muzzleFlashTimer = 0.06;
    this.armRecoil = 0.22;
    this.weaponKickZ = 0.06;

    if (this.muzzleFlashCore && this.muzzleFlashCross && this.muzzleLight) {
      (this.muzzleFlashCore.material as THREE.MeshBasicMaterial).opacity = 1.0;
      (this.muzzleFlashCross.material as THREE.MeshBasicMaterial).opacity = 0.95;
      this.muzzleFlashCross.rotation.z = Math.random() * Math.PI;
      this.muzzleLight.intensity = 4.2;
    }
  }

  public syncState(state: any) {
    if (!state) return;

    if (typeof state.x === 'number') this.targetPos.x = state.x;
    if (typeof state.y === 'number') this.targetPos.y = state.y;
    if (typeof state.z === 'number') this.targetPos.z = state.z;
    if (typeof state.yaw === 'number') this.targetYaw = state.yaw;
    if (typeof state.pitch === 'number') this.targetPitch = state.pitch;

    // Detect large distance jumps (teleport, respawn) and snap immediately to prevent sliding
    if (this.group.position.distanceToSquared(this.targetPos) > 64) {
      this.group.position.copy(this.targetPos);
      this.group.rotation.y = this.targetYaw;
    }

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

    if (typeof state.maxHealth === 'number') this.maxHealth = state.maxHealth;

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

    // 4. Muzzle flash decay
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        if (this.muzzleFlashCore && this.muzzleFlashCross && this.muzzleLight) {
          (this.muzzleFlashCore.material as THREE.MeshBasicMaterial).opacity = 0;
          (this.muzzleFlashCross.material as THREE.MeshBasicMaterial).opacity = 0;
          this.muzzleLight.intensity = 0;
        }
      }
    }

    // 5. Recoil recovery
    this.armRecoil = Math.max(0, this.armRecoil - dt * 1.8);
    this.weaponKickZ = Math.max(0, this.weaponKickZ - dt * 0.6);

    // 6. Smooth aim pitch tracking (tilt head and weapon arm)
    this.currentPitch = THREE.MathUtils.lerp(this.currentPitch, this.targetPitch, Math.min(1, dt * 15));
    this.headMesh.rotation.x = -this.currentPitch * 0.75;

    // 7. Walk cycle animation when moving
    if (this.isMoving) {
      this.walkCycleTime += dt * 10;
      const swing = Math.sin(this.walkCycleTime) * 0.45;
      this.leftLegPivot.rotation.x = swing;
      this.rightLegPivot.rotation.x = -swing;
      this.leftArmPivot.rotation.x = -swing * 0.7;
      // Right arm holds rifle steady with pitch offset and firing recoil climb
      this.rightArmPivot.rotation.x = -Math.PI / 4 - this.currentPitch * 0.45 + Math.cos(this.walkCycleTime) * 0.05 - this.armRecoil;
    } else {
      // Idle pose
      this.leftLegPivot.rotation.x = THREE.MathUtils.lerp(this.leftLegPivot.rotation.x, 0, dt * 10);
      this.rightLegPivot.rotation.x = THREE.MathUtils.lerp(this.rightLegPivot.rotation.x, 0, dt * 10);
      this.leftArmPivot.rotation.x = THREE.MathUtils.lerp(this.leftArmPivot.rotation.x, 0, dt * 10);
      this.rightArmPivot.rotation.x = THREE.MathUtils.lerp(
        this.rightArmPivot.rotation.x,
        -Math.PI / 4 - this.currentPitch * 0.45 - this.armRecoil,
        dt * 15
      );
    }

    // Weapon mechanical kick
    this.rifleGroup.position.z = 0.2 - this.weaponKickZ;

    // 8. Shield bubble animation
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
    this.isAlive = false;
    this.billboardTexture.dispose();
    if (this.billboardSprite && this.billboardSprite.material) {
      this.billboardSprite.material.dispose();
    }

    const uniqueGeometries = new Set<THREE.BufferGeometry>();
    const uniqueMaterials = new Set<THREE.Material>();

    this.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) uniqueGeometries.add(mesh.geometry);
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m && uniqueMaterials.add(m));
        } else if (mesh.material) {
          uniqueMaterials.add(mesh.material);
        }
      }
    });

    uniqueGeometries.forEach((geo) => geo.dispose());
    uniqueMaterials.forEach((mat) => mat.dispose());

    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.group.clear();
  }
}
