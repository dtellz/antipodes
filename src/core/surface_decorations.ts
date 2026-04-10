import * as THREE from 'three';

/**
 * Deterministic random from an integer seed.
 */
function seededRandom(seed: number, offset: number = 0): number {
  const x = Math.sin((seed + offset) * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Places decorative objects on the planet surface to make it feel alive.
 * Trees, rocks, grass tufts, and flowers are oriented radially outward.
 */
export class SurfaceDecorator {
  private scene: THREE.Scene;
  private decorations: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Add a conifer-style tree (cone canopy + cylinder trunk).
   */
  public addTree(position: THREE.Vector3, seed: number): void {
    const group = new THREE.Group();
    const scale = 0.7 + seededRandom(seed, 1) * 0.6;

    // Trunk
    const trunkH = 0.035 * scale;
    const trunkGeom = new THREE.CylinderGeometry(0.004 * scale, 0.006 * scale, trunkH, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.y = trunkH / 2;
    group.add(trunk);

    // Canopy – two stacked cones for a fuller look
    const green = new THREE.Color().setHSL(0.3 + seededRandom(seed, 2) * 0.08, 0.6, 0.25 + seededRandom(seed, 3) * 0.15);
    const canopyMat = new THREE.MeshLambertMaterial({ color: green });

    const lowerH = 0.045 * scale;
    const lowerGeom = new THREE.ConeGeometry(0.028 * scale, lowerH, 7);
    const lower = new THREE.Mesh(lowerGeom, canopyMat);
    lower.position.y = trunkH + lowerH * 0.35;
    group.add(lower);

    const upperH = 0.035 * scale;
    const upperGeom = new THREE.ConeGeometry(0.020 * scale, upperH, 7);
    const upper = new THREE.Mesh(upperGeom, canopyMat);
    upper.position.y = trunkH + lowerH * 0.55 + upperH * 0.3;
    group.add(upper);

    this.placeOnSurface(group, position);
  }

  /**
   * Add a round deciduous-style tree (sphere canopy).
   */
  public addRoundTree(position: THREE.Vector3, seed: number): void {
    const group = new THREE.Group();
    const scale = 0.7 + seededRandom(seed, 10) * 0.6;

    // Trunk
    const trunkH = 0.03 * scale;
    const trunkGeom = new THREE.CylinderGeometry(0.003 * scale, 0.005 * scale, trunkH, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6B3410 });
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.y = trunkH / 2;
    group.add(trunk);

    // Round canopy
    const green = new THREE.Color().setHSL(0.28 + seededRandom(seed, 11) * 0.1, 0.55, 0.3 + seededRandom(seed, 12) * 0.12);
    const canopyR = 0.022 * scale;
    const canopyGeom = new THREE.IcosahedronGeometry(canopyR, 1);
    const canopyMat = new THREE.MeshLambertMaterial({ color: green });
    const canopy = new THREE.Mesh(canopyGeom, canopyMat);
    canopy.position.y = trunkH + canopyR * 0.7;
    group.add(canopy);

    this.placeOnSurface(group, position);
  }

  /**
   * Add a rock or boulder.
   */
  public addRock(position: THREE.Vector3, seed: number): void {
    const group = new THREE.Group();
    const size = 0.008 + seededRandom(seed, 20) * 0.014;
    const geom = new THREE.DodecahedronGeometry(size, 0);

    const grayVal = 0.3 + seededRandom(seed, 21) * 0.25;
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(grayVal, grayVal * 0.95, grayVal * 0.88),
    });
    const rock = new THREE.Mesh(geom, mat);
    rock.position.y = size * 0.3;
    // Varied rotation so rocks don't all face the same way
    rock.rotation.set(
      seededRandom(seed, 22) * Math.PI,
      seededRandom(seed, 23) * Math.PI,
      seededRandom(seed, 24) * Math.PI
    );
    group.add(rock);

    this.placeOnSurface(group, position);
  }

  /**
   * Add a tuft of grass blades.
   */
  public addGrass(position: THREE.Vector3, seed: number): void {
    const group = new THREE.Group();
    const numBlades = 3 + Math.floor(seededRandom(seed, 30) * 4);

    for (let i = 0; i < numBlades; i++) {
      const h = 0.008 + seededRandom(seed, 31 + i) * 0.014;
      const geom = new THREE.ConeGeometry(0.002, h, 4);
      const greenVal = 0.35 + seededRandom(seed, 40 + i) * 0.3;
      const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.15, greenVal, 0.08) });
      const blade = new THREE.Mesh(geom, mat);
      blade.position.set(
        (seededRandom(seed, 50 + i) - 0.5) * 0.015,
        h / 2,
        (seededRandom(seed, 60 + i) - 0.5) * 0.015
      );
      blade.rotation.set(
        (seededRandom(seed, 70 + i) - 0.5) * 0.4,
        seededRandom(seed, 80 + i) * Math.PI,
        (seededRandom(seed, 90 + i) - 0.5) * 0.4
      );
      group.add(blade);
    }

    this.placeOnSurface(group, position);
  }

  /**
   * Add a small flower (stem + coloured head).
   */
  public addFlower(position: THREE.Vector3, seed: number): void {
    const group = new THREE.Group();

    // Stem
    const stemH = 0.01 + seededRandom(seed, 100) * 0.008;
    const stemGeom = new THREE.CylinderGeometry(0.001, 0.0015, stemH, 4);
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
    const stem = new THREE.Mesh(stemGeom, stemMat);
    stem.position.y = stemH / 2;
    group.add(stem);

    // Flower head – pick a bright colour
    const hue = seededRandom(seed, 101);
    const flowerColor = new THREE.Color().setHSL(hue, 0.8, 0.55);
    const headR = 0.003 + seededRandom(seed, 102) * 0.003;
    const headGeom = new THREE.IcosahedronGeometry(headR, 0);
    const headMat = new THREE.MeshLambertMaterial({ color: flowerColor });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = stemH + headR * 0.5;
    group.add(head);

    this.placeOnSurface(group, position);
  }

  /**
   * Orient a group so its local Y axis points radially outward from the sphere
   * center, then attach it to the scene.
   */
  private placeOnSurface(group: THREE.Group, position: THREE.Vector3): void {
    const up = position.clone().normalize();
    group.position.copy(position);
    group.lookAt(position.clone().add(up));
    group.rotateX(Math.PI / 2);

    this.scene.add(group);
    this.decorations.push(group);
  }

  public clear(): void {
    for (const d of this.decorations) {
      this.scene.remove(d);
    }
    this.decorations = [];
  }
}
