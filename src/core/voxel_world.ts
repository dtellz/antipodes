import * as THREE from 'three';
import { generateGeodesicSphere, GeodesicMesh } from './geodesic';
import { TerrainGenerator, BiomeType } from './terrain';
import { CaveGenerator } from './caves';

export interface VoxelData {
  materialType: string;
  color: THREE.Color;
  hardness: number;
  exists: boolean;
}

/**
 * Manages the volumetric voxel world with multiple radial shells.
 * Each shell contains triangular cells that can be dug out.
 */
export class VoxelWorld {
  private geodesicMesh: GeodesicMesh;
  private voxels: Map<string, VoxelData> = new Map();
  private terrain: TerrainGenerator;
  private caveGenerator: CaveGenerator;
  private caveCells: Set<string> = new Set(); // Track cave locations for decoration
  
  public readonly subdivisionLevel: number;
  public readonly numShells: number;
  public readonly shellThickness: number;
  public readonly baseRadius: number;
  public readonly triangleCount: number;

  public readonly coreRadius: number;

  constructor(
    subdivisionLevel: number = 5,
    numShells: number = 10,
    baseRadius: number = 1.0,
    shellThickness: number = 0.05
  ) {
    this.subdivisionLevel = subdivisionLevel;
    this.numShells = numShells;
    this.baseRadius = baseRadius;
    this.shellThickness = shellThickness;
    this.coreRadius = 0.15; // Hollow core where the orb sits
    
    this.geodesicMesh = generateGeodesicSphere(subdivisionLevel, 1.0);
    this.triangleCount = this.geodesicMesh.indices.length / 3;
    this.terrain = new TerrainGenerator(42);
    this.caveGenerator = new CaveGenerator({ seed: 54321 });
    
    console.log(`VoxelWorld: ${this.triangleCount} cells per shell, ${numShells} shells = ${this.triangleCount * numShells} total voxels`);
  }

  private getKey(shell: number, cellID: number): string {
    return `${shell}-${cellID}`;
  }

  /**
   * Initialize the world with terrain-based voxels and caves.
   */
  public generateTerrain(): void {
    console.log('Generating volumetric terrain with caves...');
    
    for (let shell = 0; shell < this.numShells; shell++) {
      const shellRadius = this.getShellRadius(shell);
      
      for (let cellID = 0; cellID < this.triangleCount; cellID++) {
        const center = this.getCellCenter(shell, cellID);
        const surfaceHeight = this.terrain.getRadiusAt(center, this.baseRadius);
        
        // Only create voxels below the surface
        if (shellRadius <= surfaceHeight) {
          // Check if this should be a cave
          if (this.caveGenerator.isCave(center, this.baseRadius)) {
            // This is a cave - don't create a voxel, but track it
            this.caveCells.add(this.getKey(shell, cellID));
            continue;
          }
          
          const terrainData = this.terrain.getTerrainAt(center);
          
          // Determine material based on depth
          let materialType: string;
          let color: THREE.Color;
          const depthFromSurface = surfaceHeight - shellRadius;
          
          if (depthFromSurface < this.shellThickness * 2) {
            // Surface layer - use terrain biome
            materialType = terrainData.biome;
            color = terrainData.color.clone();
          } else if (depthFromSurface < this.shellThickness * 5) {
            // Dirt/soil layer
            materialType = 'dirt';
            color = new THREE.Color(0.4, 0.25, 0.1);
          } else {
            // Rock/stone layer
            materialType = 'stone';
            const variation = Math.random() * 0.1;
            color = new THREE.Color(0.35 + variation, 0.35 + variation, 0.38 + variation);
          }
          
          this.voxels.set(this.getKey(shell, cellID), {
            materialType,
            color,
            hardness: materialType === 'stone' ? 2 : 1,
            exists: true
          });
        }
      }
    }
    
    console.log(`Generated ${this.voxels.size} voxels with ${this.caveCells.size} cave cells`);
  }

  /**
   * Get cave cells for decoration placement.
   */
  public getCaveCells(): Set<string> {
    return this.caveCells;
  }

  /**
   * Get cave generator for decoration data.
   */
  public getCaveGenerator(): CaveGenerator {
    return this.caveGenerator;
  }

  /**
   * Get the radius of a specific shell.
   * Shell 0 starts at coreRadius, shell numShells-1 is at surface.
   */
  public getShellRadius(shell: number): number {
    // Shells go from coreRadius to baseRadius
    return this.coreRadius + (shell / (this.numShells - 1)) * (this.baseRadius - this.coreRadius);
  }

  /**
   * Get the center position of a cell.
   */
  public getCellCenter(shell: number, cellID: number): THREE.Vector3 {
    const i1 = this.geodesicMesh.indices[cellID * 3];
    const i2 = this.geodesicMesh.indices[cellID * 3 + 1];
    const i3 = this.geodesicMesh.indices[cellID * 3 + 2];
    
    const v1 = this.geodesicMesh.vertices[i1];
    const v2 = this.geodesicMesh.vertices[i2];
    const v3 = this.geodesicMesh.vertices[i3];
    
    const center = new THREE.Vector3()
      .add(v1).add(v2).add(v3)
      .divideScalar(3)
      .normalize();
    
    return center.multiplyScalar(this.getShellRadius(shell));
  }

  /**
   * Get voxel data at a specific location.
   */
  public getVoxel(shell: number, cellID: number): VoxelData | undefined {
    return this.voxels.get(this.getKey(shell, cellID));
  }

  /**
   * Remove a voxel (dig it out).
   */
  public removeVoxel(shell: number, cellID: number): VoxelData | undefined {
    const key = this.getKey(shell, cellID);
    const voxel = this.voxels.get(key);
    if (voxel) {
      this.voxels.delete(key);
    }
    return voxel;
  }

