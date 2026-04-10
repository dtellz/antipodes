import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VoxelWorld } from './core/voxel_world';
import { WorldRenderer } from './core/world_renderer';
import { Player } from './core/player';
import { DiggingSystem } from './core/digging';
import { Minimap } from './core/minimap';
import { CaveDecorator } from './core/caves';

// Game modes
type GameMode = 'orbit' | 'player';

/**
 * Set up cave decorations (crystals, mushrooms, lights) at cave locations.
 */
function setupCaveDecorations(world: VoxelWorld, decorator: CaveDecorator): void {
  const caveGenerator = world.getCaveGenerator();
  const caveCells = world.getCaveCells();
  const caveDecorators: { pos: THREE.Vector3; hasCrystals: boolean }[] = [];

  // Sample cave cells for decoration placement
  let processed = 0;
  for (const key of caveCells) {
    processed++;
    if (processed % 5 !== 0) continue; // Only decorate every 5th cave cell to avoid clutter

    const [shellStr, cellIDStr] = key.split('-');
    const shell = parseInt(shellStr);
    const cellID = parseInt(cellIDStr);

    const center = world.getCellCenter(shell, cellID);
    const caveData = caveGenerator.getCaveData(center);

    if (caveData.hasCrystals || caveData.hasGlowMushrooms) {
      caveDecorators.push({ pos: center, hasCrystals: caveData.hasCrystals });
    }
  }

  // Add decorations
  for (const { pos, hasCrystals } of caveDecorators.slice(0, 200)) { // Limit to 200 decorations
    const caveData = caveGenerator.getCaveData(pos);
    if (hasCrystals) {
      decorator.addCrystal(pos, caveData.lightColor);
    } else if (caveData.hasGlowMushrooms) {
      decorator.addMushroom(pos, caveData.lightColor);
    }
  }

  console.log(`Added ${caveDecorators.length} cave decorations`);
}

