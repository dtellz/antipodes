import * as THREE from 'three';

export interface GeodesicMesh {
  vertices: THREE.Vector3[];
  indices: Uint32Array;
  hierarchy?: GeodesicHierarchy;
}

export interface GeodesicHierarchy {
  /**
   * Maps a parent triangle index at level k to its children indices at level k+1.
   * levels[k][parentIndex] = [childIndex1, childIndex2, childIndex3, childIndex4]
   */
  levels: Map<number, Map<number, number[]>>;
  maxLevel: number;
}

/**
 * Generates the 12 vertices and 20 faces of a regular Icosahedron.
 */
export function generateIcosahedron(): GeodesicMesh {
  const phi = (1 + Math.sqrt(5)) / 2;
  const vertices: THREE.Vector3[] = [
    new THREE.Vector3(-1,  phi,  0),
    new THREE.Vector3( 1,  phi,  0),
    new THREE.Vector3(-1, -phi,  0),
    new THREE.Vector3( 1, -phi,  0),
    new THREE.Vector3( 0, -1,  phi),
    new THREE.Vector3( 0,  1,  phi),
    new THREE.Vector3( 0, -1, -phi),
    new THREE.Vector3( 0,  1, -phi),
    new THREE.Vector3( phi,  0, -1),
    new THREE.Vector3( phi,  0,  1),
    new THREE.Vector3(-phi,  0, -1),
    new THREE.Vector3(-phi,  0,  1),
  ];

  // Normalize vertices to unit sphere initially
  vertices.forEach(v => v.normalize());

  const indices: number[] = [
    0, 11, 5,
    0, 5, 1,
    0, 1, 7,
    0, 7, 10,
    0, 10, 11,
    1, 5, 9,
    5, 11, 4,
    11, 10, 2,
    10, 7, 6,
    7, 1, 8,
    3, 9, 4,
    3, 4, 2,
    3, 2, 6,
    3, 6, 8,
    3, 8, 9,
    4, 9, 5,
    2, 4, 11,
    6, 2, 10,
    8, 6, 7,
    9, 8, 1,
  ];

  return {
    vertices,
    indices: new Uint32Array(indices),
  };
}

interface SubdivisionResult {
  mesh: GeodesicMesh;
  parentToChildren: Map<number, number[]>;
}

/**
 * Performs one level of linear subdivision on the mesh.
 * Splits each triangle into four smaller triangles by finding midpoints of edges.
 */
export function subdivide(mesh: GeodesicMesh): SubdivisionResult {
  const { vertices, indices } = mesh;
  const newVertices = [...vertices];
  const newIndices: number[] = [];
  const parentToChildren = new Map<number, number[]>();
  
  // Map to store midpoints to avoid duplicates: "v1-v2" -> index
  const midpointCache = new Map<string, number>();

  function getMidpoint(idx1: number, idx2: number): number {
    const key = idx1 < idx2 ? `${idx1}-${idx2}` : `${idx2}-${idx1}`;
    if (midpointCache.has(key)) {
      return midpointCache.get(key)!;
    }

    const v1 = vertices[idx1];
    const v2 = vertices[idx2];
    const midpoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
    
    newVertices.push(midpoint);
    const newIdx = newVertices.length - 1;
    midpointCache.set(key, newIdx);
    return newIdx;
  }

  for (let i = 0; i < indices.length; i += 3) {
    const parentIndex = i / 3;
    const v1 = indices[i];
    const v2 = indices[i + 1];
    const v3 = indices[i + 2];

    const a = getMidpoint(v1, v2);
    const b = getMidpoint(v2, v3);
    const c = getMidpoint(v3, v1);

    // Four new triangles
    const childIndices = [
      [v1, a, c],
      [v2, b, a],
      [v3, c, b],
      [a, b, c]
    ];

    const children: number[] = [];
    for (const tri of childIndices) {
      const startIdx = newIndices.length;
      newIndices.push(tri[0], tri[1], tri[2]);
      children.push(startIdx / 3);
    }

    parentToChildren.set(parentIndex, children);
  }

  return {
    mesh: {
      vertices: newVertices,
      indices: new Uint32Array(newIndices),
    },
    parentToChildren
  };
}

/**
 * Pushes all vertices to a specified radius R.
 */
export function normalize(mesh: GeodesicMesh, radius: number): GeodesicMesh {
  const newVertices = mesh.vertices.map(v => v.clone().normalize().multiplyScalar(radius));
  return {
    ...mesh,
    vertices: newVertices,
  };
}

/**
 * Generates a geodesic sphere by subdividing an icosahedron N times.
 */
export function generateGeodesicSphere(subdivisions: number, radius: number = 1): GeodesicMesh {
  let currentMesh = generateIcosahedron();
  const hierarchyLevels: Map<number, number[]>[] = [];

  for (let i = 0; i < subdivisions; i++) {
    const result = subdivide(currentMesh);
    hierarchyLevels.push(result.parentToChildren);
    currentMesh = normalize(result.mesh, radius);
  }

  if (subdivisions > 0) {
    const levelsMap = new Map<number, Map<number, number[]>>();
    for (let i = 0; i < hierarchyLevels.length; i++) {
      const levelMap = new Map<number, number[]>();
      hierarchyLevels[i].forEach((children, parentIndex) => {
        levelMap.set(parentIndex, children);
      });
      levelsMap.set(i, levelMap);
    }
    currentMesh.hierarchy = {
      levels: levelsMap,
      maxLevel: subdivisions - 1
    };
  }

  return currentMesh;
}
