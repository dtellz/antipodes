import * as THREE from 'three';

/**
 * Simple 3D noise implementation for terrain generation.
 * Uses a combination of sine waves for pseudo-random noise.
 */
class SimplexNoise {
  private perm: number[] = [];

  constructor(seed: number = 0) {
    const p = [];
    for (let i = 0; i < 256; i++) {
      p[i] = Math.floor(Math.abs(Math.sin(seed + i) * 10000) % 256);
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  public noise3D(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);

    const A = this.perm[X] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const B = this.perm[X + 1] + Y;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;

    return this.lerp(
      this.lerp(
        this.lerp(this.grad(this.perm[AA], x, y, z), this.grad(this.perm[BA], x - 1, y, z), u),
        this.lerp(this.grad(this.perm[AB], x, y - 1, z), this.grad(this.perm[BB], x - 1, y - 1, z), u),
        v
      ),
      this.lerp(
        this.lerp(this.grad(this.perm[AA + 1], x, y, z - 1), this.grad(this.perm[BA + 1], x - 1, y, z - 1), u),
        this.lerp(this.grad(this.perm[AB + 1], x, y - 1, z - 1), this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  public fbm(x: number, y: number, z: number, octaves: number = 4, lacunarity: number = 2, persistence: number = 0.5): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise3D(x * frequency, y * frequency, z * frequency);
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }
}

export enum BiomeType {
  DEEP_OCEAN = 'deep_ocean',
  OCEAN = 'ocean',
  BEACH = 'beach',
  PLAINS = 'plains',
  FOREST = 'forest',
  HILLS = 'hills',
  MOUNTAINS = 'mountains',
  SNOW = 'snow'
}

export interface TerrainData {
  height: number;       // 0-1 normalized height
  biome: BiomeType;
  color: THREE.Color;
}

export class TerrainGenerator {
  private heightNoise: SimplexNoise;
  private moistureNoise: SimplexNoise;
  private detailNoise: SimplexNoise;
  
  public seaLevel: number = 0.4;
  public heightScale: number = 0.15;

  constructor(seed: number = 42) {
    this.heightNoise = new SimplexNoise(seed);
    this.moistureNoise = new SimplexNoise(seed + 1000);
    this.detailNoise = new SimplexNoise(seed + 2000);
  }

  /**
   * Generate terrain data for a point on the unit sphere.
   */
  public getTerrainAt(position: THREE.Vector3): TerrainData {
    const p = position.clone().normalize();
    
    // Multi-octave noise for height
    const continentScale = 1.5;
    const detailScale = 4.0;
    
    // Continental shapes (large features)
    let height = this.heightNoise.fbm(
      p.x * continentScale,
      p.y * continentScale,
      p.z * continentScale,
      6, 2.0, 0.5
    );
    
    // Add detail noise
    const detail = this.detailNoise.fbm(
      p.x * detailScale,
      p.y * detailScale,
      p.z * detailScale,
      4, 2.0, 0.5
    ) * 0.3;
    
    height = (height + detail + 1) / 2; // Normalize to 0-1
    
    // Moisture for biome variation
    const moisture = (this.moistureNoise.fbm(
      p.x * 2,
      p.y * 2,
      p.z * 2,
      3, 2.0, 0.5
    ) + 1) / 2;

    const biome = this.getBiome(height, moisture);
    const color = this.getBiomeColor(height, biome, moisture);

    return { height, biome, color };
  }

  private getBiome(height: number, moisture: number): BiomeType {
    if (height < this.seaLevel - 0.1) return BiomeType.DEEP_OCEAN;
    if (height < this.seaLevel) return BiomeType.OCEAN;
    if (height < this.seaLevel + 0.03) return BiomeType.BEACH;
    if (height < 0.55) {
      return moisture > 0.5 ? BiomeType.FOREST : BiomeType.PLAINS;
    }
    if (height < 0.7) return BiomeType.HILLS;
    if (height < 0.85) return BiomeType.MOUNTAINS;
    return BiomeType.SNOW;
  }

  private getBiomeColor(height: number, biome: BiomeType, moisture: number): THREE.Color {
    const variation = (Math.random() - 0.5) * 0.05;
    
    switch (biome) {
      case BiomeType.DEEP_OCEAN:
        return new THREE.Color(0.05 + variation, 0.15 + variation, 0.4 + variation);
      case BiomeType.OCEAN:
        return new THREE.Color(0.1 + variation, 0.3 + variation, 0.6 + variation);
      case BiomeType.BEACH:
        return new THREE.Color(0.76 + variation, 0.7 + variation, 0.5 + variation);
      case BiomeType.PLAINS:
        return new THREE.Color(0.4 + variation, 0.6 + variation * 2, 0.2 + variation);
      case BiomeType.FOREST:
        return new THREE.Color(0.13 + variation, 0.4 + variation, 0.13 + variation);
      case BiomeType.HILLS:
        return new THREE.Color(0.35 + variation, 0.5 + variation, 0.25 + variation);
      case BiomeType.MOUNTAINS:
        return new THREE.Color(0.4 + variation, 0.38 + variation, 0.35 + variation);
      case BiomeType.SNOW:
        return new THREE.Color(0.95 + variation, 0.95 + variation, 0.97 + variation);
      default:
        return new THREE.Color(1, 0, 1); // Magenta for debug
    }
  }

  /**
   * Get the actual radius for a vertex based on terrain height.
   */
  public getRadiusAt(position: THREE.Vector3, baseRadius: number): number {
    const terrain = this.getTerrainAt(position);
    const heightOffset = (terrain.height - this.seaLevel) * this.heightScale;
    
    // Water stays at sea level
    if (terrain.biome === BiomeType.OCEAN || terrain.biome === BiomeType.DEEP_OCEAN) {
      return baseRadius;
    }
    
    return baseRadius + heightOffset * baseRadius;
  }
}
