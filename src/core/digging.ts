import * as THREE from 'three';
import { VoxelWorld, VoxelData } from './voxel_world';

export interface DigResult {
  shell: number;
  cellID: number;
  voxel: VoxelData;
  position: THREE.Vector3;
}

export interface CannonResult {
  impactPosition: THREE.Vector3;
  removedCount: number;
}

// ---------------------------------------------------------------------------
// DiggingSystem  (single-voxel pick + multi-voxel cannon)
// ---------------------------------------------------------------------------

export class DiggingSystem {
  private world: VoxelWorld;
  private debris: Debris[] = [];
  private effects: Effect[] = [];
  private scene: THREE.Scene;

  public digRange: number = 0.3;
  public digCooldown: number = 0.2;
  private lastDigTime: number = 0;

  // Cannon settings
  public cannonRange: number = 0.6;
  public cannonCooldown: number = 0.8;
  public cannonBlastRadius: number = 0.08;
  private lastCannonTime: number = 0;

  // Screen-shake state (read by external camera code)
  public shakeIntensity: number = 0;

  constructor(world: VoxelWorld, scene: THREE.Scene) {
    this.world = world;
    this.scene = scene;
  }

  // -------------------------------------------------------------------------
  // Single-voxel dig (left click)
  // -------------------------------------------------------------------------

  public dig(origin: THREE.Vector3, direction: THREE.Vector3): DigResult | null {
    const now = performance.now() / 1000;
    if (now - this.lastDigTime < this.digCooldown) return null;

    const result = this.raycastVoxel(origin, direction, this.digRange);
    if (!result) return null;

    // Destroy the entire structure group (cluster of ~6 adjacent voxels)
    const groupCells = this.world.getStructureGroup(result.cellID);
    let firstVoxel: VoxelData | null = null;

    for (const cellID of groupCells) {
      const voxel = this.world.removeVoxel(result.shell, cellID);
      if (voxel) {
        if (!firstVoxel) firstVoxel = voxel;
        const pos = this.world.getCellCenter(result.shell, cellID);
        this.createDebris(pos, voxel);
      }
    }

    if (!firstVoxel) return null;

    this.lastDigTime = now;
    return { shell: result.shell, cellID: result.cellID, voxel: firstVoxel, position: result.position };
  }

  // -------------------------------------------------------------------------
  // Cannon blast (right click) — destroys 6-10 voxels in a radius
  // -------------------------------------------------------------------------

  public cannon(origin: THREE.Vector3, direction: THREE.Vector3): CannonResult | null {
    const now = performance.now() / 1000;
    if (now - this.lastCannonTime < this.cannonCooldown) return null;

    // --- Muzzle flash at origin ---
    this.spawnMuzzleFlash(origin, direction);

    // --- Projectile trail ---
    const hit = this.raycastVoxel(origin, direction, this.cannonRange);
    const impactPos = hit
      ? hit.position
      : origin.clone().add(direction.clone().normalize().multiplyScalar(this.cannonRange));

    this.spawnProjectileTrail(origin, impactPos);

    if (!hit) return null;

    this.lastCannonTime = now;

    // --- Blast: remove voxels in radius around impact ---
    const removed = this.blastRadius(hit.position);

    // --- Explosion effect at impact ---
    this.spawnExplosion(hit.position);

    // --- Screen shake ---
    this.shakeIntensity = 1.0;

    return { impactPosition: hit.position, removedCount: removed };
  }

  /**
   * Remove all voxels whose centres fall within `cannonBlastRadius` of `center`.
   * Checks the hit shell ±2 and nearby cells.  Returns the count removed.
   */
  private blastRadius(center: THREE.Vector3): number {
    const hitCell = this.world.worldToCell(center);
    if (!hitCell) return 0;

    const rSq = this.cannonBlastRadius * this.cannonBlastRadius;
    let removed = 0;

    // Scan shells around the impact
    const shellMin = Math.max(0, hitCell.shell - 2);
    const shellMax = Math.min(this.world.numShells - 1, hitCell.shell + 2);

    for (let shell = shellMin; shell <= shellMax; shell++) {
      for (let cellID = 0; cellID < this.world.triangleCount; cellID++) {
        if (!this.world.hasVoxel(shell, cellID)) continue;

        const cellCenter = this.world.getCellCenter(shell, cellID);
        if (cellCenter.distanceToSquared(center) <= rSq) {
          const voxel = this.world.removeVoxel(shell, cellID);
          if (voxel) {
            removed++;
            // Explosive debris for every removed voxel
            this.createExplosiveDebris(cellCenter, voxel, center);
          }
        }
      }
    }

    return removed;
  }

