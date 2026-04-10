import * as THREE from 'three';

export interface PlayerConfig {
  moveSpeed: number;
  jumpForce: number;
  gravity: number;
  height: number;
  radius: number;
  maxFallSpeed: number;
}

const DEFAULT_CONFIG: PlayerConfig = {
  moveSpeed: 0.4,
  jumpForce: 0.55,
  gravity: 4.5,
  height: 0.08,
  radius: 0.03,
  maxFallSpeed: 2.0,
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
    this.updateLocalFrame();

    const oldPosition = this.position.clone();

    // --- HORIZONTAL MOVEMENT (great-circle rotation) ---
    const moveDir = new THREE.Vector3();

    if (this.keys.has('KeyW')) moveDir.add(this.lookForward);
    if (this.keys.has('KeyS')) moveDir.sub(this.lookForward);
    if (this.keys.has('KeyA')) moveDir.sub(this.localRight);
    if (this.keys.has('KeyD')) moveDir.add(this.localRight);

    // Reduce air control when airborne
    const airControl = this.isGrounded ? 1.0 : 0.45;
    const moveDistance = moveDir.lengthSq() > 0.0001
      ? this.config.moveSpeed * airControl * deltaTime
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
    const radialSpeed = this.velocity.dot(this.localUp);
    this.velocity.copy(this.localUp).multiplyScalar(radialSpeed);

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
   * Physics for on/above the planet surface (normal gravity).
   */
  private handleSurfacePhysics(
    deltaTime: number,
    groundHeight: number,
    distFromCenter: number,
    getGroundHeight: (pos: THREE.Vector3) => number,
    checkCollision?: (pos: THREE.Vector3) => boolean
  ): void {
    const playerFeetHeight = groundHeight + this.config.height;
    const groundTolerance = 0.005;
    this.isGrounded = distFromCenter <= playerFeetHeight + groundTolerance;

    // Jump
    if (this.keys.has('Space') && this.isGrounded) {
      this.velocity.copy(this.localUp.clone().multiplyScalar(this.config.jumpForce));
      this.isGrounded = false;
    }

    if (!this.isGrounded) {
      // Gravity (always toward center)
      const gravityDir = this.localUp.clone().negate();
      this.velocity.add(gravityDir.multiplyScalar(this.config.gravity * deltaTime));

      // Air resistance
      this.velocity.multiplyScalar(1 - 1.0 * deltaTime);

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
  }

  // ---------------------------------------------------------------------------
  // Third-person camera
  // ---------------------------------------------------------------------------

  private updateCamera(deltaTime: number): void {
    // Reference: player's mid-body
    const playerCenter = this.position.clone()
      .sub(this.localUp.clone().multiplyScalar(this.config.height * 0.4));

    // Camera arm: behind the player, angled by pitch
    const behind = this.lookForward.clone().negate().multiplyScalar(this.camArmLength);
    const up = this.localUp.clone().multiplyScalar(this.camArmHeight);
    const right = this.localRight.clone().multiplyScalar(this.camRightOffset);

    // Pitch tilts the arm vertically
    const pitchUp = this.localUp.clone()
      .multiplyScalar(Math.sin(-this.pitch * 0.5) * this.camArmLength * 0.5);

    const targetCamPos = playerCenter.clone().add(behind).add(up).add(right).add(pitchUp);

    // Prevent camera from going below the planet surface
    const minRadius = this.position.length() + 0.02;
    if (targetCamPos.length() < minRadius) {
      targetCamPos.normalize().multiplyScalar(minRadius);
    }

    // Smooth follow (frame-rate independent)
    const smooth = 1 - Math.exp(-12 * deltaTime);
    this.camera.position.lerp(targetCamPos, smooth);

    // Look-at: a point ahead of the player in the look direction
    const lookDir = this.getLookDirection();
    const lookAtPoint = playerCenter.clone()
      .add(lookDir.clone().multiplyScalar(0.12));

    this.camera.up.copy(this.localUp);
    this.camera.lookAt(lookAtPoint);
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
