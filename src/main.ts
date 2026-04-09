import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateGeodesicSphere } from './core/geodesic';

function init() {
  // Scene setup
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 3;

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

  // Generate Geodesic Sphere (Subdivisions: 3, Radius: 1)
  const subdivisions = 3;
  const radius = 1;
  const geodesicMesh = generateGeodesicSphere(subdivisions, radius);

  // Create Geometry
  const geometry = new THREE.BufferGeometry();
  
  // Convert Vector3 array to Float32Array for BufferGeometry
  const positions = new Float32Array(geodesicMesh.vertices.length * 3);
  for (let i = 0; i < geodesicMesh.vertices.length; i++) {
    positions[i * 3] = geodesicMesh.vertices[i].x;
    positions[i * 3 + 1] = geodesicMesh.vertices[i].y;
    positions[i * 3 + 2] = geodesicMesh.vertices[i].z;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(geodesicMesh.indices, 1));
  geometry.computeVertexNormals();

  // Material
  const material = new THREE.MeshPhongMaterial({
    color: 0x00ff88,
    wireframe: true,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // Add a solid version for better look
  const solidMaterial = new THREE.MeshPhongMaterial({
    color: 0x224466,
    side: THREE.DoubleSide
  });
  const solidMesh = new THREE.Mesh(geometry, solidMaterial);
  scene.add(solidMesh);

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
