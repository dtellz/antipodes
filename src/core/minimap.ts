import * as THREE from 'three';

export interface MinimapConfig {
  size: number;
  margin: number;
  planetRadius: number;
  coreRadius: number;
}

/**
 * A 2D minimap showing a cross-section of the planet.
 * Displays player position, core orb, and dug tunnels.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: MinimapConfig;
  
  private playerPos: THREE.Vector3 = new THREE.Vector3();
  private hasOrb: boolean = false;
  private startDirection: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  constructor(config: Partial<MinimapConfig> = {}) {
    this.config = {
      size: 150,
      margin: 15,
      planetRadius: 1.0,
      coreRadius: 0.15,
      ...config
    };

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.config.size;
    this.canvas.height = this.config.size;
    this.canvas.style.cssText = `
      position: fixed;
      bottom: ${this.config.margin}px;
      right: ${this.config.margin}px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
    `;
    document.body.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;
  }

  public setStartDirection(dir: THREE.Vector3): void {
    this.startDirection.copy(dir).normalize();
  }

  public update(
    playerPosition: THREE.Vector3,
    hasOrb: boolean,
    dugCells?: Set<string>
  ): void {
    this.playerPos.copy(playerPosition);
    this.hasOrb = hasOrb;

    const ctx = this.ctx;
    const size = this.config.size;
    const center = size / 2;
    const scale = (size / 2 - 10) / this.config.planetRadius;

    // Clear
    ctx.clearRect(0, 0, size, size);

    // Draw planet outline
    ctx.beginPath();
    ctx.arc(center, center, this.config.planetRadius * scale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(60, 100, 60, 0.4)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 200, 100, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw shell rings
    ctx.strokeStyle = 'rgba(100, 150, 100, 0.2)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 5; i++) {
      const r = (this.config.coreRadius + (this.config.planetRadius - this.config.coreRadius) * (i / 5)) * scale;
      ctx.beginPath();
      ctx.arc(center, center, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw core cavity
    ctx.beginPath();
    ctx.arc(center, center, this.config.coreRadius * scale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(40, 30, 50, 0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 100, 50, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw core orb (if not collected)
    if (!this.hasOrb) {
      ctx.beginPath();
      ctx.arc(center, center, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD700';
      ctx.fill();
      ctx.strokeStyle = '#FFA500';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Glow effect
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, 10);
      gradient.addColorStop(0, 'rgba(255, 215, 0, 0.5)');
      gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.beginPath();
      ctx.arc(center, center, 10, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Draw start position marker (where player needs to return with orb)
    const startX = center + this.startDirection.x * this.config.planetRadius * scale;
    const startY = center - this.startDirection.y * this.config.planetRadius * scale;
    ctx.beginPath();
    ctx.arc(startX, startY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00FF00';
    ctx.fill();
    ctx.font = '8px Arial';
    ctx.fillStyle = '#00FF00';
    ctx.fillText('START', startX - 15, startY - 8);

    // Draw antipode marker
    const antiX = center - this.startDirection.x * this.config.planetRadius * scale;
    const antiY = center + this.startDirection.y * this.config.planetRadius * scale;
    ctx.beginPath();
    ctx.arc(antiX, antiY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#FF6600';
    ctx.fill();
    ctx.fillStyle = '#FF6600';
    ctx.fillText('GOAL', antiX - 12, antiY + 15);

    // Draw player position
    // Project 3D position to 2D (use XY plane, ignore Z for simplicity)
    const playerDist = this.playerPos.length();
    const playerDir = this.playerPos.clone().normalize();
    
    // Use the dominant axis for 2D projection
    const px = center + playerDir.x * playerDist * scale;
    const py = center - playerDir.y * playerDist * scale;

    // Player trail/direction indicator
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(px, py);
    ctx.strokeStyle = 'rgba(0, 150, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Player dot
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = this.hasOrb ? '#FFD700' : '#00AAFF';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Player direction arrow
    const arrowLen = 8;
    const arrowDir = playerDir.clone();
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + arrowDir.x * arrowLen, py - arrowDir.y * arrowLen);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Depth indicator text
    const depthPercent = Math.max(0, (this.config.planetRadius - playerDist) / (this.config.planetRadius - this.config.coreRadius) * 100);
    ctx.font = 'bold 10px Arial';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    
    if (playerDist < this.config.coreRadius) {
      ctx.fillText('IN CORE', center, size - 5);
    } else {
      ctx.fillText(`${depthPercent.toFixed(0)}% deep`, center, size - 5);
    }
  }

  public dispose(): void {
    this.canvas.remove();
  }
}
