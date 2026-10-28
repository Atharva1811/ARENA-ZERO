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

  private upVector = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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

    // Orient cylinder (default along Y) towards direction
    const quat = new THREE.Quaternion().setFromUnitVectors(this.upVector, dir.clone().normalize());
    mesh.quaternion.copy(quat);

    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.08, maxLife: 0.08 });

    // Add impact sparks at hit point
    this.addImpactSparks(end, hitTarget);
  }

  public addImpactSparks(position: THREE.Vector3, hitTarget: boolean) {
    const sparkCount = hitTarget ? 10 : 6;
    const sparkColor = hitTarget ? 0xff0044 : 0x38bdf8;

    const sparkGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: sparkColor,
      transparent: true,
      opacity: 1,
    });

    for (let i = 0; i < sparkCount; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat.clone());
      mesh.position.copy(position);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 5
      );

      this.scene.add(mesh);
      this.sparks.push({
        mesh,
        velocity: vel,
        life: 0.25,
        maxLife: 0.25,
      });
    }
  }

  public update(dt: number) {
    // 1. Update tracers
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

    // 2. Update sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.sparks.splice(i, 1);
      } else {
        s.velocity.y -= 12 * dt; // gravity
        s.mesh.position.addScaledVector(s.velocity, dt);
        const mat = s.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = s.life / s.maxLife;
      }
    }
  }

  public dispose() {
    this.tracers.forEach((t) => {
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
    });
    this.tracers = [];

    this.sparks.forEach((s) => {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    });
    this.sparks = [];
  }
}