function init() {
  // Scene setup
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(2.5, 1.5, 2.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  // Orbit controls (for spectator mode)
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.05;
  orbitControls.minDistance = 1.2;
  orbitControls.maxDistance = 10;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
  sunLight.position.set(5, 3, 4);
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3d5c3d, 0.3);
  scene.add(hemiLight);

  // --- VOXEL WORLD ---
  const SUBDIVISION_LEVEL = 4; // Lower for performance with voxels (5120 cells per shell)
  const NUM_SHELLS = 15;
  const BASE_RADIUS = 1.0;
  
  console.log('Creating voxel world...');
  const world = new VoxelWorld(SUBDIVISION_LEVEL, NUM_SHELLS, BASE_RADIUS, 0.06);
  world.generateTerrain();
  
  // World renderer
  const worldRenderer = new WorldRenderer(world, scene);
  worldRenderer.update();
  
  // --- CORE ORB (The prize at the center!) ---
  const orbRadius = 0.04;
  const coreGeometry = new THREE.SphereGeometry(orbRadius, 32, 32);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xFFD700,
    emissive: 0xFFAA00,
    emissiveIntensity: 0.8,
    metalness: 0.9,
    roughness: 0.1,
  });
  const coreOrb = new THREE.Mesh(coreGeometry, coreMaterial);
  coreOrb.position.set(0, 0, 0);
  scene.add(coreOrb);
  
  // Core glow
  const coreGlowGeometry = new THREE.SphereGeometry(orbRadius * 2, 32, 32);
  const coreGlowMaterial = new THREE.ShaderMaterial({
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
        gl_FragColor = vec4(1.0, 0.8, 0.2, 1.0) * intensity;
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
  });
  const coreGlow = new THREE.Mesh(coreGlowGeometry, coreGlowMaterial);
  scene.add(coreGlow);

  // --- PLAYER ---
  const startPos = new THREE.Vector3(0, BASE_RADIUS + 0.15, 0);
  const player = new Player(startPos, camera);
  
  // --- DIGGING SYSTEM ---
  const diggingSystem = new DiggingSystem(world, scene);
  
  // --- MINIMAP ---
  const minimap = new Minimap({
    size: 160,
    planetRadius: BASE_RADIUS,
    coreRadius: world.coreRadius,
  });
  minimap.setStartDirection(startPos.clone().normalize());
  
  // --- CAVE DECORATIONS ---
  const caveDecorator = new CaveDecorator(scene);
  setupCaveDecorations(world, caveDecorator);
  
  // --- GAME STATE ---
  let gameMode: GameMode = 'orbit';
  let hasOrb = false;
  let gameWon = false;
  let gameStarted = false;
  const startDirection = startPos.clone().normalize();

  // --- START SCREEN ---
  const startScreen = document.createElement('div');
  startScreen.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: rgba(0, 0, 0, 0.7);
    z-index: 2000;
    transition: opacity 0.5s ease;
  `;

  const title = document.createElement('h1');
  title.textContent = 'ANTIPODES';
  title.style.cssText = `
    color: #FFD700;
    font-family: Arial, sans-serif;
    font-size: 48px;
    margin-bottom: 10px;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
  `;

  const subtitle = document.createElement('p');
  subtitle.textContent = 'Dig to the core, grab the orb, reach the antipode!';
  subtitle.style.cssText = `
    color: #FFFFFF;
    font-family: Arial, sans-serif;
    font-size: 18px;
    margin-bottom: 30px;
    text-shadow: 1px 1px 2px black;
  `;

  const startButton = document.createElement('button');
  startButton.textContent = 'START GAME';
  startButton.style.cssText = `
    padding: 20px 60px;
    font-size: 24px;
    font-family: Arial, sans-serif;
    font-weight: bold;
    color: #000;
    background: linear-gradient(135deg, #FFD700, #FFA500);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(255, 215, 0, 0.4);
    transition: transform 0.2s, box-shadow 0.2s;
  `;
  startButton.onmouseenter = () => {
    startButton.style.transform = 'scale(1.05)';
    startButton.style.boxShadow = '0 6px 20px rgba(255, 215, 0, 0.6)';
  };
  startButton.onmouseleave = () => {
    startButton.style.transform = 'scale(1)';
    startButton.style.boxShadow = '0 4px 15px rgba(255, 215, 0, 0.4)';
  };
  startButton.onclick = () => {
    gameStarted = true;
    gameMode = 'player';
    orbitControls.enabled = false;
    startScreen.style.opacity = '0';
    setTimeout(() => startScreen.remove(), 500);
    ui.modeText.textContent = 'Player Mode';
  };

  startScreen.appendChild(title);
  startScreen.appendChild(subtitle);
  startScreen.appendChild(startButton);
  document.body.appendChild(startScreen);

  // --- UI ---
  const ui = createUI();
  ui.modeText.textContent = 'Spectator Mode - Click START GAME to play';
  const perfMonitor = new PerfMonitor();
  
  // Digging on click
  document.addEventListener('mousedown', (e) => {
    if (gameMode === 'player' && e.button === 0) {
      const lookDir = player.getLookDirection();
      const result = diggingSystem.dig(player.getPosition(), lookDir);
      
      if (result) {
        worldRenderer.markDirty();
        console.log(`Dug voxel at shell ${result.shell}, cell ${result.cellID}`);
      }
    }
  });

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- GAME LOOP ---
  let lastTime = performance.now();
  
  function animate() {
    requestAnimationFrame(animate);
    
    const now = performance.now();
    const deltaTime = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    
    // Update based on mode
    if (gameMode === 'player') {
      player.update(
        deltaTime, 
        (pos) => world.getGroundHeight(pos),
        (pos) => world.checkCollision(pos)
      );
    } else {
      orbitControls.update();
    }
    
    // Update digging debris
    diggingSystem.update(deltaTime);
    
    // Update world mesh if needed
    worldRenderer.update();
    
    // Animate core orb
    coreOrb.rotation.y += deltaTime * 0.5;
    coreGlow.rotation.y -= deltaTime * 0.3;
    
    // Check if player reached the core and grabbed the orb
    const distToCenter = player.getPosition().length();
    if (!hasOrb && distToCenter < orbRadius + 0.05) {
      hasOrb = true;
      scene.remove(coreOrb);
      scene.remove(coreGlow);
      ui.statusText.textContent = '🌟 You got the orb! Now dig to the ANTIPODE (opposite side)!';
      ui.statusText.style.color = '#FFD700';
      console.log('Orb collected! Now reach the antipode.');
    }
    
    // Show when player enters the core cavity
    if (player.isInCore(world.coreRadius) && !hasOrb) {
      ui.statusText.textContent = '🔮 You\'re in the core! Grab the golden orb!';
      ui.statusText.style.color = '#FFAA00';
    }
    
    // Check win condition (reached antipode with orb)
    if (hasOrb && !gameWon) {
      const currentDir = player.getPosition().clone().normalize();
      const dotProduct = currentDir.dot(startDirection);
      
      if (dotProduct < -0.9 && player.getPosition().length() > BASE_RADIUS * 0.9) {
        gameWon = true;
        ui.statusText.textContent = '🎉 YOU WIN! You brought the orb to the antipode!';
        ui.statusText.style.color = '#00FF00';
        ui.statusText.style.fontSize = '24px';
      }
    }
    
    // Update UI
    const dist = player.getPosition().length();
    const depthPercent = ((BASE_RADIUS - dist) / (BASE_RADIUS - world.coreRadius) * 100);
    const inCore = dist < world.coreRadius;
    
    if (inCore) {
      ui.depthText.textContent = `📍 IN THE CORE! Distance from center: ${(dist * 100).toFixed(1)}cm`;
    } else if (depthPercent > 0) {
      ui.depthText.textContent = `⛏️ Depth: ${depthPercent.toFixed(1)}% (${(dist * 100).toFixed(0)}cm from center)`;
    } else {
      ui.depthText.textContent = `🌍 On surface (radius: ${(dist * 100).toFixed(0)}cm)`;
    }
    
    // Update minimap
    minimap.update(player.getPosition(), hasOrb);
    
    // Update perf monitor
    const voxelCount = world.getAllVoxels().size;
    const triCount = renderer.info.render.triangles;
    perfMonitor.update(voxelCount, triCount);
    
    renderer.render(scene, camera);
  }

  animate();
}

class PerfMonitor {
  private container: HTMLElement;
  private fpsText: HTMLElement;
  private voxelText: HTMLElement;
  private frameText: HTMLElement;
  
  private frames: number[] = [];
  private lastUpdate: number = 0;
  
  constructor() {
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 4px;
      pointer-events: none;
      z-index: 1000;
    `;
    
    this.fpsText = document.createElement('div');
    this.voxelText = document.createElement('div');
    this.frameText = document.createElement('div');
    
    this.container.appendChild(this.fpsText);
    this.container.appendChild(this.voxelText);
    this.container.appendChild(this.frameText);
    document.body.appendChild(this.container);
  }
  
  update(voxelCount: number, triangleCount: number): void {
    const now = performance.now();
    this.frames.push(now);
    
    // Keep only last second of frames
    while (this.frames.length > 0 && this.frames[0] < now - 1000) {
      this.frames.shift();
    }
    
    // Update display every 100ms
    if (now - this.lastUpdate > 100) {
      const fps = this.frames.length;
      const fpsColor = fps >= 50 ? '#0f0' : fps >= 30 ? '#ff0' : '#f00';
      
      this.fpsText.innerHTML = `FPS: <span style="color:${fpsColor}">${fps}</span>`;
      this.voxelText.textContent = `Voxels: ${voxelCount.toLocaleString()}`;
      this.frameText.textContent = `Tris: ${triangleCount.toLocaleString()}`;
      
      this.lastUpdate = now;
    }
  }
}

