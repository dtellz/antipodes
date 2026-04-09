import * as THREE from 'three';
import { VoxelWorld, VoxelData } from './voxel_world';

export interface DigResult {
  shell: number;
  cellID: number;
  voxel: VoxelData;
  position: THREE.Vector3;
}

/**
 * Handles digging mechanics and debris creation.
 */
export class DiggingSystem {
  private world: VoxelWorld;
  private debris: Debris[] = [];
  private scene: THREE.Scene;
  
  public digRange: number = 0.3;
  public digCooldown: number = 0.2;
  private lastDigTime: number = 0;

  constructor(world: VoxelWorld, scene: THREE.Scene) {
    this.world = world;
    this.scene = scene;
  }

  /**
   * Attempt to dig at a position in a direction.
   */
  public dig(origin: THREE.Vector3, direction: THREE.Vector3): DigResult | null {
    const now = performance.now() / 1000;
    if (now - this.lastDigTime < this.digCooldown) {
      return null;
    }
    
    // Raycast to find voxel
    const result = this.raycastVoxel(origin, direction);
    if (!result) return null;
    
    // Remove the voxel
    const voxel = this.world.removeVoxel(result.shell, result.cellID);
    if (!voxel) return null;
    
    this.lastDigTime = now;
    
    // Create debris
    this.createDebris(result.position, voxel);
    
    return {
      shell: result.shell,
      cellID: result.cellID,
      voxel,
      position: result.position
    };
  }

  /**
   * Raycast to find the first voxel hit.
   */
  private raycastVoxel(origin: THREE.Vector3, direction: THREE.Vector3): { shell: number; cellID: number; position: THREE.Vector3 } | null {
    const step = 0.02;
    const maxDist = this.digRange;
    
    const pos = origin.clone();
    const dir = direction.clone().normalize();
    
    for (let d = 0; d < maxDist; d += step) {
      pos.copy(origin).add(dir.clone().multiplyScalar(d));
      
      const cell = this.world.worldToCell(pos);
      if (cell && this.world.hasVoxel(cell.shell, cell.cellID)) {
        return {
          shell: cell.shell,
          cellID: cell.cellID,
          position: pos.clone()
        };
      }
    }
    
    return null;
  }

  /**
   * Create falling debris when a voxel is broken.
   */
  private createDebris(position: THREE.Vector3, voxel: VoxelData): void {
    const numPieces = 3 + Math.floor(Math.random() * 3);
    
    for (let i = 0; i < numPieces; i++) {
      const debris = new Debris(position.clone(), voxel.color.clone());
      this.debris.push(debris);
      this.scene.add(debris.mesh);
    }
  }

  /**
   * Update all debris physics.
   */
  public update(deltaTime: number): void {
    const toRemove: number[] = [];
    
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      d.update(deltaTime);
      
      if (d.lifetime > 3.0) {
        this.scene.remove(d.mesh);
        toRemove.push(i);
      }
    }
    
    // Remove expired debris
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.debris.splice(toRemove[i], 1);
    }
  }
}

/**
 * A piece of debris that falls with gravity toward center.
 */
class Debris {
  public mesh: THREE.Mesh;
  public velocity: THREE.Vector3;
  public lifetime: number = 0;
  
  private static geometry: THREE.BufferGeometry | null = null;

  constructor(position: THREE.Vector3, color: THREE.Color) {
    if (!Debris.geometry) {
      Debris.geometry = new THREE.TetrahedronGeometry(0.015);
    }
    
    const material = new THREE.MeshLambertMaterial({ color });
    this.mesh = new THREE.Mesh(Debris.geometry, material);
    this.mesh.position.copy(position);
    
    // Random rotation
    this.mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    
    // Random initial velocity (mostly outward from dig point)
    const outward = position.clone().normalize();
    const randomDir = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 0.5
    );
    
    this.velocity = outward.multiplyScalar(0.5 + Math.random() * 0.5).add(randomDir);
  }

  public update(deltaTime: number): void {
    this.lifetime += deltaTime;
    
    // Gravity toward center
    const gravityDir = this.mesh.position.clone().normalize().negate();
    const gravity = 2.0;
    this.velocity.add(gravityDir.multiplyScalar(gravity * deltaTime));
    
    // Apply velocity
    this.mesh.position.add(this.velocity.clone().multiplyScalar(deltaTime));
    
    // Spin
    this.mesh.rotation.x += deltaTime * 5;
    this.mesh.rotation.y += deltaTime * 3;
    
    // Fade out
    const material = this.mesh.material as THREE.MeshLambertMaterial;
    if (this.lifetime > 2.0) {
      material.opacity = 1 - (this.lifetime - 2.0);
      material.transparent = true;
    }
    
    // Ground collision (simple)
    const dist = this.mesh.position.length();
    if (dist < 0.1) {
      this.mesh.position.normalize().multiplyScalar(0.1);
      this.velocity.multiplyScalar(-0.3); // Bounce
    }
  }
}
