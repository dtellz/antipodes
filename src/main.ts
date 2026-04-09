import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RadialGeodesicEngine } from './core/engine';
import { WorldManager } from './core/world_manager';
import { InteractionManager } from './core/interaction';
import { GeodesicMesher } from './core/mesher';
import { createInflationMaterial } from './core/shaders';

function init() {
  // Scene setup
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(3, 3, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const pointLight = new THREE.PointLight(0xffffff, 1);
  pointLight.position.set(5, 5, 5);
  scene.add(pointLight);

  // Initialize Engine (Subdivisions: 3, Shell Radius Step: 1)
  const engine = new RadialGeodesicEngine(3, 1);

  // Visualize a few voxels to test Phase 2
  const voxelCountToTest = 50;
  const triangleCount = engine.getTriangleCount();

  for (let i = 0; i < voxelCountToTest; i++) {
    const r = Math.floor(Math.random() * 3); // Shells 0, 1, or 2
    const cellID = Math.floor(Math.random() * triangleCount);

    const { vertices, indices } = engine.getVoxelGeometry(r, cellID);

    const geometry = new THREE.BufferGeometry();
    const posArray = new Float32Array(vertices.length * 3);
    for (let j = 0; j < vertices.length; j++) {
      posArray[j * 3] = vertices[j].x;
      posArray[j * 3 + 1] = vertices[j].y;
      posArray[j * 3 + 2] = vertices[j].z;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhongMaterial({
      color: Math.random() * 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
  }

  // Add the base geodesic sphere for reference (wireframe)
  const baseGeom = engine.getBaseMesh();
  const baseGeometry = new THREE.BufferGeometry();
  const basePositions = new Float32Array(baseGeom.vertices.length * 3);
  for (let i = 0; i < baseGeom.vertices.length; i++) {
    basePositions[i * 3] = baseGeom.vertices[i].x;
    basePositions[i * 3 + 1] = baseGeom.vertices[i].y;
    basePositions[i * 3 + 2] = baseGeom.vertices[i].z;
  }
  baseGeometry.setAttribute('position', new THREE.BufferAttribute(basePositions, 3));
  baseGeometry.setIndex(new THREE.BufferAttribute(baseGeom.indices, 1));

  const baseMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.2 });
  const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
  scene.add(baseMesh);

  // --- PHASE 5: MESHING & RENDERING SETUP ---
  const worldManager = new WorldManager();
  const interactionManager = new InteractionManager(camera);

  // Populate the world with some random voxels to click on
  for (let i = 0; i < 200; i++) {
    const r = Math.floor(Math.random() * 3) + 1; // Shells 1, 2, or 3
    const cellID = Math.floor(Math.random() * triangleCount);
    const colors = [0x8B4513, 0x228B22, 0x808080, 0xFFD700]; // dirt, grass, stone, gold
    const materialType = ['dirt', 'grass', 'stone', 'gold'][i % 4];

    // Add to storage
    worldManager.setVoxel(r, cellID, {
      materialType,
      lightLevel: 1,
      hardness: 1
    });
  }

  // Generate and add meshes using the Greedy Mesher
  const mesher = new GeodesicMesher(engine, worldManager);
  const materialMeshes = mesher.generateMeshes();

  materialMeshes.forEach((mesh, materialType) => {
    // Assign inflation material
    const color = materialType === 'dirt' ? 0x8B4513 :
                  materialType === 'grass' ? 0x228B22 :
                  materialType === 'stone' ? 0x808080 : 0xFFD700;
    
    mesh.material = createInflationMaterial(color, 0.015);
    scene.add(mesh);
  });

  // For raycasting to work with batched meshes, we need to handle it differently.
  // Since the mesher batches everything, a single click might hit many voxels or none.
  // For this demo, we'll keep the interaction simple:
  // In a real engine, we would use a spatial hash or similar for raycasting against voxels.

  // Handle clicks for digging
  window.addEventListener('click', (event) => {
    const mouse = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );

    const hit = interactionManager.raycast(mouse, scene);
    if (hit) {
      console.log('Hit voxel:', hit.r, hit.cellID);
      interactionManager.dig(hit, worldManager, scene);
    }
  });

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  animate();
}

init();
