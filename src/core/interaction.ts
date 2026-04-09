import * as THREE from 'three';
import { WorldManager } from './world_manager';

export interface VoxelInteractionResult {
  r: number;
  cellID: number;
  point: THREE.Vector3;
  object: THREE.Object3D;
}

/**
 * Handles user interactions like clicking and digging in the 3D world.
 */
export class InteractionManager {
  private raycaster: THREE.Raycaster;

  constructor(private camera: THREE.Camera) {
    this.raycaster = new THREE.Raycaster();
  }

  /**
   * Performs a raycast from the camera through the mouse position.
   * @param mouse Normalized device coordinates (-1 to +1).
   * @param scene The Three.js scene to test against.
   * @returns An interaction result if a voxel was hit, otherwise null.
   */
  public raycast(mouse: THREE.Vector2, scene: THREE.Scene): VoxelInteractionResult | null {
    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(scene.children);

    if (intersects.length > 0) {
      const hit = intersects[0];
      // We expect the voxel metadata to be stored in userData
      const voxelInfo = hit.object.userData.voxelInfo as { r: number; cellID: number } | undefined;

      if (voxelInfo) {
        return {
          r: voxelInfo.r,
          cellID: voxelInfo.cellID,
          point: hit.point,
          object: hit.object
        };
      }
    }

    return null;
  }

  /**
   * Removes a voxel from the world and its corresponding mesh from the scene.
   * @param result The result of a successful raycast.
   * @param worldManager The manager handling voxel storage.
   * @param scene The Three.js scene to remove the object from.
   */
  public dig(result: VoxelInteractionResult, worldManager: WorldManager, scene: THREE.Scene): void {
    // 1. Remove from data storage
    worldManager.removeVoxel(result.r, result.cellID);

    // 2. Remove from visual representation
    scene.remove(result.object);
  }
}
