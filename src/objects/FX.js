import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared, rand, TAU, glowTexture, NOISE_GLSL } from '../core/utils.js';
import { ParticlePool } from './Particles.js';

/* ------------------------------------------------------------------ */
/* Glows                                                               */
/* ------------------------------------------------------------------ */

/** A soft additive glow sprite. */
export function glowSprite(color = 0x9ff3ff, scale = 1, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity }));
  s.scale.setScalar(scale);
  return s;
}

/* ------------------------------------------------------------------ */
/* Beams (repulsor blasts, the chest beam, lasers)                     */
/* ------------------------------------------------------------------ */

const BEAM_VS = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FS = /* glsl */ `
  uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
  varying vec2 vUv;
  void main(){
    float across = abs(vUv.x - 0.5) * 2.0;                 // 0 on the axis, 1 at the edge
    float core = pow(1.0 - across, 6.0);
    float glow = pow(1.0 - across, 1.6);
    float ripple = 0.8 + 0.2 * sin(vUv.y * 60.0 - uTime * 50.0);
    vec3 c = mix(uColor, vec3(1.0), core);
    gl_FragColor = vec4(c * (glow * 1.2 + core * 2.0) * ripple, glow * uAlpha);
  }`;

/**
 * A pool of beams. beams.fire(from, to, { width, life, color }) shoots a beam that flares and fades.
 * Each beam is a camera-facing ribbon, so it stays bright from any angle.
 */
