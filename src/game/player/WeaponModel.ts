import * as THREE from 'three';

export class WeaponModel {
  public group: THREE.Group;
  private gunMesh: THREE.Group;
  private muzzleFlash: THREE.Mesh;
  private muzzleLight: THREE.PointLight;

  private defaultPos = new THREE.Vector3(0.28, -0.25, -0.55);
  private defaultRot = new THREE.Vector3(0, 0, 0);

  private recoilZ: number = 0;
  private recoilRotX: number = 0;
  private muzzleFlashTimer: number = 0;

  private isReloading: boolean = false;
  private reloadProgress: number = 0;

  constructor() {
    this.group = new THREE.Group();
    this.gunMesh = new THREE.Group();
    this.group.add(this.gunMesh);

    // Materials
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.8,
      flatShading: true,
    });

    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.9,
      flatShading: true,
    });

    const energyRailMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
    });

    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.3,
      metalness: 0.9,
    });

    // 1. Rifle Main Body
    const bodyGeo = new THREE.BoxGeometry(0.08, 0.12, 0.42);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0, -0.1);
    this.gunMesh.add(body);

    // 2. Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.024, 0.028, 0.28, 8);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.02, -0.4);
    this.gunMesh.add(barrel);

    // Muzzle brake
    const brakeGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.06, 8);
    brakeGeo.rotateX(Math.PI / 2);
    const brake = new THREE.Mesh(brakeGeo, bodyMat);
    brake.position.set(0, 0.02, -0.54);
    this.gunMesh.add(brake);

    // 3. Glowing Energy Rail (Runs along top of rifle)
    const railGeo = new THREE.BoxGeometry(0.04, 0.02, 0.32);
    const rail = new THREE.Mesh(railGeo, energyRailMat);
    rail.position.set(0, 0.07, -0.15);
    this.gunMesh.add(rail);

    // 4. Grip / Handle
    const gripGeo = new THREE.BoxGeometry(0.06, 0.14, 0.08);
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, -0.11, 0.02);
    grip.rotation.x = -0.25;
    this.gunMesh.add(grip);

    // 5. Magazine Cartridge
    const magGeo = new THREE.BoxGeometry(0.05, 0.12, 0.09);
    const mag = new THREE.Mesh(magGeo, energyRailMat);
    mag.position.set(0, -0.09, -0.14);
    mag.rotation.x = 0.15;
    this.gunMesh.add(mag);

    // 6. Holographic Sight / Optic
    const opticBaseGeo = new THREE.BoxGeometry(0.05, 0.04, 0.08);
    const opticBase = new THREE.Mesh(opticBaseGeo, bodyMat);
    opticBase.position.set(0, 0.09, 0.02);
    this.gunMesh.add(opticBase);

    const opticLensGeo = new THREE.RingGeometry(0.015, 0.025, 8);
    const opticLens = new THREE.Mesh(opticLensGeo, energyRailMat);
    opticLens.position.set(0, 0.11, -0.02);
    this.gunMesh.add(opticLens);

    // 7. Muzzle Flash Sprite & Light
    const flashGeo = new THREE.OctahedronGeometry(0.08, 0);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0x88f5ff,
      transparent: true,
      opacity: 0,
    });
    this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlash.position.set(0, 0.02, -0.6);
    this.gunMesh.add(this.muzzleFlash);

    this.muzzleLight = new THREE.PointLight(0x00e5ff, 0, 6);
    this.muzzleLight.position.set(0, 0.02, -0.6);
    this.gunMesh.add(this.muzzleLight);

    // Position viewmodel relative to camera
    this.gunMesh.position.copy(this.defaultPos);
  }

  public triggerRecoil() {
    this.recoilZ = 0.085;
    this.recoilRotX = 0.12;

    // Show muzzle flash
    this.muzzleFlashTimer = 0.05;
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = 1.0;
    this.muzzleLight.intensity = 3.5;
  }

  public startReload(durationSec: number = 1.6) {
    this.isReloading = true;
    this.reloadProgress = 0;
    this.reloadDuration = durationSec;
  }

  private reloadDuration = 1.6;

  public update(delta: number, isMoving: boolean, isSprinting: boolean, time: number) {
    const dt = Math.min(delta, 0.1);

    // Muzzle flash decay
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        (this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = 0;
        this.muzzleLight.intensity = 0;
      }
    }

    // Recoil recovery
    this.recoilZ = Math.max(0, this.recoilZ - dt * 0.5);
    this.recoilRotX = Math.max(0, this.recoilRotX - dt * 0.8);

    // Procedural weapon bobbing
    let bobX = 0;
    let bobY = 0;
    if (isMoving && !this.isReloading) {
      const bobFreq = isSprinting ? 14 : 9;
      const bobAmp = isSprinting ? 0.03 : 0.015;
      bobX = Math.sin(time * bobFreq * 0.5) * bobAmp * 0.5;
      bobY = Math.abs(Math.sin(time * bobFreq)) * bobAmp;
    } else {
      // Gentle idle breathing sway
      bobX = Math.sin(time * 2.0) * 0.003;
      bobY = Math.cos(time * 2.0) * 0.003;
    }

    // Reload animation dip
    let reloadOffsetY = 0;
    let reloadRotZ = 0;
    if (this.isReloading) {
      this.reloadProgress += dt / this.reloadDuration;
      if (this.reloadProgress >= 1.0) {
        this.isReloading = false;
        this.reloadProgress = 0;
      } else {
        // Smooth sine dip curve
        const dip = Math.sin(this.reloadProgress * Math.PI);
        reloadOffsetY = -dip * 0.22;
        reloadRotZ = dip * 0.45;
      }
    }

    // Apply combined offsets
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
