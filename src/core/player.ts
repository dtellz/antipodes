import * as THREE from 'three';

export interface PlayerConfig {
  moveSpeed: number;
  sprintMultiplier: number;
  jumpForce: number;
  doubleJumpForce: number;
  gravity: number;
  height: number;
  radius: number;
  maxFallSpeed: number;
}

const DEFAULT_CONFIG: PlayerConfig = {
  moveSpeed: 0.55,
  sprintMultiplier: 1.6,
  jumpForce: 0.85,
  doubleJumpForce: 0.72,
  gravity: 3.6,
  height: 0.08,
  radius: 0.03,
  maxFallSpeed: 2.8,
};

/**
 * Third-person player with spherical gravity (always pulled toward world center).
 *
 * Orientation strategy: `lookForward` is a world-space 3D vector that is always
 * tangent to the sphere surface.  Each frame, `updateLocalFrame()` parallel-
 * transports it onto the new tangent plane so the heading is preserved without
 * any worldUp singularity.
 */
export class Player {
  public position: THREE.Vector3;
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public camera: THREE.PerspectiveCamera;

  private config: PlayerConfig;
  private scene: THREE.Scene;
  private isGrounded: boolean = false;
  private pitch: number = 0;

  // Input state
  private keys: Set<string> = new Set();
  private isPointerLocked: boolean = false;

  // --- Platformer jump state ---
  private hasDoubleJumped: boolean = false;
  private coyoteTimer: number = 0;
  private jumpBufferTimer: number = 0;
  private jumpHeld: boolean = false;
  private wasGrounded: boolean = false;
  private landingSquash: number = 0;          // 0..1 visual squash on landing
  private airTime: number = 0;                // time spent in the air (for landing impact)

  // Jump tuning constants
  private readonly coyoteTime = 0.12;         // grace period after leaving edge
  private readonly jumpBufferTime = 0.15;     // pre-land jump input window
  private readonly fallGravityMul = 1.7;      // snappier descent
  private readonly apexGravityMul = 0.55;     // hang time near peak
  private readonly apexSpeedThreshold = 0.18; // radial speed threshold for apex zone

  // Local coordinate frame (parallel-transported, no worldUp dependency).
  private localUp: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private lookForward: THREE.Vector3 = new THREE.Vector3(0, 0, -1);
  private localRight: THREE.Vector3 = new THREE.Vector3(1, 0, 0);

  // Visual model
  private playerModel: THREE.Group;

  // Third-person camera
  private readonly camArmLength = 0.22;
  private readonly camArmHeight = 0.12;
  private readonly camRightOffset = 0.05;
  private currentArmLength: number = 0.22;    // smoothed arm length for caves
  private currentArmHeight: number = 0.12;    // smoothed arm height for caves

  // Stored collision check for camera occlusion resolution
  private checkCollisionFn?: (pos: THREE.Vector3) => boolean;

  constructor(
    startPosition: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    config: Partial<PlayerConfig> = {}
  ) {
    this.position = startPosition.clone();
    this.camera = camera;
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.playerModel = this.createPlayerModel();
    this.setupInputListeners();
    this.updateLocalFrame();
    this.updatePlayerModel();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private setupInputListeners(): void {
    document.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.jumpBufferTimer = this.jumpBufferTime;
        this.jumpHeld = true;
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') {
        this.jumpHeld = false;
      }
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
    this.lookForward.applyAxisAngle(this.localUp, -dx * sensitivity);
    this.lookForward.normalize();
    this.pitch -= dy * sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
  }

  // ---------------------------------------------------------------------------
  // Local frame (parallel-transport)
  // ---------------------------------------------------------------------------

