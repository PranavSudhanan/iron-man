import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Film look: chromatic aberration, colour grade, vignette, grain and flashes. */
export function createCinematicPass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uGrain: { value: 0.035 },
      uVig: { value: 0.55 },
      uCA: { value: 0.012 },
      uSat: { value: 1 },
      uTint: { value: new THREE.Color(1, 0.15, 0.15) },
      uTintAmt: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 0.95, 0.9) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
      uniform float uGrain; uniform float uVig; uniform float uCA; uniform float uSat;
      uniform vec3 uTint; uniform float uTintAmt; uniform float uFlash; uniform vec3 uFlashColor;
      varying vec2 vUv;
      float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 c = vUv - 0.5;
        float r2 = dot(c, c);
        vec2 off = c * uCA * (0.4 + r2 * 3.0);
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        col = mix(col, l * uTint * 2.2 + col * 0.15, uTintAmt);
        col *= 1.0 - uVig * smoothstep(0.25, 0.95, length(c) * 1.35);
        col += (rnd(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * uGrain * (0.6 + l);
        col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }`,
  });
}

export const DEFAULT_GRADE = { grain: 0.025, vig: 0.45, ca: 0.002, sat: 1, tint: 0xff2626, tintAmt: 0 };
