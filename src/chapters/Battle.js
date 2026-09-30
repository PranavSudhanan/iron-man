import * as THREE from 'three';
import './Battle.css';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Chapter } from '../core/Chapter.js';
import { CineCam } from '../core/CineCam.js';
import { Suit, POSES, suitEnvironment } from '../objects/Suit.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { Beams, Shockwaves, Explosions, createDrone, createCity, glowSprite } from '../objects/FX.js';
import { mergeStatic } from '../core/mergeStatic.js';
import { rand, damp, clamp, TAU, h, drawTexture, shared } from '../core/utils.js';
import { loadEnv, envMap, backdrop, loadTextures, hasTextures, pbr, HDRIS } from '../core/Env.js';

/*
 * Battle over a city at dusk. The suit hovers above the rooftops while drones pour out of a hostile carrier.
 * Tap a drone to fire, hold for a charged blast, fire micro-missiles or the chest beam; drag to look around.
 * Three waves, then the carrier's shield drops and it becomes the target.
 */

const SUIT = new THREE.Vector3(0, 80, 0);
const CARRIER = new THREE.Vector3(0, 128, 175);
const BAY = new THREE.Vector3(0, 119, 175);
const WAVES = [8, 12, 16];
const POOL = 24;
const MISSILE_CD = 9, UNI_CD = 14, REBOOT = 3, CARRIER_HP = 100;
const UP = new THREE.Vector3(0, 1, 0);
const LEGS = ['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clonePose = (p) => { const o = {}; for (const k in p) o[k] = p[k].slice(); o.spine = o.spine || [0, 0, 0]; o.neck = o.neck || [0, 0, 0]; for (const k of LEGS) o[k] = POSES.hover[k].slice(); return o; };
const SUN_DIR = new THREE.Vector3(-380, 70, 1000).normalize();
// the photographed dusk: its sun sits at u = 0.65 of the panorama, turned here to lie along SUN_DIR
const SKY_ROT = (0.65 - 0.5) * TAU - Math.atan2(SUN_DIR.z, SUN_DIR.x);
// the sky dome uses only the photo's clean stretch u 0.475..0.93 (open sea horizon: no apartment blocks or mountain), mirrored
// round the circle: the same sun on the rising half of the mirror
const SKY_U0 = 0.475, SKY_U1 = 0.93;
const SKY_MROT = ((0.65 - SKY_U0) / (SKY_U1 - SKY_U0) / 2 - 0.5) * TAU - Math.atan2(SUN_DIR.z, SUN_DIR.x);

/**
 * The carrier's force field: all but invisible at rest, a faint bright rim where it is seen edge-on and a
 * slow heat-shimmer of a lattice; hits make the lattice flare for a moment. uOpacity: 0.1 at rest, more when hit.
 */
function shieldMaterial(color = 0xffc2a0) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uOpacity: { value: 0.1 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float k = uOpacity * 10.0;                       // 1 at rest
        float f = 1.0 - abs(dot(normalize(vN), vV));
        float rim = pow(f, 6.0);
        vec2 hp = vec2(vUv.x * 90.0, vUv.y * 44.0);
        hp.x += mod(floor(hp.y), 2.0) * 0.5;
        vec2 c = abs(fract(hp) - 0.5);
        float hexl = smoothstep(0.44, 0.5, max(c.x * 1.1, c.y));
        float ripple = smoothstep(0.97, 1.0, sin(vUv.y * 18.0 - uTime * 1.2) * 0.5 + 0.5);
        float hit = max(k - 1.0, 0.0);
        float a = rim * 0.07 * k + hexl * f * f * (0.012 + 0.06 * hit) + ripple * rim * 0.05 + hexl * hit * 0.02;
        gl_FragColor = vec4(uColor * (1.4 + rim * 1.5 + hit * 0.8), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---- photographed sky, aerial perspective, the far city (local helpers; the same ones live in Hud.js) ---- */

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** The average colour (linear) of a sky photo just above its horizon, between photo u0..u1: the haze colour. */
function horizonColor(tex, u0, u1, fallback, e0 = 0.4, e1 = 3.5) {
  const c = new THREE.Color(fallback);
  const img = tex && tex.image;
  if (!img) return c;
  try {
    const W = 512, H = 256;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, W, H);
    const y0 = Math.round(H / 2 - (e1 / 180) * H), y1 = Math.max(y0 + 1, Math.round(H / 2 - (e0 / 180) * H));
    const d = x.getImageData(Math.round(u0 * W), y0, Math.max(1, Math.round((u1 - u0) * W)), y1 - y0).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += toLin(d[i] / 255); g += toLin(d[i + 1] / 255); b += toLin(d[i + 2] / 255); n++; }
    if (n) c.setRGB(r / n, g / n, b / n);
  } catch (e) { /* keep the fallback */ }
  return c;
}

/**
 * The photographed sky on a dome that follows the camera. Only the sky half of the photo is used: below the
 * horizon (the photographer's street) it becomes the haze the city is fogged into, so the city meets the real
 * sky at the horizon. rot turns the photo (radians, same sense as scene.environmentRotation.y); with mirror the
 * clean stretch u0..u1 of the panorama is ping-ponged around the full circle (hides buildings in the photo).
 */
function photoSky(tex, { radius = 1400, rot = 0, fog, sun, intensity = 1.2, haze = 0.05, u0 = 0, u1 = 1, mirror = false, blur = 1, boost = 1.6, smoothTop = 0 }) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex }, uRot: { value: rot }, uInt: { value: intensity }, uHaze: { value: haze },
      uU0: { value: u0 }, uU1: { value: u1 }, uMirror: { value: mirror ? 1 : 0 }, uBlur: { value: blur }, uBoost: { value: boost }, uSmoothTop: { value: smoothTop },
      uFog: { value: fog.clone() }, uSun: { value: sun.clone().normalize() },
    },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uRot, uInt, uHaze, uU0, uU1, uMirror, uBlur, uBoost, uSmoothTop; uniform vec3 uFog, uSun;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float a = (atan(d.z, d.x) + uRot) * 0.15915494 + 0.5;
        vec2 ga = vec2(dFdx(a), dFdy(a)); ga -= floor(ga + 0.5);
        float u; vec2 gu;
        if (uMirror > 0.5) { float f = fract(a); u = uU0 + (uU1 - uU0) * (1.0 - abs(2.0 * f - 1.0)); gu = ga * 2.0 * (uU1 - uU0); }
        else { u = fract(a); gu = ga; }
        float y = d.y;
        float v = asin(clamp(max(y, 0.004), -1.0, 1.0)) * 0.31830989 + 0.5;
        vec2 gv = vec2(dFdx(v), dFdy(v));
        // a smooth photographed gradient shows its 8-bit JPEG blocks when enlarged: read from a softer mip
        gu *= uBlur; gv *= uBlur;
        vec3 col = textureGrad(uMap, vec2(u, v), vec2(gu.x, gv.x), vec2(gu.y, gv.y)).rgb;
        // (optionally) a clear sky's upper reaches from a far softer read: no enlarged compression blocks overhead
        if (uSmoothTop > 0.0) {
          vec3 soft = textureGrad(uMap, vec2(u, v), vec2(gu.x, gv.x) * 24.0, vec2(gu.y, gv.y) * 24.0).rgb;
          col = mix(col, soft, smoothstep(0.08, 0.35, y) * uSmoothTop);
        }
        // the photo clips the sun and the brightest cloud edges at white: give them back some range
        float m = max(col.r, max(col.g, col.b));
        col *= uInt * (1.0 + smoothstep(0.9, 1.0, m) * uBoost);
        // aerial perspective: the horizon dissolves into the haze, brighter toward the sun
        float s = max(dot(d, uSun), 0.0);
        vec3 hz = uFog * (1.0 + pow(s, 10.0) * 1.2);
        col = mix(hz, col, smoothstep(-0.004, uHaze, y));
        col = mix(col, hz * 0.55, smoothstep(0.0, -0.35, y));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The rest of the city out to the horizon: instanced towers (one draw) with lit windows drawn in world space,
 * averaged out where they get smaller than a pixel so the distance doesn't shimmer. Fog takes them into the haze.
 */
