/**
 * Represents a single voxel in the Radial-Geodesic Voxel Engine (RGVE).
 * A voxel is defined by its radial layer and its surface identifier.
 */
export class Voxel {
  /**
   * @param r The radial layer index (0 is the center, increasing outwards).
   * @param cellID A unique identifier for the surface area on this shell.
   *               In a hierarchical system, this could be a path-like string 
   *               representing the subdivision tree (e.g., "5-2-1").
   */
  constructor(public readonly r: number, public readonly cellID: string) {}

  /**
   * Returns a string representation of the voxel coordinates.
   */
  toString(): string {
    return `Voxel(r: ${this.r}, cellID: "${this.cellID}")`;
  }
}
