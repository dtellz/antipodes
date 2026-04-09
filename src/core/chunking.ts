import * as THREE from 'three';
import { GeodesicMesh } from './geodesic';

/**
 * Represents a chunk of voxels on a specific radial shell.
 * This allows for grouping multiple voxels together to optimize rendering and management.
 */
export class ShellChunk {
  /**
   * @param r The radial layer index this chunk belongs to.
   * @param startCellID The starting triangle index in this chunk.
   * @param endCellID The ending triangle index (exclusive) in this chunk.
   */
  constructor(
    public readonly r: number,
    public readonly startCellID: number,
    public readonly endCellID: number
  ) {}

  /**
   * Checks if a given cellID belongs to this chunk.
   */
  public contains(cellID: number): boolean {
    return cellID >= this.startCellID && cellID < this.endCellID;
  }

  /**
   * Returns the number of cells in this chunk.
   */
  public get size(): number {
    return this.endCellID - this.startCellID;
  }
}

/**
 * Manages voxels organized into chunks for efficient spatial querying and rendering.
 */
export class ChunkedWorldManager {
  private chunks: Map<number, ShellChunk[]> = new Map(); // Key: r (radial layer)
  private voxelData: Map<string, any> = new Map(); // Key: "r-cellID"

  /**
   * Adds a chunk to the world.
   */
  public addChunk(chunk: ShellChunk): void {
    const shellChunks = this.chunks.get(chunk.r) || [];
    shellChunks.push(chunk);
    this.chunks.set(chunk.r, shellChunks);
  }

  /**
   * Gets the chunk containing a specific cell on a given shell.
   */
  public getChunk(r: number, cellID: number): ShellChunk | undefined {
    const shellChunks = this.chunks.get(r);
    if (!shellChunks) return undefined;

    return shellChunks.find(chunk => chunk.contains(cellID));
  }

  /**
   * Returns all chunks for a specific radial layer.
   */
  public getChunksForShell(r: number): ShellChunk[] {
    return this.chunks.get(r) || [];
  }

  /**
   * Gets all cellIDs that are part of a chunk on shell r.
   * Useful for identifying "active" areas in a shell.
   */
  public getActiveCellIDsForShell(r: number): number[] {
    const activeCells: number[] = [];
    const shellChunks = this.chunks.get(r) || [];

    for (const chunk of shellChunks) {
      for (let id = chunk.startCellID; id < chunk.endCellID; id++) {
        activeCells.push(id);
      }
    }
    return activeCells;
  }
}