function farTowers({ n, rMin, rMax, hMin, hMax, a0 = 0, a1 = TAU, color = 0x2a2828, win = 0xffb070, winK = 0.5, clear = null }) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.15 });
  const uWin = { value: new THREE.Color(win).multiplyScalar(winK) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWin = uWin;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW; varying float vUp; varying float vSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 fw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
          vSeed = float(gl_InstanceID);
        #else
          vSeed = 0.0;
        #endif
        vFW = (modelMatrix * fw).xyz; vUp = abs(normal.y);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uWin; varying vec3 vFW; varying float vUp; varying float vSeed;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 q = vec2((vFW.x + vFW.z) / 2.6, vFW.y / 3.4);
          vec2 cell = floor(q), f = fract(q);
          float inWin = step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.72);
          float r = h21(cell + vSeed * 7.31);
          float lit = step(0.8, r) * (0.55 + 0.45 * h21(cell * 1.7 + 3.1));
          float fine = clamp(1.4 - max(fwidth(q.x), fwidth(q.y)) * 1.6, 0.0, 1.0);
          float w = mix(0.07, inWin * lit, fine) * (1.0 - step(0.5, vUp)) * step(2.5, vFW.y);
          totalEmissiveRadiance += uWin * w * mix(vec3(1.0), vec3(0.75, 0.85, 1.1), step(0.93, r));
        }`);
  };
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, n);
  const dm = new THREE.Object3D();
  let i = 0;
  for (let tries = 0; i < n && tries < n * 4; tries++) {
    const a = rand(a0, a1), r = rMin + (rMax - rMin) * Math.pow(Math.random(), 1.35);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (clear && clear(x, z)) continue;
    const fall = Math.exp(-((r - rMin) / (rMax - rMin)) * 1.6);
    dm.position.set(x, 0, z);
    dm.rotation.set(0, Math.round(rand(0, 4)) * Math.PI / 2 + rand(-0.08, 0.08), 0);
    const w = rand(12, 32);
    dm.scale.set(w, Math.max(hMin, rand(hMin, hMax) * fall * (Math.random() < 0.08 ? 1.7 : 1)), w * rand(0.6, 1.4));
    dm.updateMatrix();
    mesh.setMatrixAt(i++, dm.matrix);
  }
  mesh.count = i;
  mesh.computeBoundingSphere();
  return mesh;
}

/** A ground that carries the city out to the horizon under the fog. */
function farLand(size = 8000) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0x0a0909, roughness: 0.95, metalness: 0 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.6;
  return m;
}

/**
 * Explosions that read as fireballs rather than glow: a hot core cooling to deep red at the edge, dark smoke
 * with a sunlit rim, and a slower column of smoke left hanging after each blast.
 */
function realisticBooms(boom, k, smokeCols) {
  const U = (p) => p.material.uniforms;
  U(boom.fire).uRim.value.set(0x4a1204); U(boom.fire).uRimAmt.value = 0.85; U(boom.fire).uSoft.value = 1.1;
  U(boom.smoke).uRim.value.set(0x6a5448); U(boom.smoke).uRimAmt.value = 0.35; U(boom.smoke).uSoft.value = 2.2;
  // the fire is drawn over its own smoke (additive light over a dark body), never hidden behind it
  boom.smoke.points.renderOrder = 1; boom.fire.points.renderOrder = 2; boom.sparks.points.renderOrder = 2;
  boom.cFire.splice(0, boom.cFire.length, ...[0xffb868, 0xff8a38, 0xe0561c, 0xffc878].map((c) => new THREE.Color(c).multiplyScalar(k)));
  boom.cSpark.splice(0, boom.cSpark.length, ...[0xffd8a0, 0xfff0d0].map((c) => new THREE.Color(c).multiplyScalar(k)));
  boom.cSmoke.splice(0, boom.cSmoke.length, new THREE.Color(0x2e2925), new THREE.Color(0x3a332e));
  // smoke that rolls, spreads and rises instead of hanging as a ball
  boom.smoke.turbulence = 2.2; boom.smoke.buoyancy = 1.4;
  // a moment after the flash, the fireball rolls over into a slower, larger body of smoke
  const at = boom.at.bind(boom), update = boom.update.bind(boom), later = [];
  boom.at = (pos, size = 1) => { at(pos, size); if (later.length < 24) later.push({ t: 0.22, pos: pos.clone(), size }); };
  boom.update = (dt, t) => {
    for (let i = later.length - 1; i >= 0; i--) {
      const q = later[i];
      if ((q.t -= dt) > 0) continue;
      later.splice(i, 1);
      boom.smoke.burst(q.pos, Math.round(8 * q.size), { speed: 1.8 * q.size, spread: q.size * 3, up: 1.4, life: [2.8, 5], size: [1.6 * q.size, 3 * q.size], colors: smokeCols, grow: 1.5, alpha: 0.5 });
    }
    update(dt, t);
  };
}

export class Battle extends Chapter {
  constructor(app) {
    super(app, { id: 'battle', title: 'Battle', jp: 'DEFENSE' });
    this.bloom = { strength: 0.95, radius: 0.55, threshold: 0.78 };
    this.grade = { ...this.grade, grain: 0.022, vig: 0.42, ca: 0.0025, sat: 1, tint: 0xff7a3a, tintAmt: 0.03 };
    this.mood = 'calm';
    this.shiftView = 0.08;
    this.trail = false;
    this.phase = 'idle'; // idle | break | wave | boss | finale | victory
    this.seen = false;
  }

  /* ------------------------------------------------------------------ */
  /* Build                                                                */
  /* ------------------------------------------------------------------ */

  load() { return Promise.all([loadModels(['classic']), loadEnv(HDRIS.fire, { backdrop: true }), loadTextures(['concrete_floor_worn_001'])]); }

  build() {
    const s = this.scene, low = this.app.low;
    // the sculpted armor, shown exactly as authored (the procedural suit is only a silent fallback)
    const real = new RealSuit('classic', { castShadow: false });
    this.real = real.ok;
    // its lacquered metal glints: raise the bloom threshold and push every effect's colour past 1 instead
    this.hdr = this.real ? 3.5 : 1;
    this.bloomBase = 0.95;
    if (this.real) this.bloom = { strength: 0.9, radius: 0.5, threshold: 2.6 };
    // a real photographed dusk: its light on every surface (turned so its sun is our sun), its sky behind
    const env = envMap(HDRIS.fire), sky = backdrop(HDRIS.fire);
    s.environment = env || suitEnvironment();
    s.environmentIntensity = env ? 0.75 : 0.6;
    if (env) s.environmentRotation.set(0, SKY_ROT, 0);
    // the haze is the photo's own horizon colour, so the fogged city melts into the real sky
    const haze = this.haze = horizonColor(sky, 0.3, 0.95, 0x6a4a50).multiplyScalar(0.8);
    s.background = haze.clone();
    s.fog = new THREE.FogExp2(haze.clone(), 0.002);
    this.camera.fov = 55; this.camera.near = 0.3; this.camera.far = 1600;
    this.camera.position.set(0, 82, -9);
    this.camera.updateProjectionMatrix();

    // scratch
    this.ray = new THREE.Raycaster();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._fwd = new THREE.Vector3(); this._right = new THREE.Vector3(); this._end = new THREE.Vector3();
    this._palm = new THREE.Vector3(); this._pdir = new THREE.Vector3(); this._o = new THREE.Vector3();
    this._sp = SUIT.clone(); this._chest = new THREE.Vector3(); this._cc = CARRIER.clone(); this._acc = new THREE.Vector3();
    this._line = new THREE.Line3(); this._dummy = new THREE.Object3D(); this._camLook = new THREE.Vector3();
    this.queue = [];

    // sky, sun, city
    if (sky) {
      this.sky = photoSky(sky, { radius: 1400, rot: SKY_MROT, fog: haze, sun: SUN_DIR, intensity: 0.85, haze: 0.045, u0: SKY_U0, u1: SKY_U1, mirror: true, blur: 1.3 });
      s.add(this.sky);
    }
    this.city = createCity({ size: 560, block: 24, street: 9, clear: { x: 0, y: 0, r: 30 }, fogColor: haze.getHex(), fogDensity: 0.002, win: 0xffb070, base: 0x2e2628, maxH: 125, sun: SUN_DIR, sunColor: 0xffa066, sunStrength: 2.0, ambient: 0.3, lit: 0.6, sky: haze.getHex() });
    s.add(this.city.group);
    // the rest of the city out to the horizon (one draw), and the ground under it
    s.add(farTowers({ n: low ? 260 : 520, rMin: 310, rMax: 1150, hMin: 14, hMax: 150, color: 0x3a3634, win: 0xffb070, winK: 0.55 }));
    s.add(farLand());

    // light: the photo's low sun ahead (rims the suit), its lavender sky as a soft fill, the carrier's red bay light
    s.add(new THREE.HemisphereLight(0x9a90b8, 0x2a1c18, env ? 0.4 : 0.8));
    const key = new THREE.DirectionalLight(0xffa066, 2.4);
    key.position.copy(SUIT).addScaledVector(SUN_DIR, 150);
    key.target.position.copy(SUIT);
    s.add(key, key.target);
    const fill = new THREE.DirectionalLight(0x9aa0d8, env ? 0.45 : 0.9);
    fill.position.copy(SUIT).add(this._v.set(30, 40, -80));
    fill.target.position.copy(SUIT);
    s.add(fill, fill.target);
    this.bayLight = new THREE.PointLight(0xff2a2a, 0, 150, 1.1);
    this.bayLight.position.copy(BAY).y -= 4;
    s.add(this.bayLight);

    this._buildCarrier();
    this._buildPlumes();

    // the suit
    this.suit = this.real ? real : new Suit({ scheme: 'mk7', castShadow: false });
    this.suit.root.rotation.order = 'YXZ';
    this.suit.root.position.copy(SUIT);
    if (!this.real) this.suit.pose('hover', 1);
    this.suit.reactor = 1; this.suit.eyes = 1; this.suit.faceOpen = 0; this.suit.thrust = 0.85;
    s.add(this.suit.root);
    this.poses = { hover: clonePose(POSES.hover), r: clonePose(POSES.blastR), l: clonePose(POSES.blastL), uni: clonePose(POSES.unibeam) };
    this.poseMode = '';
    this.yaw = 0; this.yawT = 0; this.lean = 0.05;
    this.aimPoint = new THREE.Vector3(); this.aimHold = 0; this.armUp = 0; this.side = 'r'; this.aimSide = 'r';
    this.palmT = { l: 0, r: 0 };

    // drones: shared materials and eye geometry
    const droneMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.35 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3030).multiplyScalar(2.2 * this.hdr), toneMapped: false });
    const eyeGeo = new THREE.SphereGeometry(0.16, 12, 10);
    this.drones = Array.from({ length: POOL }, () => {
      const g = createDrone();
      const { body, eye } = g.userData;
      body.material.dispose(); body.material = droneMat; body.castShadow = false;
      eye.material.dispose(); eye.material = eyeMat;
      eye.geometry.dispose(); eye.geometry = eyeGeo;
      g.visible = false;
      s.add(g);
      return { g, state: 'off', vel: new THREE.Vector3(), seed: 0, w: 0, R: 16, hgt: 0, fireT: 0, t: 0, locked: false };
    });

    // missiles: one instanced mesh
    const missileGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.07, 0.55, 6).rotateX(Math.PI / 2),
      new THREE.ConeGeometry(0.07, 0.18, 6).rotateX(Math.PI / 2).translate(0, 0, 0.36),
    ]);
    this.missileMesh = new THREE.InstancedMesh(missileGeo, new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.6, roughness: 0.4 }), 16);
    this.missileMesh.frustumCulled = false;
    this._dummy.scale.setScalar(0); this._dummy.updateMatrix();
    for (let i = 0; i < 16; i++) this.missileMesh.setMatrixAt(i, this._dummy.matrix);
    s.add(this.missileMesh);
    this.missiles = Array.from({ length: 16 }, () => ({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), drone: null, carrier: false, lock: null, t: 0 }));

    // effects
    this.beams = new Beams(s, 10);
    this.lasers = new Beams(s, 18);
    this.bolts = Array.from({ length: 18 }, () => ({ on: false, b: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(), aim: new THREE.Vector3(), hit: false, t: 0 }));
    this.waves = new Shockwaves(s, 6);
    this.boom = new Explosions(s, { lights: 3, low });
    this.trailSmoke = new ParticlePool({ count: low ? 400 : 800, blending: THREE.NormalBlending, drag: 1.2, turbulence: 0.6, softness: 2.2 });
    this.trailFire = new ParticlePool({ count: low ? 300 : 500, drag: 2, softness: 1.4 });
    s.add(this.trailSmoke.points, this.trailFire.points);
    this.cSmoke = [new THREE.Color(0x6a6660), new THREE.Color(0x7a746c)];
    this.cFire = [new THREE.Color(0xffd28a), new THREE.Color(0xff8a30), new THREE.Color(0xffffff)];
    this.cShield = [new THREE.Color(0xff6a4a), new THREE.Color(0xffc0a0)];
    this.muzzle = glowSprite(0xbff6ff, 0.01, 1); s.add(this.muzzle);
    this.halo = glowSprite(0x9ff3ff, 0.01, 0); s.add(this.halo);
    this.chestGlow = glowSprite(0xcff8ff, 0.01, 0); s.add(this.chestGlow);
    this.muzzleT = 1;
    if (this.real) {
      for (const sp of [this.muzzle, this.halo, this.chestGlow]) { sp.material.color.multiplyScalar(this.hdr); sp.material.toneMapped = false; }
      for (const c of [...this.cFire, ...this.cShield]) c.multiplyScalar(this.hdr * 0.8);
    }
    // explosions: fireballs with dark smoke, not blobs of glow
    realisticBooms(this.boom, this.real ? 1.3 : 1, [new THREE.Color(0x2a2420), new THREE.Color(0x36302a), new THREE.Color(0x201c19)]);
    this.trailSmoke.material.uniforms.uRim.value.set(0x9a8a80); this.trailSmoke.material.uniforms.uRimAmt.value = 0.35;

    this.cine = new CineCam(this.camera);
    this.uni = { active: false, t: 0, cd: 0, beam: null, boomT: 0 };
    this.mis = { cd: 0 };
    this.camYaw = 0; this.camYawT = 0; this.camPitch = 0.08; this.camPitchT = 0.08;
    this.shake = 0; this.bloomKick = 0;
    this.charge = 0; this.chargeFull = false; this._skipClickUntil = 0;
    this.pending = { on: false, t: 0, side: 'r', power: 0, drone: null, carrier: false, shield: false, point: new THREE.Vector3() };
    this._buildUI();
    this._resetWorld();
  }

  _buildCarrier() {
    const s = this.scene;
    const panel = drawTexture(512, 256, (x, w, hh) => {
      x.fillStyle = '#707480'; x.fillRect(0, 0, w, hh);
      for (let k = 0; k < 70; k++) {
        const v = Math.floor(rand(88, 128));
        x.fillStyle = `rgb(${v},${v},${v + 6})`;
        x.fillRect(rand(0, w), rand(0, hh), rand(20, 120), rand(10, 60));
      }
      x.strokeStyle = 'rgba(20,22,26,0.8)'; x.lineWidth = 2; x.beginPath();
      for (let k = 0; k < 40; k++) x.rect(Math.floor(rand(0, w)), Math.floor(rand(0, hh)), rand(30, 160), rand(16, 70));
      x.stroke();
    });
    panel.wrapS = panel.wrapT = THREE.RepeatWrapping;
    panel.repeat.set(4, 2);
    const hullMat = new THREE.MeshStandardMaterial({ map: panel, color: 0x4a4d55, metalness: 0.75, roughness: 0.8 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1d21, metalness: 0.85, roughness: 0.6 });
    // weathered plate: the scuffs, dents and grime of a worn surface photographed for real (its relief and roughness)
    const wear = hasTextures('concrete_floor_worn_001') ? pbr('concrete_floor_worn_001', { repeat: [3, 1.5] }) : null;
    if (wear) {
      for (const m of [hullMat, trimMat]) { m.normalMap = wear.normalMap; m.normalScale.set(0.7, 0.7); m.roughnessMap = wear.roughnessMap; }
      hullMat.aoMap = wear.aoMap;
    }
    this.redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a2a).multiplyScalar(3), toneMapped: false });
    this.redK = 3 * Math.max(1, this.hdr * 0.8);
    this.bayMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(1.6), toneMapped: false, side: THREE.DoubleSide });
    const engineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a2a).multiplyScalar(2.5 * this.hdr), toneMapped: false });

    const g = this.carrier = new THREE.Group();
    g.position.copy(CARRIER);
    s.add(g);
    const mk = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    const light = new THREE.SphereGeometry(0.55, 8, 6);
    this.chunks = [];
    const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.72, 0.5).multiplyScalar(1.8), toneMapped: false });
    const chunk = (x, len, r) => {
      const c = new THREE.Group();
      c.position.set(x, 0, 0);
      c.userData = { base: c.position.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), falling: false };
      g.add(c);
      this.chunks.push(c);
      // the hull: a flattened octagonal body, deck and keel plates, angled armour skirts along both sides
      const hull = new THREE.CylinderGeometry(r, r * 0.94, len, 8, 1); hull.rotateZ(Math.PI / 2); hull.rotateX(Math.PI / 8); hull.scale(1, 0.4, 1);
      mk(c, hull, hullMat, 0, 0, 0);
      mk(c, new THREE.BoxGeometry(len * 0.92, 1.3, r * 0.95), trimMat, 0, 0.4 * r + 0.3, 0);
      mk(c, new THREE.BoxGeometry(len * 0.86, 1.6, r * 0.7), trimMat, 0, -0.4 * r - 0.4, 0);
      for (const sz of [-1, 1]) {
        const skirt = mk(c, new THREE.BoxGeometry(len * 0.94, r * 0.34, 0.9), hullMat, 0, -0.05 * r, sz * r * 0.93);
        skirt.rotation.x = sz * -0.45;
        // running-light strips and rows of lit ports along the sides
        mk(c, new THREE.BoxGeometry(len * 0.8, 0.28, 0.12), this.redMat, 0, 0.1 * r, sz * (r * 0.99));
        const ports = [];
        for (let lx = -len / 2 + 2; lx <= len / 2 - 2; lx += 1.6) if (Math.random() < 0.6) ports.push(new THREE.BoxGeometry(0.7, 0.35, 0.1).translate(lx, -0.12 * r, sz * r * 1.0));
        if (ports.length) mk(c, mergeGeometries(ports), windowMat, 0, 0, 0);
      }
      // deck greebles: vents, blocks, antennae
      const bits = [];
      for (let k = 0; k < 22; k++) {
        const w = rand(1, 4), hh = rand(0.4, 2.2), dd = rand(1, 3.5);
        bits.push(new THREE.BoxGeometry(w, hh, dd).translate(rand(-len / 2 + 2, len / 2 - 2), 0.4 * r + 0.95 + hh / 2, rand(-r * 0.4, r * 0.4)));
      }
      mk(c, mergeGeometries(bits), trimMat, 0, 0, 0);
      return c;
    };
    const L = chunk(-30, 30, 11), C = chunk(0, 30, 12.5), R = chunk(30, 30, 11);
    // armoured ribs
    for (const [c, xs] of [[L, [-10, 0, 10]], [C, [-11, 11]], [R, [-8, 4]]]) for (const x of xs) mk(c, new THREE.BoxGeometry(1.4, 9, 23.5), trimMat, x, 0, 0);
    // the prow
    const prow = new THREE.ConeGeometry(11, 20, 6, 1); prow.rotateZ(-Math.PI / 2); prow.scale(1, 0.5, 1);
    mk(R, prow, hullMat, 25, 0, 0);
    // the engine block and its three nozzles
    const eng = new THREE.CylinderGeometry(9, 11, 10, 6); eng.rotateZ(Math.PI / 2); eng.scale(1, 0.55, 1);
    mk(L, eng, trimMat, -20, 0, 0);
    this.engineGlows = [];
    for (const [y, z] of [[0, -5], [0, 5], [2.6, 0]]) {
      mk(L, new THREE.CylinderGeometry(2.4, 2.8, 2, 12).rotateZ(Math.PI / 2), trimMat, -26, y, z);
      mk(L, new THREE.CircleGeometry(2.2, 16).rotateY(-Math.PI / 2), engineMat, -27.05, y, z);
      const gl = glowSprite(0xff6a2a, 8, 0.6); gl.position.set(-28.5, y, z); L.add(gl); this.engineGlows.push(gl);
    }
    // the launch bay under the middle, the command tower above it, gun turrets
    mk(C, new THREE.BoxGeometry(24, 5, 15), trimMat, 0, -6, 0);
    mk(C, new THREE.PlaneGeometry(18, 8).rotateX(Math.PI / 2), this.bayMat, 0, -8.56, 0);
    mk(C, new THREE.BoxGeometry(12, 7, 9), hullMat, 0, 8, 0);
    mk(C, new THREE.BoxGeometry(7, 4, 6), trimMat, -1, 13, 0);
    mk(C, new THREE.CylinderGeometry(0.3, 0.3, 9, 6), trimMat, 2, 18, 0);
    mk(C, new THREE.CylinderGeometry(0.25, 0.25, 6, 6), trimMat, -3, 17, 2);
    mk(C, light, this.redMat, 2, 22.7, 0);
    for (const [c, x] of [[C, -8], [C, 9], [R, -2], [L, 4]]) {
      mk(c, new THREE.BoxGeometry(3, 1.6, 3), trimMat, x, -5.6, -6);
      mk(c, new THREE.CylinderGeometry(0.35, 0.35, 5, 6).rotateX(Math.PI / 2), trimMat, x, -5.8, -9);
    }
    for (const c of this.chunks) mergeStatic(c);
    this.bayGlow = glowSprite(0xff2020, 14, 0.3); this.bayGlow.position.set(0, -10, 0); C.add(this.bayGlow);
    this.carrierMeshes = [];
    for (const c of this.chunks) c.traverse((o) => { if (o.isMesh) this.carrierMeshes.push(o); });
    // the shield
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), shieldMaterial(0xffc2a0));
    this.shield.scale.set(66, 28, 30);
    g.add(this.shield);
  }

  _buildPlumes() {
    const s = this.scene;
    this.smoke = new ParticlePool({ count: this.app.low ? 420 : 760, blending: THREE.NormalBlending, drag: 0.25, buoyancy: 0.35, turbulence: 0.6, softness: 2.2 });
    this.embers = new ParticlePool({ count: 260, drag: 0.8, buoyancy: 1.5, softness: 1.4 });
    s.add(this.smoke.points, this.embers.points);
    this.cPlume = [new THREE.Color(0x3a3430), new THREE.Color(0x4a423c), new THREE.Color(0x2e2a27)];
    this.smoke.points.renderOrder = 1; this.embers.points.renderOrder = 2;
    this.smoke.material.uniforms.uRim.value.set(0x8a7066); this.smoke.material.uniforms.uRimAmt.value = 0.4;
    this.cEmber = [new THREE.Color(0xff8a30), new THREE.Color(0xffc060)];
    this.plumes = [];
    for (let k = 0; k < 7; k++) {
      let x = 0, z = 0, y = 0;
      for (let tries = 0; tries < 16; tries++) {
        const a = Math.PI / 2 + rand(-1.15, 1.15), d = rand(55, 170);
        x = Math.cos(a) * d; z = Math.sin(a) * d; y = this.city.heightAt(x, z);
        if (y > 12) break;
      }
      const glow = glowSprite(0xff7a2a, 9, 0.6);
      glow.material.color.multiplyScalar(1.6);
      glow.position.set(x, y + 3, z);
      s.add(glow);
      this.plumes.push({ x, y, z, glow });
    }
  }

  _buildUI() {
    this.intro({
      kicker: 'Last line',
      title: 'Battle over the <em>City</em>',
      jp: 'DEFENSE',
      desc: 'A hostile carrier hangs over the skyline at dusk, launching drone after drone. Hold the air above the rooftops: three waves, and then the carrier itself. The armor reboots if it drops — it never gives up.',
      extra: [
        this.gestures([['tap', '<b>Tap</b> a drone to fire'], ['hold', '<b>Hold</b> &amp; release: charged blast'], ['drag', '<b>Drag</b> to look around'], ['key', '<b>F</b> missiles · <b>Space</b> chest beam']]),
      ],
    });
    const weapon = (label, key, fn) => {
      const b = this.button(`<span>${label}</span><kbd>${key}</kbd><i class="bt-cd"></i>`, fn, 'bt-weapon');
      return { b, cd: b.querySelector('.bt-cd'), last: -1 };
    };
    this.wMis = weapon('Missiles', 'F', () => this._missiles());
    this.wUni = weapon('Unibeam', 'Space', () => this._unibeam());
    this.ui.append(h('div.controls', {}, h('div.group', {}, this.wMis.b, this.wUni.b)));

    const pill = (label, cls = '') => { const b = h('b', { text: '—' }); return { el: h(`div.pill${cls}`, {}, label, b), b, last: '' }; };
    const meter = (label, cls) => { const v = h('span', { text: '' }); const f = h(`div.meter-fill${cls}`); return { el: h('div.meter', {}, h('div.meter-label', {}, h('span', { text: label }), v), h('div.meter-track', {}, f)), v, f, last: -1 }; };
    this.hud = { wave: pill('Wave'), left: pill('Hostiles'), down: pill('Downed', '.opt') };
    this.mInt = meter('Armor', '');
    this.mMis = meter('Missiles', '.gold');
    this.mUni = meter('Chest beam', '.gold');
    this.mMis.el.classList.add('opt'); this.mUni.el.classList.add('opt');
    this.ui.append(h('div.hud-corner', {}, this.hud.wave.el, this.hud.left.el, this.hud.down.el, this.mInt.el, this.mMis.el, this.mUni.el));

    this.bossPct = h('span', { text: '100%' });
    this.bossFill = h('div.bt-boss-fill');
    this.boss = h('div.bt-boss.hidden', {}, h('div.bt-boss-label', {}, h('span', { text: 'Carrier hull' }), this.bossPct), h('div.bt-boss-track', {}, this.bossFill));
    this.rebootFill = h('em');
    this.rebootEl = h('div.bt-reboot', {}, h('b', { text: 'Rebooting' }), h('span', { text: 'J.A.R.V.I.S. is restarting the armor' }), h('i', {}, this.rebootFill));
    this.locks = Array.from({ length: 8 }, () => ({ el: h('div.lock-box', {}, h('span', { text: 'LOCK' })), on: false, drone: null, carrier: false, off: new THREE.Vector3() }));
    this.comboEl = h('div.combo');
    this.titleB = h('b'); this.titleS = h('span');
    this.titleEl = h('div.big-title', {}, this.titleB, this.titleS);
    this.cardStats = h('div.bt-report');
    this.cardTime = h('div.big');
    this.card = h('div.game-card.hidden', { role: 'dialog', 'aria-label': 'Battle report' },
      h('span.bt-kicker', { text: 'After-action report' }), h('h3', { text: 'Airspace secured' }), this.cardTime, this.cardStats,
      this.button('Replay', () => this._replay(), 'btn-primary'));
    this.ui.append(this.boss, this.rebootEl, ...this.locks.map((l) => l.el), this.comboEl, this.titleEl, this.card);
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                            */
  /* ------------------------------------------------------------------ */

  enter() {
    if (!this.seen) {
      this.seen = true;
      this.app.toast('<b>Tap</b> a drone to fire · <b>hold</b> to charge · <b>drag</b> to look around.', 4000);
      this._after(2.2, () => { if (this.phase === 'idle') this._startBattle(); });
    }
    if (this.phase === 'wave' || this.phase === 'boss' || this.phase === 'break') { this.app.sfx.setMood('battle', 30); this.moodT = 25; }
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    this.app.cinema(false);
    if (this.phase === 'finale') { this.cine.stop(); }
    this.charge = 0; this.chargeFull = false;
  }

  resize(w, hgt) {
    this.portrait = w / hgt < 0.85;
    if (!this.cine?.active) this.camera.fov = this.portrait ? 66 : 55;
    if (this.cine) this.cine.baseFov = this.camera.fov;
    super.resize(w, hgt);
  }

  _after(t, fn) { this.queue.push({ t, fn }); }

  _title(big, small) {
    this.titleB.textContent = big; this.titleS.textContent = small;
    this.titleEl.classList.remove('on'); void this.titleEl.offsetWidth; this.titleEl.classList.add('on');
  }

  /* ------------------------------------------------------------------ */
  /* Battle flow                                                          */
  /* ------------------------------------------------------------------ */

  _resetWorld() {
    for (const d of this.drones) { d.state = 'off'; d.g.visible = false; }
    for (const b of this.bolts) if (b.on) this._endBolt(b);
    for (const m of this.missiles) m.on = false;
    for (const l of this.locks) { l.on = false; l.el.classList.remove('on'); }
    for (const c of this.chunks) {
      c.position.copy(c.userData.base); c.rotation.set(0, 0, 0); c.visible = true; c.userData.falling = false;
    }
    this.shield.visible = true;
    this.shield.material.uniforms.uOpacity.value = 0.1;
    this.shieldFade = 0;
    this.carrierHp = CARRIER_HP; this._hpShown = -1;
    this.integrity = 100; this.lastHit = 9; this.rebooting = 0; this.sink = 0;
    this.uni.cd = 0; this.uni.active = false; this.mis.cd = 0;
    this.wave = 0; this.toSpawn = 0; this.downed = 0; this.shots = 0; this.hitShots = 0; this.fightTime = 0;
    this.carrierAtkT = 6; this.telegraph = 0; this.escortT = 2;
    this.multi = 0; this.multiT = 0;
    this.suit.eyes = 1; this.suit.reactor = 1; this.suit.thrust = 0.85;
    this.boss.classList.add('hidden');
    this.rebootEl.classList.remove('on');
    this.card.classList.add('hidden');
  }

  _startBattle() {
    this.phase = 'break';
    this.breakT = 1.2;
    this.app.sfx.setMood('battle', 30);
    this.moodT = 25;
  }

  _replay() {
    this.queue.length = 0;
    this._resetWorld();
    this.app.sfx.powerUp();
    this._title('Engage', 'Hostiles inbound');
    this._startBattle();
    this.breakT = 2;
  }

  _beginWave(n) {
    this.wave = n;
    this.toSpawn = WAVES[n - 1];
    this.spawnT = 0.6;
    this.phase = 'wave';
    this._title(`Wave ${n}`, n === 3 ? 'Final wave — the carrier is watching' : 'Hostile drones inbound');
    this.app.sfx.alarm();
  }

  _aliveDrones() { let n = 0; for (const d of this.drones) if (d.state !== 'off') n++; return n; }

  _launchDrone() {
    const d = this.drones.find((x) => x.state === 'off');
    if (!d) return false;
    d.state = 'launch';
    d.t = 0;
    d.seed = rand(0, TAU);
    d.w = rand(0.14, 0.3) * (Math.random() < 0.5 ? -1 : 1);
    d.R = rand(13, 22);
    d.hgt = rand(-5, 8);
    d.fireT = rand(2.5, 4.5);
    d.g.position.copy(BAY).add(this._v.set(rand(-6, 6), -1, rand(-3, 3)));
    d.vel.set(rand(-12, 12), -14, -34);
    d.g.scale.setScalar(1);
    d.g.visible = true;
    this.bayPulse = 1;
    return true;
  }

  _shieldDown() {
    this.phase = 'boss';
    this.shieldFade = 1;
    this._title('Shield down', 'Target the carrier');
    this.app.sfx.powerDown();
    this.app.sfx.boom();
    this.app.flash(0.4, 0xff8a5a);
    this.boss.classList.remove('hidden');
    this.escortT = 3;
    this.carrierAtkT = 5;
  }

  _hurtCarrier(n, point) {
    if (this.phase !== 'boss' || this.carrierHp <= 0) return;
    const before = this.carrierHp;
    this.carrierHp = Math.max(0, this.carrierHp - n);
    this.boom.spark(point, 18, 9);
    this.boss.classList.remove('hit'); void this.boss.offsetWidth; this.boss.classList.add('hit');
    // every tenth of the hull lost: a secondary blast somewhere on it
    if (Math.floor(before / 10) !== Math.floor(this.carrierHp / 10)) {
      this.boom.at(this._v.copy(this.carrier.position).add(this._v2.set(rand(-35, 35), rand(-4, 5), rand(-8, 8))), 2.4);
      this.app.sfx.boom();
    }
    if (this.carrierHp <= 0) this._finale();
  }

  _finale() {
    this.phase = 'finale';
    this.app.cinema(true);
    this.boss.classList.add('hidden');
    this.pending.on = false;
    this.uni.active = false;
    for (const b of this.bolts) if (b.on) this._endBolt(b);
    this.drones.forEach((d, i) => { if (d.state !== 'off') this._after(0.1 + i * 0.07, () => { if (d.state !== 'off') this._killDrone(d, false); }); });
    const C = this.carrier.position;
    const hull = () => this._v.copy(C).add(this._v2.set(rand(-35, 35), rand(-4, 6), rand(-9, 9)));
    const chain = (t, size) => this._after(t, () => { this.boom.at(hull(), size); this.app.sfx.boom(); this.cine.shake = Math.max(this.cine.shake, 0.6); });
    [0.2, 0.7, 1.1, 1.5, 1.8].forEach((t, i) => chain(t, 2 + i * 0.4));
    this._after(2.2, () => this._breakApart());
    [3.2, 4.4, 5.6].forEach((t) => this._after(t, () => {
      const c = this.chunks[Math.floor(Math.random() * 3)];
      if (c.visible) { this.boom.at(c.getWorldPosition(this._v), 3); this.app.sfx.boom(); }
    }));
    const behind = () => this._v3.copy(this._sp).add(this._v2.set(0, 2.2, -9));
    const ahead = () => this._camLook.copy(this._sp).add(this._v2.set(0, 4, 30));
    this.cine.baseFov = this.camera.fov;
    this.cine.play([
      { t: 1.6, pos: new THREE.Vector3(-150, 104, 60), look: C.clone(), fov: 42 },
      { t: 4.0, pos: new THREE.Vector3(-136, 98, 72), look: () => this._chunkCenter(), fov: 40, linear: true },
      { t: 4.1, pos: new THREE.Vector3(72, 40, 96), look: () => this._chunkCenter(), fov: 46, cut: true },
      { t: 8.2, pos: new THREE.Vector3(58, 46, 84), look: () => this._chunkCenter(), fov: 44, linear: true },
      { t: 10, pos: behind, look: ahead, fov: this.camera.fov },
    ], { onEnd: () => this._victory() });
  }

  _breakApart() {
    const [L, C, R] = this.chunks;
    L.userData.vel.set(-7, 1, 4); L.userData.spin.set(0.1, 0.05, 0.35);
    C.userData.vel.set(0, -2, 1); C.userData.spin.set(-0.08, 0, -0.06);
    R.userData.vel.set(8, 2, -3); R.userData.spin.set(-0.05, -0.08, -0.4);
    for (const c of this.chunks) { c.userData.falling = true; this.boom.at(c.getWorldPosition(this._v), 4.5); }
    this.shield.visible = false;
    this.app.flash(1, 0xffd0a0);
    this.app.sfx.boom(); this.app.sfx.unibeam();
    this.cine.shake = 2.2;
    this.waves.spawn(this.carrier.position, { radius: 120, life: 1.6, color: 0x3a2a20, normal: this._v.set(0, 0, 1) });
    this.bloomKick = 1.2;
  }

  _chunkCenter() {
    let n = 0;
    const acc = this._acc.set(0, 0, 0);
    for (const c of this.chunks) if (c.visible) { acc.add(c.getWorldPosition(this._v2)); n++; }
    if (n) this._cc.copy(acc.multiplyScalar(1 / n));
    return this._cc;
  }

  _victory() {
    this.app.cinema(false);
    this.phase = 'victory';
    const acc = this.shots ? Math.round((this.hitShots / this.shots) * 100) : 0;
    this.cardTime.textContent = fmtTime(this.fightTime);
    this.cardStats.replaceChildren(...[[this.downed, 'Drones down'], [`${acc}%`, 'Accuracy'], [fmtTime(this.fightTime), 'Time']]
      .map(([v, k]) => h('div', {}, h('b', { text: String(v) }), h('span', { text: k }))));
    this.card.classList.remove('hidden');
    this.app.sfx.chime();
    this.app.sfx.setMood('calm', 1);
  }

  /* ------------------------------------------------------------------ */
  /* Combat                                                               */
  /* ------------------------------------------------------------------ */

  _killDrone(d, byPlayer = true) {
    if (d.state === 'off') return;
    d.state = 'off';
    d.g.visible = false;
    this.boom.at(d.g.position, 1.3);
    const now = performance.now();
    if (now - (this._boomAt || 0) > 90) { this._boomAt = now; this.app.sfx.boom(); }
    if (!byPlayer) return;
    this.downed++;
    this.multi++;
    this.multiT = 1.1;
    if (this.multi >= 2) {
      this.comboEl.textContent = this.multi === 2 ? 'Double' : this.multi === 3 ? 'Triple' : `${this.multi}× multi-kill`;
      this.comboEl.classList.remove('on'); void this.comboEl.offsetWidth; this.comboEl.classList.add('on');
    }
  }

  _damage(n, at) {
    this.boom.spark(at, 14, 5);
    if (this.rebooting > 0 || this.phase === 'finale' || this.phase === 'victory') return;
    this.integrity = Math.max(0, this.integrity - n);
    this.lastHit = 0;
    this.app.sfx.thud();
    this.shake = Math.max(this.shake, 0.25);
    this.app.flash(0.12, 0xff3030);
    const now = performance.now();
    if (now - (this._bleedAt || 0) > 900) { this._bleedAt = now; this.app.bleed(); }
    if (this.integrity <= 0) {
      this.rebooting = REBOOT;
      this.suit.eyes = 0; this.suit.reactor = 0.2; this.suit.thrust = 0.35;
      this.rebootEl.classList.add('on');
      this.app.sfx.powerDown();
      this.app.flash(0.4, 0xff2020);
    }
  }

  _fireBolt(d) {
    const b = this.bolts.find((x) => !x.on);
    if (!b) return;
    b.on = true; b.t = 0;
    b.hit = Math.random() < 0.42 + this.wave * 0.06;
    b.pos.copy(d.g.position);
    b.aim.copy(this._chest);
    if (!b.hit) b.aim.add(this._v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 3.5)));
    b.vel.subVectors(b.aim, b.pos).normalize().multiplyScalar(70);
    b.b = this._hdrBeam(this.lasers.fire(b.pos, this._v.copy(b.pos).addScaledVector(b.vel, 0.03), { width: 0.22, life: 0.4, color: 0xff2a2a }));
    const now = performance.now();
    if (now - (this._zapAt || 0) > 140) { this._zapAt = now; this.app.sfx.zap(); }
  }

  /** Pushes a beam's colour past 1 so it still flares under the raised bloom threshold. */
  _hdrBeam(b) { b.m.material.uniforms.uColor.value.multiplyScalar(this.hdr); return b; }

  /** World position of a shoulder (for the missile launch), on either kind of suit. */
  _shoulderWorld(side, out) {
    const suit = this.suit;
    if (this.real) { suit.root.updateWorldMatrix(true, false); return out.set(side === 'l' ? 0.2 : -0.2, 1.52, -0.08).applyMatrix4(suit.root.matrixWorld); }
    if (suit.j) return suit.j[side === 'l' ? 'shoulderL' : 'shoulderR'].getWorldPosition(out);
    return suit.headWorld(out);
  }

  _endBolt(b) { b.on = false; if (b.b) b.b.age = b.b.life; }

  /** The live drone nearest the screen point, within `radius` px. */
  _nearestDrone(ndc, radius) {
    const W = this.app.width, H = this.app.height;
    const px = (ndc.x * 0.5 + 0.5) * W, py = (-ndc.y * 0.5 + 0.5) * H;
    let best = radius, pick = null;
    for (const d of this.drones) {
      if (d.state === 'off') continue;
      const v = this._v.copy(d.g.position).project(this.camera);
      if (v.z > 1) continue;
      const dist = Math.hypot((v.x * 0.5 + 0.5) * W - px, (-v.y * 0.5 + 0.5) * H - py);
      if (dist < best) { best = dist; pick = d; }
    }
    return pick;
  }

  _canFire() { return this.phase !== 'finale' && this.phase !== 'idle' && !this.uni.active && this.rebooting <= 0; }

  _shoot(ndc, power) {
    if (!this._canFire()) return;
    const ps = this.pending;
    if (ps.on) this._fire(ps);
    const d = this._nearestDrone(ndc, power ? 160 : this.app.isTouch ? 90 : 70);
    ps.drone = d; ps.carrier = false; ps.shield = false;
    if (d) ps.point.copy(d.g.position);
    else {
      this.ray.setFromCamera(ndc, this.camera);
      let hits = null;
      if (this.phase === 'boss') {
        hits = this.ray.intersectObjects(this.carrierMeshes, false);
        if (hits.length) { ps.carrier = true; ps.point.copy(hits[0].point); }
      } else if (this.shield.visible) {
        hits = this.ray.intersectObject(this.shield, false);
        if (hits.length) { ps.shield = true; ps.point.copy(hits[0].point); }
      }
      if (!ps.carrier && !ps.shield) ps.point.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, 140);
    }
    const side = this.side;
    this.side = side === 'r' ? 'l' : 'r';
    ps.on = true; ps.side = side; ps.power = power;
    ps.t = this.poseMode === side && this.armUp > 0.12 ? 0.03 : 0.13;
    this.aimSide = side;
    this.aimPoint.copy(ps.point);
    this.aimHold = 1.3;
    this.shots++;
  }

  _fire(ps) {
    ps.on = false;
    const app = this.app, heavy = ps.power > 0;
    // a shot leaves the hand; a heavy one (real armor) is driven from the chest reactor
    const pos = this.real && heavy ? this.suit.reactorWorld(this._palm) : this.suit.palmWorld(ps.side, this._palm, this._pdir).pos;
    const live = ps.drone && ps.drone.state !== 'off';
    if (live) ps.point.copy(ps.drone.g.position);
    this._hdrBeam(this.beams.fire(pos, ps.point, { width: heavy ? 0.35 + ps.power * 0.5 : 0.2, life: heavy ? 0.5 : 0.3, color: heavy ? 0xcff8ff : 0x9ff3ff }));
    app.sfx.repulsor(heavy ? 0.55 : rand(0.9, 1.1));
    app.flash(heavy ? 0.28 : 0.07, 0x9ff3ff);
    this.suit.palm[ps.side] = 1;
    this.palmT[ps.side] = heavy ? 0.4 : 0.22;
    this.muzzle.position.copy(pos);
    this.muzzleT = 0;
    let hit = false;
    if (live) { this._killDrone(ps.drone); hit = true; }
    else if (ps.carrier) { this._hurtCarrier(heavy ? 4 + ps.power * 5 : 2.5, ps.point); hit = true; }
    else if (ps.shield) {
      this.boom.spark(ps.point, 24, 8);
      this.trailFire.burst(ps.point, 30, { speed: 10, spread: 3, life: [0.3, 0.8], size: [0.6, 1.4], colors: this.cShield });
      this.shieldFlick = 1;
      if (!this._shieldHint) { this._shieldHint = true; this.app.toast('The carrier is shielded. Clear the drone waves first.', 3000); }
    }
    if (heavy) {
      const R = 5 + ps.power * 6;
      for (const d of this.drones) if (d.state !== 'off' && d.g.position.distanceTo(ps.point) < R) { this._killDrone(d); hit = true; }
      this.boom.at(ps.point, 0.8 + ps.power);
      this.shake = Math.max(this.shake, 0.3);
      this.bloomKick = 0.6;
    }
    if (hit) this.hitShots++;
  }

  _missiles() {
    if (this.phase === 'finale' || this.phase === 'idle' || this.rebooting > 0) return;
    if (this.mis.cd > 0) { this.app.sfx.wrong(); return; }
    const sp = this._sp;
    const list = this.drones.filter((d) => d.state !== 'off')
      .sort((a, b) => a.g.position.distanceToSquared(sp) - b.g.position.distanceToSquared(sp)).slice(0, 8);
    const n = list.length || (this.phase === 'boss' ? 6 : 0);
    if (!n) { this.app.toast('No targets to lock.', 1600); this.app.sfx.wrong(); return; }
    this.mis.cd = MISSILE_CD;
    for (let i = 0; i < n; i++) {
      const box = this.locks[i];
      box.drone = list[i] || null;
      box.carrier = !list[i];
      box.off.set(rand(-28, 28), rand(-3, 4), rand(-7, 7));
      this._after(i * 0.06, () => { box.on = true; box.el.classList.remove('on'); void box.el.offsetWidth; box.el.classList.add('on'); this.app.sfx.lock(); });
      this._after(0.45 + i * 0.08, () => this._launchMissile(box, i));
    }
  }

  _launchMissile(box, i) {
    const m = this.missiles.find((x) => !x.on);
    if (!m || this.phase === 'finale') { box.on = false; box.el.classList.remove('on'); return; }
    m.on = true; m.t = 0; m.lock = box; m.drone = box.drone; m.carrier = box.carrier;
    this._shoulderWorld(i % 2 ? 'l' : 'r', m.pos);
    m.pos.y += 0.25;
    const f = this._v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = this._v2.set(-f.z, 0, f.x).multiplyScalar(i % 2 ? 1 : -1);
    m.vel.set(0, 12, 0).addScaledVector(r, rand(4, 9)).addScaledVector(f, -3).add(this._v3.set(rand(-2, 2), rand(-2, 2), rand(-2, 2)));
    if (i % 2 === 0) this.app.sfx.missile();
  }

  _unibeam() {
    const u = this.uni;
    if (!this._canFire() || u.active) return;
    if (u.cd > 0) { this.app.sfx.wrong(); return; }
    u.active = true; u.t = 0; u.cd = UNI_CD; u.beam = null; u.boomT = 0;
    this.pending.on = false;
    this.aimHold = 0;
    this.app.sfx.unibeam();
    this.app.sfx.servo(0.3);
    this.app.flash(0.15, 0x9ff3ff);
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                                */
  /* ------------------------------------------------------------------ */

  click(p) {
    if (performance.now() < this._skipClickUntil) return;
    this._shoot(p.ndc, 0);
  }

  pointerMove(p) {
    if (!p.down || p.moved < 10 || this.cine.active) return;
    this.camYawT = clamp(this.camYawT - p.dx * 0.006, -1.35, 1.35);
    this.camPitchT = clamp(this.camPitchT + p.dy * 0.004, -0.35, 0.55);
  }

  pointerUp(p) {
    if (this.charge >= 0.25 && this._canFire()) {
      this._skipClickUntil = performance.now() + 60;
      this._shoot(p.ndc, Math.min(1, this.charge));
    }
    this.charge = 0; this.chargeFull = false;
    this.app.sfx.charge(0);
  }

  key(e) {
    if (e.code === 'Space') { e.preventDefault(); this._unibeam(); return true; }
    if (e.key === 'f' || e.key === 'F') { this._missiles(); return true; }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Frame                                                                */
  /* ------------------------------------------------------------------ */

  _updateFlow(dt) {
    const fighting = this.phase === 'wave' || this.phase === 'break' || this.phase === 'boss';
    if (fighting) {
      this.fightTime += dt;
      this.moodT -= dt;
      if (this.moodT <= 0) { this.moodT = 25; this.app.sfx.setMood('battle', 30); }
    }
    if (this.phase === 'break') {
      this.breakT -= dt;
      if (this.breakT <= 0) this._beginWave(this.wave + 1);
    } else if (this.phase === 'wave') {
      this.spawnT -= dt;
      if (this.toSpawn > 0 && this.spawnT <= 0) {
        if (this._launchDrone()) this.toSpawn--;
        this.spawnT = rand(0.35, 0.65);
      }
      if (this.toSpawn === 0 && this._aliveDrones() === 0) {
        if (this.wave < 3) {
          this.phase = 'break'; this.breakT = 3.5;
          this._title('Wave cleared', `Wave ${this.wave + 1} forming up`);
          this.app.sfx.chime();
        } else this._shieldDown();
      }
    } else if (this.phase === 'boss') {
      this.escortT -= dt;
      if (this.escortT <= 0) { this.escortT = 2.6; if (this._aliveDrones() < 5) this._launchDrone(); }
      // the carrier's main gun: a warning glow, then a heavy beam at the suit
      this.carrierAtkT -= dt;
      if (this.carrierAtkT <= 0 && this.telegraph <= 0) { this.telegraph = 1.3; this.app.sfx.alarm(); }
      if (this.telegraph > 0) {
        this.telegraph -= dt;
        if (this.telegraph <= 0) {
          this.carrierAtkT = rand(5.5, 7.5);
          const from = this._v3.copy(BAY);
          this._hdrBeam(this.lasers.fire(from, this._chest, { width: 1.6, life: 0.6, color: 0xff3020 }));
          this.app.sfx.repulsor(0.4);
          this._damage(10, this._chest);
          this.boom.at(this._chest, 0.5);
        }
      }
    }
    // shield fade
    if (this.shieldFade > 0) {
      this.shieldFade = Math.max(0, this.shieldFade - dt / 1.6);
      this.shield.material.uniforms.uOpacity.value = 0.1 * this.shieldFade * (0.6 + Math.random() * 0.4);
      if (this.shieldFade <= 0) this.shield.visible = false;
    }
  }

  _updateDrones(dt, t) {
    const sp = this._sp;
    for (const d of this.drones) {
      if (d.state === 'off') continue;
      d.t += dt;
      const g = d.g, pos = g.position;
      // an orbit that sweeps across the front of the suit, breathing in and out
      const a = Math.PI / 2 + Math.sin(t * d.w + d.seed) * 1.25;
      const R = d.R + Math.sin(t * 0.5 + d.seed * 3) * 5;
      const tgt = this._v.set(sp.x + Math.cos(a) * R, sp.y + d.hgt + Math.sin(t * 0.9 + d.seed) * 3.5, sp.z + Math.sin(a) * R);
      const launch = d.state === 'launch';
      const K = launch ? 0.5 : 1.3, D = launch ? 0.6 : 1.7, max = launch ? 48 : 22;
      d.vel.x += ((tgt.x - pos.x) * K - d.vel.x * D) * dt;
      d.vel.y += ((tgt.y - pos.y) * K - d.vel.y * D) * dt;
      d.vel.z += ((tgt.z - pos.z) * K - d.vel.z * D) * dt;
      const sp2 = d.vel.length();
      if (sp2 > max) d.vel.multiplyScalar(max / sp2);
      pos.addScaledVector(d.vel, dt);
      if (launch) {
        g.lookAt(this._v2.copy(pos).add(d.vel));
        if (pos.distanceTo(sp) < 38) d.state = 'attack';
      } else {
        g.lookAt(sp);
        g.rotateZ(clamp(-d.vel.x * 0.03, -0.5, 0.5));
        d.fireT -= dt;
        if (d.fireT <= 0 && this.phase !== 'finale' && this.phase !== 'victory') {
          d.fireT = rand(2.4, 4.6) / (1 + this.wave * 0.18);
          this._fireBolt(d);
        }
      }
    }
  }

  _updateBolts(dt) {
    for (const b of this.bolts) {
      if (!b.on) continue;
      b.t += dt;
      const before = this._v.subVectors(b.aim, b.pos).dot(b.vel);
      b.pos.addScaledVector(b.vel, dt);
      const after = this._v.subVectors(b.aim, b.pos).dot(b.vel);
      this.lasers.hold(b.b, this._v2.copy(b.pos).addScaledVector(b.vel, -0.04), b.pos);
      if (before > 0 && after <= 0) {
        if (b.hit) this._damage(this.wave >= 3 ? 6 : 5, b.pos);
        this._endBolt(b);
      } else if (b.t > 2.5) this._endBolt(b);
    }
  }

  _updateMissiles(dt) {
    const mm = this.missileMesh, dm = this._dummy;
    let dirty = false;
    this.missiles.forEach((m, i) => {
      if (!m.on) return;
      dirty = true;
      m.t += dt;
      // retarget if the drone is already down
      if (m.drone && m.drone.state === 'off') {
        let best = 1e9, pick = null;
        for (const d of this.drones) if (d.state !== 'off') { const q = d.g.position.distanceToSquared(m.pos); if (q < best) { best = q; pick = d; } }
        m.drone = pick;
        if (m.lock) m.lock.drone = pick;
        if (!pick && this.phase === 'boss') m.carrier = true;
      }
      let aim = null;
      if (m.drone) aim = m.drone.g.position;
      else if (m.carrier && this.phase === 'boss') aim = this._v3.copy(this.carrier.position).add(m.lock ? m.lock.off : this._v2.set(0, 0, 0));
      if (aim && m.t > 0.22) {
        const speed = Math.min(75, 25 + m.t * 70);
        const want = this._v.subVectors(aim, m.pos).normalize().multiplyScalar(speed);
        m.vel.lerp(want, 1 - Math.exp(-(2 + m.t * 7) * dt));
      }
      m.pos.addScaledVector(m.vel, dt);
      // trail
      for (let j = 0; j < 2; j++) {
        const back = j * 0.5 * dt;
        this.trailSmoke.emit({ x: m.pos.x - m.vel.x * back, y: m.pos.y - m.vel.y * back, z: m.pos.z - m.vel.z * back, vx: rand(-0.4, 0.4), vy: rand(-0.2, 0.6), vz: rand(-0.4, 0.4), life: rand(0.7, 1.1), size: rand(0.3, 0.5), grow: 2.8, alpha: 0.38, color: this.cSmoke[i % 2] });
      }
      this.trailFire.emit({ x: m.pos.x, y: m.pos.y, z: m.pos.z, life: 0.12, size: 0.35, color: this.cFire[0] });
      const hitR = m.drone ? 1.8 : 5;
      if ((aim && m.pos.distanceTo(aim) < hitR) || m.t > 5) {
        m.on = false;
        this.boom.at(m.pos, m.carrier && !m.drone ? 2 : 1);
        if (m.drone && m.pos.distanceTo(m.drone.g.position) < hitR + 1) this._killDrone(m.drone);
        else if (m.carrier && this.phase === 'boss' && m.t <= 5) { this._hurtCarrier(3.2, m.pos); this.app.sfx.boom(); }
        if (m.lock) { m.lock.on = false; m.lock.el.classList.remove('on'); }
        dm.scale.setScalar(0);
      } else {
        dm.position.copy(m.pos);
        dm.lookAt(this._v.copy(m.pos).add(m.vel));
        dm.scale.setScalar(1.6);
      }
      dm.updateMatrix();
      mm.setMatrixAt(i, dm.matrix);
    });
    if (dirty) mm.instanceMatrix.needsUpdate = true;
  }

  _updateUnibeam(dt) {
    const u = this.uni;
    if (!u.active) return;
    u.t += dt;
    const WIND = 0.3, DUR = 1.2;
    const o = this.suit.reactorWorld(this._o);
    this.chestGlow.position.copy(o);
    const fwd = this.camera.getWorldDirection(this._fwd);
    this.aimPoint.copy(o).addScaledVector(fwd, 60);
    if (u.t < WIND) { this.chestGlow.scale.setScalar(0.4 + (u.t / WIND) * 2); this.chestGlow.material.opacity = u.t / WIND; return; }
    if (u.t > WIND + DUR) { u.active = false; this.app.sfx.powerDown(); return; }
    const end = this._end.copy(o).addScaledVector(fwd, 260);
    this.ray.set(o, fwd);
    if (this.phase === 'boss') {
      const hits = this.ray.intersectObjects(this.carrierMeshes, false);
      if (hits.length) {
        end.copy(hits[0].point);
        this._hurtCarrier(24 * dt, end);
        u.boomT -= dt;
        if (u.boomT <= 0) { u.boomT = 0.14; this.boom.at(end, 2); }
      }
    } else if (this.shield.visible) {
      const hits = this.ray.intersectObject(this.shield, false);
      if (hits.length) { end.copy(hits[0].point); this.shieldFlick = 1; this.boom.spark(end, 10, 10); }
    }
    if (!u.beam) u.beam = this._hdrBeam(this.beams.fire(o, end, { width: 1.3, life: 0.6, color: 0xcff8ff }));
    else this.beams.hold(u.beam, o, end);
    this._line.set(o, end);
    for (const d of this.drones) {
      if (d.state === 'off') continue;
      const cp = this._line.closestPointToPoint(d.g.position, true, this._v);
      if (cp.distanceTo(d.g.position) < 3.2) this._killDrone(d);
    }
    this.chestGlow.scale.setScalar(2.6 + Math.random() * 0.5);
    this.chestGlow.material.opacity = 1;
    this.shake = Math.max(this.shake, 0.22);
    this.bloomKick = 1;
    this.app.flash(0.05, 0xbff6ff);
  }

  _updateSuit(dt, t) {
    const suit = this.suit, u = this.uni;
    let mode = 'hover';
    if (u.active) mode = 'uni';
    else if (this.aimHold > 0 || this.pending.on || this.charge > 0) mode = this.aimSide;
    if (this.rebooting > 0) mode = 'hover';
    if (mode !== this.poseMode) { if (!this.real) suit.pose(this.poses[mode]); this.poseMode = mode; this.armUp = 0; }
    this.armUp += dt;
    this.aimHold = Math.max(0, this.aimHold - dt);

    // drift, and a slow sink while rebooting
    this.sink = damp(this.sink, this.rebooting > 0 ? -4 : 0, 1.5, dt);
    const sp = this._sp.set(SUIT.x + Math.sin(t * 0.4) * 1.2, SUIT.y + Math.sin(t * 0.7) * 0.6 + this.sink, SUIT.z + Math.sin(t * 0.3) * 0.8);
    suit.root.position.copy(sp);
    this._chest.copy(sp).y += 1.4;

    // face the target when shooting, else look where the camera looks
    let leanT = 0.05 + (mode === 'uni' ? -0.1 : 0);
    if (mode === 'hover') this.yawT = this.camYaw;
    else {
      const P = this.aimPoint;
      this.yawT = Math.atan2(P.x - sp.x, P.z - sp.z);
      if (this.real && mode !== 'uni') {
        // the sculpted armor doesn't move its arms: the whole body pitches a little toward the target
        const pitch = Math.atan2(P.y - (sp.y + 1.55), Math.hypot(P.x - sp.x, P.z - sp.z));
        leanT = 0.05 - clamp(pitch * 0.6, -0.3, 0.3);
      } else if (mode !== 'uni') {
        const pitch = Math.atan2(P.y - (sp.y + 1.45), Math.hypot(P.x - sp.x, P.z - sp.z));
        const pose = this.poses[mode];
        pose[mode === 'r' ? 'shoulderR' : 'shoulderL'][0] = clamp(-1.52 - pitch, -2.9, -0.3);
        pose.spine[1] = 0;
        pose.neck[0] = clamp(-pitch * 0.4, -0.4, 0.4);
      }
    }
    this.yaw += wrap(this.yawT - this.yaw) * (1 - Math.exp(-(mode === 'hover' ? 3 : 10) * dt));
    suit.root.rotation.y = this.yaw;
    this.lean = damp(this.lean, leanT, 8, dt);
    suit.root.rotation.x = this.lean;
    for (const s of ['l', 'r']) {
      this.palmT[s] = Math.max(0, this.palmT[s] - dt);
      suit.palm[s] = this.palmT[s] > 0 ? 1 : (this.charge > 0 && this.aimSide === s ? this.charge : 0);
    }
    if (this.rebooting <= 0) suit.reactor = u.active ? 1.6 : 1;
    suit.update(dt);
  }

  _updateCarrier(dt, t) {
    const g = this.carrier;
    if (this.phase !== 'finale' && this.phase !== 'victory') {
      g.position.set(CARRIER.x, CARRIER.y + Math.sin(t * 0.25) * 2, CARRIER.z);
      g.rotation.z = Math.sin(t * 0.18) * 0.02;
    }
    const blink = Math.sin(t * 3) > 0.2 ? 1 : 0.25;
    this.redMat.color.setRGB(1, 0.08, 0.08).multiplyScalar(this.redK * blink);
    this.bayPulse = Math.max(0, (this.bayPulse || 0) - dt * 1.5);
    const tele = this.telegraph > 0 ? 0.5 + 0.5 * Math.sin(t * 30) : 0;
    this.bayLight.intensity = 30 + this.bayPulse * 90 + tele * 160;
    this.bayMat.color.setRGB(1.6 + tele * 3, 0.2, 0.2).multiplyScalar(Math.max(1, this.hdr * 0.8));
    this.bayGlow.scale.setScalar(14 + tele * 22 + this.bayPulse * 8);
    for (const e of this.engineGlows) e.material.opacity = 0.5 + Math.sin(t * 20 + e.position.z) * 0.06;
    // shield shimmer when hit
    this.shieldFlick = Math.max(0, (this.shieldFlick || 0) - dt * 3);
    if (this.shield.visible && this.shieldFade <= 0) this.shield.material.uniforms.uOpacity.value = 0.1 + this.shieldFlick * 0.35;
    // the wreck falls
    for (const c of this.chunks) {
      const ud = c.userData;
      if (!ud.falling || !c.visible) continue;
      ud.vel.y -= 11 * dt;
      c.position.addScaledVector(ud.vel, dt);
      c.rotation.x += ud.spin.x * dt; c.rotation.y += ud.spin.y * dt; c.rotation.z += ud.spin.z * dt;
      const wp = c.getWorldPosition(this._v);
      for (let k = 0; k < 3; k++) {
        this.trailSmoke.emit({ x: wp.x + rand(-8, 8), y: wp.y + rand(-2, 3), z: wp.z + rand(-6, 6), vx: rand(-1, 1), vy: rand(1, 3), vz: rand(-1, 1), life: rand(1.5, 2.6), size: rand(4, 7), grow: 1.5, alpha: 0.55, color: this.cSmoke[k % 2] });
      }
      this.trailFire.emit({ x: wp.x + rand(-6, 6), y: wp.y, z: wp.z + rand(-5, 5), vy: 2, life: rand(0.3, 0.6), size: rand(2, 4), color: this.cFire[Math.floor(Math.random() * 2)] });
      if (wp.y < 22) {
        c.visible = false;
        ud.falling = false;
        this.boom.at(this._v2.set(wp.x, 12, wp.z), 5);
        this.waves.spawn(this._v2.set(wp.x, 2, wp.z), { radius: 60, life: 1.4, color: 0x3a2a20 });
        this.app.sfx.boom();
        this.app.flash(0.35, 0xffb070);
        this.cine.shake = Math.max(this.cine.shake, 0.8);
      }
    }
  }

  _updateHud(dt) {
    const set = (p, text, warn) => { if (p.last !== text) { p.last = text; p.b.textContent = text; } if (warn !== undefined) p.el.classList.toggle('warn', warn); };
    const H = this.hud;
    set(H.wave, this.wave ? `${this.wave}/3` : '—');
    const hostile = this.phase === 'boss' || this.phase === 'finale' ? 'Carrier' : String(this.toSpawn + this._aliveDrones());
    set(H.left, this.phase === 'idle' || this.phase === 'victory' ? '—' : hostile, this.phase === 'boss');
    set(H.down, String(this.downed));
    const meter = (m, k, label, low) => {
      const q = Math.round(k * 100);
      if (q === m.last) return;
      m.last = q;
      m.f.style.width = `${q}%`;
      m.v.textContent = label;
      if (low !== undefined) m.f.classList.toggle('red', low);
    };
    meter(this.mInt, this.integrity / 100, this.rebooting > 0 ? 'Reboot' : `${Math.round(this.integrity)}%`, this.integrity < 30);
    const weapon = (w, m, cd, max) => {
      const k = cd > 0 ? 1 - cd / max : 1;
      meter(m, k, k >= 1 ? 'Ready' : `${Math.ceil(cd)}s`);
      const q = Math.round(k * 60);
      if (q === w.last) return;
      w.last = q;
      w.cd.style.transform = `scaleX(${k.toFixed(3)})`;
      w.b.classList.toggle('cooling', k < 1);
      w.b.classList.toggle('ready', k >= 1);
    };
    weapon(this.wMis, this.mMis, this.mis.cd, MISSILE_CD);
    weapon(this.wUni, this.mUni, this.uni.cd, UNI_CD);
    const hp = Math.ceil(this.carrierHp);
    if (hp !== this._hpShown) {
      this._hpShown = hp;
      this.bossFill.style.transform = `scaleX(${(this.carrierHp / CARRIER_HP).toFixed(3)})`;
      this.bossPct.textContent = `${hp}%`;
    }
    if (this.rebooting > 0) this.rebootFill.style.transform = `scaleX(${(1 - this.rebooting / REBOOT).toFixed(3)})`;
    // lock boxes follow their targets
    const W = this.app.width, Hh = this.app.height;
    for (const l of this.locks) {
      if (!l.on) continue;
      let p = null;
      if (l.drone && l.drone.state !== 'off') p = this._v.copy(l.drone.g.position);
      else if (l.carrier && this.phase === 'boss') p = this._v.copy(this.carrier.position).add(l.off);
      if (!p) { l.on = false; l.el.classList.remove('on'); continue; }
      p.project(this.camera);
      if (p.z > 1) { l.el.style.transform = 'translate(-200px,-200px)'; continue; }
      l.el.style.transform = `translate(${((p.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * Hh).toFixed(1)}px)`;
    }
    if (this.multiT > 0) { this.multiT -= dt; if (this.multiT <= 0) { this.multi = 0; this.comboEl.classList.remove('on'); } }
  }

  update(dt, t) {
    const app = this.app, p = app.pointer;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.t -= dt;
      if (q.t <= 0) { this.queue.splice(i, 1); q.fn(); }
    }
    this._updateFlow(dt);
    if (this.sky) this.sky.position.copy(this.camera.position);

    // armor: slow regeneration, and the reboot
    this.lastHit += dt;
    if (this.rebooting > 0) {
      this.rebooting -= dt;
      if (this.rebooting <= 0) {
        this.integrity = 55;
        this.suit.eyes = 1; this.suit.reactor = 1; this.suit.thrust = 0.85;
        this.rebootEl.classList.remove('on');
        app.sfx.powerUp();
        app.flash(0.35, 0x9ff3ff);
        app.toast('Systems restored.', 1600);
      }
    } else if (this.lastHit > 2.5 && this.phase !== 'finale') this.integrity = Math.min(100, this.integrity + dt * 3.5);

    // hold to charge
    const canCharge = this._canFire();
    const hold = this.trackHold(1.0, canCharge && !this.chargeFull, 0.22);
    if (hold.fired) { this.chargeFull = true; app.sfx.lock(); }
    if (this.chargeFull && p.down && canCharge) { this.charge = 1; app.setCharge(1); app.sfx.charge(1); }
    else this.charge = p.down && canCharge ? hold.progress : 0;
    if (this.charge > 0) {
      this.aimSide = this.side;
      const d = this._nearestDrone(p.ndc, 160);
      if (d) this.aimPoint.copy(d.g.position);
      else { this.ray.setFromCamera(p.ndc, this.camera); this.aimPoint.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, 60); }
      this.aimHold = Math.max(this.aimHold, 0.3);
    }

    const ps = this.pending;
    if (ps.on) {
      if (ps.drone && ps.drone.state !== 'off') this.aimPoint.copy(ps.drone.g.position);
      ps.t -= dt;
      if (ps.t <= 0) this._fire(ps);
    }
    this.uni.cd = Math.max(0, this.uni.cd - dt);
    this.mis.cd = Math.max(0, this.mis.cd - dt);

    this._updateSuit(dt, t);
    this._updateDrones(dt, t);
    this._updateBolts(dt);
    this._updateMissiles(dt);
    this._updateUnibeam(dt);
    this._updateCarrier(dt, t);

    // city smoke columns and the fires under them
    for (const pl of this.plumes) {
      if (Math.random() < dt * 8) this.smoke.emit({ x: pl.x + rand(-3, 3), y: pl.y + rand(0, 3), z: pl.z + rand(-3, 3), vx: rand(-0.4, 0.4) + 1.6, vy: rand(3.5, 5.5), vz: rand(-0.4, 0.4), life: rand(9, 13), size: rand(5, 9), grow: 4.5, alpha: 0.42, color: this.cPlume[Math.floor(Math.random() * 3)] });
      if (Math.random() < dt * 12) this.embers.emit({ x: pl.x + rand(-4, 4), y: pl.y + rand(0, 2), z: pl.z + rand(-4, 4), vx: rand(-1, 1), vy: rand(2, 5), vz: rand(-1, 1), life: rand(0.8, 1.8), size: rand(0.8, 1.8), color: this.cEmber[Math.floor(Math.random() * 2)] });
      pl.glow.material.opacity = 0.45 + Math.sin(t * 9 + pl.x) * 0.08 + Math.random() * 0.08;
    }

    // glows
    this.muzzleT += dt;
    const mk = Math.max(0, 1 - this.muzzleT / 0.18);
    this.muzzle.scale.setScalar(0.01 + mk * (this.real ? 1.7 : 1.1));
    this.muzzle.material.opacity = mk;
    if (this.charge > 0) {
      const pos = this.real ? this.suit.reactorWorld(this._palm) : this.suit.palmWorld(this.aimSide, this._palm, this._pdir).pos;
      this.halo.position.copy(pos);
      this.halo.scale.setScalar(0.2 + this.charge * 1.0 + Math.sin(t * 40) * 0.05 * this.charge);
      this.halo.material.opacity = 0.4 + this.charge * 0.6;
    } else this.halo.material.opacity = damp(this.halo.material.opacity, 0, 12, dt);
    if (!this.uni.active) this.chestGlow.material.opacity = damp(this.chestGlow.material.opacity, 0, 8, dt);

    this.smoke.update(dt, t);
    this.embers.update(dt, t);
    this.trailSmoke.update(dt, t);
    this.trailFire.update(dt, t);
    this.boom.update(dt, t);
    this.beams.update(dt, this.camera);
    this.lasers.update(dt, this.camera);
    this.waves.update(dt);
    app.sfx.thrust(this.active ? 0.28 + this.suit._shown.thrust * 0.15 : 0);
    this._updateHud(dt);

    // grade: desaturated while rebooting
    this.bloomKick = Math.max(0, this.bloomKick - dt * 1.2);
    this.bloom.strength = this.bloomBase + this.bloomKick * 0.9;
    this.grade.sat = this.rebooting > 0 ? 0.35 : 1;
    this.grade.tintAmt = this.rebooting > 0 ? 0.2 : 0.03;
    this.grade.tint = this.rebooting > 0 ? 0xff2020 : 0xff7a3a;

    // camera: the cinematic, or a third-person orbit behind the suit
    if (this.cine.update(dt)) return;
    const gy = app.gyro;
    this.camYaw = damp(this.camYaw, this.camYawT + (gy ? gy.x * 0.25 : 0), 5, dt);
    this.camPitch = damp(this.camPitch, this.camPitchT + (gy ? gy.y * 0.12 : 0), 5, dt);
    const th = this.camYaw, ph = this.camPitch;
    const f = this._fwd.set(Math.sin(th) * Math.cos(ph), Math.sin(ph), Math.cos(th) * Math.cos(ph));
    const r = this._right.set(-Math.cos(th), 0, Math.sin(th));
    const R = this.portrait ? 12.5 : 8.5;
    const cam = this.camera;
    cam.position.copy(this._sp).add(this._v.set(0, 1.9, 0)).addScaledVector(f, -R).addScaledVector(r, this.portrait ? 0.3 : 0.9);
    this.shake *= Math.exp(-5 * dt);
    const s = this.shake;
    if (s > 0.002) cam.position.add(this._v.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    cam.lookAt(this._camLook.copy(cam.position).addScaledVector(f, 30));
  }
}