  // -------------------------------------------------------------------------
  // Raycast (shared by dig & cannon)
  // -------------------------------------------------------------------------

  private raycastVoxel(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDist: number
  ): { shell: number; cellID: number; position: THREE.Vector3 } | null {
    const step = 0.02;
    const dir = direction.clone().normalize();
    const pos = new THREE.Vector3();

    for (let d = 0; d < maxDist; d += step) {
      pos.copy(origin).add(dir.clone().multiplyScalar(d));
      const cell = this.world.worldToCell(pos);
      if (cell && this.world.hasVoxel(cell.shell, cell.cellID)) {
        return { shell: cell.shell, cellID: cell.cellID, position: pos.clone() };
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Debris / effects factories
  // -------------------------------------------------------------------------

  private createDebris(position: THREE.Vector3, voxel: VoxelData): void {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const d = new Debris(position.clone(), voxel.color.clone(), 0.6);
      this.debris.push(d);
      this.scene.add(d.mesh);
    }
  }

  /**
   * Explosive debris — faster, more pieces, launched away from blast centre.
   */
  private createExplosiveDebris(
    position: THREE.Vector3,
    voxel: VoxelData,
    blastCenter: THREE.Vector3
  ): void {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const awayDir = position.clone().sub(blastCenter);
      if (awayDir.lengthSq() < 0.0001) awayDir.set(Math.random(), Math.random(), Math.random());
      awayDir.normalize();

      const d = new Debris(position.clone(), voxel.color.clone(), 2.0, awayDir);
      this.debris.push(d);
      this.scene.add(d.mesh);
    }
  }

  // --- Visual effects ---------------------------------------------------

  private spawnMuzzleFlash(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const dir = direction.clone().normalize();
    const flashPos = origin.clone().add(dir.multiplyScalar(0.03));
    this.effects.push(new MuzzleFlash(flashPos, this.scene));
  }

  private spawnProjectileTrail(from: THREE.Vector3, to: THREE.Vector3): void {
    this.effects.push(new ProjectileTrail(from, to, this.scene));
  }

  private spawnExplosion(position: THREE.Vector3): void {
    this.effects.push(new Explosion(position, this.scene));
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  public update(deltaTime: number): void {
    // Decay screen-shake
    this.shakeIntensity *= Math.max(0, 1 - 6 * deltaTime);
    if (this.shakeIntensity < 0.01) this.shakeIntensity = 0;

    // Debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.update(deltaTime);
      if (d.lifetime > 3.0) {
        this.scene.remove(d.mesh);
        d.dispose();
        this.debris.splice(i, 1);
      }
    }

    // Effects
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.update(deltaTime);
      if (e.isDone()) {
        e.dispose(this.scene);
        this.effects.splice(i, 1);
      }
    }
  }
}

// ===========================================================================
// Debris — small chunk that flies off a broken voxel
// ===========================================================================

class Debris {
  public mesh: THREE.Mesh;
  public velocity: THREE.Vector3;
  public lifetime: number = 0;

  private static geometry: THREE.BufferGeometry | null = null;

  constructor(
    position: THREE.Vector3,
    color: THREE.Color,
    speedMul: number = 1,
    launchDir?: THREE.Vector3
  ) {
    if (!Debris.geometry) {
      Debris.geometry = new THREE.TetrahedronGeometry(0.015);
    }

    const material = new THREE.MeshLambertMaterial({ color });
    this.mesh = new THREE.Mesh(Debris.geometry, material);
    this.mesh.position.copy(position);
    this.mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );

    const outward = launchDir
      ? launchDir.clone()
      : position.clone().normalize();

