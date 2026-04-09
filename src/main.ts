import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RadialGeodesicEngine } from './core/engine';

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

    const voxelMesh = new THREE.Mesh(geometry, material);
    scene.add(voxelMesh);
  }

  // Add the base geodesic sphere for reference (wireframe)
  const baseGeom = engine.getBaseMesh();
  const baseGeometry = new THREE.BufferGeometry();
  const basePosArray = new Float32Array(baseGeom.vertices.length * 3); // Wait, baseGeom is GeodesicMesh interface
  // Correcting for the interface:
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