  /**
   * Check if a voxel exists at a location.
   */
  public hasVoxel(shell: number, cellID: number): boolean {
    return this.voxels.has(this.getKey(shell, cellID));
  }

  /**
   * Find which cell a world position is in.
   * Returns null if inside the hollow core or outside all shells.
   */
  public worldToCell(position: THREE.Vector3): { shell: number; cellID: number } | null {
    const dist = position.length();
    
    // Inside hollow core - no voxels here
    if (dist < this.coreRadius) {
      return null;
    }
    
    // Find shell
    let shell = -1;
    for (let s = 0; s < this.numShells; s++) {
      const innerR = this.getShellRadius(s);
      const outerR = s < this.numShells - 1 ? this.getShellRadius(s + 1) : innerR + this.shellThickness;
      
      if (dist >= innerR && dist < outerR) {
        shell = s;
        break;
      }
    }
    
    if (shell < 0) return null;
    
    // Find cell by checking which triangle the direction falls into
    const cellID = this.findClosestCell(position);
    
    return { shell, cellID };
  }

  /**
   * Find the closest cell to a direction.
   */
  private findClosestCell(direction: THREE.Vector3): number {
    const dir = direction.clone().normalize();
    let closestCell = 0;
    let closestDist = Infinity;
    
    for (let cellID = 0; cellID < this.triangleCount; cellID++) {
      // Use shell 0 as reference (all shells have same angular positions)
      const center = this.getCellCenter(0, cellID).normalize();
      const d = dir.distanceToSquared(center);
      if (d < closestDist) {
        closestDist = d;
        closestCell = cellID;
      }
    }
    
    return closestCell;
  }

  /**
   * Get ground height at a position (for player collision).
   * This finds the surface the player should stand on based on their current radius.
   * 
   * Key insight: "ground" depends on which direction you're coming from:
   * - If outside a voxel shell, ground is the TOP of voxels below you
   * - If inside the core cavity, there's no ground (return 0)
   */
  public getGroundHeight(position: THREE.Vector3): number {
    const dist = position.length();
    
    // Inside the hollow core - no ground, free floating
    if (dist < this.coreRadius) {
      return 0;
    }
    
    const cellID = this.findClosestCell(position);
    
    // Find which shell the player is currently in or above
    let currentShell = -1;
    for (let s = 0; s < this.numShells; s++) {
      const shellR = this.getShellRadius(s);
      const nextR = s < this.numShells - 1 ? this.getShellRadius(s + 1) : shellR + this.shellThickness;
      if (dist >= shellR && dist < nextR) {
        currentShell = s;
        break;
      }
    }
    
    // If above all shells (on surface), find highest voxel
    if (currentShell < 0 && dist >= this.getShellRadius(this.numShells - 1)) {
      for (let shell = this.numShells - 1; shell >= 0; shell--) {
        if (this.hasVoxel(shell, cellID)) {
          const outerR = shell < this.numShells - 1 
            ? this.getShellRadius(shell + 1) 
            : this.getShellRadius(shell) + this.shellThickness;
          return outerR;
        }
      }
      // No voxels at all in this column - fall to core
      return 0;
    }
    
    // Player is within the shell range - find the voxel surface below them
    // Search downward from current position to find first voxel
    for (let shell = currentShell; shell >= 0; shell--) {
      if (this.hasVoxel(shell, cellID)) {
        // Found a voxel - ground is its top surface
        const outerR = shell < this.numShells - 1 
          ? this.getShellRadius(shell + 1) 
          : this.getShellRadius(shell) + this.shellThickness;
        return outerR;
      }
    }
    
    // No voxels below - player falls into the core cavity
    // Return 0 to signal "no ground" (core cavity)
    return 0;
  }

  /**
   * Check if a position collides with any voxel.
   */
  public checkCollision(position: THREE.Vector3): boolean {
    const cell = this.worldToCell(position);
    if (!cell) return false;
    
    return this.hasVoxel(cell.shell, cell.cellID);
  }

  /**
   * Get the geodesic mesh for rendering.
   */
  public getGeodesicMesh(): GeodesicMesh {
    return this.geodesicMesh;
  }

  /**
   * Get all voxels for rendering.
   */
  public getAllVoxels(): Map<string, VoxelData> {
    return new Map(this.voxels);
  }

  /**
   * Get the vertices of a cell for geometry generation.
   */
  public getCellVertices(shell: number, cellID: number): {
    inner: THREE.Vector3[];
    outer: THREE.Vector3[];
  } {
    const i1 = this.geodesicMesh.indices[cellID * 3];
    const i2 = this.geodesicMesh.indices[cellID * 3 + 1];
    const i3 = this.geodesicMesh.indices[cellID * 3 + 2];
    
    const innerR = this.getShellRadius(shell);
    const outerR = shell < this.numShells - 1 
      ? this.getShellRadius(shell + 1) 
      : innerR + this.shellThickness;
    
    const v1 = this.geodesicMesh.vertices[i1].clone().normalize();
    const v2 = this.geodesicMesh.vertices[i2].clone().normalize();
    const v3 = this.geodesicMesh.vertices[i3].clone().normalize();
    
    return {
      inner: [
        v1.clone().multiplyScalar(innerR),
        v2.clone().multiplyScalar(innerR),
        v3.clone().multiplyScalar(innerR)
      ],
      outer: [
        v1.clone().multiplyScalar(outerR),
        v2.clone().multiplyScalar(outerR),
        v3.clone().multiplyScalar(outerR)
      ]
    };
  }
}
