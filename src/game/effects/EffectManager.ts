import * as THREE from 'three';

interface ActiveTracer {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface SparkParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class EffectManager {
  private scene: THREE.Scene;
  private tracers: ActiveTracer[] = [];
  private sparks: SparkParticle[] = [];

  // Pooled spark meshes for zero-garbage particle management
  private sparkPool: THREE.Mesh[] = [];
  private sharedSparkGeo: THREE.BoxGeometry;
  private redSparkMat: THREE.MeshBasicMaterial;
  private cyanSparkMat: THREE.MeshBasicMaterial;

  private upVector = new THREE.Vector3(0, 1, 0);
  private readonly MAX_ACTIVE_SPARKS = 48;
  private readonly MAX_ACTIVE_TRACERS = 16;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.sharedSparkGeo = new THREE.BoxGeometry(0.045, 0.045, 0.045);
    this.redSparkMat = new THREE.MeshBasicMaterial({
      color: 0xff0044,
      transparent: true,
      opacity: 1,
    });
    this.cyanSparkMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 1,
    });
  }

  public addTracer(
    startX: number,
    startY: number,
    startZ: number,
    endX: number,
    endY: number,
    endZ: number,
    hitTarget: boolean = false
  ) {
    // If tracer buffer is full, remove oldest to prevent unbounded memory growth
    if (this.tracers.length >= this.MAX_ACTIVE_TRACERS) {
      const oldest = this.tracers.shift();
      if (oldest) {
        this.scene.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
        (oldest.mesh.material as THREE.Material).dispose();
      }
    }

    const start = new THREE.Vector3(startX, startY, startZ);
    const end = new THREE.Vector3(endX, endY, endZ);
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();

    if (len < 0.1) return;

    // Glowing energy beam cylinder
    const geo = new THREE.CylinderGeometry(0.02, 0.02, len, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: hitTarget ? 0xf43f5e : 0x06b6d4,
      transparent: true,
      opacity: 0.85,
    });

    const mesh = new THREE.Mesh(geo, mat);

    // Position at midpoint
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mesh.position.copy(mid);

    // Orient cylinder towards shot direction
    const quat = new THREE.Quaternion().setFromUnitVectors(this.upVector, dir.clone().normalize());
    mesh.quaternion.copy(quat);

    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.08, maxLife: 0.08 });

    // Add impact sparks at hit point
    this.addImpactSparks(end, hitTarget);
  }

  public addImpactSparks(position: THREE.Vector3, hitTarget: boolean) {
    const sparkCount = hitTarget ? 8 : 5;

    for (let i = 0; i < sparkCount; i++) {
      if (this.sparks.length >= this.MAX_ACTIVE_SPARKS) {
        break; // Cap active sparks to maintain smooth 60 FPS
      }

      let mesh = this.sparkPool.pop();
      if (!mesh) {
        mesh = new THREE.Mesh(this.sharedSparkGeo, hitTarget ? this.redSparkMat.clone() : this.cyanSparkMat.clone());
      } else {
        mesh.material = hitTarget ? this.redSparkMat.clone() : this.cyanSparkMat.clone();
        (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
        mesh.visible = true;
      }

      mesh.position.copy(position);
      if (!mesh.parent) {
        this.scene.add(mesh);
      }

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4.5,
        Math.random() * 3.5 + 1.2,
        (Math.random() - 0.5) * 4.5
      );

      this.sparks.push({
        mesh,
        velocity: vel,
        life: 0.22,
        maxLife: 0.22,
      });
    }
  }

  public update(dt: number) {
    // 1. Update active tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        (t.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      } else {
        const mat = t.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = (t.life / t.maxLife) * 0.85;
      }
    }

    // 2. Update active sparks with gravity and recycle into pool
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        this.sparkPool.push(s.mesh);
        this.sparks.splice(i, 1);
      } else {
        s.velocity.y -= 11 * dt; // gravity
        s.mesh.position.addScaledVector(s.velocity, dt);
        const mat = s.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, s.life / s.maxLife);
      }
    }
  }

  public dispose() {
    this.tracers.forEach((t) => {
      this.scene.remove(t.mesh);
      t.mesh.geometry?.dispose();
      (t.mesh.material as THREE.Material)?.dispose();
    });
    this.tracers = [];

    this.sparks.forEach((s) => {
      this.scene.remove(s.mesh);
      if (s.mesh.material) (s.mesh.material as THREE.Material).dispose();
    });
    this.sparks = [];

    this.sparkPool.forEach((m) => {
      this.scene.remove(m);
      if (m.material) (m.material as THREE.Material).dispose();
    });
    this.sparkPool = [];

    this.sharedSparkGeo.dispose();
    this.redSparkMat.dispose();
    this.cyanSparkMat.dispose();
  }
}
