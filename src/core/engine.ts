import * as THREE from 'three';
import { GeodesicMesh, generateGeodesicSphere } from './geodesic';
import { Voxel } from './voxel';

/**
 * The core engine that manages the radial-geodesic coordinate system.
 */
export class RadialGeodesicEngine {
  private baseMesh: GeodesicMesh;
  private readonly subdivisionLevel: number;
  private readonly shellRadiusStep: number;

  constructor(subdivisionLevel: number, shellRadiusStep: number = 1) {
    this.subdivisionLevel = subdivisionLevel;
    this.shellRadiusStep = shellRadiusStep;
    // Generate the base mesh at unit radius (radius = 1)
    this.baseMesh = generateGeodesicSphere(subdivisionLevel, 1);
  }

  /**
   * Gets the world position of a voxel's center.
   * @param r The radial layer index.
   * @param cellID The triangle index on that shell.
   */
  public getVoxelWorldPosition(r: number, cellID: string | number): THREE.Vector3 {
    const index = typeof cellID === 'string' ? parseInt(cellID, 10) : cellID;
    if (isNaN(index)) {
      throw new Error(`Invalid cellID: ${cellID}. Must be a numeric string or number.`);
    }

    // The voxel is between shell r and r+1. 
    // Its center is at radius (r + 0.5) * step.
    const radius = (r + 0.5) * this.shellRadiusStep;

    // Get the three vertices of the triangle from the base mesh
    const i1 = this.baseMesh.indices[index * 3];
    const i2 = this.baseMesh.indices[index * 3 + 1];
    const i3 = this.baseMesh.indices[index * 3 + 2];

    if (i1 === undefined || i2 === undefined || i3 === undefined) {
      throw new Error(`Triangle index ${index} is out of bounds.`);
    }

    const v1 = this.baseMesh.vertices[i1];
    const v2 = this.baseMesh.vertices[i2];
    const v3 = this.baseMesh.vertices[i3];

    // Calculate the center of the triangle on the unit sphere
    const center = new THREE.Vector3()
      .add(v1)
      .add(v2)
      .add(v3)
      .divideScalar(3);

    // Scale to the voxel's radial position
    return center.multiplyScalar(radius);
  }

  /**
   * Returns the vertices of a triangle on a specific shell.
   * This is used for Task 3: Stacking logic.
   */
  public getTriangleVerticesOnShell(r: number, triangleIndex: number): THREE.Vector3[] {
    const radius = r * this.shellRadiusStep;
    const i1 = this.baseMesh.indices[triangleIndex * 3];
    const i2 = this.baseMesh.indices[triangleIndex * 3 + 1];
    const i3 = this.baseMesh.indices[triangleIndex * 3 + 2];

    if (i1 === undefined || i2 === undefined || i3 === undefined) {
      throw new Error(`Triangle index ${triangleIndex} is out of bounds.`);
    }

    return [
      this.baseMesh.vertices[i1].clone().multiplyScalar(radius),
      this.baseMesh.vertices[i2].clone().multiplyScalar(radius),
      this.baseMesh.vertices[i3].clone().multiplyScalar(radius),
    ];
  }

  /**
   * Returns the number of triangles available on any shell.
   */
  public getTriangleCount(): number {
    return this.baseMesh.indices.length / 3;
  }

  /**
   * Gets the base mesh for rendering purposes.
   */
  public getBaseMesh(): GeodesicMesh {
    return this.baseMesh;
  }

  /**
   * Generates the geometry for a single voxel (a frustum between two shells).
   * This implements the "Stacking" logic by ensuring vertices align perfectly.
   *
   * @param r The radial layer index (the inner shell).
   * @param triangleIndex The index of the triangle on the geodesic grid.
   * @returns An object containing the vertices and indices for the voxel frustum.
   */
  public getVoxelGeometry(r: number, triangleIndex: number) {
    const rInner = r * this.shellRadiusStep;
    const rOuter = (r + 1) * this.shellRadiusStep;

    const i1 = this.baseMesh.indices[triangleIndex * 3];
    const i2 = this.baseMesh.indices[triangleIndex * 3 + 1];
    const i3 = this.baseMesh.indices[triangleIndex * 3 + 2];

    if (i1 === undefined || i2 === undefined || i3 === undefined) {
      throw new Error(`Triangle index ${triangleIndex} is out of bounds.`);
    }

    // Inner vertices (on shell r)
    const v1_inner = this.baseMesh.vertices[i1].clone().multiplyScalar(rInner);
    const v2_inner = this.baseMesh.vertices[i2].clone().multiplyScalar(rInner);
    const v3_inner = this.baseMesh.vertices[i3].clone().multiplyScalar(rInner);

    // Outer vertices (on shell r+1)
    const v1_outer = this.baseMesh.vertices[i1].clone().multiplyScalar(rOuter);
    const v2_outer = this.baseMesh.vertices[i2].clone().multiplyScalar(rOuter);
    const v3_outer = this.baseMesh.vertices[i3].clone().multiplyScalar(rOuter);

    const vertices = [
      v1_inner, v2_inner, v3_inner, // 0, 1, 2
      v1_outer, v2_outer, v3_outer  // 3, 4, 5
    ];

    // Indices for the 6 faces of the frustum (ensuring correct winding order)
    const indices = new Uint32Array([
      0, 1, 2, // Base triangle (inner)
      3, 5, 4, // Top triangle (outer) - reversed to face outward if inner is CCW
      // Wait, let's check winding. If we are looking from outside:
      // Inner base should be CW if we want it to be visible from inside?
      // Actually, for a voxel, we usually want all faces to face "outward" from the center of the voxel.
      // But standard practice is just consistent CCW.
      
      // Let's use CCW for everything as seen from outside the shell.
      // Base (inner) - if looking from inside the sphere, it's the 'bottom'.
      // If we want to see it from the center of the world:
      0, 2, 1, // Inner base (facing towards center)
      3, 4, 5, // Outer top (facing away from center)

      // Sides (quads split into two triangles each)
      0, 1, 4, 0, 4, 3, // Side 1
      1, 2, 5, 1, 5, 4, // Side 2
      2, 0, 3, 2, 3, 5  // Side 3
    ]);

    return { vertices, indices };
  }
}
