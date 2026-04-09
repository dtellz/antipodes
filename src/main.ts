import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateGeodesicSphere } from './core/geodesic';
import { TerrainGenerator } from './core/terrain';

function init() {
  // Scene setup
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB); // Sky blue background
  
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(2.5, 1.5, 2.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 1.2;
  controls.maxDistance = 10;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
  sunLight.position.set(5, 3, 4);
  scene.add(sunLight);

  // Hemisphere light for better ambient
  const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3d5c3d, 0.4);
  scene.add(hemiLight);

  // --- PLANET GENERATION ---
  const SUBDIVISION_LEVEL = 6; // 20 * 4^6 = 81,920 triangles
  const BASE_RADIUS = 1.0;
  
  console.log(`Generating geodesic sphere with ${20 * Math.pow(4, SUBDIVISION_LEVEL)} triangles...`);
  
  const geodesicMesh = generateGeodesicSphere(SUBDIVISION_LEVEL, BASE_RADIUS);
  const terrain = new TerrainGenerator(42);
  
  console.log(`Vertices: ${geodesicMesh.vertices.length}, Triangles: ${geodesicMesh.indices.length / 3}`);

  // Create the planet geometry with terrain
  const geometry = new THREE.BufferGeometry();
  
  // Apply terrain heights to vertices
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  
  // Process each triangle
  const numTriangles = geodesicMesh.indices.length / 3;
  
  for (let i = 0; i < numTriangles; i++) {
    const i1 = geodesicMesh.indices[i * 3];
    const i2 = geodesicMesh.indices[i * 3 + 1];
    const i3 = geodesicMesh.indices[i * 3 + 2];
    
    const v1 = geodesicMesh.vertices[i1].clone();
    const v2 = geodesicMesh.vertices[i2].clone();
    const v3 = geodesicMesh.vertices[i3].clone();
    
    // Get terrain data for each vertex
    const t1 = terrain.getTerrainAt(v1);
    const t2 = terrain.getTerrainAt(v2);
    const t3 = terrain.getTerrainAt(v3);
    
    // Apply height displacement
    const r1 = terrain.getRadiusAt(v1, BASE_RADIUS);
    const r2 = terrain.getRadiusAt(v2, BASE_RADIUS);
    const r3 = terrain.getRadiusAt(v3, BASE_RADIUS);
    
    v1.normalize().multiplyScalar(r1);
    v2.normalize().multiplyScalar(r2);
    v3.normalize().multiplyScalar(r3);
    
    // Add positions
    positions.push(v1.x, v1.y, v1.z);
    positions.push(v2.x, v2.y, v2.z);
    positions.push(v3.x, v3.y, v3.z);
    
    // Add colors (per-vertex)
    colors.push(t1.color.r, t1.color.g, t1.color.b);
    colors.push(t2.color.r, t2.color.g, t2.color.b);
    colors.push(t3.color.r, t3.color.g, t3.color.b);
    
    // Calculate face normal
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    
    normals.push(normal.x, normal.y, normal.z);
    normals.push(normal.x, normal.y, normal.z);
    normals.push(normal.x, normal.y, normal.z);
  }
  
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  
  // Create material with vertex colors
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
  });
  
  const planet = new THREE.Mesh(geometry, material);
  scene.add(planet);
  
  console.log('Planet created successfully!');

  // Add atmosphere glow effect
  const atmosphereGeometry = new THREE.SphereGeometry(BASE_RADIUS * 1.02, 64, 64);
  const atmosphereMaterial = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
        gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity * 0.5;
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
  });
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  scene.add(atmosphere);

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    
    // Slow rotation
    planet.rotation.y += 0.001;
    atmosphere.rotation.y += 0.001;
    
    controls.update();
    renderer.render(scene, camera);
  }

  animate();
}

init();
