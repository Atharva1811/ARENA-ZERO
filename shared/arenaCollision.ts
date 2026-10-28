export interface BoxCollider {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface CylinderCollider {
  id: string;
  x: number;
  z: number;
  radius: number;
  minY: number;
  maxY: number;
}

export const ARENA_RADIUS = 28.0;

// Symmetric spawn locations across all quadrants
export const SPAWN_POINTS: Array<{ x: number; y: number; z: number; yaw: number }> = [
  { x: 0, y: 0, z: 22, yaw: Math.PI },        // South
  { x: 0, y: 0, z: -22, yaw: 0 },             // North
  { x: 22, y: 0, z: 0, yaw: -Math.PI / 2 },   // East
  { x: -22, y: 0, z: 0, yaw: Math.PI / 2 },   // West
  { x: 15, y: 0, z: 15, yaw: (3 * Math.PI) / 4 }, // South-East
  { x: -15, y: 0, z: 15, yaw: Math.PI / 4 },      // South-West
  { x: 15, y: 0, z: -15, yaw: -(3 * Math.PI) / 4 }, // North-East
  { x: -15, y: 0, z: -15, yaw: -Math.PI / 4 },     // North-West
];

// Defined solid obstacles in Arena Zero
export const ARENA_BOXES: BoxCollider[] = [
  // 4 Corner Mega Obelisks (Towers)
  { id: 'obelisk-ne', minX: 10.5, maxX: 13.5, minZ: -13.5, maxZ: -10.5, minY: 0, maxY: 12 },
  { id: 'obelisk-nw', minX: -13.5, maxX: -10.5, minZ: -13.5, maxZ: -10.5, minY: 0, maxY: 12 },
  { id: 'obelisk-se', minX: 10.5, maxX: 13.5, minZ: 10.5, maxZ: 13.5, minY: 0, maxY: 12 },
  { id: 'obelisk-sw', minX: -13.5, maxX: -10.5, minZ: 10.5, maxZ: 13.5, minY: 0, maxY: 12 },

  // Center Courtyard Cover Blocks
  { id: 'cover-c-north', minX: -1.8, maxX: 1.8, minZ: -4.5, maxZ: -3.3, minY: 0, maxY: 2.4 },
  { id: 'cover-c-south', minX: -1.8, maxX: 1.8, minZ: 3.3, maxZ: 4.5, minY: 0, maxY: 2.4 },
  { id: 'cover-c-east', minX: 3.3, maxX: 4.5, minZ: -1.8, maxZ: 1.8, minY: 0, maxY: 2.4 },
  { id: 'cover-c-west', minX: -4.5, maxX: -3.3, minZ: -1.8, maxZ: 1.8, minY: 0, maxY: 2.4 },

  // Mid-range Tactical Bunkers / Walls
  { id: 'bunker-north', minX: -4.0, maxX: 4.0, minZ: -15.5, maxZ: -14.2, minY: 0, maxY: 2.5 },
  { id: 'bunker-south', minX: -4.0, maxX: 4.0, minZ: 14.2, maxZ: 15.5, minY: 0, maxY: 2.5 },
  { id: 'bunker-east', minX: 14.2, maxX: 15.5, minZ: -4.0, maxZ: 4.0, minY: 0, maxY: 2.5 },
  { id: 'bunker-west', minX: -15.5, maxX: -14.2, minZ: -4.0, maxZ: 4.0, minY: 0, maxY: 2.5 },

  // Flank Ramparts
  { id: 'flank-ne', minX: 19.0, maxX: 20.2, minZ: -12.0, maxZ: -6.0, minY: 0, maxY: 2.2 },
  { id: 'flank-nw', minX: -20.2, maxX: -19.0, minZ: -12.0, maxZ: -6.0, minY: 0, maxY: 2.2 },
  { id: 'flank-se', minX: 19.0, maxX: 20.2, minZ: 6.0, maxZ: 12.0, minY: 0, maxY: 2.2 },
  { id: 'flank-sw', minX: -20.2, maxX: -19.0, minZ: 6.0, maxZ: 12.0, minY: 0, maxY: 2.2 },
];

export const ARENA_CYLINDERS: CylinderCollider[] = [
  // Center Energy Reactor / Monument Column
  { id: 'reactor-core', x: 0, z: 0, radius: 1.6, minY: 0, maxY: 6.0 },
  // 4 Flank Pillars
  { id: 'pillar-north', x: 0, z: -8.5, radius: 0.9, minY: 0, maxY: 4.0 },
  { id: 'pillar-south', x: 0, z: 8.5, radius: 0.9, minY: 0, maxY: 4.0 },
  { id: 'pillar-east', x: 8.5, z: 0, radius: 0.9, minY: 0, maxY: 4.0 },
  { id: 'pillar-west', x: -8.5, z: 0, radius: 0.9, minY: 0, maxY: 4.0 },
];

/**
 * Resolves player horizontal movement against all solid arena colliders and boundary
 */
export function resolveArenaCollision(
  currX: number,
  currZ: number,
  radius: number = 0.45
): { x: number; z: number } {
  let nextX = currX;
  let nextZ = currZ;

  // 1. Resolve against Box colliders
  for (const box of ARENA_BOXES) {
    // Find closest point on AABB to player center
    const closestX = Math.max(box.minX, Math.min(box.maxX, nextX));
    const closestZ = Math.max(box.minZ, Math.min(box.maxZ, nextZ));

    const dx = nextX - closestX;
    const dz = nextZ - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq);
      if (dist > 0.0001) {
        const overlap = radius - dist;
        nextX += (dx / dist) * overlap;
        nextZ += (dz / dist) * overlap;
      } else {
        // Player center inside box; push toward closest edge
        const dMinX = Math.abs(nextX - box.minX);
        const dMaxX = Math.abs(nextX - box.maxX);
        const dMinZ = Math.abs(nextZ - box.minZ);
        const dMaxZ = Math.abs(nextZ - box.maxZ);
        const minVal = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);
        if (minVal === dMinX) nextX = box.minX - radius;
        else if (minVal === dMaxX) nextX = box.maxX + radius;
        else if (minVal === dMinZ) nextZ = box.minZ - radius;
        else nextZ = box.maxZ + radius;
      }
    }
  }

  // 2. Resolve against Cylinder colliders
  for (const cyl of ARENA_CYLINDERS) {
    const dx = nextX - cyl.x;
    const dz = nextZ - cyl.z;
    const dist = Math.hypot(dx, dz);
    const minDist = cyl.radius + radius;

    if (dist < minDist && dist > 0.0001) {
      const overlap = minDist - dist;
      nextX += (dx / dist) * overlap;
      nextZ += (dz / dist) * overlap;
    }
  }

  // 3. Circular Arena Perimeter Barrier
  const distFromCenter = Math.hypot(nextX, nextZ);
  const maxAllowedDist = ARENA_RADIUS - radius;
  if (distFromCenter > maxAllowedDist) {
    const factor = maxAllowedDist / distFromCenter;
    nextX *= factor;
    nextZ *= factor;
  }

  return { x: nextX, z: nextZ };
}

