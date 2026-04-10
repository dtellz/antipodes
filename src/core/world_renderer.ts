import * as THREE from 'three';
import { VoxelWorld } from './voxel_world';

/**
 * Renders the voxel world efficiently by batching geometry.
 */
export class WorldRenderer {
  private world: VoxelWorld;
  private scene: THREE.Scene;
  private surfaceMesh: THREE.Mesh | null = null;
  private needsUpdate: boolean = true;

  constructor(world: VoxelWorld, scene: THREE.Scene) {
    this.world = world;
    this.scene = scene;
  }

  /**
   * Mark the world as needing a visual update.
   */
  public markDirty(): void {
    this.needsUpdate = true;
  }

  /**
   * Rebuild the world mesh if needed.
   */
  public update(): void {
    if (!this.needsUpdate) return;
    this.needsUpdate = false;
    
    // Remove old mesh
    if (this.surfaceMesh) {
      this.scene.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
      (this.surfaceMesh.material as THREE.Material).dispose();
    }
    
    // Build new mesh
    this.surfaceMesh = this.buildSurfaceMesh();
    this.scene.add(this.surfaceMesh);
  }

  /**
   * Depth-based layer colors — distinct bands from core to surface so dug
   * cross-sections look like slices of a layered sphere.
   * Index 0 = innermost shell (hottest), higher = closer to surface.
   */
  private static readonly LAYER_COLORS: readonly THREE.Color[] = [
    new THREE.Color(0xFF5500), // 0  — magma orange
    new THREE.Color(0xFF2200), // 1  — deep red
    new THREE.Color(0xCC1100), // 2  — dark red
    new THREE.Color(0x991100), // 3  — maroon
    new THREE.Color(0x7733AA), // 4  — deep purple
    new THREE.Color(0x5544AA), // 5  — indigo
    new THREE.Color(0x3366AA), // 6  — slate blue
    new THREE.Color(0x335577), // 7  — steel
    new THREE.Color(0x445544), // 8  — dark moss
    new THREE.Color(0x556633), // 9  — olive
    new THREE.Color(0x776644), // 10 — khaki stone
    new THREE.Color(0x8B7355), // 11 — tan rock
    new THREE.Color(0x7A5C3A), // 12 — earth brown
    // Shells 13–14 keep the biome colour assigned at world-gen time.
  ];

  /**
   * Return the display colour for a voxel.  The top two shells use the
   * biome colour from world-gen; all deeper shells use a fixed layer colour
   * so a freshly dug cross-section shows clear depth bands.
   */
  private getLayerColor(shell: number, voxelColor: THREE.Color): THREE.Color {
    const surfaceShell = this.world.numShells - 2; // keep biome colour above here
    if (shell >= surfaceShell) return voxelColor;
    const idx = Math.min(shell, WorldRenderer.LAYER_COLORS.length - 1);
    return WorldRenderer.LAYER_COLORS[idx];
  }

  /**
   * Build a mesh showing only exposed voxel faces.
   */
  private buildSurfaceMesh(): THREE.Mesh {
    const positions: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];

    const voxels = this.world.getAllVoxels();

    for (const [key, voxel] of voxels) {
      const [shellStr, cellStr] = key.split('-');
      const shell = parseInt(shellStr);
      const cellID = parseInt(cellStr);

      const displayColor = this.getLayerColor(shell, voxel.color);

      // Get cell geometry
      const { inner, outer } = this.world.getCellVertices(shell, cellID);

      // Check which faces are exposed
      const hasInnerNeighbor = shell > 0 && this.world.hasVoxel(shell - 1, cellID);
      const hasOuterNeighbor = shell < this.world.numShells - 1 && this.world.hasVoxel(shell + 1, cellID);

      // Add outer face (always visible if no outer neighbor)
      if (!hasOuterNeighbor) {
        this.addTriangle(positions, colors, normals, outer[0], outer[1], outer[2], displayColor, true);
      }

      // Add inner face (visible if no inner neighbor)
      if (!hasInnerNeighbor) {
        this.addTriangle(positions, colors, normals, inner[0], inner[2], inner[1], displayColor, false);
      }

      // Add side faces (simplified - always add for now)
      // In a full implementation, we'd check lateral neighbors
      this.addQuad(positions, colors, normals, inner[0], inner[1], outer[1], outer[0], displayColor);
      this.addQuad(positions, colors, normals, inner[1], inner[2], outer[2], outer[1], displayColor);
      this.addQuad(positions, colors, normals, inner[2], inner[0], outer[0], outer[2], displayColor);
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    
    return new THREE.Mesh(geometry, material);
  }

  private addTriangle(
    positions: number[],
    colors: number[],
    normals: number[],
    v1: THREE.Vector3,
    v2: THREE.Vector3,
    v3: THREE.Vector3,
    color: THREE.Color,
    outward: boolean
  ): void {
    positions.push(v1.x, v1.y, v1.z);
    positions.push(v2.x, v2.y, v2.z);
    positions.push(v3.x, v3.y, v3.z);
    
    colors.push(color.r, color.g, color.b);
    colors.push(color.r, color.g, color.b);
    colors.push(color.r, color.g, color.b);
    
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    if (!outward) normal.negate();
    
    normals.push(normal.x, normal.y, normal.z);
    normals.push(normal.x, normal.y, normal.z);
    normals.push(normal.x, normal.y, normal.z);
  }

  private addQuad(
    positions: number[],
    colors: number[],
    normals: number[],
    v1: THREE.Vector3,
    v2: THREE.Vector3,
    v3: THREE.Vector3,
    v4: THREE.Vector3,
    color: THREE.Color
  ): void {
    // Two triangles
    this.addTriangle(positions, colors, normals, v1, v2, v3, color, true);
    this.addTriangle(positions, colors, normals, v1, v3, v4, color, true);
  }

  /**
   * Dispose of resources.
   */
  public dispose(): void {
    if (this.surfaceMesh) {
      this.scene.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
      (this.surfaceMesh.material as THREE.Material).dispose();
    }
  }
}
