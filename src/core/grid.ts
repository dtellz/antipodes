import { GeodesicMesh, generateGeodesicSphere } from './geodesic';

/**
 * Manages a geodesic grid at a specific subdivision level.
 */
export class GeodesicGrid {
  public readonly mesh: GeodesicMesh;
  public readonly subdivisionLevel: number;

  constructor(subdivisionLevel: number, radius: number = 1) {
    this.subdivisionLevel = subdivisionLevel;
    this.mesh = generateGeodesicSphere(subdivisionLevel, radius);
  }
}