    const randomDir = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 0.5
    );

    this.velocity = outward
      .multiplyScalar((0.5 + Math.random() * 0.5) * speedMul)
      .add(randomDir.multiplyScalar(speedMul));
  }

  public update(deltaTime: number): void {
    this.lifetime += deltaTime;

    // Gravity toward center
    const gravityDir = this.mesh.position.clone().normalize().negate();
    this.velocity.add(gravityDir.multiplyScalar(2.0 * deltaTime));

    this.mesh.position.add(this.velocity.clone().multiplyScalar(deltaTime));

    // Spin
    this.mesh.rotation.x += deltaTime * 5;
    this.mesh.rotation.y += deltaTime * 3;

    // Fade out
    const mat = this.mesh.material as THREE.MeshLambertMaterial;
    if (this.lifetime > 2.0) {
      mat.opacity = 1 - (this.lifetime - 2.0);
      mat.transparent = true;
    }

    // Ground bounce
    if (this.mesh.position.length() < 0.1) {
      this.mesh.position.normalize().multiplyScalar(0.1);
      this.velocity.multiplyScalar(-0.3);
    }
  }

  public dispose(): void {
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ===========================================================================
// Effect base
// ===========================================================================

interface Effect {
  update(dt: number): void;
  isDone(): boolean;
  dispose(scene: THREE.Scene): void;
}

// ===========================================================================
// MuzzleFlash — bright sphere that pops and fades fast
// ===========================================================================

class MuzzleFlash implements Effect {
  private mesh: THREE.Mesh;
  private age = 0;
  private duration = 0.12;

  constructor(position: THREE.Vector3, scene: THREE.Scene) {
    const geom = new THREE.SphereGeometry(0.018, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xFFDD44,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.position.copy(position);
    scene.add(this.mesh);
  }

  update(dt: number): void {
    this.age += dt;
    const t = this.age / this.duration;
    this.mesh.scale.setScalar(1 + t * 2);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
  }

  isDone(): boolean { return this.age >= this.duration; }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ===========================================================================
// ProjectileTrail — bright line from muzzle to impact that fades out
// ===========================================================================

class ProjectileTrail implements Effect {
  private line: THREE.Line;
  private age = 0;
  private duration = 0.2;

  constructor(from: THREE.Vector3, to: THREE.Vector3, scene: THREE.Scene) {
    const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xFFAA22,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      linewidth: 2,
    });
    this.line = new THREE.Line(geom, mat);
    scene.add(this.line);
  }

  update(dt: number): void {
    this.age += dt;
    (this.line.material as THREE.LineBasicMaterial).opacity =
      Math.max(0, 1 - this.age / this.duration);
  }

  isDone(): boolean { return this.age >= this.duration; }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.line);
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}

// ===========================================================================
// Explosion — expanding ring of glowing spheres + a central fireball
// ===========================================================================

class Explosion implements Effect {
  private parts: THREE.Mesh[] = [];
  private velocities: THREE.Vector3[] = [];
  private age = 0;
  private duration = 0.6;

  constructor(position: THREE.Vector3, scene: THREE.Scene) {
    // Central fireball
    const fbGeom = new THREE.SphereGeometry(0.025, 8, 8);
    const fbMat = new THREE.MeshBasicMaterial({
      color: 0xFF6600,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const fireball = new THREE.Mesh(fbGeom, fbMat);
    fireball.position.copy(position);
    scene.add(fireball);
    this.parts.push(fireball);
    this.velocities.push(new THREE.Vector3());

    // Ring of sparks
    const sparkCount = 10 + Math.floor(Math.random() * 6);
    const sparkGeom = new THREE.SphereGeometry(0.008, 6, 6);

    for (let i = 0; i < sparkCount; i++) {
      const hue = 0.05 + Math.random() * 0.1; // orange-red range
      const sparkMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(hue, 1, 0.55),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const spark = new THREE.Mesh(sparkGeom, sparkMat);
      spark.position.copy(position);
      scene.add(spark);
      this.parts.push(spark);

      // Random outward velocity
      const vel = new THREE.Vector3(
        (Math.random() - 0.5),
        (Math.random() - 0.5),
        (Math.random() - 0.5)
      ).normalize().multiplyScalar(0.3 + Math.random() * 0.4);
      this.velocities.push(vel);
    }
  }

  update(dt: number): void {
    this.age += dt;
    const t = this.age / this.duration;

    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.position.add(this.velocities[i].clone().multiplyScalar(dt));
      const mat = p.material as THREE.MeshBasicMaterial;

      if (i === 0) {
        // Fireball: expand then fade
        p.scale.setScalar(1 + t * 3);
        mat.opacity = Math.max(0, 1 - t * 1.5);
      } else {
        // Sparks: shrink + fade
        p.scale.setScalar(Math.max(0.01, 1 - t));
        mat.opacity = Math.max(0, 1 - t);
      }
    }
  }

  isDone(): boolean { return this.age >= this.duration; }

  dispose(scene: THREE.Scene): void {
    for (const p of this.parts) {
      scene.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
  }
}