  private updateLocalFrame(): void {
    if (this.position.lengthSq() < 0.0001) return;

    const targetUp = this.position.clone().normalize();

    const dist = this.position.length();
    const smoothRadius = 0.25;
    if (dist < smoothRadius) {
      const blend = Math.max(0.06, (dist / smoothRadius) * 0.4);
      this.localUp.lerp(targetUp, blend).normalize();
    } else {
      this.localUp.copy(targetUp);
    }

    // Parallel-transport lookForward onto tangent plane.
    const upDot = this.lookForward.dot(this.localUp);
    this.lookForward.sub(this.localUp.clone().multiplyScalar(upDot));

    if (this.lookForward.lengthSq() > 0.0001) {
      this.lookForward.normalize();
    } else {
      const fallback = Math.abs(this.localUp.x) < 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
      this.lookForward.crossVectors(this.localUp, fallback).normalize();
    }

    this.localRight.crossVectors(this.lookForward, this.localUp).normalize();
  }

  // ---------------------------------------------------------------------------
  // Look direction helpers
  // ---------------------------------------------------------------------------

  public getLookDirection(): THREE.Vector3 {
    return this.lookForward.clone()
      .applyAxisAngle(this.localRight, this.pitch)
      .normalize();
  }

  /**
   * Eye position for digging raycast (near the player's head).
   */
  public getEyePosition(): THREE.Vector3 {
    return this.position.clone()
      .sub(this.localUp.clone().multiplyScalar(this.config.height * 0.15));
  }

  // ---------------------------------------------------------------------------
  // Physics update
  // ---------------------------------------------------------------------------

