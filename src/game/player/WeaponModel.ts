import * as THREE from 'three';

export class WeaponModel {
  public group: THREE.Group;
  private gunMesh: THREE.Group;
  private muzzleSocket: THREE.Group;
  private muzzleFlashGroup: THREE.Group;
  private muzzleFlashCore: THREE.Mesh;
  private muzzleFlashCross: THREE.Mesh;
  private muzzleLight: THREE.PointLight;

  // Viewmodel resting transform in camera space (lower-right, forward-facing tactical carbine)
  private defaultPos = new THREE.Vector3(0.22, -0.19, -0.46);
  private defaultRot = new THREE.Vector3(0.01, -0.02, 0);

  private recoilZ: number = 0;
  private recoilRotX: number = 0;
  private muzzleFlashTimer: number = 0;

  private isReloading: boolean = false;
  private reloadProgress: number = 0;
  private reloadDuration: number = 1.6;

  constructor() {
    this.group = new THREE.Group();
    this.gunMesh = new THREE.Group();
    this.group.add(this.gunMesh);

    // --- MATERIALS ---
    // Primary gun metal (matte tactical dark slate)
    const receiverMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.45,
      metalness: 0.75,
      flatShading: true,
    });

    // Darker polymer for grips and stock
    const polymerMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.85,
      metalness: 0.25,
      flatShading: true,
    });

    // Metallic barrel and mechanical accents
    const metallicMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.25,
      metalness: 0.9,
    });

    // Bright glowing cyan energy accents
    const energyMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
    });

    // Reflex optic glass / reticle
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9,
    });

    // --- 1. RECEIVER & CHASSIS ---
    // Upper receiver
    const upperGeo = new THREE.BoxGeometry(0.065, 0.06, 0.32);
    const upper = new THREE.Mesh(upperGeo, receiverMat);
    upper.position.set(0, 0.025, -0.06);
    this.gunMesh.add(upper);

    // Lower receiver / mag housing
    const lowerGeo = new THREE.BoxGeometry(0.055, 0.05, 0.22);
    const lower = new THREE.Mesh(lowerGeo, polymerMat);
    lower.position.set(0, -0.025, -0.04);
    this.gunMesh.add(lower);

    // Top Picatinny tactical rail
    const railGeo = new THREE.BoxGeometry(0.038, 0.015, 0.36);
    const rail = new THREE.Mesh(railGeo, metallicMat);
    rail.position.set(0, 0.06, -0.07);
    this.gunMesh.add(rail);

    // Ejection port cover (right side)
    const portGeo = new THREE.BoxGeometry(0.012, 0.024, 0.08);
    const port = new THREE.Mesh(portGeo, metallicMat);
    port.position.set(0.032, 0.03, -0.05);
    this.gunMesh.add(port);

    // Glowing energy status line along receiver flank
    const statusLineGeo = new THREE.BoxGeometry(0.068, 0.008, 0.18);
    const statusLine = new THREE.Mesh(statusLineGeo, energyMat);
    statusLine.position.set(0, 0.015, -0.06);
    this.gunMesh.add(statusLine);

    // --- 2. STOCK & BUFFER TUBE (Eliminates blocky walkie-talkie look) ---
    // Cylindrical buffer tube extending straight back toward shoulder
    const bufferGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.16, 10);
    bufferGeo.rotateX(Math.PI / 2);
    const bufferTube = new THREE.Mesh(bufferGeo, metallicMat);
    bufferTube.position.set(0, 0.02, 0.16);
    this.gunMesh.add(bufferTube);

    // Skeletonized tactical carbine stock
    const stockGeo = new THREE.BoxGeometry(0.045, 0.09, 0.14);
    const stock = new THREE.Mesh(stockGeo, polymerMat);
    stock.position.set(0, -0.01, 0.19);
    stock.rotation.x = -0.12;
    this.gunMesh.add(stock);

    // Ergonomic rubber buttpad at the rear
    const buttpadGeo = new THREE.BoxGeometry(0.048, 0.12, 0.022);
    const buttpad = new THREE.Mesh(buttpadGeo, polymerMat);
    buttpad.position.set(0, -0.015, 0.265);
    this.gunMesh.add(buttpad);

    // --- 3. BARREL SHROUD / HANDGUARD ---
    // Tactical vented handguard
    const handguardGeo = new THREE.BoxGeometry(0.058, 0.068, 0.24);
    const handguard = new THREE.Mesh(handguardGeo, receiverMat);
    handguard.position.set(0, 0.02, -0.32);
    this.gunMesh.add(handguard);

    // Lower angled foregrip
    const foregripGeo = new THREE.BoxGeometry(0.04, 0.07, 0.05);
    const foregrip = new THREE.Mesh(foregripGeo, polymerMat);
    foregrip.position.set(0, -0.045, -0.32);
    foregrip.rotation.x = 0.25;
    this.gunMesh.add(foregrip);

    // --- 4. EXTENDED BARREL & MUZZLE BRAKE ---
    // Extended rifled barrel extending past handguard
    const barrelGeo = new THREE.CylinderGeometry(0.016, 0.018, 0.32, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, metallicMat);
    barrel.position.set(0, 0.02, -0.52);
    this.gunMesh.add(barrel);

    // Aggressive slotted muzzle brake
    const brakeGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.07, 10);
    brakeGeo.rotateX(Math.PI / 2);
    const brake = new THREE.Mesh(brakeGeo, metallicMat);
    brake.position.set(0, 0.02, -0.71);
    this.gunMesh.add(brake);

    // Crown flash hider ring
    const crownGeo = new THREE.RingGeometry(0.014, 0.026, 8);
    const crown = new THREE.Mesh(crownGeo, metallicMat);
    crown.position.set(0, 0.02, -0.745);
    this.gunMesh.add(crown);

    // --- 5. PISTOL GRIP & TRIGGER ASSEMBLY ---
    // Ergonomic angled pistol grip
    const gripGeo = new THREE.BoxGeometry(0.048, 0.14, 0.065);
    const grip = new THREE.Mesh(gripGeo, polymerMat);
    grip.position.set(0, -0.105, 0.05);
    grip.rotation.x = -0.32;
    this.gunMesh.add(grip);

    // Trigger guard
    const guardGeo = new THREE.BoxGeometry(0.02, 0.04, 0.065);
    const guard = new THREE.Mesh(guardGeo, polymerMat);
    guard.position.set(0, -0.065, -0.01);
    this.gunMesh.add(guard);

    // Trigger
    const triggerGeo = new THREE.BoxGeometry(0.008, 0.025, 0.015);
    const trigger = new THREE.Mesh(triggerGeo, metallicMat);
    trigger.position.set(0, -0.06, 0.005);
    trigger.rotation.x = -0.2;
    this.gunMesh.add(trigger);

    // --- 6. CURVED HIGH-CAPACITY MAGAZINE ---
    // Magwell beneath receiver
    const magwellGeo = new THREE.BoxGeometry(0.058, 0.035, 0.08);
    const magwell = new THREE.Mesh(magwellGeo, receiverMat);
    magwell.position.set(0, -0.055, -0.11);
    this.gunMesh.add(magwell);

    // Curved magazine angled slightly forward
    const magGeo = new THREE.BoxGeometry(0.042, 0.17, 0.075);
    const mag = new THREE.Mesh(magGeo, polymerMat);
    mag.position.set(0, -0.14, -0.115);
    mag.rotation.x = 0.16;
    this.gunMesh.add(mag);

    // Glowing cyan ammo energy cell stripe
    const magStripeGeo = new THREE.BoxGeometry(0.044, 0.13, 0.012);
    const magStripe = new THREE.Mesh(magStripeGeo, energyMat);
    magStripe.position.set(0, -0.14, -0.08);
    magStripe.rotation.x = 0.16;
    this.gunMesh.add(magStripe);

    // --- 7. HOLOGRAPHIC REFLEX OPTIC ---
    // Optic riser mount on Picatinny rail
    const mountGeo = new THREE.BoxGeometry(0.042, 0.025, 0.07);
    const mount = new THREE.Mesh(mountGeo, polymerMat);
    mount.position.set(0, 0.075, -0.06);
    this.gunMesh.add(mount);

    // Sight hood housing (open rectangular frame)
    const hoodTopGeo = new THREE.BoxGeometry(0.048, 0.008, 0.07);
    const hoodTop = new THREE.Mesh(hoodTopGeo, receiverMat);
    hoodTop.position.set(0, 0.125, -0.06);
    this.gunMesh.add(hoodTop);

    const hoodSideL = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.07), receiverMat);
    hoodSideL.position.set(-0.022, 0.105, -0.06);
    this.gunMesh.add(hoodSideL);

    const hoodSideR = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.07), receiverMat);
    hoodSideR.position.set(0.022, 0.105, -0.06);
    this.gunMesh.add(hoodSideR);

    // Projected holographic reticle dot
    const reticleGeo = new THREE.PlaneGeometry(0.018, 0.018);
    const reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.position.set(0, 0.105, -0.06);
    this.gunMesh.add(reticle);

    // --- 8. MUZZLE SOCKET & MULTI-LAYER FLASH ---
    this.muzzleSocket = new THREE.Group();
    this.muzzleSocket.position.set(0, 0.02, -0.76);
    this.gunMesh.add(this.muzzleSocket);

    this.muzzleFlashGroup = new THREE.Group();
    this.muzzleSocket.add(this.muzzleFlashGroup);

    // Flash core octahedron
    const coreGeo = new THREE.OctahedronGeometry(0.085, 0);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
    });
    this.muzzleFlashCore = new THREE.Mesh(coreGeo, coreMat);
    this.muzzleFlashGroup.add(this.muzzleFlashCore);

    // Cross-star flare mesh
    const crossGeo = new THREE.BoxGeometry(0.24, 0.24, 0.01);
    const crossMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.muzzleFlashCross = new THREE.Mesh(crossGeo, crossMat);
    this.muzzleFlashGroup.add(this.muzzleFlashCross);

    // Dynamic muzzle flash point light
    this.muzzleLight = new THREE.PointLight(0x00e5ff, 0, 8);
    this.muzzleSocket.add(this.muzzleLight);

    // Apply resting viewmodel pose
    this.gunMesh.position.copy(this.defaultPos);
    this.gunMesh.rotation.set(this.defaultRot.x, this.defaultRot.y, this.defaultRot.z);
  }

  /**
   * Queries world-space coordinates of the rifle's muzzle tip.
   */
  public getMuzzleWorldPosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return this.muzzleSocket.getWorldPosition(target);
  }

  /**
   * Triggers snappy tactile recoil and illuminates muzzle flash.
   */
  public triggerRecoil() {
    this.recoilZ = 0.055;
    this.recoilRotX = 0.07;

    // Show muzzle flash
    this.muzzleFlashTimer = 0.06;
    (this.muzzleFlashCore.material as THREE.MeshBasicMaterial).opacity = 1.0;
    (this.muzzleFlashCross.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.muzzleFlashCross.rotation.z = Math.random() * Math.PI;
    this.muzzleLight.intensity = 4.5;
  }

  public startReload(durationSec: number = 1.6) {
    this.isReloading = true;
    this.reloadProgress = 0;
    this.reloadDuration = durationSec;
  }

  public update(delta: number, isMoving: boolean, isSprinting: boolean, time: number) {
    const dt = Math.min(delta, 0.1);

    // Muzzle flash decay
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        (this.muzzleFlashCore.material as THREE.MeshBasicMaterial).opacity = 0;
        (this.muzzleFlashCross.material as THREE.MeshBasicMaterial).opacity = 0;
        this.muzzleLight.intensity = 0;
      }
    }

    // Snappy recoil recovery
    this.recoilZ = Math.max(0, this.recoilZ - dt * 0.42);
    this.recoilRotX = Math.max(0, this.recoilRotX - dt * 0.65);

    // Procedural weapon bobbing & breathing sway
    let bobX = 0;
    let bobY = 0;
    if (isMoving && !this.isReloading) {
      const bobFreq = isSprinting ? 14 : 9;
      const bobAmp = isSprinting ? 0.024 : 0.012;
      bobX = Math.sin(time * bobFreq * 0.5) * bobAmp * 0.5;
      bobY = Math.abs(Math.sin(time * bobFreq)) * bobAmp;
    } else {
      // Gentle idle breathing sway
      bobX = Math.sin(time * 2.0) * 0.0025;
      bobY = Math.cos(time * 2.0) * 0.0025;
    }

    // Smooth reload animation dip
    let reloadOffsetY = 0;
    let reloadRotZ = 0;
    if (this.isReloading) {
      this.reloadProgress += dt / this.reloadDuration;
      if (this.reloadProgress >= 1.0) {
        this.isReloading = false;
        this.reloadProgress = 0;
      } else {
        const dip = Math.sin(this.reloadProgress * Math.PI);
        reloadOffsetY = -dip * 0.20;
        reloadRotZ = dip * 0.40;
      }
    }

    // Apply combined position and rotation
    this.gunMesh.position.set(
      this.defaultPos.x + bobX,
      this.defaultPos.y + bobY + reloadOffsetY,
      this.defaultPos.z + this.recoilZ
    );

    this.gunMesh.rotation.set(
      this.defaultRot.x + this.recoilRotX,
      this.defaultRot.y,
      this.defaultRot.z + reloadRotZ
    );
  }

  public dispose() {
    this.group.traverse((obj) => {
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
  }
}
