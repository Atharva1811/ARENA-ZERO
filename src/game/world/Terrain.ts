import * as THREE from 'three';

export interface TerrainData {
  mesh: THREE.Mesh;
  getHeight: (x: number, z: number) => number;
  getSurfaceType: (x: number, z: number) => 'sand' | 'grass' | 'stone';
  isWalkable: (x: number, z: number) => boolean;
  radius: number;
}

export function createTerrain(): TerrainData {
  const islandRadius = 46;
  const segments = 90; // Balanced detail for crisp low-poly facets
  const size = 110;

  // Height function based on analytical coordinates
  const getHeight = (x: number, z: number): number => {
    const dist = Math.sqrt(x * x + z * z);
    if (dist > islandRadius + 6) {
      return -4.0; // Deep water
    }

    // Base island profile: smooth dome that slopes gently into the ocean
    const normalizedDist = Math.min(1.0, dist / islandRadius);
    // Smooth cosine taper to water
    const falloff = 0.5 * (1 + Math.cos(normalizedDist * Math.PI));
    let baseHeight = falloff * 4.2;

    // Center Shrine Sanctuary mound (around 0,0)
    const shrineDist = Math.sqrt(x * x + z * z);
    if (shrineDist < 14) {
      const shrineMound = Math.max(0, 1 - shrineDist / 14);
      baseHeight += shrineMound * 1.5;
    }

    // North-East Overlook Hill (Sun Crystal location: ~18, -18)
    const neDist = Math.hypot(x - 18, z - (-18));
    if (neDist < 16) {
      const neMound = Math.max(0, 1 - neDist / 16);
      baseHeight += neMound * 3.8;
    }

    // West Beach Cove depression (Water Crystal location: ~ -22, -6)
    const coveDist = Math.hypot(x - (-22), z - (-6));
    if (coveDist < 15) {
      const coveDip = Math.max(0, 1 - coveDist / 15);
      baseHeight -= coveDip * 1.2;
    }

    // South-East Palm Plateau (Forest Crystal location: ~18, 16)
    const seDist = Math.hypot(x - 18, z - 16);
    if (seDist < 14) {
      const seMound = Math.max(0, 1 - seDist / 14);
      baseHeight += seMound * 1.4;
    }

    // Subtle low-poly undulation
    const ripples =
      Math.sin(x * 0.18) * Math.cos(z * 0.18) * 0.6 +
      Math.sin(x * 0.35 + 1.2) * Math.cos(z * 0.28) * 0.3;

    let height = baseHeight + ripples * falloff;

    // Shoreline smoothing: ensure heights near shoreline (dist > 38) taper gently into water
    if (dist > 36) {
      const shoreTaper = Math.max(0, 1 - (dist - 36) / 10);
      height = height * shoreTaper - (1 - shoreTaper) * 1.5;
    }

    return height;
  };

  const getSurfaceType = (x: number, z: number): 'sand' | 'grass' | 'stone' => {
    const h = getHeight(x, z);
    if (h < 1.1) return 'sand';
    if (h > 5.5) return 'stone';
    return 'grass';
  };

  const isWalkable = (x: number, z: number): boolean => {
    const dist = Math.hypot(x, z);
    const h = getHeight(x, z);
    // Player shouldn't wander into water deeper than knee level (h < -0.3) or beyond island radius
    return dist <= islandRadius - 2 && h >= -0.2;
  };

  // Generate Plane geometry with vertex noise
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2); // Lay horizontal on XZ plane

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];

  // Color palette (stylized tropical palette)
  const colorDeepSea = new THREE.Color(0x1a7282);
  const colorWetSand = new THREE.Color(0xcbb37b);
  const colorSand = new THREE.Color(0xecd39a);
  const colorLowGrass = new THREE.Color(0x9fc869);
  const colorLushGrass = new THREE.Color(0x56a644);
  const colorHighGrass = new THREE.Color(0x408d35);
  const colorRock = new THREE.Color(0x868a85);
  const colorHighRock = new THREE.Color(0x9ca39b);

  const vertexColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);

    // Add tiny deterministic jitter for low-poly facet breakup
    const jitter = (Math.sin(vx * 1.5 + vz * 2.3) * 0.15);
    const vy = getHeight(vx, vz) + jitter;
    posAttr.setY(i, vy);

    // Compute color based on elevation and slope
    if (vy < 0.1) {
      vertexColor.copy(colorDeepSea);
    } else if (vy < 0.7) {
      const t = vy / 0.7;
      vertexColor.copy(colorWetSand).lerp(colorSand, t);
    } else if (vy < 1.4) {
      const t = (vy - 0.7) / 0.7;
      vertexColor.copy(colorSand).lerp(colorLowGrass, t);
    } else if (vy < 2.6) {
      const t = (vy - 1.4) / 1.2;
      vertexColor.copy(colorLowGrass).lerp(colorLushGrass, t);
    } else if (vy < 4.0) {
      const t = (vy - 2.6) / 1.4;
      vertexColor.copy(colorLushGrass).lerp(colorHighGrass, t);
    } else if (vy < 5.8) {
      const t = (vy - 4.0) / 1.8;
      vertexColor.copy(colorHighGrass).lerp(colorRock, t);
    } else {
      const t = Math.min(1.0, (vy - 5.8) / 2.5);
      vertexColor.copy(colorRock).lerp(colorHighRock, t);
    }

    colors.push(vertexColor.r, vertexColor.g, vertexColor.b);
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  return {
    mesh,
    getHeight,
    getSurfaceType,
    isWalkable,
    radius: islandRadius,
  };
}

/**
 * Creates dynamic animated tropical water mesh
 */
export function createWater(): { mesh: THREE.Mesh; update: (time: number) => void } {
  const waterGeo = new THREE.PlaneGeometry(160, 160, 48, 48);
  waterGeo.rotateX(-Math.PI / 2);

  // Keep original positions for wave animation
  const origPos = waterGeo.attributes.position.clone();

  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x22b2c9,
    roughness: 0.25,
    metalness: 0.15,
    transparent: true,
    opacity: 0.78,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(waterGeo, waterMat);
  mesh.position.y = 0.0;
  mesh.receiveShadow = true;

  const update = (time: number) => {
    const pos = waterGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = origPos.getX(i);
      const w = origPos.getZ(i);
      // Gentle ocean swell
      const wave =
        Math.sin(u * 0.15 + time * 1.8) * 0.16 +
        Math.cos(w * 0.12 + time * 1.4) * 0.14 +
        Math.sin((u + w) * 0.2 + time * 2.2) * 0.08;
      pos.setY(i, wave);
    }
    waterGeo.computeVertexNormals();
    pos.needsUpdate = true;
  };

  return { mesh, update };
}
