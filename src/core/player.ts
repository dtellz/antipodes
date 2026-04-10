import * as THREE from 'three';

export interface PlayerConfig {
  moveSpeed: number;
  jumpForce: number;
  gravity: number;
  height: number;
  radius: number;
}

const DEFAULT_CONFIG: PlayerConfig = {
  moveSpeed: 0.5,
  jumpForce: 0.8,
  gravity: 2.5,
  height: 0.08,
  radius: 0.03,
};

// Debug logging - set to false to disable
const DEBUG_MOVEMENT = true;
function logMovement(...args: unknown[]): void {
  if (DEBUG_MOVEMENT) {
    console.log('[Player]', ...args);
  }
}

/**
 * First-person player with spherical gravity (always pulled toward world center).
 */
export class Player {
  public position: THREE.Vector3;
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public camera: THREE.PerspectiveCamera;
  
  private config: PlayerConfig;
  private isGrounded: boolean = false;
  private yaw: number = 0;
  private pitch: number = 0;
  
  // Input state
  private keys: Set<string> = new Set();
  private isPointerLocked: boolean = false;
  
  // Local coordinate frame (relative to planet surface)
  private localUp: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private localForward: THREE.Vector3 = new THREE.Vector3(0, 0, -1);
  private localRight: THREE.Vector3 = new THREE.Vector3(1, 0, 0);

  constructor(
    startPosition: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    config: Partial<PlayerConfig> = {}
  ) {
    this.position = startPosition.clone();
    this.camera = camera;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.setupInputListeners();
    this.updateLocalFrame();
  }

