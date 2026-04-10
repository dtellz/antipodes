import * as THREE from 'three';

/**
 * Simple 3D noise for cave generation
 */
class CaveNoise {
  private seed: number;

  constructor(seed: number = 12345) {
    this.seed = seed;
  }

  private hash(x: number, y: number, z: number): number {
    let h = this.seed + x * 374761393 + y * 668265263 + z * 1274126177;
    h = (h ^ (h >> 13)) * 1274126177;
    return h;
  }

  private smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  public noise3D(x: number, y: number, z: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;

    const sx = this.smoothstep(fx);
    const sy = this.smoothstep(fy);
    const sz = this.smoothstep(fz);

    const n000 = (this.hash(ix, iy, iz) & 0xFFFF) / 0xFFFF;
    const n001 = (this.hash(ix, iy, iz + 1) & 0xFFFF) / 0xFFFF;
    const n010 = (this.hash(ix, iy + 1, iz) & 0xFFFF) / 0xFFFF;
    const n011 = (this.hash(ix, iy + 1, iz + 1) & 0xFFFF) / 0xFFFF;
    const n100 = (this.hash(ix + 1, iy, iz) & 0xFFFF) / 0xFFFF;
    const n101 = (this.hash(ix + 1, iy, iz + 1) & 0xFFFF) / 0xFFFF;
    const n110 = (this.hash(ix + 1, iy + 1, iz) & 0xFFFF) / 0xFFFF;
    const n111 = (this.hash(ix + 1, iy + 1, iz + 1) & 0xFFFF) / 0xFFFF;

    const nx00 = this.lerp(n000, n100, sx);
    const nx01 = this.lerp(n001, n101, sx);
    const nx10 = this.lerp(n010, n110, sx);
    const nx11 = this.lerp(n011, n111, sx);

    const nxy0 = this.lerp(nx00, nx10, sy);
    const nxy1 = this.lerp(nx01, nx11, sy);

    return this.lerp(nxy0, nxy1, sz);
  }

  public fbm(x: number, y: number, z: number, octaves: number = 3): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise3D(x * frequency, y * frequency, z * frequency);
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }

    return value / maxValue;
  }
}

export interface CaveConfig {
  seed: number;
  caveFrequency: number;      // How often caves appear
  caveThreshold: number;      // Noise threshold for cave (lower = more caves)
  minCaveRadius: number;      // Minimum radius where caves can appear
  maxCaveRadius: number;      // Maximum radius where caves can appear
  wormFrequency: number;      // Frequency of worm-like tunnels
  wormThreshold: number;      // Threshold for worm tunnels
}

const DEFAULT_CAVE_CONFIG: CaveConfig = {
  seed: 54321,
  caveFrequency: 3.5,
  caveThreshold: 0.42,
  minCaveRadius: 0.25,
  maxCaveRadius: 0.88,
  wormFrequency: 1.4,
  wormThreshold: 0.18,
};

/**
 * Generates cave systems throughout the planet using 3D noise.
 */
export class CaveGenerator {
  private noise: CaveNoise;
  private wormNoise: CaveNoise;
  private config: CaveConfig;

  constructor(config: Partial<CaveConfig> = {}) {
    this.config = { ...DEFAULT_CAVE_CONFIG, ...config };
    this.noise = new CaveNoise(this.config.seed);
    this.wormNoise = new CaveNoise(this.config.seed + 9999);
  }

  /**
   * Check if a position should be a cave (empty space).
   * Returns true if this position should be carved out.
   *
   * Uses the "worm tunnel" technique: caves form where two independent
   * noise fields both cross 0.5 simultaneously, creating continuous
   * tube-shaped tunnels through 3D space.
   */
  public isCave(position: THREE.Vector3, baseRadius: number): boolean {
    const dist = position.length();
    const normalizedDist = dist / baseRadius;

    // No caves too close to surface or too close to core
    if (normalizedDist > this.config.maxCaveRadius || normalizedDist < this.config.minCaveRadius) {
      return false;
    }

    // Use actual 3D position (not normalized!) so caves are continuous across shells
    const f1 = this.config.caveFrequency;
    const px = position.x * f1;
    const py = position.y * f1;
    const pz = position.z * f1;

    // Depth factor: wider caves at middle depths, thinner near boundaries
    const depthFactor = 1.0 - Math.abs(normalizedDist - 0.55) * 1.8;
    const clampedDepth = Math.max(0.15, Math.min(1.0, depthFactor));
    const threshold = this.config.wormThreshold * clampedDepth;

    // Primary worm tunnels: |noise1 - 0.5| + |noise2 - 0.5| < threshold
    // Both noise fields must cross 0.5 near the same point, forming a tube
    const n1 = this.noise.noise3D(px, py, pz);
    const n2 = this.wormNoise.noise3D(px, py, pz);
    const worm1 = Math.abs(n1 - 0.5) + Math.abs(n2 - 0.5);

    if (worm1 < threshold) return true;

    // Secondary worm system at different frequency for branching variety
    const f2 = f1 * this.config.wormFrequency;
    const n3 = this.noise.noise3D(px * f2 + 31.7, py * f2 + 47.3, pz * f2 + 13.1);
    const n4 = this.wormNoise.noise3D(px * f2 + 31.7, py * f2 + 47.3, pz * f2 + 13.1);
    const worm2 = Math.abs(n3 - 0.5) + Math.abs(n4 - 0.5);

    if (worm2 < threshold * 0.6) return true;

    return false;
  }

