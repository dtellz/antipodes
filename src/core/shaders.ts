import * as THREE from 'three';

export const inflationVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float inflation;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    
    // Expand the vertex along its normal
    vec3 newPosition = position + (normal * inflation);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  }
`;

export const inflationFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform vec3 color;

  void main() {
    // Simple diffuse lighting for testing
    vec3 lightDir = normalize(vec3(5.0, 5.0, 5.0));
    float diff = max(dot(vNormal, lightDir), 0.2); // Ambient + Diffuse
    
    gl_FragColor = vec4(color * diff, 1.0);
  }
`;

export function createInflationMaterial(color: number, inflation: number = 0.01): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      inflation: { value: inflation },
      color: { value: new THREE.Color(color) }
    },
    vertexShader: inflationVertexShader,
    fragmentShader: inflationFragmentShader,
  });
}
