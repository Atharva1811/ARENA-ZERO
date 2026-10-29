import * as THREE from 'three';
import type { WeaponId } from '../../../shared/types';

export class WeaponModel {
  public group: THREE.Group;
  public currentWeapon: WeaponId = 'rifle';

  // Weapon sub-groups
  private knifeGroup: THREE.Group;
  private pistolGroup: THREE.Group;
  private rifleGroup: THREE.Group;
  private sniperGroup: THREE.Group;

  // Active viewmodel mesh container
  private activeContainer: THREE.Group;

  // Muzzle sockets & flashes per firearm
  private pistolMuzzleSocket!: THREE.Group;
  private pistolFlashGroup!: THREE.Group;
  private pistolFlashCore!: THREE.Mesh;
  private pistolFlashCross!: THREE.Mesh;
  private pistolLight!: THREE.PointLight;

  private rifleMuzzleSocket!: THREE.Group;
  private rifleFlashGroup!: THREE.Group;
  private rifleFlashCore!: THREE.Mesh;
  private rifleFlashCross!: THREE.Mesh;
  private rifleLight!: THREE.PointLight;

  private sniperMuzzleSocket!: THREE.Group;
  private sniperFlashGroup!: THREE.Group;
  private sniperFlashCore!: THREE.Mesh;
  private sniperFlashCross!: THREE.Mesh;
  private sniperLight!: THREE.PointLight;

  // Resting & ADS transforms per weapon in camera space
  private restingTransforms: Record<WeaponId, { pos: THREE.Vector3; rot: THREE.Vector3; adsPos: THREE.Vector3 }> = {
    knife: {
      pos: new THREE.Vector3(0.20, -0.19, -0.38),
      rot: new THREE.Vector3(0.18, -0.32, 0.12),
      adsPos: new THREE.Vector3(0.14, -0.16, -0.34),
    },
    pistol: {
      pos: new THREE.Vector3(0.18, -0.17, -0.42),
      rot: new THREE.Vector3(0.01, -0.015, 0),
      adsPos: new THREE.Vector3(0.0, -0.118, -0.35),
    },
    rifle: {
      pos: new THREE.Vector3(0.22, -0.19, -0.46),
      rot: new THREE.Vector3(0.01, -0.02, 0),
      adsPos: new THREE.Vector3(0.0, -0.128, -0.38),
    },
    sniper: {
      pos: new THREE.Vector3(0.23, -0.21, -0.52),
      rot: new THREE.Vector3(0.01, -0.02, 0),
      adsPos: new THREE.Vector3(0.0, -0.135, -0.40),
    },
  };

  private currentAdsProgress: number = 0;
  private isAiming: boolean = false;
  private isSniperScoped: boolean = false;

  private recoilZ: number = 0;
  private recoilRotX: number = 0;
  private muzzleFlashTimer: number = 0;
  private muzzleFlashFrames: number = 0;

  // Melee slash animation state
  private isSlashing: boolean = false;
  private slashProgress: number = 0;

  // Reload animation state
  private isReloading: boolean = false;
  private reloadProgress: number = 0;
  private reloadDuration: number = 1.6;

  constructor() {
    this.group = new THREE.Group();
    this.activeContainer = new THREE.Group();
    this.group.add(this.activeContainer);

    this.knifeGroup = new THREE.Group();
    this.pistolGroup = new THREE.Group();
    this.rifleGroup = new THREE.Group();
    this.sniperGroup = new THREE.Group();

    this.activeContainer.add(this.knifeGroup);
    this.activeContainer.add(this.pistolGroup);
    this.activeContainer.add(this.rifleGroup);
    this.activeContainer.add(this.sniperGroup);

    // Build models
    this.buildKnife();
    this.buildPistol();
    this.buildRifle();
    this.buildSniper();

    // Default to pulse rifle
    this.setWeapon('rifle');
  }

