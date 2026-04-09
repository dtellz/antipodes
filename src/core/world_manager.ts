/**
 * Data associated with a voxel.
 */
export interface VoxelData {
  materialType: string;
  lightLevel: number;
  hardness: number;
}

import { Voxel } from './voxel';

/**
 * Manages the sparse storage of voxels in the world.
 */
export class WorldManager {
  // Key format: "r-cellID"
  private voxels: Map<string, VoxelData> = new Map();

  /**
   * Sets a voxel at the specified location.
   * @param r The radial layer index.
   * @param cellID The surface identifier (triangle index).
   * @param data The voxel's properties.
   */
  public setVoxel(r: number, cellID: string | number, data: VoxelData): void {
    const key = this._generateKey(r, cellID);
    this.voxels.set(key, data);
  }

  /**
   * Gets the voxel data at the specified location.
   * @param r The radial layer index.
   * @param cellID The surface identifier (triangle index).
   * @returns The VoxelData if it exists, otherwise undefined.
   */
  public getVoxel(r: number, cellID: string | number): VoxelData | undefined {
    const key = this._generateKey(r, cellID);
    return this.voxels.get(key);
  }

  /**
   * Generates a unique string key for the voxel map.
   */
  private _generateKey(r: number, cellID: string | number): string {
    return `${r}-${cellID}`;
  }

  /**
   * Returns all voxels in the world. 
   * Useful for debugging or full-world operations.
   */
  public getAllVoxels(): Map<string, VoxelData> {
    return new Map(this.voxels);
  }

  /**
   * Clears all voxels from the world.
   */
  public clear(): void {
    this.voxels.clear();
  }
}