  private setupInputListeners(): void {
    document.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    
    document.addEventListener('mousemove', (e) => {
      if (this.isPointerLocked) {
        this.handleMouseMove(e.movementX, e.movementY);
      }
    });
    
    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement !== null;
    });
    
    document.addEventListener('click', () => {
      if (!this.isPointerLocked) {
        document.body.requestPointerLock();
      }
    });
  }

  private handleMouseMove(dx: number, dy: number): void {
    const sensitivity = 0.002;
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
  }

  /**
   * Update the local coordinate frame based on position.
   * "Up" is always away from the planet center (radial direction).
   * This means gravity always pulls toward center regardless of which
   * hemisphere the player is in.
   */
  private updateLocalFrame(): void {
    // "Up" is always the radial direction (away from center)
    // This naturally handles the antipode - when you cross the center,
    // your "up" flips because your position vector flips
    if (this.position.lengthSq() > 0.0001) {
      this.localUp.copy(this.position).normalize();
    }
    
    // Maintain forward direction tangent to sphere
    // Use world up as reference, but handle poles
    const worldUp = new THREE.Vector3(0, 1, 0);
    if (Math.abs(this.localUp.dot(worldUp)) > 0.99) {
      worldUp.set(1, 0, 0);
    }
    
    this.localRight.crossVectors(worldUp, this.localUp).normalize();
    this.localForward.crossVectors(this.localUp, this.localRight).normalize();
  }

  /**
   * Get the direction the player is looking.
   */
  public getLookDirection(): THREE.Vector3 {
    // Rotate forward by yaw around local up
    const rotatedForward = this.localForward.clone()
      .applyAxisAngle(this.localUp, this.yaw);
    
    // Rotate by pitch around local right (after yaw)
    const rotatedRight = this.localRight.clone()
      .applyAxisAngle(this.localUp, this.yaw);
    
    return rotatedForward.applyAxisAngle(rotatedRight, this.pitch).normalize();
  }

  /**
   * Update player physics and position.
   * @param checkCollision Function that returns true if position is blocked by a voxel
   */
  public update(
    deltaTime: number, 
    getGroundHeight: (pos: THREE.Vector3) => number,
    checkCollision?: (pos: THREE.Vector3) => boolean
  ): void {
    this.updateLocalFrame();
    
    const oldPosition = this.position.clone();
    
    // Get movement input
    const moveDir = new THREE.Vector3();
    
    if (this.keys.has('KeyW')) moveDir.add(this.localForward);
    if (this.keys.has('KeyS')) moveDir.sub(this.localForward);
    if (this.keys.has('KeyA')) moveDir.sub(this.localRight);
    if (this.keys.has('KeyD')) moveDir.add(this.localRight);
    
    // Apply yaw rotation to movement
    if (moveDir.lengthSq() > 0) {
      moveDir.applyAxisAngle(this.localUp, this.yaw);
      moveDir.normalize();
    }
    
    // Try horizontal movement
    const moveVelocity = moveDir.multiplyScalar(this.config.moveSpeed * deltaTime);
    const newHorizontalPos = this.position.clone().add(moveVelocity);
    const posBefore = this.position.clone();

    // Check horizontal collision
    const collision = checkCollision ? checkCollision(newHorizontalPos) : false;
    let actuallyMoved = false;
    if (!collision) {
      const distMoved = this.position.distanceTo(newHorizontalPos);
      if (distMoved > 0.0001) {
        this.position.copy(newHorizontalPos);
        actuallyMoved = true;
        logMovement('Moved:', posBefore.toArray().map(v => v.toFixed(3)), '->', this.position.toArray().map(v => v.toFixed(3)));
      }
    } else if (moveDir.lengthSq() > 0) {
      logMovement('BLOCKED by collision at:', newHorizontalPos.toArray().map(v => v.toFixed(3)));
    }

    // CRITICAL: After horizontal movement, re-project player to correct surface height
    // This ensures player stays "on the ground" and doesn't float away
    const currentGroundHeight = getGroundHeight(this.position);

    // Only re-project if: 1) we actually moved, or 2) we're significantly off the surface (prevents drift)
    const currentDist = this.position.length();
    const targetHeight = currentGroundHeight > 0 ? currentGroundHeight + this.config.height : currentDist;
    const heightError = Math.abs(currentDist - targetHeight);
    const needsReprojection = actuallyMoved || heightError > 0.01; // Only reproject if moved or significantly off surface

    if (needsReprojection && currentGroundHeight > 0) {
      // Normalize position and set to correct radius
      this.position.normalize().multiplyScalar(targetHeight);
      if (actuallyMoved) {
        logMovement('Moved & re-projected to height:', targetHeight.toFixed(3));
      }
    }

    // Update local frame after horizontal move (now at correct surface position)
    this.updateLocalFrame();
    
    // Ground check
    const groundHeight = getGroundHeight(this.position);
    const distFromCenter = this.position.length();
    
    // Special case: inside the core cavity (groundHeight == 0 means no ground)
    const inCoreCavity = groundHeight === 0;
    
    if (inCoreCavity) {
      // In the hollow core - floating/falling, no ground to stand on
      this.isGrounded = false;
      logMovement('CORE PHYSICS - dist:', distFromCenter.toFixed(3), 'velocity:', this.velocity.length().toFixed(3));

      // GRAVITY: Always pulls toward the single center point (0,0,0) where the orb is
      const distToCenter = this.position.length();
      const orbGrabRadius = 0.08; // Distance where player can grab orb

      if (distToCenter > 0.0001) {
        // Direction from player TO center (0,0,0)
        const toCenter = this.position.clone().negate();
        const gravityDir = toCenter.normalize();

        // SOFT LANDING ZONE: Near the center, gravity is much weaker
        // This prevents oscillation and lets player stabilize to grab orb
        let gravityStrength = this.config.gravity;

        if (distToCenter < orbGrabRadius) {
          // Within orb grab range - very weak gravity (10% normal)
          // This creates a "floaty" zone where player can hover near center
          gravityStrength = this.config.gravity * 0.1;

          // Also apply drag to slow down any remaining velocity
          this.velocity.multiplyScalar(0.95);
        }

        this.velocity.add(gravityDir.multiplyScalar(gravityStrength * deltaTime));
      } else {
        // Essentially at center - zero out tiny movements
        this.velocity.multiplyScalar(0.9);
      }

      // Apply velocity
      const velocityStep = this.velocity.clone().multiplyScalar(deltaTime);
      this.position.add(velocityStep);

      // Check if we've exited the core on the other side
      const newGroundHeight = getGroundHeight(this.position);
      if (newGroundHeight > 0) {
        // Exited core - check for ground collision
        const newFeetHeight = newGroundHeight + this.config.height;
        if (this.position.length() < newFeetHeight) {
          this.position.normalize().multiplyScalar(newFeetHeight);
          this.velocity.set(0, 0, 0);
          this.isGrounded = true;
        }
      }
    } else {
      // Normal ground physics
      const playerFeetHeight = groundHeight + this.config.height;
      
      // Grounded if within small tolerance of ground
      const groundTolerance = 0.005;
      this.isGrounded = distFromCenter <= playerFeetHeight + groundTolerance;
      
      // Jump
      if (this.keys.has('Space') && this.isGrounded) {
        this.velocity.copy(this.localUp.clone().multiplyScalar(this.config.jumpForce));
        this.isGrounded = false;
      }
      
      // Apply gravity
      if (!this.isGrounded) {
        const gravityDir = this.localUp.clone().negate();
        this.velocity.add(gravityDir.multiplyScalar(this.config.gravity * deltaTime));
        
        // Calculate new position from velocity
        const velocityStep = this.velocity.clone().multiplyScalar(deltaTime);
        const newPos = this.position.clone().add(velocityStep);
        
        // Check collision at new position
        if (checkCollision && checkCollision(newPos)) {
          // Hit a voxel - stop and stay at current position
          this.velocity.set(0, 0, 0);
          this.isGrounded = true;
        } else {
          // Check ground at new position
          const newGroundHeight = getGroundHeight(newPos);
          
          // If entering core cavity, just fall through
          if (newGroundHeight === 0) {
            this.position.copy(newPos);
          } else {
            const newFeetHeight = newGroundHeight + this.config.height;
            const newDist = newPos.length();
            
            if (newDist < newFeetHeight) {
              // Would go below ground - snap to ground
              this.position.normalize().multiplyScalar(newFeetHeight);
              this.velocity.set(0, 0, 0);
              this.isGrounded = true;
            } else {
              // Free fall
              this.position.copy(newPos);
            }
          }
        }
      } else {
        // On ground - clear velocity
        this.velocity.set(0, 0, 0);
        
        // Snap to ground surface
        this.position.normalize().multiplyScalar(playerFeetHeight);
      }
    }
    
    // Final collision check - revert if stuck in voxel
    if (checkCollision && checkCollision(this.position)) {
      this.position.copy(oldPosition);
      this.velocity.set(0, 0, 0);
    }
    
    // Update camera
    this.updateCamera();
  }
  
  /**
   * Check if player is inside the hollow core cavity.
   */
  public isInCore(coreRadius: number): boolean {
    return this.position.length() < coreRadius;
  }

  private updateCamera(): void {
    // Position camera at player head
    const headOffset = this.localUp.clone().multiplyScalar(this.config.height * 0.8);
    this.camera.position.copy(this.position).add(headOffset);
    
    // Look direction
    const lookDir = this.getLookDirection();
    const lookTarget = this.camera.position.clone().add(lookDir);
    
    // Set camera orientation
    this.camera.up.copy(this.localUp);
    this.camera.lookAt(lookTarget);
  }

  public getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  public isOnGround(): boolean {
    return this.isGrounded;
  }
}