  /**
   * Get cave "biome" data for lighting and decoration.
   */
  public getCaveData(position: THREE.Vector3): {
    hasCrystals: boolean;
    hasGlowMushrooms: boolean;
    hasWater: boolean;
    lightColor: THREE.Color;
    lightIntensity: number;
  } {
    // Use actual 3D position for spatially coherent features
    const featureNoise = this.noise.noise3D(position.x * 10, position.y * 10, position.z * 10);
    const colorNoise = this.wormNoise.noise3D(position.x * 5, position.y * 5, position.z * 5);

    const hasCrystals = featureNoise > 0.7;
    const hasGlowMushrooms = featureNoise < 0.3 && featureNoise > 0.15;
    const hasWater = featureNoise < 0.15;

    // Determine light color based on features
    let lightColor: THREE.Color;
    let lightIntensity: number;

    if (hasCrystals) {
      // Crystal caves - purple/blue glow
      const hue = 0.7 + colorNoise * 0.15; // Purple to blue
      lightColor = new THREE.Color().setHSL(hue, 0.8, 0.6);
      lightIntensity = 0.8;
    } else if (hasGlowMushrooms) {
      // Mushroom caves - green/teal glow
      const hue = 0.35 + colorNoise * 0.1; // Green to teal
      lightColor = new THREE.Color().setHSL(hue, 0.7, 0.5);
      lightIntensity = 0.5;
    } else if (hasWater) {
      // Water caves - blue glow
      lightColor = new THREE.Color(0.2, 0.4, 0.8);
      lightIntensity = 0.3;
    } else {
      // Regular cave - dim warm light
      lightColor = new THREE.Color(0.8, 0.6, 0.4);
      lightIntensity = 0.2;
    }

    return { hasCrystals, hasGlowMushrooms, hasWater, lightColor, lightIntensity };
  }
}

/**
 * Creates decorative elements for caves (crystals, mushrooms, etc.)
 */
export class CaveDecorator {
  private scene: THREE.Scene;
  private decorations: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Add a glowing crystal cluster at a position.
   */
  public addCrystal(position: THREE.Vector3, color: THREE.Color): void {
    const group = new THREE.Group();

    // Create several crystal spikes
    const numCrystals = 3 + Math.floor(Math.random() * 4);

    for (let i = 0; i < numCrystals; i++) {
      const height = 0.02 + Math.random() * 0.04;
      const radius = 0.005 + Math.random() * 0.008;

      const geometry = new THREE.ConeGeometry(radius, height, 6);
      const material = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.8,
      });

      const crystal = new THREE.Mesh(geometry, material);

      // Random offset and rotation
      crystal.position.set(
        (Math.random() - 0.5) * 0.03,
        height / 2,
        (Math.random() - 0.5) * 0.03
      );
      crystal.rotation.set(
        (Math.random() - 0.5) * 0.3,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.3
      );

      group.add(crystal);
    }

    // Orient group to point away from center (outward from cave wall)
    const normal = position.clone().normalize();
    group.position.copy(position);
    group.lookAt(position.clone().add(normal));
    group.rotateX(Math.PI / 2);

    this.scene.add(group);
    this.decorations.push(group);
  }

  /**
   * Add glowing mushrooms at a position.
   */
  public addMushroom(position: THREE.Vector3, color: THREE.Color): void {
    const group = new THREE.Group();

    const numMushrooms = 2 + Math.floor(Math.random() * 3);

    for (let i = 0; i < numMushrooms; i++) {
      // Stem
      const stemHeight = 0.01 + Math.random() * 0.015;
      const stemGeom = new THREE.CylinderGeometry(0.002, 0.003, stemHeight, 8);
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
      const stem = new THREE.Mesh(stemGeom, stemMat);
      stem.position.y = stemHeight / 2;

      // Cap
      const capRadius = 0.005 + Math.random() * 0.008;
      const capGeom = new THREE.SphereGeometry(capRadius, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const capMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.7,
      });
      const cap = new THREE.Mesh(capGeom, capMat);
      cap.position.y = stemHeight;

      const mushroom = new THREE.Group();
      mushroom.add(stem);
      mushroom.add(cap);

      mushroom.position.set(
        (Math.random() - 0.5) * 0.02,
        0,
        (Math.random() - 0.5) * 0.02
      );

      group.add(mushroom);
    }

    // Orient to surface
    const normal = position.clone().normalize();
    group.position.copy(position);
    group.lookAt(position.clone().add(normal));
    group.rotateX(Math.PI / 2);

    this.scene.add(group);
    this.decorations.push(group);
  }

  /**
   * Clear all decorations.
   */
  public clear(): void {
    for (const dec of this.decorations) {
      this.scene.remove(dec);
    }
    this.decorations = [];
  }
}
