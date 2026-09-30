import * as THREE from 'three';
import { shared, rand } from '../core/utils.js';

/**
 * CPU-simulated particle pool rendered as soft round points.
 * Works for embers, sparks, smoke and (with normal blending) Amaterasu's black flames.
 */
export class ParticlePool {
  constructor({
    count = 1500,
    blending = THREE.AdditiveBlending,
    rim = 0x000000,
    rimAmount = 0,
    softness = 1.4,
    gravity = 0,
    drag = 1,
    turbulence = 0,
    buoyancy = 0,
  } = {}) {
    this.count = count;
    this.gravity = gravity;
    this.drag = drag;
    this.turbulence = turbulence;
    this.buoyancy = buoyancy;
    this.cursor = 0;
    this.live = 0;
    this.fresh = false;

    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    this.size = new Float32Array(count);
    this.baseSize = new Float32Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.seed = new Float32Array(count);
    this.maxAlpha = new Float32Array(count);

    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aColor', this.colAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPointScale: shared.uPointScale,
        uRim: { value: new THREE.Color(rim) },
        uRimAmt: { value: rimAmount },
        uSoft: { value: softness },
      },
      transparent: true,
      depthWrite: false,
      blending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
        uniform float uPointScale;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha <= 0.0 ? 0.0 : min(aSize * uPointScale / max(-mv.z, 0.1), 220.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uRim; uniform float uRimAmt; uniform float uSoft;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float a = pow(1.0 - d, uSoft);
          vec3 c = mix(vColor, uRim, smoothstep(0.15, 0.95, d) * uRimAmt);
          gl_FragColor = vec4(c, a * vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }

  /**
   * Emit one particle. opts: {x,y,z, vx,vy,vz, life, size, color:THREE.Color, grow, alpha}
   */
  emit(o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    const c = o.color;
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
    this.age[i] = 0;
    this.life[i] = o.life || 1;
    this.baseSize[i] = o.size || 0.2;
    this.grow[i] = o.grow ?? 0;
    this.maxAlpha[i] = o.alpha ?? 1;
    this.seed[i] = Math.random() * 100;
    this.fresh = true;
  }

  burst(origin, n, { speed = 3, spread = 1, up = 0, life = [0.6, 1.2], size = [0.1, 0.3], color, colors, grow = 0, alpha = 1 } = {}) {
    for (let k = 0; k < n; k++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(rand(-1, 1));
      const s = speed * rand(0.3, 1);
      this.emit({
        x: origin.x + rand(-0.1, 0.1) * spread, y: origin.y + rand(-0.1, 0.1) * spread, z: origin.z + rand(-0.1, 0.1) * spread,
        vx: Math.sin(ph) * Math.cos(th) * s, vy: Math.cos(ph) * s + up, vz: Math.sin(ph) * Math.sin(th) * s,
        life: rand(life[0], life[1]), size: rand(size[0], size[1]),
        color: colors ? colors[Math.floor(Math.random() * colors.length)] : color, grow, alpha,
      });
    }
  }

  update(dt, t) {
    // nothing alive and nothing new: skip the CPU loop, the GPU upload and the draw call
    if (!this.live && !this.fresh) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    const { pos, vel, age, life, alpha, size } = this;
    const drag = Math.exp(-this.drag * dt);
    let live = 0;
    for (let i = 0; i < this.count; i++) {
      if (age[i] >= life[i]) { alpha[i] = 0; continue; }
      live++;
      age[i] += dt;
      const k = age[i] / life[i];
      if (k >= 1) { alpha[i] = 0; continue; }
      const i3 = i * 3;
      if (this.turbulence) {
        const s = this.seed[i];
        vel[i3] += Math.sin(t * 3.1 + pos[i3 + 1] * 1.7 + s) * this.turbulence * dt;
        vel[i3 + 2] += Math.cos(t * 2.7 + pos[i3] * 1.3 + s) * this.turbulence * dt;
      }
      vel[i3 + 1] += (this.gravity + this.buoyancy) * dt;
      vel[i3] *= drag; vel[i3 + 1] *= drag; vel[i3 + 2] *= drag;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      alpha[i] = Math.min(1, k * 8) * (1 - k) * this.maxAlpha[i];
      size[i] = this.baseSize[i] * Math.max(0.01, 1 + this.grow[i] * k);
    }
    this.posAttr.needsUpdate = true;
    if (this.fresh) this.colAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.live = live;
    this.fresh = false;
  }

  clear() {
    this.age.fill(0);
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