  public setWeapon(weaponId: WeaponId) {
    this.currentWeapon = weaponId;
    this.knifeGroup.visible = weaponId === 'knife';
    this.pistolGroup.visible = weaponId === 'pistol';
    this.rifleGroup.visible = weaponId === 'rifle';
    this.sniperGroup.visible = weaponId === 'sniper';

    this.recoilZ = 0;
    this.recoilRotX = 0;
    this.isSlashing = false;
    this.isReloading = false;
    this.currentAdsProgress = 0;
    this.isAiming = false;
    this.isSniperScoped = false;

    const t = this.restingTransforms[weaponId];
    this.activeContainer.position.copy(t.pos);
    this.activeContainer.rotation.set(t.rot.x, t.rot.y, t.rot.z);
  }

  public setAiming(isAiming: boolean, isSniperScoped: boolean) {
    this.isAiming = isAiming;
    this.isSniperScoped = isSniperScoped;

    // When sniper is fully scoped in, hide 3D viewmodel so the full-screen sniper reticle takes over
    if (this.currentWeapon === 'sniper') {
      this.sniperGroup.visible = !isSniperScoped;
    }
  }

  // --- MODEL BUILDERS ---

  private buildKnife() {
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.2,
      flatShading: true,
    });
    const guardMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.35,
      metalness: 0.85,
    });
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.2,
      metalness: 0.95,
      flatShading: true,
    });
    const energyMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });

    // Ergonomic tactical handle
    const handleGeo = new THREE.BoxGeometry(0.032, 0.13, 0.042);
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0, -0.065, 0.02);
    this.knifeGroup.add(handle);

    // Crossguard
    const guardGeo = new THREE.BoxGeometry(0.048, 0.016, 0.055);
    const guard = new THREE.Mesh(guardGeo, guardMat);
    guard.position.set(0, 0.008, 0.02);
    this.knifeGroup.add(guard);

    // Combat blade (pointed forward -Z in camera space)
    const bladeGeo = new THREE.BoxGeometry(0.012, 0.042, 0.24);
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(0, 0.018, -0.11);
    this.knifeGroup.add(blade);

    // Tapered cutting tip
    const tipGeo = new THREE.ConeGeometry(0.021, 0.07, 4);
    tipGeo.rotateX(-Math.PI / 2);
    const tip = new THREE.Mesh(tipGeo, bladeMat);
    tip.position.set(0, 0.018, -0.25);
    this.knifeGroup.add(tip);

    // Cyan energised cutting edge line
    const edgeGeo = new THREE.BoxGeometry(0.014, 0.006, 0.22);
    const edge = new THREE.Mesh(edgeGeo, energyMat);
    edge.position.set(0, -0.004, -0.11);
    this.knifeGroup.add(edge);
  }

  private buildPistol() {
    const slideMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.3,
      metalness: 0.85,
      flatShading: true,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.8,
      metalness: 0.3,
      flatShading: true,
    });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.25, metalness: 0.9 });
    const energyMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const sightMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    // Lower frame & grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.12, 0.055), frameMat);
    grip.position.set(0, -0.07, 0.04);
    grip.rotation.x = -0.28;
    this.pistolGroup.add(grip);

    // Trigger guard
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.035, 0.05), frameMat);
    guard.position.set(0, -0.035, -0.01);
    this.pistolGroup.add(guard);

    // Trigger
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.02, 0.012), metalMat);
    trigger.position.set(0, -0.03, 0.005);
    this.pistolGroup.add(trigger);

    // Slide & upper frame
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.046, 0.22), slideMat);
    slide.position.set(0, 0.015, -0.05);
    this.pistolGroup.add(slide);

    // Barrel tip
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), metalMat);
    barrel.geometry.rotateX(Math.PI / 2);
    barrel.position.set(0, 0.015, -0.17);
    this.pistolGroup.add(barrel);

    // Front iron sight
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.014, 0.012), sightMat);
    frontSight.position.set(0, 0.045, -0.15);
    this.pistolGroup.add(frontSight);

    // Rear iron sight
    const rearSightL = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.014, 0.01), sightMat);
    rearSightL.position.set(-0.012, 0.045, 0.05);
    this.pistolGroup.add(rearSightL);
    const rearSightR = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.014, 0.01), sightMat);
    rearSightR.position.set(0.012, 0.045, 0.05);
    this.pistolGroup.add(rearSightR);

    // Glowing battery cell line
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.047, 0.008, 0.09), energyMat);
    cell.position.set(0, 0.008, -0.04);
    this.pistolGroup.add(cell);

    // Muzzle Socket & Flash
    this.pistolMuzzleSocket = new THREE.Group();
    this.pistolMuzzleSocket.position.set(0, 0.015, -0.21);
    this.pistolGroup.add(this.pistolMuzzleSocket);

    this.pistolFlashGroup = new THREE.Group();
    this.pistolMuzzleSocket.add(this.pistolFlashGroup);

    this.pistolFlashCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.065, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false })
    );
    this.pistolFlashGroup.add(this.pistolFlashCore);

    this.pistolFlashCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0, depthTest: false })
    );
    this.pistolFlashGroup.add(this.pistolFlashCross);
    this.pistolFlashGroup.visible = false;

    this.pistolLight = new THREE.PointLight(0x00e5ff, 0, 6);
    this.pistolMuzzleSocket.add(this.pistolLight);
  }

  private buildRifle() {
    const receiverMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.45,
      metalness: 0.75,
      flatShading: true,
    });
    const polymerMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.85,
      metalness: 0.25,
      flatShading: true,
    });
    const metallicMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.25, metalness: 0.9 });
    const energyMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 });

    // Upper receiver
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.06, 0.32), receiverMat);
    upper.position.set(0, 0.025, -0.06);
    this.rifleGroup.add(upper);

    // Lower receiver / mag housing
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.22), polymerMat);
    lower.position.set(0, -0.025, -0.04);
    this.rifleGroup.add(lower);

    // Top rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.015, 0.36), metallicMat);
    rail.position.set(0, 0.06, -0.07);
    this.rifleGroup.add(rail);

    // Status line
    const statusLine = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.008, 0.18), energyMat);
    statusLine.position.set(0, 0.015, -0.06);
    this.rifleGroup.add(statusLine);

    // Stock & Buffer Tube
    const buffer = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 10), metallicMat);
    buffer.geometry.rotateX(Math.PI / 2);
    buffer.position.set(0, 0.02, 0.16);
    this.rifleGroup.add(buffer);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.09, 0.14), polymerMat);
    stock.position.set(0, -0.01, 0.19);
    stock.rotation.x = -0.12;
    this.rifleGroup.add(stock);

    const buttpad = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.12, 0.022), polymerMat);
    buttpad.position.set(0, -0.015, 0.265);
    this.rifleGroup.add(buttpad);

    // Handguard & Barrel
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.068, 0.24), receiverMat);
    handguard.position.set(0, 0.02, -0.32);
    this.rifleGroup.add(handguard);

    const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.05), polymerMat);
    foregrip.position.set(0, -0.045, -0.32);
    foregrip.rotation.x = 0.25;
    this.rifleGroup.add(foregrip);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.32, 12), metallicMat);
    barrel.geometry.rotateX(Math.PI / 2);
    barrel.position.set(0, 0.02, -0.52);
    this.rifleGroup.add(barrel);

    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.07, 10), metallicMat);
    brake.geometry.rotateX(Math.PI / 2);
    brake.position.set(0, 0.02, -0.71);
    this.rifleGroup.add(brake);

    // Pistol grip & Magazine
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.14, 0.065), polymerMat);
    grip.position.set(0, -0.105, 0.05);
    grip.rotation.x = -0.32;
    this.rifleGroup.add(grip);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.17, 0.075), polymerMat);
    mag.position.set(0, -0.14, -0.115);
    mag.rotation.x = 0.16;
    this.rifleGroup.add(mag);

    const magStripe = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.13, 0.012), energyMat);
    magStripe.position.set(0, -0.14, -0.08);
    magStripe.rotation.x = 0.16;
    this.rifleGroup.add(magStripe);

    // Reflex Optic
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.025, 0.07), polymerMat);
    mount.position.set(0, 0.075, -0.06);
    this.rifleGroup.add(mount);

    const hoodTop = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.008, 0.07), receiverMat);
    hoodTop.position.set(0, 0.125, -0.06);
    this.rifleGroup.add(hoodTop);

    const hoodSideL = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.07), receiverMat);
    hoodSideL.position.set(-0.022, 0.105, -0.06);
    this.rifleGroup.add(hoodSideL);

    const hoodSideR = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.07), receiverMat);
    hoodSideR.position.set(0.022, 0.105, -0.06);
    this.rifleGroup.add(hoodSideR);

    const reticle = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.018), reticleMat);
    reticle.position.set(0, 0.105, -0.06);
    this.rifleGroup.add(reticle);

    // Muzzle Socket & Flash
    this.rifleMuzzleSocket = new THREE.Group();
    this.rifleMuzzleSocket.position.set(0, 0.02, -0.76);
    this.rifleGroup.add(this.rifleMuzzleSocket);

    this.rifleFlashGroup = new THREE.Group();
    this.rifleMuzzleSocket.add(this.rifleFlashGroup);

    this.rifleFlashCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.085, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false })
    );
    this.rifleFlashGroup.add(this.rifleFlashCore);

    this.rifleFlashCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.24, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0, depthTest: false })
    );
    this.rifleFlashGroup.add(this.rifleFlashCross);
    this.rifleFlashGroup.visible = false;

    this.rifleLight = new THREE.PointLight(0x00e5ff, 0, 8);
    this.rifleMuzzleSocket.add(this.rifleLight);
  }

  private buildSniper() {
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.7,
      flatShading: true,
    });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.2, metalness: 0.95 });
    const polymerMat = new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.9, metalness: 0.1 });
    const scopeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.85 });
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.8 });
    const energyMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    // Long monolithic chassis
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.075, 0.45), chassisMat);
    chassis.position.set(0, 0.02, -0.05);
    this.sniperGroup.add(chassis);

    const energyStripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.22), energyMat);
    energyStripe.position.set(0, 0.045, -0.05);
    this.sniperGroup.add(energyStripe);

    // Stock with cheek riser & buttpad
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.26), polymerMat);
    stock.position.set(0, -0.01, 0.26);
    this.sniperGroup.add(stock);

    const cheekRiser = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.04, 0.14), chassisMat);
    cheekRiser.position.set(0, 0.07, 0.22);
    this.sniperGroup.add(cheekRiser);

    // Heavy long fluted barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.58, 12), barrelMat);
    barrel.geometry.rotateX(Math.PI / 2);
    barrel.position.set(0, 0.025, -0.54);
    this.sniperGroup.add(barrel);

    // Massive dual-chamber muzzle brake
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.048, 0.11), barrelMat);
    brake.position.set(0, 0.025, -0.88);
    this.sniperGroup.add(brake);

    // Grip & 5-round box magazine
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.06), polymerMat);
    grip.position.set(0, -0.09, 0.06);
    grip.rotation.x = -0.3;
    this.sniperGroup.add(grip);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.11, 0.08), chassisMat);
    mag.position.set(0, -0.08, -0.11);
    this.sniperGroup.add(mag);

    // Folded bipod beneath barrel
    const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.025, 0.22), polymerMat);
    bipod.position.set(0, -0.025, -0.42);
    this.sniperGroup.add(bipod);

    // Heavy Optical Scope tube
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.32, 16), scopeMat);
    scopeTube.geometry.rotateX(Math.PI / 2);
    scopeTube.position.set(0, 0.105, -0.05);
    this.sniperGroup.add(scopeTube);

    // Scope front objective lens bell
    const objBell = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.026, 0.08, 16), scopeMat);
    objBell.geometry.rotateX(Math.PI / 2);
    objBell.position.set(0, 0.105, -0.23);
    this.sniperGroup.add(objBell);

    const objLens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), lensMat);
    objLens.position.set(0, 0.105, -0.271);
    this.sniperGroup.add(objLens);

    // Scope eyepiece bell
    const eyeBell = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.06, 16), scopeMat);
    eyeBell.geometry.rotateX(Math.PI / 2);
    eyeBell.position.set(0, 0.105, 0.13);
    this.sniperGroup.add(eyeBell);

    // Scope mounting rings
    const ring1 = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.04, 0.03), polymerMat);
    ring1.position.set(0, 0.085, -0.12);
    this.sniperGroup.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.04, 0.03), polymerMat);
    ring2.position.set(0, 0.085, 0.03);
    this.sniperGroup.add(ring2);

    // Muzzle Socket & Heavy Flash
    this.sniperMuzzleSocket = new THREE.Group();
    this.sniperMuzzleSocket.position.set(0, 0.025, -0.94);
    this.sniperGroup.add(this.sniperMuzzleSocket);

    this.sniperFlashGroup = new THREE.Group();
    this.sniperMuzzleSocket.add(this.sniperFlashGroup);

    this.sniperFlashCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.12, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false })
    );
    this.sniperFlashGroup.add(this.sniperFlashCore);

    this.sniperFlashCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0, depthTest: false })
    );
    this.sniperFlashGroup.add(this.sniperFlashCross);
    this.sniperFlashGroup.visible = false;

    this.sniperLight = new THREE.PointLight(0x00e5ff, 0, 10);
    this.sniperMuzzleSocket.add(this.sniperLight);
  }

  // --- ACTIONS & ANIMATIONS ---

  public getMuzzleWorldPosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    switch (this.currentWeapon) {
      case 'knife':
        return this.group.getWorldPosition(target);
      case 'pistol':
        return this.pistolMuzzleSocket ? this.pistolMuzzleSocket.getWorldPosition(target) : target;
      case 'sniper':
        return this.sniperMuzzleSocket ? this.sniperMuzzleSocket.getWorldPosition(target) : target;
      case 'rifle':
      default:
        return this.rifleMuzzleSocket ? this.rifleMuzzleSocket.getWorldPosition(target) : target;
    }
  }

  public triggerRecoil(weaponId: WeaponId = this.currentWeapon) {
    if (weaponId === 'knife') {
      this.triggerMeleeSlash();
      return;
    }

    if (weaponId === 'sniper') {
      this.recoilZ = 0.12;
      this.recoilRotX = 0.15;
    } else if (weaponId === 'pistol') {
      this.recoilZ = 0.045;
      this.recoilRotX = 0.06;
    } else {
      this.recoilZ = 0.06;
      this.recoilRotX = 0.08;
    }

    this.muzzleFlashTimer = weaponId === 'sniper' ? 0.11 : 0.09;
    this.muzzleFlashFrames = 3;

    // Trigger weapon-specific flash
    let flashGroup = this.rifleFlashGroup;
    let flashCore = this.rifleFlashCore;
    let flashCross = this.rifleFlashCross;
    let light = this.rifleLight;

    if (weaponId === 'pistol') {
      flashGroup = this.pistolFlashGroup;
      flashCore = this.pistolFlashCore;
      flashCross = this.pistolFlashCross;
      light = this.pistolLight;
    } else if (weaponId === 'sniper') {
      flashGroup = this.sniperFlashGroup;
      flashCore = this.sniperFlashCore;
      flashCross = this.sniperFlashCross;
      light = this.sniperLight;
    }

    if (flashGroup && flashCore && flashCross && light) {
      flashGroup.visible = true;
      (flashCore.material as THREE.MeshBasicMaterial).opacity = 1.0;
      (flashCross.material as THREE.MeshBasicMaterial).opacity = 0.95;
      flashCross.rotation.z = Math.random() * Math.PI;
      light.intensity = weaponId === 'sniper' ? 8.0 : weaponId === 'pistol' ? 4.0 : 5.0;
    }
  }

  public triggerMeleeSlash() {
    this.isSlashing = true;
    this.slashProgress = 0;
  }

  public startReload(durationSec: number = 1.6) {
    if (this.currentWeapon === 'knife') return;
    this.isReloading = true;
    this.reloadProgress = 0;
    this.reloadDuration = durationSec;
  }

  public update(delta: number, isMoving: boolean, isSprinting: boolean, time: number) {
    const dt = Math.min(delta, 0.1);

    // Smooth ADS interpolation
    const targetAds = this.isAiming ? 1.0 : 0.0;
    const adsSpeed = this.currentWeapon === 'sniper' ? 14 : 12;
    this.currentAdsProgress = THREE.MathUtils.lerp(this.currentAdsProgress, targetAds, Math.min(1.0, dt * adsSpeed));

    // Scoped weapon viewmodel visibility
    if (this.currentWeapon === 'sniper') {
      this.sniperGroup.visible = !this.isSniperScoped;
    }

    // Muzzle flash decay
    if (this.muzzleFlashFrames > 0) {
      this.muzzleFlashFrames--;
    } else if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        if (this.rifleFlashGroup) {
          this.rifleFlashGroup.visible = false;
          (this.rifleFlashCore.material as THREE.MeshBasicMaterial).opacity = 0;
          this.rifleLight.intensity = 0;
        }
        if (this.pistolFlashGroup) {
          this.pistolFlashGroup.visible = false;
          (this.pistolFlashCore.material as THREE.MeshBasicMaterial).opacity = 0;
          this.pistolLight.intensity = 0;
        }
        if (this.sniperFlashGroup) {
          this.sniperFlashGroup.visible = false;
          (this.sniperFlashCore.material as THREE.MeshBasicMaterial).opacity = 0;
          this.sniperLight.intensity = 0;
        }
      }
    }

    // Recoil recovery
    this.recoilZ = THREE.MathUtils.lerp(this.recoilZ, 0, Math.min(0.4, dt * 10));
    this.recoilRotX = THREE.MathUtils.lerp(this.recoilRotX, 0, Math.min(0.5, dt * 12));

    // Procedural weapon bobbing & sway
    let bobX = 0;
    let bobY = 0;
    const swayDampen = 1.0 - this.currentAdsProgress * 0.75; // ADS reduces viewmodel sway significantly

    if (isMoving && !this.isReloading && !this.isSlashing) {
      const bobFreq = isSprinting ? 14 : 9;
      const bobAmp = (isSprinting ? 0.024 : 0.012) * swayDampen;
      bobX = Math.sin(time * bobFreq * 0.5) * bobAmp * 0.5;
      bobY = Math.abs(Math.sin(time * bobFreq)) * bobAmp;
    } else {
      bobX = Math.sin(time * 2.0) * 0.0025 * swayDampen;
      bobY = Math.cos(time * 2.0) * 0.0025 * swayDampen;
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
        const dip = Math.sin(this.reloadProgress * Math.PI);
        reloadOffsetY = -dip * 0.20;
        reloadRotZ = dip * 0.40;
      }
    }

    // Knife melee slash animation
    let slashOffsetX = 0;
    let slashOffsetY = 0;
    let slashRotZ = 0;
    let slashRotX = 0;
    if (this.isSlashing) {
      this.slashProgress += dt / 0.28;
      if (this.slashProgress >= 1.0) {
        this.isSlashing = false;
        this.slashProgress = 0;
      } else {
        const sweep = Math.sin(this.slashProgress * Math.PI);
        slashOffsetX = -sweep * 0.26;
        slashOffsetY = sweep * 0.09;
        slashRotZ = -sweep * 1.3;
        slashRotX = sweep * 0.4;
      }
    }

    // Blend resting pose with ADS pose
    const transform = this.restingTransforms[this.currentWeapon];
    const targetPos = new THREE.Vector3().lerpVectors(transform.pos, transform.adsPos, this.currentAdsProgress);

    this.activeContainer.position.set(
      targetPos.x + bobX + slashOffsetX,
      targetPos.y + bobY + reloadOffsetY + slashOffsetY,
      targetPos.z + this.recoilZ
    );

    this.activeContainer.rotation.set(
      transform.rot.x + this.recoilRotX + slashRotX,
      transform.rot.y,
      transform.rot.z + reloadRotZ + slashRotZ
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