function createUI(): { modeText: HTMLElement; statusText: HTMLElement; depthText: HTMLElement } {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    color: white;
    font-family: Arial, sans-serif;
    font-size: 14px;
    text-shadow: 1px 1px 2px black;
    pointer-events: none;
    z-index: 1000;
  `;
  
  const modeText = document.createElement('div');
  modeText.textContent = 'Spectator Mode (Tab to switch)';
  modeText.style.marginBottom = '5px';
  
  const depthText = document.createElement('div');
  depthText.textContent = 'Depth: 0%';
  depthText.style.marginBottom = '5px';
  
  const statusText = document.createElement('div');
  statusText.textContent = 'Dig to the center and find the golden orb!';
  statusText.style.color = '#88CCFF';
  
  const controls = document.createElement('div');
  controls.innerHTML = `
    <br>
    <strong>Controls:</strong><br>
    WASD - Move<br>
    Mouse - Look<br>
    Click - Dig<br>
    Space - Jump<br>
    Tab - Toggle mode
  `;
  controls.style.marginTop = '20px';
  controls.style.fontSize = '12px';
  controls.style.opacity = '0.8';
  
  container.appendChild(modeText);
  container.appendChild(depthText);
  container.appendChild(statusText);
  container.appendChild(controls);
  document.body.appendChild(container);
  
  // Crosshair
  const crosshair = document.createElement('div');
  crosshair.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 20px;
    height: 20px;
    pointer-events: none;
    z-index: 1000;
  `;
  crosshair.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="2" fill="none" stroke="white" stroke-width="1"/>
      <line x1="10" y1="0" x2="10" y2="6" stroke="white" stroke-width="1"/>
      <line x1="10" y1="14" x2="10" y2="20" stroke="white" stroke-width="1"/>
      <line x1="0" y1="10" x2="6" y2="10" stroke="white" stroke-width="1"/>
      <line x1="14" y1="10" x2="20" y2="10" stroke="white" stroke-width="1"/>
    </svg>
  `;
  document.body.appendChild(crosshair);
  
  return { modeText, statusText, depthText };
}

init();