export class Beams {
  constructor(scene, count = 12) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.translate(0, 0.5, 0); // from the origin up +y
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(0x9ff3ff) }, uAlpha: { value: 0 } },
        vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.items.push({ m, life: 0, age: 0, width: 0.2, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
    this._i = 0;
    this._dir = new THREE.Vector3(); this._side = new THREE.Vector3(); this._view = new THREE.Vector3();
  }

  fire(from, to, { width = 0.18, life = 0.35, color = 0x9ff3ff } = {}) {
    const b = this.items[this._i];
    this._i = (this._i + 1) % this.items.length;
    b.from.copy(from); b.to.copy(to); b.width = width; b.life = life; b.age = 0;
    b.m.material.uniforms.uColor.value.set(color);
    b.m.visible = true;
    return b;
  }

  /** Keeps a beam aimed each frame (for a held beam): beams.hold(b, from, to). */
  hold(b, from, to) { b.from.copy(from); b.to.copy(to); b.age = Math.min(b.age, b.life * 0.3); }

  update(dt, camera) {
    for (const b of this.items) {
      if (!b.m.visible) continue;
      b.age += dt;
      const k = b.age / b.life;
      if (k >= 1) { b.m.visible = false; continue; }
      b.m.material.uniforms.uAlpha.value = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      // a ribbon from `from` to `to`, turned to face the camera
      const d = this._dir.subVectors(b.to, b.from);
      const len = d.length();
      d.normalize();
      this._view.subVectors(camera.position, b.from).normalize();
      const side = this._side.crossVectors(d, this._view).normalize();
      const normal = this._view.crossVectors(side, d).normalize();
      const w = b.width * (1 + (1 - k) * 0.6);
      const m = b.m;
      m.matrixAutoUpdate = false;
      m.matrix.makeBasis(side.multiplyScalar(w), d.clone().multiplyScalar(len), normal);
      m.matrix.setPosition(b.from);
      m.matrixWorldNeedsUpdate = true;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Shockwaves                                                          */
/* ------------------------------------------------------------------ */

/** Expanding rings of light: waves.spawn(pos, { radius, life, color, normal }). */
export class Shockwaves {
  constructor(scene, count = 8) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.8, 1, 64);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      scene.add(m);
      this.items.push({ m, age: 0, life: 1, radius: 3 });
    }
    this._i = 0;
  }

  spawn(pos, { radius = 3, life = 0.8, color = 0x9ff3ff, normal = new THREE.Vector3(0, 1, 0) } = {}) {
    const w = this.items[this._i];
    this._i = (this._i + 1) % this.items.length;
    w.m.position.copy(pos);
    w.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    w.m.material.color.set(color);
    w.age = 0; w.life = life; w.radius = radius;
    w.m.visible = true;
  }

  update(dt) {
    for (const w of this.items) {
      if (!w.m.visible) continue;
      w.age += dt;
      const k = w.age / w.life;
      if (k >= 1) { w.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      w.m.scale.setScalar(0.05 + e * w.radius);
      w.m.material.opacity = (1 - k) * 0.9;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Explosions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Fireballs with sparks, smoke and a flash of light. boom.at(pos, size).
 * Uses a fixed pool of lights (always in the scene, just dimmed), so shaders never change.
 */
export class Explosions {
  constructor(scene, { lights = 2, low = false } = {}) {
    this.fire = new ParticlePool({ count: low ? 500 : 1200, drag: 2.2, buoyancy: 1.2, turbulence: 0.8, softness: 1.6 });
    this.sparks = new ParticlePool({ count: low ? 300 : 700, gravity: -9, drag: 0.6, softness: 1 });
    this.smoke = new ParticlePool({ count: low ? 200 : 400, blending: THREE.NormalBlending, drag: 1.5, buoyancy: 0.8, turbulence: 0.5, softness: 2.2 });
    scene.add(this.fire.points, this.sparks.points, this.smoke.points);
    this.lights = Array.from({ length: lights }, () => { const l = new THREE.PointLight(0xff8a40, 0, 30, 1.6); scene.add(l); return { l, e: 0 }; });
    this._li = 0;
    this.cFire = [new THREE.Color(0xffd28a), new THREE.Color(0xff8a30), new THREE.Color(0xff4a1a), new THREE.Color(0xffffff)];
    this.cSpark = [new THREE.Color(0xffe0a0), new THREE.Color(0xfff4d8)];
    this.cSmoke = [new THREE.Color(0x2a2522), new THREE.Color(0x3a332e)];
  }

  at(pos, size = 1) {
    this.fire.burst(pos, Math.round(60 * size), { speed: 4 * size, spread: size * 2, life: [0.4, 1.0], size: [0.4 * size, 1.1 * size], colors: this.cFire, grow: 1.5 });
    this.sparks.burst(pos, Math.round(50 * size), { speed: 12 * size, spread: size, up: 3, life: [0.4, 1.2], size: [0.05, 0.14], colors: this.cSpark });
    this.smoke.burst(pos, Math.round(24 * size), { speed: 1.6 * size, spread: size * 2.5, up: 1, life: [1.5, 3], size: [1 * size, 2.2 * size], colors: this.cSmoke, grow: 1.2, alpha: 0.55 });
    const L = this.lights[this._li];
    this._li = (this._li + 1) % this.lights.length;
    L.l.position.copy(pos);
    L.e = 30 * size;
  }

  /** A small shower of sparks (a hit, a hammer blow). */
  spark(pos, n = 20, speed = 5) {
    this.sparks.burst(pos, n, { speed, spread: 0.3, up: 2, life: [0.3, 0.8], size: [0.03, 0.08], colors: this.cSpark });
  }

  update(dt, t) {
    this.fire.update(dt, t); this.sparks.update(dt, t); this.smoke.update(dt, t);
    for (const L of this.lights) { L.e *= Math.exp(-5 * dt); L.l.intensity = L.e; }
  }
}

/* ------------------------------------------------------------------ */
/* Holographic floor grid                                              */
/* ------------------------------------------------------------------ */

export function holoGrid(size = 40, { color = 0x5fe3ff, cell = 1, fade = 0.5, opacity = 0.6 } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(color) }, uCell: { value: cell }, uSize: { value: size }, uFade: { value: fade }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uCell; uniform float uSize; uniform float uFade; uniform float uOpacity;
      varying vec3 vW;
      float line(float v, float w){ float f = abs(fract(v - 0.5) - 0.5) / fwidth(v); return 1.0 - clamp(f / w, 0.0, 1.0); }
      void main(){
        vec2 p = vW.xz / uCell;
        float g = max(line(p.x, 1.0), line(p.y, 1.0)) * 0.55 + max(line(p.x / 5.0, 1.4), line(p.y / 5.0, 1.4)) * 0.6;
        float r = length(vW.xz) / (uSize * 0.5);
        float fade = 1.0 - smoothstep(uFade, 1.0, r);
        float pulse = 0.5 + 0.5 * sin(r * 20.0 - uTime * 2.0);
        gl_FragColor = vec4(uColor * (1.0 + pulse * 0.4), g * fade * uOpacity);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -1;
  return m;
}

/* ------------------------------------------------------------------ */
/* Sky                                                                 */
/* ------------------------------------------------------------------ */

/** A gradient dome with stars (and an optional glow on the horizon, e.g. a city's light). */
export function nightSky({ radius = 400, top = 0x02040a, horizon = 0x0c1a2c, glow = 0x2a3a55, stars = 1500 } = {}) {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(top) }, uHor: { value: new THREE.Color(horizon) }, uGlow: { value: new THREE.Color(glow) } },
    vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uGlow; varying vec3 vP;
      void main(){
        float h = clamp(vP.y, -0.2, 1.0);
        vec3 c = mix(uHor, uTop, smoothstep(0.0, 0.5, h));
        c += uGlow * exp(-abs(h) * 14.0) * 0.8;
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  dome.renderOrder = -10;
  g.add(dome);
  if (stars) {
    const pos = new Float32Array(stars * 3);
    for (let i = 0; i < stars; i++) {
      const th = rand(0, TAU), y = rand(0.05, 1), r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * radius * 0.95, y * radius * 0.95, Math.sin(th) * r * radius * 0.95], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe6ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    pts.renderOrder = -9;
    g.add(pts);
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* A city at night                                                     */
/* ------------------------------------------------------------------ */

// Towers: three kinds of facade (glass offices lit a whole floor at a time, concrete apartment blocks
// with scattered rooms, older brick), windows in real units with mullions and floor slabs, rooms in
// different colour temperatures, dark glass reflecting the sky, the street lights' warm bounce on the
// lowest floors. Where a window gets smaller than a pixel the pattern fades to its average light, so
// distant towers never shimmer like pixels.
const CITY_FS = /* glsl */ `
  uniform float uTime; uniform vec3 uWin; uniform vec3 uBase; uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uSky; uniform float uLit;
  uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb;
  varying vec3 vW; varying vec3 vN; varying float vSeed; varying vec3 vLocal; varying vec3 vScale;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
  float hash1(float p){ return fract(sin(p * 91.7) * 43758.5453); }
  void main(){
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float kind = hash1(vSeed * 7.3);               // < .45 glass office, < .85 apartments, else brick
    float office = step(kind, 0.45), brick = step(0.85, kind);
    vec3 wall = uBase * mix(vec3(1.0), mix(vec3(0.75, 0.82, 0.95), vec3(1.25, 0.95, 0.8), brick), 0.6) * (0.75 + 0.5 * hash1(vSeed * 3.1));
    float y = vLocal.y * vScale.y;
    // ambient: the sky from above, the city's own glow from below
    float up = n.y * 0.5 + 0.5;
    vec3 c = wall * (0.1 + 0.16 * up + uAmb * (0.6 + 0.4 * up));
    // daylight pages: the low sun rakes across the walls that face it, the rest stay in shade
    float sunLit = max(dot(n, uSunDir), 0.0);
    c += wall * uSunCol * sunLit;
    c += vec3(1.0, 0.55, 0.25) * wall * 1.1 * exp(-y / 12.0) * (1.0 - abs(n.y));
    if (abs(n.y) < 0.5) {
      vec2 uv = abs(n.x) > 0.5 ? vec2((vLocal.z + 0.5) * vScale.z, y) : vec2((vLocal.x + 0.5) * vScale.x, y);
      float bay = mix(mix(2.6, 3.4, hash1(vSeed * 5.1)), 1.5, office);
      float storey = mix(3.1, 3.9, office);
      vec2 g = uv / vec2(bay, storey);
      vec2 cell = floor(g), f = fract(g);
      vec2 fw = fwidth(g);
      float detail = 1.0 - smoothstep(0.25, 0.7, max(fw.x, fw.y));
      // the glass: offices are nearly all glass (thin mullions, a slab band), homes have punched windows
      vec2 lo = mix(vec2(0.22, 0.3), vec2(0.04, 0.2), office), hi = 1.0 - mix(vec2(0.22, 0.18), vec2(0.04, 0.06), office);
      vec2 aa = fw * 1.2 + 0.001;
      float inWin = smoothstep(lo.x - aa.x, lo.x + aa.x, f.x) * (1.0 - smoothstep(hi.x - aa.x, hi.x + aa.x, f.x))
                  * smoothstep(lo.y - aa.y, lo.y + aa.y, f.y) * (1.0 - smoothstep(hi.y - aa.y, hi.y + aa.y, f.y));
      float area = (hi.x - lo.x) * (hi.y - lo.y);
      // which rooms are lit: offices by floor (and a few dark bays), homes room by room
      float floorOn = step(0.62, hash(vec2(cell.y, vSeed * 17.0)));
      float roomOn = step(0.78, hash(cell + vSeed * 13.1 + n.xz * 7.0));
      float on = mix(roomOn, floorOn * step(0.18, hash(cell * 1.3 + vSeed)), office) * step(1.0, cell.y) * uLit;
      float onAvg = mix(0.2, 0.3, office) * uLit;
      // colour temperature: warm tungsten, neutral, cool LED / fluorescent (offices), the odd blue TV
      float t = hash(cell * 2.7 + vSeed * 3.0);
      vec3 room = t < 0.5 ? vec3(1.0, 0.68, 0.38) : t < 0.8 ? vec3(1.0, 0.86, 0.66) : vec3(0.78, 0.88, 1.0);
      room = mix(room, vec3(0.82, 0.9, 1.0), office * 0.7);
      float tv = step(0.97, t) * (1.0 - office) * (0.6 + 0.4 * sin(uTime * 7.0 + t * 50.0));
      room = mix(room, vec3(0.45, 0.6, 1.0), tv);
      float inside = mix(0.55, 1.0, smoothstep(0.1, 0.9, f.y)) * mix(0.6, 1.25, hash(cell * 1.7 + vSeed));
      vec3 lit = uWin / vec3(1.0, 0.788, 0.541) * room * inside * 1.15;
      // dark glass reflects the sky (more at grazing angles), lit glass shows the room
      float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
      vec3 glass = uSky * (0.15 + 0.85 * fres) * mix(0.35, 0.9, office);
      // glass facing the sun catches a hot glare of it
      glass += uSunCol * pow(max(dot(reflect(-v, n), uSunDir), 0.0), 24.0) * 1.5 * office;
      vec3 win = mix(glass, lit, on);
      vec3 winAvg = mix(glass, uWin * 1.15 * vec3(1.0, 0.95, 0.9), onAvg * 0.7);
      vec3 near = mix(c, win, inWin);
      vec3 far = mix(c, winAvg, area);
      c = mix(far, near, detail);
    } else if (n.y > 0.5) {
      c = wall * 0.12; // the roof: dark gravel and plant
    }
    float d2 = dot(vW - cameraPosition, vW - cameraPosition);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * d2);
    gl_FragColor = vec4(mix(c, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
  }`;
const CITY_VS = /* glsl */ `
  attribute float aSeed;
  varying vec3 vW; varying vec3 vN; varying float vSeed; varying vec3 vLocal; varying vec3 vScale;
  void main(){
    vLocal = position;
    vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// Streets: asphalt, pavements, pools of sodium light along the kerbs, and traffic: white headlights in
// one lane, red tail lights in the other, moving. All in the ground's shader (one draw).
const STREET_VS = /* glsl */ `
  varying vec3 vW;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const STREET_FS = /* glsl */ `
  uniform float uTime; uniform float uBlock; uniform float uStreet; uniform float uHalf; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uTraffic;
  varying vec3 vW;
  float hash1(float p){ return fract(sin(p * 91.7) * 43758.5453); }
  // one direction of streets: returns light (rgb) and how much of the pixel is street (a)
  vec4 streets(float across, float along, float t){
    float k = floor(across / uBlock + 0.5);          // which street
    float d = across - k * uBlock;                    // from its centre line
    float w = uStreet * 0.5;
    float fw = fwidth(across) + 0.001;
    float road = 1.0 - smoothstep(w - 1.6 - fw, w - 1.6 + fw, abs(d));
    float kerb = 1.0 - smoothstep(w - fw, w + fw, abs(d));
    vec3 col = vec3(0.0);
    // street lamps every 14 m on both kerbs: a warm pool on the road
    float lampAlong = fract(along / 14.0 + hash1(k) ) - 0.5;
    float pool = exp(-lampAlong * lampAlong * 30.0) * exp(-pow(abs(d) - (w - 1.2), 2.0) * 0.12);
    col += vec3(1.0, 0.52, 0.18) * (0.09 + 0.9 * pool) * kerb;
    // traffic: two lanes, cars ~4 m long, spaced at random, fading to an even glow when too small to see
    float fa = fwidth(along) + 0.001;
    float detail = 1.0 - smoothstep(0.6, 3.0, fa);
    for (int lane = 0; lane < 2; lane++) {
      float side = lane == 0 ? -1.0 : 1.0;
      float laneD = d - side * 1.6;
      float inLane = exp(-laneD * laneD * 3.0);
      float spd = (7.0 + 6.0 * hash1(k * 3.1 + side)) * side;
      float spacing = 18.0 + 30.0 * hash1(k * 5.7 + side);
      float p = (along + t * spd) / spacing;
      float id = floor(p);
      float car = step(0.35, hash1(id * 1.7 + k + side)) * smoothstep(0.0, 0.02, fract(p)) * (1.0 - smoothstep(4.0 / spacing - 0.02, 4.0 / spacing, fract(p)));
      car = mix(0.35 * 4.0 / spacing, car, detail);
      vec3 lightCol = lane == 0 ? vec3(1.0, 0.92, 0.8) * 2.2 : vec3(1.0, 0.08, 0.04) * 2.0;
      col += lightCol * car * inLane * uTraffic;
    }
    return vec4(col, kerb);
  }
  void main(){
    float t = uTime;
    vec2 p = vW.xz + uHalf;
    vec4 a = streets(p.x, p.y, t);
    vec4 b = streets(p.y, p.x, t * 1.13);
    float inCity = 1.0 - smoothstep(uHalf - 10.0, uHalf + 30.0, max(abs(vW.x), abs(vW.z)));
    vec3 ground = vec3(0.012, 0.012, 0.014);
    vec3 c = ground + (max(a.rgb, b.rgb) + min(a.rgb, b.rgb) * 0.4) * inCity;
    float d2 = dot(vW - cameraPosition, vW - cameraPosition);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * d2);
    gl_FragColor = vec4(mix(c, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
  }`;

/**
 * A night city of lit towers as a single instanced mesh (one draw call): taller towards the centre,
 * streets on a grid (with street lights and traffic), a clear space left at `clear` (e.g. for a landing
 * pad), red aviation lights blinking on the tall ones. Returns { group, mesh, ground, heightAt(x, z), size }.
 * `sky`: the colour the dark glass reflects (the sky near the horizon). `lit`: share of rooms lit (0..1).
 * `groundSize`: the street plane's width (keep it inside the land, e.g. off a coast).
 * Daylight: `sun` (a direction), `sunColor`, `sunStrength` light the walls facing it; `ambient` adds the sky's haze.
 */
export function createCity({ size = 600, block = 22, street = 8, centre = new THREE.Vector2(0, 0), clear = null, fogColor = 0x0a1422, fogDensity = 0.004, win = 0xffc98a, base = 0x1a2230, maxH = 180, sky = null, lit = 1, traffic = 1, groundSize = size * 1.4, sun = null, sunColor = 0xffa060, sunStrength = 0, ambient = 0 } = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const n = Math.floor(size / block);
  const mats = [];
  const heights = new Map();
  const beacons = [];
  for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) {
    const x = (ix - n / 2) * block + block / 2, z = (iz - n / 2) * block + block / 2;
    const d = Math.hypot(x - centre.x, z - centre.y);
    if (clear && Math.hypot(x - clear.x, z - clear.y) < clear.r) continue;
    // one to four towers per block
    const k = Math.random() < 0.35 ? 1 : Math.random() < 0.7 ? 2 : 4;
    const inner = block - street;
    for (let q = 0; q < k; q++) {
      const w = k === 1 ? inner : k === 2 ? inner / 2 - 0.5 : inner / 2 - 0.5;
      const dz = k === 4 ? inner / 2 - 0.5 : inner;
      const ox = k === 1 ? 0 : (q % 2 ? 1 : -1) * (inner / 4);
      const oz = k === 4 ? (q < 2 ? -1 : 1) * (inner / 4) : 0;
      const hMax = maxH * Math.exp(-d / (size * 0.22));
      const h = Math.max(6, hMax * rand(0.25, 1) * (Math.random() < 0.06 ? 1.6 : 1));
      const sx = w * rand(0.8, 1), sz = dz * rand(0.8, 1);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x + ox, 0, z + oz), new THREE.Quaternion(), new THREE.Vector3(sx, h, sz));
      mats.push(m);
      if (h > 70) for (const [cx, cz] of [[-1, -1], [1, 1]]) beacons.push(x + ox + cx * sx * 0.45, h + 1, z + oz + cz * sz * 0.45);
      const key = `${ix},${iz}`;
      heights.set(key, Math.max(heights.get(key) || 0, h));
    }
  }
  const fogC = new THREE.Color(fogColor);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime, uWin: { value: new THREE.Color(win) }, uBase: { value: new THREE.Color(base) },
      uFogColor: { value: fogC }, uFogDensity: { value: fogDensity },
      uSky: { value: sky ? new THREE.Color(sky) : fogC.clone().multiplyScalar(1.4) }, uLit: { value: lit },
      uSunDir: { value: sun ? sun.clone().normalize() : new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(sunColor).multiplyScalar(sun ? sunStrength : 0) },
      uAmb: { value: fogC.clone().multiplyScalar(ambient) },
    },
    vertexShader: CITY_VS, fragmentShader: CITY_FS,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
  const seeds = new Float32Array(mats.length);
  mats.forEach((m, i) => { mesh.setMatrixAt(i, m); seeds[i] = Math.random(); });
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.computeBoundingSphere();
  const group = new THREE.Group();
  group.add(mesh);
  // the ground: streets, street lights and traffic, all in its shader
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime, uBlock: { value: block }, uStreet: { value: street }, uHalf: { value: (n / 2) * block },
      uFogColor: { value: fogC }, uFogDensity: { value: fogDensity }, uTraffic: { value: traffic },
    },
    vertexShader: STREET_VS, fragmentShader: STREET_FS,
  }));
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  // red aviation lights on the tall towers, blinking together (as they do)
  if (beacons.length) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
    const bm = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(1, 0.06, 0.03).multiplyScalar(4) } },
      vertexShader: /* glsl */ `void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(900.0 / -mv.z, 1.5, 5.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uColor;
        void main(){ vec2 q = gl_PointCoord - 0.5; float a = exp(-dot(q, q) * 14.0); float blink = smoothstep(0.0, 0.08, fract(uTime * 0.5)) * (1.0 - smoothstep(0.35, 0.5, fract(uTime * 0.5))); gl_FragColor = vec4(uColor * a * blink, a * blink); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const pts = new THREE.Points(bg, bm);
    pts.frustumCulled = false;
    group.add(pts);
  }
  const heightAt = (x, z) => heights.get(`${Math.floor(x / block + n / 2)},${Math.floor(z / block + n / 2)}`) || 0;
  return { group, mesh, ground, heightAt, size };
}

/* ------------------------------------------------------------------ */
/* Enemy drones                                                        */
/* ------------------------------------------------------------------ */

let _droneGeo = null;
/** A hostile drone: a dark hull with a ring of vents and a red eye. One merged mesh + an eye. */
export function createDrone() {
  if (!_droneGeo) {
    const parts = [];
    const hull = new THREE.SphereGeometry(0.5, 20, 14); hull.scale(1, 0.55, 1.2); parts.push(hull);
    const ring = new THREE.TorusGeometry(0.62, 0.07, 8, 28); ring.rotateX(Math.PI / 2); parts.push(ring);
    for (let k = 0; k < 4; k++) {
      const fin = new THREE.BoxGeometry(0.08, 0.05, 0.5); fin.translate(0, 0, 0.62); fin.rotateY(k * Math.PI / 2 + Math.PI / 4); parts.push(fin);
    }
    _droneGeo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; }));
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(_droneGeo, new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.35 }));
  body.castShadow = true;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }));
  eye.position.set(0, -0.05, 0.55);
  g.add(body, eye);
  g.userData = { body, eye };
  return g;
}

/* ------------------------------------------------------------------ */
/* Energy field shader (plasma, the reactor's light)                   */
/* ------------------------------------------------------------------ */

/** An animated plasma surface (additive). */
export function plasmaMaterial(color = 0x7fe6ff, { speed = 1, scale = 2, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(color) }, uSpeed: { value: speed }, uScale: { value: scale }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime; uniform vec3 uColor; uniform float uSpeed; uniform float uScale; uniform float uOpacity;
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        float n = snoise(vP * uScale + vec3(0.0, uTime * uSpeed, uTime * uSpeed * 0.5)) * 0.5 + 0.5;
        float n2 = snoise(vP * uScale * 2.3 - vec3(uTime * uSpeed * 0.7)) * 0.5 + 0.5;
        float f = pow(1.0 - abs(dot(normalize(vN), vV)), 1.5);
        float v = pow(n * n2, 1.5) * 2.0 + f * 0.8;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), pow(n * n2, 3.0)) * v, clamp(v, 0.0, 1.0) * uOpacity);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
