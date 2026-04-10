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

/**
 * First-person player with spherical gravity (always pulled toward world center).
 *
 * Orientation strategy: instead of storing a scalar yaw relative to an
 * arbitrary worldUp-based reference frame (which has a singularity at the
 * poles and drifts as the player moves on the sphere), we store `lookForward`
 * as a world-space 3D vector that is always tangent to the sphere surface.
 *
 * Each frame, `updateLocalFrame()` parallel-transports `lookForward` onto the
 * new tangent plane at the player's updated position.  This means:
 *   - No reference to worldUp → no pole singularity / 180° flips.
 *   - Heading is preserved as the player walks → no curved-movement drift.
 */
export class Player {
  public position: THREE.Vector3;
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public camera: THREE.PerspectiveCamera;

  private config: PlayerConfig;
  private isGrounded: boolean = false;
  private pitch: number = 0;

  // Input state
  private keys: Set<string> = new Set();
  private isPointerLocked: boolean = false;

  // Local coordinate frame (relative to planet surface).
  // lookForward is the canonical facing direction; localRight is derived from it.
  // Neither depends on a fixed worldUp vector.
  private localUp: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private lookForward: THREE.Vector3 = new THREE.Vector3(0, 0, -1);
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
    // Yaw: rotate lookForward around the local up axis (no worldUp needed).
    this.lookForward.applyAxisAngle(this.localUp, -dx * sensitivity);
    this.lookForward.normalize();
    this.pitch -= dy * sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
  }

  /**
   * Update the local coordinate frame based on position using parallel transport.
   *
   * "Up" is always the radial direction (away from center).  `lookForward` is
   * projected onto the new tangent plane so the player's facing direction is
   * preserved without any worldUp reference.  This avoids the pole singularity
   * that the old fixed-worldUp approach had.
   */
  private updateLocalFrame(): void {
    if (this.position.lengthSq() < 0.0001) return;

    const targetUp = this.position.clone().normalize();

    // Outside the core snap localUp instantly.  Inside the core (near center),
    // blend gradually: a position of 0.05 units causes the same angular change
    // as a large movement at the surface, which would spin the camera wildly.
    // Smoothing limits the per-frame rotation to a visually stable amount.
    const dist = this.position.length();
    const smoothRadius = 0.25; // blend below this radius
    if (dist < smoothRadius) {
      // Blend factor: ~6% at center, ~40% at the edge of the smooth zone.
      const blend = Math.max(0.06, (dist / smoothRadius) * 0.4);
      this.localUp.lerp(targetUp, blend).normalize();
    } else {
      this.localUp.copy(targetUp);
    }

    // Parallel-transport lookForward onto the (updated) tangent plane.
    const upDot = this.lookForward.dot(this.localUp);
    this.lookForward.sub(this.localUp.clone().multiplyScalar(upDot));

    if (this.lookForward.lengthSq() > 0.0001) {
      this.lookForward.normalize();
    } else {
      // Degenerate: lookForward was almost parallel to up.
      const fallback = Math.abs(this.localUp.x) < 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
      this.lookForward.crossVectors(this.localUp, fallback).normalize();
    }

    // right = forward × up  (right-hand rule keeps it consistent)
    this.localRight.crossVectors(this.lookForward, this.localUp).normalize();
  }

  /**
   * Get the direction the player is looking (includes pitch).
   */
  public getLookDirection(): THREE.Vector3 {
    return this.lookForward.clone()
      .applyAxisAngle(this.localRight, this.pitch)
      .normalize();
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
    // Parallel-transport lookForward to current position before doing anything.
    this.updateLocalFrame();

    const oldPosition = this.position.clone();

    // --- HORIZONTAL MOVEMENT ---
    // lookForward and localRight are already in the tangent plane — no extra
    // yaw rotation needed.
    const moveDir = new THREE.Vector3();

    if (this.keys.has('KeyW')) moveDir.add(this.lookForward);
    if (this.keys.has('KeyS')) moveDir.sub(this.lookForward);
    if (this.keys.has('KeyA')) moveDir.sub(this.localRight);
    if (this.keys.has('KeyD')) moveDir.add(this.localRight);

    const moveDistance = moveDir.lengthSq() > 0.0001
      ? this.config.moveSpeed * deltaTime
      : 0;

    if (moveDistance > 0) {
      const tangentDir = moveDir.normalize();
      const currentRadius = this.position.length();

      // Rotate position around the axis perpendicular to both position and
      // movement direction.  This moves the player along a great circle and
      // always preserves their distance from the center.
      const rotationAxis = new THREE.Vector3()
        .crossVectors(this.position, tangentDir)
        .normalize();

      if (rotationAxis.lengthSq() > 0.0001) {
        const rotationAngle = moveDistance / currentRadius;
        const newPos = this.position.clone().applyAxisAngle(rotationAxis, rotationAngle);
        // Re-normalize after rotation to prevent floating-point radius drift.
        newPos.normalize().multiplyScalar(currentRadius);

        const collision = checkCollision ? checkCollision(newPos) : false;
        if (!collision) {
          this.position.copy(newPos);
        }
      }
    }

    // Auto-step: small height adjustments when grounded (terrain following).
    const currentGroundHeight = getGroundHeight(this.position);
    const currentDist = this.position.length();
    const targetHeight = currentGroundHeight > 0
      ? currentGroundHeight + this.config.height
      : currentDist;
    const heightError = Math.abs(currentDist - targetHeight);
    const stepHeight = 0.02;

    if (currentGroundHeight > 0 && heightError > 0.001 && heightError <= stepHeight) {
      this.position.normalize().multiplyScalar(targetHeight);
    }

    // Update frame after horizontal move so vertical physics uses correct up.
    this.updateLocalFrame();

    // --- VERTICAL PHYSICS ---
    const groundHeight = getGroundHeight(this.position);
    const distFromCenter = this.position.length();
    const inCoreCavity = groundHeight === 0;

    if (inCoreCavity) {
      // Inside the hollow core — spherical gravity toward center.
      this.isGrounded = false;
      const distToCenter = this.position.length();
      const orbGrabRadius = 0.08;

      if (distToCenter > 0.0001) {
        const gravityDir = this.position.clone().negate().normalize();
        let gravityStrength = this.config.gravity;

        if (distToCenter < orbGrabRadius) {
          gravityStrength = this.config.gravity * 0.1;
          this.velocity.multiplyScalar(0.95);
        }

        this.velocity.add(gravityDir.multiplyScalar(gravityStrength * deltaTime));
      } else {
        this.velocity.multiplyScalar(0.9);
      }

      const velocityStep = this.velocity.clone().multiplyScalar(deltaTime);
      const tentativePos = this.position.clone().add(velocityStep);

      // Pre-check: if the next step would embed us in a voxel wall, stop
      // before moving.  Without this, the end-of-frame collision revert would
      // zero velocity and re-accelerate the player into the same wall each
      // frame, trapping them.
      if (checkCollision && checkCollision(tentativePos)) {
        this.velocity.set(0, 0, 0);
      } else {
        this.position.copy(tentativePos);

        // Check if we've exited the core on the other side.
        const newGroundHeight = getGroundHeight(this.position);
        if (newGroundHeight > 0) {
          const newFeetHeight = newGroundHeight + this.config.height;
          if (this.position.length() < newFeetHeight) {
            this.position.normalize().multiplyScalar(newFeetHeight);
            this.velocity.set(0, 0, 0);
            this.isGrounded = true;
          }
        }
      }
    } else {
      // Normal ground physics.
      const playerFeetHeight = groundHeight + this.config.height;
      const groundTolerance = 0.005;
      this.isGrounded = distFromCenter <= playerFeetHeight + groundTolerance;

      if (this.keys.has('Space') && this.isGrounded) {
        this.velocity.copy(this.localUp.clone().multiplyScalar(this.config.jumpForce));
        this.isGrounded = false;
      }

      if (!this.isGrounded) {
        const gravityDir = this.localUp.clone().negate();
        this.velocity.add(gravityDir.multiplyScalar(this.config.gravity * deltaTime));

        const velocityStep = this.velocity.clone().multiplyScalar(deltaTime);
        const newPos = this.position.clone().add(velocityStep);

        if (checkCollision && checkCollision(newPos)) {
          this.velocity.set(0, 0, 0);
          this.isGrounded = true;
        } else {
          const newGroundHeight = getGroundHeight(newPos);

          if (newGroundHeight === 0) {
            this.position.copy(newPos);
          } else {
            const newFeetHeight = newGroundHeight + this.config.height;
            const newDist = newPos.length();

            if (newDist < newFeetHeight) {
              this.position.normalize().multiplyScalar(newFeetHeight);
              this.velocity.set(0, 0, 0);
              this.isGrounded = true;
            } else {
              this.position.copy(newPos);
            }
          }
        }
      } else {
        this.velocity.set(0, 0, 0);
        this.position.normalize().multiplyScalar(playerFeetHeight);
      }
    }

    // Final safety: if we somehow ended up inside a voxel, revert.
    if (checkCollision && checkCollision(this.position)) {
      this.position.copy(oldPosition);
      this.velocity.set(0, 0, 0);
    }

    this.updateCamera();
  }

  /**
   * Check if player is inside the hollow core cavity.
   */
  public isInCore(coreRadius: number): boolean {
    return this.position.length() < coreRadius;
  }

  private updateCamera(): void {
    const headOffset = this.localUp.clone().multiplyScalar(this.config.height * 0.8);
    this.camera.position.copy(this.position).add(headOffset);

    const lookDir = this.getLookDirection();
    const lookTarget = this.camera.position.clone().add(lookDir);

    this.camera.up.copy(this.localUp);
    this.camera.lookAt(lookTarget);
  }

  public getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  public isOnGround(): boolean {
    return this.isGrounded;
  }

  public simulateKeyDown(code: string): void {
    this.keys.add(code);
  }

  public simulateKeyUp(code: string): void {
    this.keys.delete(code);
  }

  /**
   * Rotate facing direction for mobile touch look controls.
   */
  public rotateYawPitch(yawDelta: number, pitchDelta: number): void {
    this.lookForward.applyAxisAngle(this.localUp, yawDelta);
    this.lookForward.normalize();
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch + pitchDelta));
  }
}
