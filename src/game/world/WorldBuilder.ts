import * as THREE from 'three';
import type { CollectibleItem, ShrineState } from '../types';
import type { TerrainData } from './Terrain';

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

export interface WorldObjects {
  group: THREE.Group;
  collectibles: CollectibleItem[];
  shrine: ShrineState;
  obstacles: Obstacle[];
  shrineMesh: THREE.Group;
  shrineBeam: THREE.Mesh;
  shrineOrb: THREE.Mesh;
  shrinePedestals: THREE.Mesh[];
  update: (time: number, delta: number) => void;
  unlockShrineVisuals: () => void;
  completeShrineVisuals: () => void;
  removeCollectibleMesh: (id: string) => void;
}

export function buildWorld(terrain: TerrainData): WorldObjects {
  const worldGroup = new THREE.Group();
  const obstacles: Obstacle[] = [];

  // Shared low-poly materials for performance
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x7a5330,
    roughness: 0.9,
    flatShading: true,
  });

  const leafMat1 = new THREE.MeshStandardMaterial({
    color: 0x3d8c2c,
    roughness: 0.8,
    flatShading: true,
  });

  const leafMat2 = new THREE.MeshStandardMaterial({
    color: 0x54ab3c,
    roughness: 0.8,
    flatShading: true,
  });

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x737976,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true,
  });

  const darkRockMat = new THREE.MeshStandardMaterial({
    color: 0x555c59,
    roughness: 0.95,
    flatShading: true,
  });

  const stonePlinthMat = new THREE.MeshStandardMaterial({
    color: 0x8a928e,
    roughness: 0.8,
    flatShading: true,
  });

  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xe6b843,
    roughness: 0.3,
    metalness: 0.8,
    flatShading: true,
  });

  // --- PALM TREES GENERATOR ---
  function createPalmTree(x: number, z: number, scale = 1.0, curveAngle = 0.2): THREE.Group {
    const tree = new THREE.Group();
    const h = terrain.getHeight(x, z);
    tree.position.set(x, h, z);

    // Segmented curved trunk
    const segments = 5;
    const segHeight = 0.8 * scale;
    let currY = 0;
    let currX = 0;
    const curveDir = (x * 3.7 + z * 1.3) % (Math.PI * 2);

    for (let i = 0; i < segments; i++) {
      const radiusTop = (0.24 - i * 0.02) * scale;
      const radiusBottom = (0.28 - i * 0.02) * scale;
      const segGeo = new THREE.CylinderGeometry(radiusTop, radiusBottom, segHeight, 6);
      const segMesh = new THREE.Mesh(segGeo, trunkMat);
      segMesh.castShadow = true;
      segMesh.receiveShadow = true;

      segMesh.position.set(currX, currY + segHeight / 2, 0);
      segMesh.rotation.z = Math.sin(curveDir) * curveAngle * (i / segments);
      tree.add(segMesh);

      currY += segHeight * 0.95;
      currX += Math.sin(curveDir) * 0.12 * scale;
    }

    // Foliage crown at top
    const crown = new THREE.Group();
    crown.position.set(currX, currY, 0);

    const leafCount = 7;
    for (let i = 0; i < leafCount; i++) {
      const angle = (i / leafCount) * Math.PI * 2;
      const leafGeo = new THREE.ConeGeometry(0.55 * scale, 2.4 * scale, 4);
      leafGeo.rotateX(Math.PI / 2.3);
      const leafMesh = new THREE.Mesh(leafGeo, i % 2 === 0 ? leafMat1 : leafMat2);
      leafMesh.castShadow = true;
      leafMesh.position.set(0, 0, 0);
      leafMesh.rotation.y = angle;
      leafMesh.rotation.z = 0.45;
      crown.add(leafMesh);
    }

    // Stylized coconuts
    const coconutGeo = new THREE.DodecahedronGeometry(0.18 * scale);
    const coconutMat = new THREE.MeshStandardMaterial({ color: 0x4a3219, roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(coconutGeo, coconutMat);
      const ang = (i / 3) * Math.PI * 2;
      c.position.set(Math.cos(ang) * 0.25 * scale, -0.15 * scale, Math.sin(ang) * 0.25 * scale);
      crown.add(c);
    }

    tree.add(crown);
    worldGroup.add(tree);

    // Add obstacle
    obstacles.push({ x, z, radius: 0.6 * scale });
    return tree;
  }

  // --- ROCKS GENERATOR ---
  function createRock(x: number, z: number, scale = 1.0, isDark = false): THREE.Mesh {
    const h = terrain.getHeight(x, z);
    const geo = new THREE.DodecahedronGeometry(scale, 1);

    // Slight vertex distortion for craggy appearance
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const deform = 1 + (Math.sin(vx * 3 + vz * 2) * 0.18);
      pos.setXYZ(i, vx * deform, vy * deform * 0.75, vz * deform);
    }
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, isDark ? darkRockMat : rockMat);
    mesh.position.set(x, h + scale * 0.35, z);
    mesh.rotation.set(
      Math.sin(x) * 0.5,
      Math.cos(z) * Math.PI,
      Math.sin(z) * 0.4
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    worldGroup.add(mesh);
    obstacles.push({ x, z, radius: scale * 0.85 });
    return mesh;
  }

  // --- BUSHES & FLORA ---
  const flowerColors = [0xff3366, 0xffbb00, 0x00d4ff, 0xff77aa];
  function createBush(x: number, z: number, scale = 0.8) {
    const h = terrain.getHeight(x, z);
    const bush = new THREE.Group();
    bush.position.set(x, h, z);

    const bushGeo = new THREE.DodecahedronGeometry(scale, 1);
    const bMesh = new THREE.Mesh(bushGeo, leafMat1);
    bMesh.scale.set(1.1, 0.7, 1.1);
    bMesh.castShadow = true;
    bush.add(bMesh);

    // Small flower accents
    const flColor = flowerColors[Math.floor(Math.abs(x * 13 + z * 7)) % flowerColors.length];
    const flowerMat = new THREE.MeshStandardMaterial({ color: flColor, roughness: 0.4 });
    const flowerGeo = new THREE.OctahedronGeometry(0.12 * scale);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(flowerGeo, flowerMat);
      const fa = (i / 4) * Math.PI * 2;
      f.position.set(Math.cos(fa) * 0.6 * scale, 0.4 * scale, Math.sin(fa) * 0.6 * scale);
      bush.add(f);
    }

    worldGroup.add(bush);
  }

  // Place trees in clusters (avoiding shrine center, crystal spots, and player start at (0, 16))
  const treePositions = [
    // South-East Palm Grove (dense)
    { x: 14, z: 12, s: 1.2 }, { x: 19, z: 11, s: 1.1 }, { x: 22, z: 15, s: 1.3 },
    { x: 15, z: 20, s: 1.0 }, { x: 24, z: 21, s: 1.2 }, { x: 21, z: 25, s: 1.1 },
    { x: 12, z: 24, s: 0.9 }, { x: 17, z: 28, s: 1.0 },
    // South-West coast
    { x: -14, z: 18, s: 1.1 }, { x: -18, z: 22, s: 1.3 }, { x: -22, z: 15, s: 1.0 },
    { x: -10, z: 25, s: 0.9 }, { x: -25, z: 20, s: 1.2 },
    // North-West forest ridge
    { x: -16, z: -14, s: 1.1 }, { x: -22, z: -18, s: 1.2 }, { x: -14, z: -22, s: 1.0 },
    { x: -26, z: -12, s: 1.3 }, { x: -28, z: -20, s: 1.1 },
    // North hill fringe
    { x: 2, z: -26, s: 1.2 }, { x: 8, z: -24, s: 1.0 }, { x: -6, z: -28, s: 1.1 },
    { x: 12, z: -28, s: 1.2 }, { x: 25, z: -12, s: 1.1 }, { x: 26, z: -22, s: 1.0 },
    // Near beach fringes
    { x: -6, z: 32, s: 1.1 }, { x: 6, z: 32, s: 1.2 }, { x: -12, z: 30, s: 1.0 },
    { x: 14, z: 32, s: 0.9 },
  ];

  for (const t of treePositions) {
    if (terrain.getHeight(t.x, t.z) > 0.3) {
      createPalmTree(t.x, t.z, t.s, 0.25);
    }
  }

  // Place decorative rocks and sea stacks
  const rockPositions = [
    // Ocean/beach sea stacks (framing the island visually)
    { x: -32, z: 4, s: 2.8, d: true },
    { x: -34, z: -8, s: 3.2, d: true },
    { x: 30, z: 28, s: 2.5, d: true },
    { x: 34, z: -18, s: 3.0, d: true },
    { x: -18, z: -32, s: 2.7, d: true },
    { x: 22, z: -32, s: 2.4, d: true },
    // Inland landmark boulders
    { x: -12, z: -6, s: 1.6, d: false },
    { x: -8, z: -15, s: 1.8, d: false },
    { x: 8, z: -12, s: 1.5, d: false },
    { x: 12, z: -8, s: 1.7, d: false },
    { x: -15, z: 8, s: 1.4, d: false },
    { x: 10, z: 8, s: 1.3, d: false },
    { x: 20, z: -10, s: 1.9, d: false },
    { x: 24, z: -26, s: 2.1, d: false },
  ];

  for (const r of rockPositions) {
    createRock(r.x, r.z, r.s, r.d);
  }

  // Place lush bushes and flowers
  const bushCoords = [
    { x: 4, z: 18 }, { x: -4, z: 18 }, { x: 8, z: 16 }, { x: -8, z: 16 },
    { x: 12, z: 18 }, { x: 16, z: 14 }, { x: 18, z: 18 }, { x: 20, z: 14 },
    { x: -16, z: -10 }, { x: -18, z: -12 }, { x: -20, z: -4 },
    { x: 14, z: -14 }, { x: 16, z: -22 }, { x: 20, z: -16 },
    { x: 2, z: -16 }, { x: -2, z: -16 }, { x: -10, z: 20 }, { x: 10, z: 22 }
  ];

  for (const b of bushCoords) {
    createBush(b.x, b.z, 0.7 + Math.random() * 0.4);
  }

  // --- THE SOLIS SHRINE (Centerpiece at 0, 0) ---
  const shrineMesh = new THREE.Group();
  const shrineY = terrain.getHeight(0, 0);
  shrineMesh.position.set(0, shrineY, 0);

  // 1. Tiered Stone Base & Platform Floor
  const baseStepGeo = new THREE.CylinderGeometry(6.4, 7.0, 0.45, 24);
  const baseStep = new THREE.Mesh(baseStepGeo, stonePlinthMat);
  baseStep.position.y = 0.22;
  baseStep.receiveShadow = true;
  baseStep.castShadow = true;
  shrineMesh.add(baseStep);

  const upperStepGeo = new THREE.CylinderGeometry(5.6, 5.9, 0.45, 24);
  const upperStep = new THREE.Mesh(upperStepGeo, stonePlinthMat);
  upperStep.position.y = 0.65;
  upperStep.receiveShadow = true;
  upperStep.castShadow = true;
  shrineMesh.add(upperStep);

  // 2. Entrance Staircase (South side, +Z direction toward start)
  const stairWidth = 3.8;
  const stairSteps = 3;
  for (let i = 0; i < stairSteps; i++) {
    const sDepth = 0.65;
    const sHeight = 0.22;
    const sGeo = new THREE.BoxGeometry(stairWidth, sHeight, sDepth);
    const sMesh = new THREE.Mesh(sGeo, stonePlinthMat);
    sMesh.position.set(0, 0.15 + i * 0.18, 5.0 + (stairSteps - 1 - i) * 0.55);
    sMesh.receiveShadow = true;
    sMesh.castShadow = true;
    shrineMesh.add(sMesh);
  }

  // Entrance Balustrades / Cheek Walls
  const balustradeGeo = new THREE.BoxGeometry(0.5, 0.7, 1.8);
  const leftBalustrade = new THREE.Mesh(balustradeGeo, stonePlinthMat);
  leftBalustrade.position.set(-2.1, 0.45, 5.5);
  leftBalustrade.castShadow = true;
  shrineMesh.add(leftBalustrade);
  obstacles.push({ x: -2.1, z: 5.5, radius: 0.5 });

  const rightBalustrade = new THREE.Mesh(balustradeGeo, stonePlinthMat);
  rightBalustrade.position.set(2.1, 0.45, 5.5);
  rightBalustrade.castShadow = true;
  shrineMesh.add(rightBalustrade);
  obstacles.push({ x: 2.1, z: 5.5, radius: 0.5 });

  // 3. Grand Entrance Gateway Pillars & Architrave (Doorway)
  const entrancePillarGeo = new THREE.CylinderGeometry(0.5, 0.6, 4.4, 8);
  const pillarCapGeo = new THREE.BoxGeometry(1.2, 0.4, 1.2);

  // Left Gateway Pillar
  const leftEntPill = new THREE.Mesh(entrancePillarGeo, stonePlinthMat);
  leftEntPill.position.set(-2.3, 2.65, 4.9);
  leftEntPill.castShadow = true;
  shrineMesh.add(leftEntPill);

  const leftEntCap = new THREE.Mesh(pillarCapGeo, goldMat);
  leftEntCap.position.set(-2.3, 4.95, 4.9);
  leftEntCap.castShadow = true;
  shrineMesh.add(leftEntCap);
  obstacles.push({ x: -2.3, z: 4.9, radius: 0.65 });

  // Right Gateway Pillar
  const rightEntPill = new THREE.Mesh(entrancePillarGeo, stonePlinthMat);
  rightEntPill.position.set(2.3, 2.65, 4.9);
  rightEntPill.castShadow = true;
  shrineMesh.add(rightEntPill);

  const rightEntCap = new THREE.Mesh(pillarCapGeo, goldMat);
  rightEntCap.position.set(2.3, 4.95, 4.9);
  rightEntCap.castShadow = true;
  shrineMesh.add(rightEntCap);
  obstacles.push({ x: 2.3, z: 4.9, radius: 0.65 });

  // Gateway Architrave / Lintel Beam across doorway
  const lintelGeo = new THREE.BoxGeometry(5.4, 0.5, 0.9);
  const lintel = new THREE.Mesh(lintelGeo, goldMat);
  lintel.position.set(0, 5.25, 4.9);
  lintel.castShadow = true;
  shrineMesh.add(lintel);

  // 4. Perimeter Stone Walls & Colonnade enclosing West, North, and East sides
  // Covers angles from ~125 deg to 415 deg (leaving ~65 deg to 115 deg open as entrance)
  const wallArcSegments = 12;
  const startAngle = (125 * Math.PI) / 180;
  const endAngle = (415 * Math.PI) / 180;
  const wallRadius = 5.6;

  for (let i = 0; i <= wallArcSegments; i++) {
    const angle = startAngle + (i / wallArcSegments) * (endAngle - startAngle);
    const wx = Math.cos(angle) * wallRadius;
    const wz = Math.sin(angle) * wallRadius;

    // Visual Wall Segment Mesh
    const wallSegGeo = new THREE.BoxGeometry(1.6, 2.2, 0.6);
    const wallSeg = new THREE.Mesh(wallSegGeo, stonePlinthMat);
    wallSeg.position.set(wx, 1.75, wz);
    wallSeg.rotation.y = -angle + Math.PI / 2;
    wallSeg.castShadow = true;
    wallSeg.receiveShadow = true;
    shrineMesh.add(wallSeg);

    // Decorative wall cap
    const capGeo = new THREE.BoxGeometry(1.7, 0.25, 0.7);
    const cap = new THREE.Mesh(capGeo, darkRockMat);
    cap.position.set(wx, 2.9, wz);
    cap.rotation.y = -angle + Math.PI / 2;
    shrineMesh.add(cap);

    // Solid Wall Collider along perimeter
    obstacles.push({ x: wx, z: wz, radius: 0.75 });
  }

  // 5. 4 Grand Inner Sanctuary Pillars
  const pillarGeo = new THREE.CylinderGeometry(0.45, 0.55, 4.2, 8);
  const innerPillarAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  const innerPillarDist = 3.6;

  innerPillarAngles.forEach((ang) => {
    const px = Math.cos(ang) * innerPillarDist;
    const pz = Math.sin(ang) * innerPillarDist;

    const pMesh = new THREE.Mesh(pillarGeo, stonePlinthMat);
    pMesh.position.set(px, 2.6, pz);
    pMesh.castShadow = true;
    pMesh.receiveShadow = true;
    shrineMesh.add(pMesh);

    const capMesh = new THREE.Mesh(pillarCapGeo, goldMat);
    capMesh.position.set(px, 4.8, pz);
    capMesh.castShadow = true;
    shrineMesh.add(capMesh);

    // Pillar base plinth
    const basePill = new THREE.Mesh(pillarCapGeo, stonePlinthMat);
    basePill.position.set(px, 0.9, pz);
    shrineMesh.add(basePill);

    // Inner Pillar Collision
    obstacles.push({ x: px, z: pz, radius: 0.65 });
  });

  // 6. Central Altar Stone
  const altarGeo = new THREE.CylinderGeometry(1.4, 1.6, 1.1, 8);
  const altar = new THREE.Mesh(altarGeo, stonePlinthMat);
  altar.position.y = 1.3;
  altar.receiveShadow = true;
  altar.castShadow = true;
  shrineMesh.add(altar);

  // Altar solid collider (player can stand at ~1.9m from center to interact)
  obstacles.push({ x: 0, z: 0, radius: 1.45 });

  // Center Glowing Orb
  const orbGeo = new THREE.DodecahedronGeometry(0.7, 2);
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0x88bbff,
    emissive: 0x224488,
    emissiveIntensity: 0.4,
    roughness: 0.2,
    metalness: 0.8,
  });
  const shrineOrb = new THREE.Mesh(orbGeo, orbMat);
  shrineOrb.position.set(0, 2.5, 0);
  shrineMesh.add(shrineOrb);

  // 7. 3 Pedestals for the Elemental Crystals around the Altar
  const pedestalAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  const pedestalDist = 2.4;
  const pedestalColors = [0x00e5ff, 0xffaa00, 0x00ff88]; // Water, Sun, Forest
  const shrinePedestals: THREE.Mesh[] = [];

  pedestalAngles.forEach((ang, idx) => {
    const px = Math.cos(ang) * pedestalDist;
    const pz = Math.sin(ang) * pedestalDist;

    const pedGeo = new THREE.CylinderGeometry(0.35, 0.45, 1.1, 6);
    const pedMat = new THREE.MeshStandardMaterial({
      color: 0x6e7572,
      roughness: 0.7,
      flatShading: true,
    });
    const ped = new THREE.Mesh(pedGeo, pedMat);
    ped.position.set(px, 1.2, pz);
    ped.castShadow = true;
    shrineMesh.add(ped);

    // Gem socket ring on top
    const ringGeo = new THREE.TorusGeometry(0.28, 0.08, 6, 12);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      emissive: pedestalColors[idx],
      emissiveIntensity: 0.1, // Dim until collected
      roughness: 0.3,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(px, 1.8, pz);
    shrineMesh.add(ring);
    shrinePedestals.push(ring);

    // Solid pedestal collider
    obstacles.push({ x: px, z: pz, radius: 0.45 });
  });

  // Vertical Holy Light Beam (initially hidden/invisible)
  const beamGeo = new THREE.CylinderGeometry(0.6, 2.2, 45, 16, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x88eeff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shrineBeam = new THREE.Mesh(beamGeo, beamMat);
  shrineBeam.position.set(0, 24, 0);
  shrineMesh.add(shrineBeam);

  // Shrine point light for glowing effect
  const shrineLight = new THREE.PointLight(0xffeedd, 0, 15);
  shrineLight.position.set(0, 3.2, 0);
  shrineMesh.add(shrineLight);

  worldGroup.add(shrineMesh);

  const shrineState: ShrineState = {
    position: new THREE.Vector3(0, shrineY, 0),
    unlocked: false,
    completed: false,
    radius: 4.5, // Interaction trigger radius
  };

  // --- THE 3 ELEMENTAL CRYSTALS ---
  const crystalDefs: Array<{
    id: string;
    name: string;
    element: 'water' | 'sun' | 'forest';
    color: string;
    glowHex: number;
    coords: { x: number; z: number };
    hint: string;
  }> = [
    {
      id: 'crystal-water',
      name: 'Azure Water Crystal',
      element: 'water',
      color: '#00e5ff',
      glowHex: 0x00e5ff,
      coords: { x: -22, z: -6 },
      hint: 'Resting near the secluded tidal beach cove to the West.',
    },
    {
      id: 'crystal-sun',
      name: 'Amber Sun Crystal',
      element: 'sun',
      color: '#ffaa00',
      glowHex: 0xffaa00,
      coords: { x: 18, z: -18 },
      hint: 'Shining atop the ancient stone ridge overlook to the North-East.',
    },
    {
      id: 'crystal-forest',
      name: 'Emerald Forest Crystal',
      element: 'forest',
      color: '#00ff88',
      glowHex: 0x00ff88,
      coords: { x: 18, z: 16 },
      hint: 'Nestled deep within the lush palm sanctuary to the South-East.',
    },
  ];

  const collectibles: CollectibleItem[] = [];

  crystalDefs.forEach((cDef) => {
    const cy = terrain.getHeight(cDef.coords.x, cDef.coords.z) + 1.2;
    const crystalGroup = new THREE.Group();
    crystalGroup.position.set(cDef.coords.x, cy, cDef.coords.z);

    // Multi-faceted crystal shape (elongated double pyramid / bipyramid)
    const gemGeo = new THREE.OctahedronGeometry(0.7, 0);
    gemGeo.scale(0.8, 1.4, 0.8);

    const gemMat = new THREE.MeshStandardMaterial({
      color: cDef.glowHex,
      emissive: cDef.glowHex,
      emissiveIntensity: 0.8,
      roughness: 0.15,
      metalness: 0.2,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });

    const gemMesh = new THREE.Mesh(gemGeo, gemMat);
    gemMesh.castShadow = true;
    crystalGroup.add(gemMesh);

    // Outer rotating orbital ring
    const ringGeo = new THREE.TorusGeometry(1.1, 0.04, 6, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: cDef.glowHex,
      transparent: true,
      opacity: 0.7,
      wireframe: true,
    });
    const orbitRing = new THREE.Mesh(ringGeo, ringMat);
    crystalGroup.add(orbitRing);

    // Dedicated Point Light casting soft glow
    const pLight = new THREE.PointLight(cDef.glowHex, 2.2, 8);
    pLight.position.set(0, 0, 0);
    crystalGroup.add(pLight);

    // Mini pedestal stone base underneath
    const baseGeo = new THREE.CylinderGeometry(0.6, 0.8, 0.4, 6);
    const baseMesh = new THREE.Mesh(baseGeo, stonePlinthMat);
    baseMesh.position.set(0, -0.9, 0);
    baseMesh.receiveShadow = true;
    crystalGroup.add(baseMesh);

    worldGroup.add(crystalGroup);

    collectibles.push({
      id: cDef.id,
      name: cDef.name,
      element: cDef.element,
      color: cDef.color,
      glowColor: cDef.glowHex,
      position: new THREE.Vector3(cDef.coords.x, cy, cDef.coords.z),
      collected: false,
      hint: cDef.hint,
      mesh: crystalGroup,
      light: pLight,
    });
  });

  // Animation & Visual Update methods
  let shrineUnlockedAnim = false;
  let shrineCompletedAnim = false;

  const unlockShrineVisuals = () => {
    shrineUnlockedAnim = true;
    shrineState.unlocked = true;

    // Light up pedestals
    shrinePedestals.forEach((ped, idx) => {
      const mat = ped.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(pedestalColors[idx]);
      mat.emissiveIntensity = 1.0;
    });

    // Beam of light begins glowing
    (shrineBeam.material as THREE.MeshBasicMaterial).opacity = 0.65;
    (shrineOrb.material as THREE.MeshStandardMaterial).emissive.setHex(0xaae8ff);
    (shrineOrb.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2;
    shrineLight.intensity = 3.5;
  };

  const completeShrineVisuals = () => {
    shrineCompletedAnim = true;
    shrineState.completed = true;
    (shrineBeam.material as THREE.MeshBasicMaterial).opacity = 0.95;
    shrineLight.intensity = 6.0;
  };

  const removeCollectibleMesh = (id: string) => {
    const col = collectibles.find((c) => c.id === id);
    if (col && col.mesh) {
      worldGroup.remove(col.mesh);
      col.mesh = undefined;
    }
  };

  const update = (time: number, delta: number) => {
    // Animate active crystals (hover & rotate)
    collectibles.forEach((c, idx) => {
      if (!c.collected && c.mesh) {
        // Sinusoidal bobbing
        const baseHeight = terrain.getHeight(c.position.x, c.position.z) + 1.2;
        c.mesh.position.y = baseHeight + Math.sin(time * 2.5 + idx * 1.5) * 0.22;
        // Rotation
        c.mesh.rotation.y += delta * 1.6;
        // Animate inner gem and outer ring
        const gem = c.mesh.children[0];
        if (gem) gem.rotation.x = Math.sin(time * 1.8) * 0.15;
        const ring = c.mesh.children[1];
        if (ring) {
          ring.rotation.x = time * 1.2;
          ring.rotation.z = time * 0.8;
        }
      }
    });

    // Animate Shrine visuals
    if (shrineUnlockedAnim) {
      // Swirl the holy beam
      shrineBeam.rotation.y += delta * 0.6;
      const pulse = Math.sin(time * 4) * 0.15 + 0.8;
      (shrineBeam.material as THREE.MeshBasicMaterial).opacity = shrineCompletedAnim ? 0.9 : 0.6 * pulse;
      shrineOrb.position.y = 2.5 + Math.sin(time * 2.8) * 0.25;
      shrineOrb.rotation.y += delta * 2.0;
    } else {
      // Gentle idle glow
      shrineOrb.rotation.y += delta * 0.5;
    }
  };

  return {
    group: worldGroup,
    collectibles,
    shrine: shrineState,
    obstacles,
    shrineMesh,
    shrineBeam,
    shrineOrb,
    shrinePedestals,
    update,
    unlockShrineVisuals,
    completeShrineVisuals,
    removeCollectibleMesh,
  };
}
