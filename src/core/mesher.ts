import * as THREE from 'three';
import { GeodesicMesh } from './geodesic';
import { RadialGeodesicEngine } from './engine';
import { WorldManager } from './world_manager';

export interface VoxelFace {
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  normal: THREE.Vector3;
  materialType: string;
}

/**
 * Utility to handle adjacency and meshing for the geodesic grid.
 */
export class GeodesicMesher {
  constructor(
    private engine: RadialGeodesicEngine,
    private worldManager: WorldManager
  ) {}

  /**
   * Generates a mesh by culling internal faces and batching by material.
   */
  public generateMeshes(): Map<string, THREE.Mesh> {
    const allVoxels = this.worldManager.getAllVoxels();
    const visibleFaces: Map<string, VoxelFace[]> = new Map();

    for (const [key, data] of allVoxels.entries()) {
      const parts = key.split('-');
      const r = parseInt(parts[0], 10);
      const cellID = parseInt(parts[1], 10);

      // Get the 6 faces of this voxel frustum
      const faces = this.getVoxelFaces(r, cellID, data.materialType);

      for (const face of faces) {
        if (this.isFaceVisible(r, cellID, face)) {
          if (!visibleFaces.has(data.materialType)) {
            visibleFaces.set(data.materialType, []);
          }
          visibleFaces.get(data.materialType)!.push(face);
        }
      }
    }

    const meshes = new Map<string, THREE.Mesh>();
    for (const [materialType, faces] of visibleFaces.entries()) {
      meshes.set(materialType, this.createBatchMesh(faces));
    }

    return meshes;
  }

  private getVoxelFaces(r: number, cellID: number, materialType: string): VoxelFace[] {
    const { vertices, indices } = this.engine.getVoxelGeometry(r, cellID);
    const faces: VoxelFace[] = [];

    // The engine returns 6 faces via indices (as defined in engine.ts):
    // 0, 2, 1 (Inner base)
    // 3, 4, 5 (Outer top)
    // 0, 1, 4, 0, 4, 3 (Side 1)
    // 1, 2, 5, 1, 5, 4 (Side 2)
    // 2, 0, 3, 2, 3, 5 (Side 3)

    const faceIndices = [
      [0, 2, 1], // Inner base
      [3, 4, 5], // Outer top
      [0, 1, 4], [0, 4, 3], // Side 1
      [1, 2, 5], [1, 5, 4], // Side 2
      [2, 0, 3], [2, 3, 5]  // Side 3
    ];

    for (const idx of faceIndices) {
      const v = [
        vertices[idx[0]],
        vertices[idx[1]],
        vertices[idx[2]]
      ];
      
      // Calculate normal
      const edge1 = new THREE.Vector3().subVectors(v[1], v[0]);
      const edge2 = new THREE.Vector3().subVectors(v[2], v[0]);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      faces.push({ vertices: [v[0], v[1], v[2]], normal, materialType });
    }

    return faces;
  }

  private isFaceVisible(r: number, cellID: number, face: VoxelFace): boolean {
    // 1. Check Radial Adjacency (Inner/Outer faces)
    const centerDir = face.vertices[0].clone().normalize();
    const dotCenter = face.normal.dot(centerDir);

    if (Math.abs(dotCenter + 1) < 0.1) { // Facing towards center (Inner base)
      const neighborData = this.worldManager.getVoxel(r - 1, cellID);
      if (neighborData && neighborData.materialType === face.materialType) return false;
    } else if (Math.abs(dotCenter - 1) < 0.1) { // Facing away from center (Outer top)
      const neighborData = this.worldManager.getVoxel(r + 1, cellID);
      if (neighborData && neighborData.materialType === face.materialType) return false;
    }

    // 2. Check Surface Adjacency (Side faces)
    // For side faces, the normal is perpendicular to the radial direction.
    if (Math.abs(dotCenter) < 0.1) {
      // This is a side face. We need to find which neighbor shares this edge.
      // To keep it simple for now, we'll skip surface culling or implement a basic version.
      // A full implementation requires mapping edges to cellIDs.
    }

    return true;
  }

  private createBatchMesh(faces: VoxelFace[]): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const baseIdx = i * 3;
      
      positions.push(face.vertices[0].x, face.vertices[0].y, face.vertices[0].z);
      positions.push(face.vertices[1].x, face.vertices[1].y, face.vertices[1].z);
      positions.push(face.vertices[2].x, face.vertices[2].y, face.vertices[2].z);

      normals.push(face.normal.x, face.normal.y, face.normal.z);
      normals.push(face.normal.x, face.normal.y, face.normal.z);
      normals.push(face.normal.x, face.normal.y, face.normal.z);

      indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);

    return new THREE.Mesh(geometry);
  }
}