/**
 * Server-authoritative raycast check:
 * Returns true if line of sight between p0 and p1 is completely clear (not blocked by walls/obstacles).
 */
export function isLineOfSightClear(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number
): boolean {
  const dirX = x1 - x0;
  const dirY = y1 - y0;
  const dirZ = z1 - z0;
  const dist = Math.hypot(dirX, dirZ);

  if (dist < 0.001) return true;

  // Normalized direction
  const nx = dirX / dist;
  const nz = dirZ / dist;

  // 1. Raycast against Cylinders in XZ
  for (const cyl of ARENA_CYLINDERS) {
    const ox = x0 - cyl.x;
    const oz = z0 - cyl.z;
    const b = 2 * (ox * nx + oz * nz);
    const c = ox * ox + oz * oz - (cyl.radius * cyl.radius);
    const disc = b * b - 4 * c;

    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      const t1 = (-b - sqrtDisc) / 2;
      const t2 = (-b + sqrtDisc) / 2;
      const hitT = t1 > 0 ? t1 : t2;

      if (hitT > 0.2 && hitT < dist - 0.2) {
        // Check Y elevation
        const hitY = y0 + (hitT / dist) * dirY;
        if (hitY >= cyl.minY && hitY <= cyl.maxY) {
          return false; // Blocked by cylinder
        }
      }
    }
  }

  // 2. Raycast against Box colliders (AABB Slab method)
  for (const box of ARENA_BOXES) {
    let tmin = 0;
    let tmax = dist;

    // X slab
    if (Math.abs(dirX) > 0.0001) {
      let t1 = (box.minX - x0) / (dirX / dist);
      let t2 = (box.maxX - x0) / (dirX / dist);
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    } else if (x0 < box.minX || x0 > box.maxX) {
      continue;
    }

    // Z slab
    if (Math.abs(dirZ) > 0.0001) {
      let t1 = (box.minZ - z0) / (dirZ / dist);
      let t2 = (box.maxZ - z0) / (dirZ / dist);
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    } else if (z0 < box.minZ || z0 > box.maxZ) {
      continue;
    }

    // Y slab
    if (Math.abs(dirY) > 0.0001) {
      let t1 = (box.minY - y0) / (dirY / dist);
      let t2 = (box.maxY - y0) / (dirY / dist);
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }

    // If intersection happens between shooter and target
    if (tmin > 0.2 && tmin < dist - 0.2) {
      return false; // Blocked by wall
    }
  }

  return true; // Clean line of sight
}