  public update(
    deltaTime: number,
    getGroundHeight: (pos: THREE.Vector3) => number,
    checkCollision?: (pos: THREE.Vector3) => boolean
  ): void {
    this.checkCollisionFn = checkCollision;
    this.updateLocalFrame();

    // --- Tick jump timers ---
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - deltaTime);
    if (this.isGrounded) {
      this.coyoteTimer = this.coyoteTime;
      this.airTime = 0;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - deltaTime);
      this.airTime += deltaTime;
    }

    const oldPosition = this.position.clone();

    // --- HORIZONTAL MOVEMENT (great-circle rotation) ---
    const moveDir = new THREE.Vector3();

    if (this.keys.has('KeyW')) moveDir.add(this.lookForward);
    if (this.keys.has('KeyS')) moveDir.sub(this.lookForward);
    if (this.keys.has('KeyA')) moveDir.sub(this.localRight);
    if (this.keys.has('KeyD')) moveDir.add(this.localRight);

    const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const sprintMul = sprinting && this.isGrounded ? this.config.sprintMultiplier : 1.0;

    // Air control: 80% (responsive in air, full on ground)
    const airControl = this.isGrounded ? 1.0 : 0.80;
    const moveDistance = moveDir.lengthSq() > 0.0001
      ? this.config.moveSpeed * sprintMul * airControl * deltaTime
      : 0;

    if (moveDistance > 0) {
      const tangentDir = moveDir.normalize();
      const currentRadius = this.position.length();

      const rotationAxis = new THREE.Vector3()
        .crossVectors(this.position, tangentDir)
        .normalize();

      if (rotationAxis.lengthSq() > 0.0001) {
        const rotationAngle = moveDistance / currentRadius;
        const newPos = this.position.clone().applyAxisAngle(rotationAxis, rotationAngle);
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
    const stepHeight = 0.025;

    if (currentGroundHeight > 0 && heightError > 0.001 && heightError <= stepHeight) {
      this.position.normalize().multiplyScalar(targetHeight);
    }

    // Update frame after horizontal move so vertical physics uses correct up.
    this.updateLocalFrame();

    // --- Keep velocity radial (prevent tangential drift on curved surface) ---
    // Use position directly so gravity is always one direction: from center outward
    const outward = this.position.clone().normalize();
    const radialSpeed = this.velocity.dot(outward);
    this.velocity.copy(outward).multiplyScalar(radialSpeed);

    // --- VERTICAL PHYSICS ---
    const groundHeight = getGroundHeight(this.position);
    const distFromCenter = this.position.length();
    const inCoreCavity = groundHeight === 0;

    if (inCoreCavity) {
      this.handleCorePhysics(deltaTime, getGroundHeight, checkCollision);
    } else {
      this.handleSurfacePhysics(deltaTime, groundHeight, distFromCenter, getGroundHeight, checkCollision);
    }

    // Final safety: if embedded in voxel, revert.
    if (checkCollision && checkCollision(this.position)) {
      this.position.copy(oldPosition);
      this.velocity.set(0, 0, 0);
    }

    // --- Landing squash decay ---
    this.landingSquash *= Math.max(0, 1 - 8 * deltaTime);
    if (this.landingSquash < 0.01) this.landingSquash = 0;

    this.wasGrounded = this.isGrounded;
    this.updatePlayerModel();
    this.updateCamera(deltaTime);
  }

  /**
   * Physics for inside the hollow core (floating, spherical gravity toward center).
   */
  private handleCorePhysics(
    deltaTime: number,
    getGroundHeight: (pos: THREE.Vector3) => number,
    checkCollision?: (pos: THREE.Vector3) => boolean
  ): void {
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

    // Air resistance in core
    this.velocity.multiplyScalar(1 - 1.5 * deltaTime);

    // Cap speed
    if (this.velocity.length() > this.config.maxFallSpeed) {
      this.velocity.normalize().multiplyScalar(this.config.maxFallSpeed);
    }

    const velocityStep = this.velocity.clone().multiplyScalar(deltaTime);
    const tentativePos = this.position.clone().add(velocityStep);

    if (checkCollision && checkCollision(tentativePos)) {
      this.velocity.set(0, 0, 0);
    } else {
      this.position.copy(tentativePos);

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
  }

  /**
   * Attempt a jump. Returns true if a jump was executed.
   * Handles grounded jump, coyote jump, and double jump.
   */
  private tryJump(): boolean {
    // Gravity direction: always radially outward from world center
    const outward = this.position.clone().normalize();

    // Grounded or coyote-time jump
    if (this.isGrounded || this.coyoteTimer > 0) {
      this.velocity.copy(outward.clone().multiplyScalar(this.config.jumpForce));
      // Nudge position outward to cleanly clear the ground tolerance
      this.position.add(outward.clone().multiplyScalar(0.012));
      this.isGrounded = false;
      this.coyoteTimer = 0;
      this.hasDoubleJumped = false;
      this.jumpBufferTimer = 0;
      return true;
    }

    // Double jump (only once per airborne period)
    if (!this.hasDoubleJumped) {
      // Kill any downward velocity first, then apply double jump force
      const radialSpeed = this.velocity.dot(outward);
      if (radialSpeed < 0) {
        this.velocity.sub(outward.clone().multiplyScalar(radialSpeed));
      }
      this.velocity.add(outward.clone().multiplyScalar(this.config.doubleJumpForce));
      this.hasDoubleJumped = true;
      this.jumpBufferTimer = 0;
      return true;
    }

    return false;
  }

  /**
   * Physics for on/above the planet surface (normal gravity).
   * Features: coyote time, jump buffering, double jump, asymmetric gravity.
   */
  private handleSurfacePhysics(
    deltaTime: number,
    groundHeight: number,
    distFromCenter: number,
    getGroundHeight: (pos: THREE.Vector3) => number,
    checkCollision?: (pos: THREE.Vector3) => boolean
  ): void {
    const playerFeetHeight = groundHeight + this.config.height;
    const groundTolerance = 0.008;
    this.isGrounded = distFromCenter <= playerFeetHeight + groundTolerance;

    // --- Landing detection (for squash) ---
    if (this.isGrounded && !this.wasGrounded) {
      this.landingSquash = Math.min(1, this.airTime * 2);
      this.hasDoubleJumped = false;
    }

    // --- Jump: either from buffer or direct input ---
    if (this.jumpBufferTimer > 0) {
      this.tryJump();
    }

    if (!this.isGrounded) {
      // Gravity direction: always straight toward world center (core orb)
      const outward = this.position.clone().normalize();
      const gravityDir = outward.clone().negate();

      // --- Asymmetric gravity ---
      const radialSpeed = this.velocity.dot(outward);
      let gravMul: number;

      if (radialSpeed < -this.apexSpeedThreshold) {
        // Falling: heavier gravity for snappy descent
        gravMul = this.fallGravityMul;
      } else if (Math.abs(radialSpeed) < this.apexSpeedThreshold) {
        // Apex: lighter gravity for hang time
        gravMul = this.apexGravityMul;
      } else {
        // Rising: normal gravity
        gravMul = 1.0;
      }

      this.velocity.add(gravityDir.multiplyScalar(this.config.gravity * gravMul * deltaTime));

      // Light air resistance
      this.velocity.multiplyScalar(1 - 0.5 * deltaTime);

      // Cap fall speed
      if (this.velocity.length() > this.config.maxFallSpeed) {
        this.velocity.normalize().multiplyScalar(this.config.maxFallSpeed);
      }

      const velocityStep = this.velocity.clone().multiplyScalar(deltaTime);
      const newPos = this.position.clone().add(velocityStep);

      if (checkCollision && checkCollision(newPos)) {
        this.velocity.set(0, 0, 0);
        this.isGrounded = true;
      } else {
        const newGroundHeight = getGroundHeight(newPos);

        if (newGroundHeight === 0) {
          // Falling into the core cavity
          this.position.copy(newPos);
        } else {
          const newFeetHeight = newGroundHeight + this.config.height;
          const newDist = newPos.length();

          if (newDist < newFeetHeight) {
            // Landed
            this.position.normalize().multiplyScalar(newFeetHeight);
            this.velocity.set(0, 0, 0);
            this.isGrounded = true;
          } else {
            this.position.copy(newPos);
          }
        }
      }
    } else {
      // Grounded: zero velocity, snap to surface
      this.velocity.set(0, 0, 0);
      this.position.normalize().multiplyScalar(playerFeetHeight);
    }
  }

  // ---------------------------------------------------------------------------
  // Player model
  // ---------------------------------------------------------------------------

  private createPlayerModel(): THREE.Group {
    const model = new THREE.Group();

    // --- Head ---
    const headGeom = new THREE.SphereGeometry(0.013, 8, 8);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xFFD5A0 });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 0.068;
    model.add(head);

    // --- Body ---
    const bodyGeom = new THREE.CylinderGeometry(0.012, 0.014, 0.035, 8);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3377CC });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.0375;
    model.add(body);

    // --- Legs ---
    const legGeom = new THREE.CylinderGeometry(0.005, 0.005, 0.02, 6);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x334488 });
    const leftLeg = new THREE.Mesh(legGeom, legMat);
    leftLeg.position.set(-0.007, 0.01, 0);
    model.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeom, legMat);
    rightLeg.position.set(0.007, 0.01, 0);
    model.add(rightLeg);

    // --- Arms ---
    const armGeom = new THREE.CylinderGeometry(0.004, 0.004, 0.025, 6);
    const leftArm = new THREE.Mesh(armGeom, bodyMat);
    leftArm.position.set(-0.017, 0.04, 0);
    leftArm.rotation.z = 0.2;
    model.add(leftArm);
    const rightArm = new THREE.Mesh(armGeom, bodyMat);
    rightArm.position.set(0.017, 0.04, 0);
    rightArm.rotation.z = -0.2;
    model.add(rightArm);

    // --- Backpack (shows facing direction) ---
    const bpGeom = new THREE.BoxGeometry(0.010, 0.012, 0.006);
    const bpMat = new THREE.MeshLambertMaterial({ color: 0xCC6600 });
    const backpack = new THREE.Mesh(bpGeom, bpMat);
    backpack.position.set(0, 0.042, 0.012);
    model.add(backpack);

    // --- Cannon (held in right hand, pointing forward -Z) ---
    const cannonMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    // Barrel
    const barrelGeom = new THREE.CylinderGeometry(0.003, 0.004, 0.035, 6);
    const barrel = new THREE.Mesh(barrelGeom, cannonMat);
    barrel.rotation.x = Math.PI / 2; // point along -Z
    barrel.position.set(0.019, 0.045, -0.022);
    model.add(barrel);
    // Grip / body
    const gripGeom = new THREE.BoxGeometry(0.006, 0.010, 0.010);
    const grip = new THREE.Mesh(gripGeom, cannonMat);
    grip.position.set(0.019, 0.042, -0.004);
    model.add(grip);

    this.scene.add(model);
    return model;
  }

  private updatePlayerModel(): void {
    // Model origin is at feet; player position is at head level.
    const feetPos = this.position.clone()
      .sub(this.localUp.clone().multiplyScalar(this.config.height));
    this.playerModel.position.copy(feetPos);
    this.playerModel.up.copy(this.localUp);
    this.playerModel.lookAt(feetPos.clone().add(this.lookForward));

    // Landing squash-and-stretch
    if (this.landingSquash > 0.01) {
      const squashY = 1 - this.landingSquash * 0.35;
      const stretchXZ = 1 + this.landingSquash * 0.2;
      this.playerModel.scale.set(stretchXZ, squashY, stretchXZ);
    } else {
      this.playerModel.scale.set(1, 1, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Third-person camera (collision-aware)
  // ---------------------------------------------------------------------------

  private updateCamera(deltaTime: number): void {
    // Reference: player's mid-body
    const playerCenter = this.position.clone()
      .sub(this.localUp.clone().multiplyScalar(this.config.height * 0.4));

    // --- Probe available space to adaptively shorten the camera arm in caves ---
    const targetArm = this.probeArmLength(playerCenter);
    const targetHeight = Math.min(this.camArmHeight, targetArm * 0.6);

    // Smooth arm changes: pull in fast (tight spaces), push out slower (open areas)
    const armSmooth = targetArm < this.currentArmLength
      ? 1 - Math.exp(-18 * deltaTime)   // fast retract
      : 1 - Math.exp(-4 * deltaTime);   // gentle extend
    this.currentArmLength += (targetArm - this.currentArmLength) * armSmooth;
    this.currentArmHeight += (targetHeight - this.currentArmHeight) * armSmooth;

    // --- Compute ideal camera position (behind + above + right) ---
    const behind = this.lookForward.clone().negate().multiplyScalar(this.currentArmLength);
    const up = this.localUp.clone().multiplyScalar(this.currentArmHeight);
    const rightOffset = Math.min(this.camRightOffset, this.currentArmLength * 0.25);
    const right = this.localRight.clone().multiplyScalar(rightOffset);
    const pitchUp = this.localUp.clone()
      .multiplyScalar(Math.sin(-this.pitch * 0.5) * this.currentArmLength * 0.5);

    const idealPos = playerCenter.clone().add(behind).add(up).add(right).add(pitchUp);

    // Prevent camera from going below the planet surface
    const minRadius = this.position.length() + 0.02;
    if (idealPos.length() < minRadius) {
      idealPos.normalize().multiplyScalar(minRadius);
    }

    // --- Final collision check: march from player to ideal and stop before hitting voxels ---
    const clearDist = this.findClearDistance(playerCenter, idealPos);
    const totalDist = playerCenter.distanceTo(idealPos);

    let targetCamPos: THREE.Vector3;

    if (clearDist >= totalDist * 0.95) {
      // Path is clear
      targetCamPos = idealPos;
    } else {
      // Blocked: place camera at clear distance (with small safety margin)
      const dir = idealPos.clone().sub(playerCenter).normalize();
      const safeDist = Math.max(0.04, clearDist - 0.02);
      targetCamPos = playerCenter.clone().add(dir.multiplyScalar(safeDist));
    }

    // --- Smooth follow (frame-rate independent) ---
    // Faster follow when close (cave) for tighter feel, slower when far out
    const camDist = this.camera.position.distanceTo(playerCenter);
    const followSpeed = camDist < this.camArmLength * 0.5 ? 20 : 12;
    const smooth = 1 - Math.exp(-followSpeed * deltaTime);
    this.camera.position.lerp(targetCamPos, smooth);

    // Safety: if camera ended up inside a voxel, snap to player
    if (this.checkCollisionFn && this.checkCollisionFn(this.camera.position)) {
      this.camera.position.copy(
        playerCenter.clone().add(this.localUp.clone().multiplyScalar(0.04))
      );
    }

    // --- Look-at: blend between forward-look and player-centered based on distance ---
    const lookDir = this.getLookDirection();
    const normalLookAt = playerCenter.clone().add(lookDir.clone().multiplyScalar(0.12));
    const closeLookAt = playerCenter.clone();

    const currentCamDist = this.camera.position.distanceTo(playerCenter);
    const closeBlend = Math.max(0, 1 - currentCamDist / (this.camArmLength * 0.4));
    const lookAtPoint = normalLookAt.clone().lerp(closeLookAt, closeBlend);

    // Camera up vector: when looking nearly straight down, switch up hint to
    // lookForward so the view doesn't gimbal-lock.
    const viewDir = lookAtPoint.clone().sub(this.camera.position).normalize();
    const upDotView = Math.abs(viewDir.dot(this.localUp));
    const upBlend = Math.max(0, (upDotView - 0.7) / 0.3);
    const cameraUp = this.localUp.clone()
      .lerp(this.lookForward, upBlend)
      .normalize();

    this.camera.up.copy(cameraUp);
    this.camera.lookAt(lookAtPoint);
  }

  /**
   * Probe multiple directions around the player to find how much arm-length
   * the environment allows. In open areas returns full camArmLength; in caves
   * returns a shorter distance so the camera stays inside the cavity.
   */
  private probeArmLength(playerCenter: THREE.Vector3): number {
    if (!this.checkCollisionFn) return this.camArmLength;

    const maxArm = this.camArmLength;
    const step = 0.02;
    let minClear = maxArm;

    // Probe in several directions: behind, above, behind-above, left, right
    const directions = [
      this.lookForward.clone().negate(),                                      // behind
      this.localUp.clone(),                                                    // above
      this.lookForward.clone().negate().add(this.localUp).normalize(),        // behind-above
      this.localRight.clone(),                                                 // right
      this.localRight.clone().negate(),                                        // left
    ];

    for (const dir of directions) {
      for (let d = step; d <= maxArm; d += step) {
        const testPos = playerCenter.clone().add(dir.clone().multiplyScalar(d));
        if (this.checkCollisionFn(testPos)) {
          minClear = Math.min(minClear, Math.max(0.05, d - step));
          break;
        }
      }
    }

    return minClear;
  }

  /**
   * March from `from` toward `to` in small steps, checking for voxel collisions.
   * Returns the distance along the path where the first collision occurs,
   * or the full distance if the path is entirely clear.
   */
  private findClearDistance(from: THREE.Vector3, to: THREE.Vector3): number {
    const dir = to.clone().sub(from);
    const totalDist = dir.length();
    if (totalDist < 0.001) return totalDist;
    if (!this.checkCollisionFn) return totalDist;

    dir.normalize();
    const step = 0.02;

    for (let d = step; d < totalDist; d += step) {
      const testPos = from.clone().add(dir.clone().multiplyScalar(d));
      if (this.checkCollisionFn(testPos)) {
        return Math.max(0.04, d - step);
      }
    }

    return totalDist;
  }

  // ---------------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------------

  public isInCore(coreRadius: number): boolean {
    return this.position.length() < coreRadius;
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

  public rotateYawPitch(yawDelta: number, pitchDelta: number): void {
    this.lookForward.applyAxisAngle(this.localUp, yawDelta);
    this.lookForward.normalize();
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch + pitchDelta));
  }
}
