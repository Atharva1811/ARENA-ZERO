import * as THREE from 'three';
import { ARENA_BOXES, ARENA_CYLINDERS, ARENA_RADIUS } from '../../../shared/arenaCollision';

export class ArenaMap {
  public group: THREE.Group;
  private coreMesh!: THREE.Mesh;
  private coreLight!: THREE.PointLight;

  constructor() {
    this.group = new THREE.Group();
    this.buildArena();
  }

  private buildArena() {
    // Shared materials
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x181f2a,
      roughness: 0.8,
      metalness: 0.2,
      flatShading: true,
    });

    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x222a38,
      roughness: 0.7,
      metalness: 0.5,
      flatShading: true,
    });

    const coverMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.6,
      metalness: 0.3,
      flatShading: true,
    });

    const obeliskMat = new THREE.MeshStandardMaterial({
      color: 0x1a2332,
      roughness: 0.5,
      metalness: 0.7,
      flatShading: true,
    });

    const neonCyanMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
    });

    const neonOrangeMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
    });

    // 1. Arena Main Floor (Circular combat ground)
    const floorGeo = new THREE.CylinderGeometry(ARENA_RADIUS + 2, ARENA_RADIUS + 3, 1.0, 36);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Decorative floor grid rings
    for (let r = 8; r <= 24; r += 8) {
      const ringGeo = new THREE.RingGeometry(r - 0.08, r + 0.08, 48);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, neonCyanMat);
      ring.position.y = 0.01;
      this.group.add(ring);
    }

    // 2. Central Raised Platform (Radius 6m, Height 0.6m)
    const platformGeo = new THREE.CylinderGeometry(6.2, 6.8, 0.6, 24);
    const platform = new THREE.Mesh(platformGeo, darkMetalMat);
    platform.position.y = 0.3;
    platform.receiveShadow = true;
    platform.castShadow = true;
    this.group.add(platform);

    // 3. Central Reactor Core (matching 'reactor-core' cylinder)
    const coreGeo = new THREE.CylinderGeometry(1.5, 1.5, 5.0, 16);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x0088cc,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.8,
      transparent: true,
      opacity: 0.9,
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.coreMesh.position.set(0, 2.5, 0);
    this.coreMesh.castShadow = true;
    this.group.add(this.coreMesh);

    this.coreLight = new THREE.PointLight(0x00e5ff, 2.5, 18);
    this.coreLight.position.set(0, 3.5, 0);
    this.group.add(this.coreLight);

    // Core base rings
    const coreBaseGeo = new THREE.CylinderGeometry(1.8, 2.0, 0.4, 16);
    const coreBase = new THREE.Mesh(coreBaseGeo, darkMetalMat);
    coreBase.position.y = 0.7;
    coreBase.castShadow = true;
    this.group.add(coreBase);

    // 4. Build all defined Box Colliders in ARENA_BOXES
    for (const box of ARENA_BOXES) {
      const width = box.maxX - box.minX;
      const height = box.maxY - box.minY;
      const depth = box.maxZ - box.minZ;
      const posX = (box.minX + box.maxX) / 2;
      const posY = (box.minY + box.maxY) / 2;
      const posZ = (box.minZ + box.maxZ) / 2;

      const geo = new THREE.BoxGeometry(width, height, depth);
      const isTower = box.id.startsWith('obelisk');
      const mesh = new THREE.Mesh(geo, isTower ? obeliskMat : coverMat);
      mesh.position.set(posX, posY, posZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // Add glowing accent stripe to towers
      if (isTower) {
        const stripeGeo = new THREE.BoxGeometry(width * 1.02, 0.4, depth * 1.02);
        const stripe = new THREE.Mesh(stripeGeo, neonCyanMat);
        stripe.position.set(posX, posY + 2.5, posZ);
        this.group.add(stripe);

        const towerLight = new THREE.PointLight(0x00e5ff, 1.2, 12);
        towerLight.position.set(posX, posY + 3.0, posZ);
        this.group.add(towerLight);
      } else {
        // Cover block trim
        const trimGeo = new THREE.BoxGeometry(width * 1.01, 0.1, depth * 1.01);
        const trim = new THREE.Mesh(trimGeo, neonOrangeMat);
        trim.position.set(posX, box.maxY, posZ);
        this.group.add(trim);
      }
    }

    // 5. Build defined Cylinder Colliders in ARENA_CYLINDERS
    for (const cyl of ARENA_CYLINDERS) {
      if (cyl.id === 'reactor-core') continue; // already built above
      const height = cyl.maxY - cyl.minY;
      const geo = new THREE.CylinderGeometry(cyl.radius, cyl.radius, height, 12);
      const mesh = new THREE.Mesh(geo, darkMetalMat);
      mesh.position.set(cyl.x, cyl.minY + height / 2, cyl.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // Glowing cap ring
      const capGeo = new THREE.TorusGeometry(cyl.radius * 0.9, 0.08, 6, 12);
      capGeo.rotateX(Math.PI / 2);
      const cap = new THREE.Mesh(capGeo, neonOrangeMat);
      cap.position.set(cyl.x, cyl.maxY, cyl.z);
      this.group.add(cap);
    }

    // 6. Perimeter Security Energy Barrier
    const pylonCount = 20;
    const pylonRadius = ARENA_RADIUS;
    const pylonGeo = new THREE.BoxGeometry(0.8, 3.2, 0.8);
    const barrierMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < pylonCount; i++) {
      const ang = (i / pylonCount) * Math.PI * 2;
      const px = Math.cos(ang) * pylonRadius;
      const pz = Math.sin(ang) * pylonRadius;

      const pylon = new THREE.Mesh(pylonGeo, darkMetalMat);
      pylon.position.set(px, 1.6, pz);
      pylon.castShadow = true;
      this.group.add(pylon);

      // Wall segment connecting to next pylon
      const nextAng = ((i + 1) / pylonCount) * Math.PI * 2;
      const nextX = Math.cos(nextAng) * pylonRadius;
      const nextZ = Math.sin(nextAng) * pylonRadius;

      const segLen = Math.hypot(nextX - px, nextZ - pz);
      const segGeo = new THREE.PlaneGeometry(segLen, 3.0);
      const segMesh = new THREE.Mesh(segGeo, barrierMat);
      segMesh.position.set((px + nextX) / 2, 1.5, (pz + nextZ) / 2);
      segMesh.rotation.y = -Math.atan2(nextZ - pz, nextX - px);
      this.group.add(segMesh);
    }
  }

  public update(time: number) {
    if (this.coreMesh) {
      this.coreMesh.rotation.y = time * 0.8;
      const pulse = Math.sin(time * 3.5) * 0.3 + 1.8;
      this.coreLight.intensity = pulse;
    }
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
