import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Chapter } from '../core/Chapter.js';
import { ParticlePool } from '../objects/Particles.js';
import { Beams, Explosions, createCity, createDrone, glowSprite } from '../objects/FX.js';
import { loadEnv, envMap, backdrop, HDRIS } from '../core/Env.js';
import { rand, damp, clamp, lerp, TAU, h, toScreen, easeInOut } from '../core/utils.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { suitEnvironment } from '../objects/Suit.js';
import './Hud.css';

/*
 * Inside the helmet: first-person over a city at dusk. The HUD tracks the horizon, heading, speed and
 * altitude; hostile drones patrol around you. Point at one to analyse it, tap to lock (up to six), fire
 * micro-missiles. Scan, night vision, a threat meter, J.A.R.V.I.S. typing its reports. Never game over.
 * On entry the battle-worn helmet turns to face you and is put on: dark for a beat, then the HUD boots.
 */

const CITY = 700;
const MAX_LOCKS = 6;
const N_DRONES = 10;
const N_MISSILES = 12;
const TYPES = [
  { name: 'Recon drone', base: 0.3 },
  { name: 'Strike drone', base: 0.7 },
  { name: 'Interceptor', base: 0.5 },
];
const AMBIENT = [
  'Wind from the west at twelve knots. Stabilisers trimmed.',
  'Reactor temperature nominal.',
  'Civil air traffic grounded over the district.',
  'Street-level sensors show the area evacuated.',
  'Hover efficiency at ninety-four percent.',
  'Sunset in eleven minutes. Light levels dropping.',
];
const TAPE_PX = 2; // pixels per unit on the speed and altitude tapes
// the helmet entrance (camera space; the helmet is shown 4x size at 4x the distance, clear of the near plane)
const HELM_K = 4;
const HELM_SHOW = new THREE.Vector3(0, -0.05, -3.0);
const HELM_WORN = new THREE.Vector3(0, -0.14, 0.35);
const SEQ_ON = 5.0, SEQ_OFF = 1.5;
// dusk over the lagoon: a photographed clear sunset sky, its sun (u = 0.6 of the panorama) turned onto SUN_DIR.
// The dome uses only the clean stretch u 0.31..0.765 (no palazzi or trees), mirrored round the circle.
const SUN_DIR = new THREE.Vector3(-0.85, 0.055, -0.52).normalize();
const SUN_AZ = Math.atan2(SUN_DIR.z, SUN_DIR.x);
const SKY_ROT = (0.6 - 0.5) * TAU - SUN_AZ;
const SKY_U0 = 0.31, SKY_U1 = 0.765;
const SKY_MROT = ((0.6 - SKY_U0) / (SKY_U1 - SKY_U0) / 2 - 0.5) * TAU - SUN_AZ;

/* ---- photographed sky, aerial perspective, the far city (local helpers; the same ones live in Battle.js) ---- */

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

export class Hud extends Chapter {
  constructor(app) {
    super(app, { id: 'hud', title: 'Heads-Up Display', jp: 'HUD' });
    // real metal throws bright glints: only true light sources (HDR glows, fire, beams) bloom
    this.bloom = { strength: 0.85, radius: 0.5, threshold: 2.5 };
    this.grade = { ...this.grade, grain: 0.022, vig: 0.36, ca: 0.0025, sat: 1, tint: 0xffa060, tintAmt: 0.03 };
    this.baseGrade = { ...this.grade };
    this.mood = 'calm';
    this.shiftView = 0.1;
    this.trail = false;
    this.pathA = 0; this.pathSpeed = 22;
    this.lookYaw = 0; this.lookPitch = 0; this.lookYawT = 0; this.lookPitchT = 0;
    this.pitch = 0; this.roll = 0; this.yaw = 0;
    this.speed = 22;
    this.power = 1; this.integrity = 1; this._hurtT = 10;
    this.kills = 0; this.nv = false; this.threat = 0; this.warn = false; this._alarmT = 0;
    this.hovered = null; this._tapT = 0; this.tapped = null;
    this.locks = []; this.launchQ = []; this._launchT = 0;
    this.scanT = 0; this._attackT = 5; this._ambT = 14; this._boomT = 0;
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._fwd = new THREE.Vector3(); this._right = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    this.base = new THREE.Vector3();
    this.lines = []; this.typing = null;
    this.helmState = 'worn'; this.helmT = 0; this.worn = false; this._boots = 0; this._cues = {};
  }

  load() { return Promise.all([loadModels(['helmetB']), loadEnv(HDRIS.sunset, { backdrop: true })]); }

  /* ------------------------------------------------------------------ */
  /* build                                                               */
  /* ------------------------------------------------------------------ */

  build() {
    const s = this.scene;
    const app = this.app;
    // a real photographed sunset: its light on every surface (turned so its sun is our sun), its sky behind
    const env = envMap(HDRIS.sunset), skyTex = backdrop(HDRIS.sunset);
    s.environment = env || suitEnvironment();
    s.environmentIntensity = env ? 0.8 : 0.8;
    if (env) s.environmentRotation.set(0, SKY_ROT, 0);
    // the haze is the photo's own horizon colour, so the fogged city melts into the real sky at the horizon
    const haze = this.haze = horizonColor(skyTex, SKY_U0, SKY_U1, 0x8a6a70).multiplyScalar(0.85);
    s.background = haze.clone();
    s.fog = new THREE.FogExp2(haze.clone(), 0.0012);
    this.camera.near = 0.5;
    this.camera.far = 5000;
    this.camera.rotation.order = 'YXZ';
    s.add(this.camera);

    // the sky: the photograph itself (its sun included), on a dome that rides with the camera
    this.sunDir = SUN_DIR.clone();
    this.sky = skyTex ? photoSky(skyTex, { radius: 2400, rot: SKY_MROT, fog: haze, sun: SUN_DIR, intensity: 0.95, haze: 0.04, u0: SKY_U0, u1: SKY_U1, mirror: true, blur: 2, boost: 0.8, smoothTop: 1 }) : new THREE.Object3D();
    s.add(this.sky);

    // the city
    this.city = createCity({ size: CITY, block: 22, street: 8, fogColor: haze.getHex(), fogDensity: 0.0012, maxH: 170, win: 0xffc98a, base: 0x3a3438, sun: SUN_DIR, sunColor: 0xffa860, sunStrength: 2.2, ambient: 0.35, lit: 0.55, sky: haze.getHex() });
    s.add(this.city.group);
    // the city goes on to the horizon (one draw), on ground that carries it there under the haze
    s.add(farTowers({ n: app.low ? 700 : 1400, rMin: CITY * 0.5, rMax: 1900, hMin: 10, hMax: 130, color: 0x3c3836, win: 0xffc98a, winK: 0.5 }));
    s.add(farLand(9000));

    // light: the photo's low sun, its blue sky overhead as a soft fill
    s.add(new THREE.HemisphereLight(0x9ab0e0, 0x2a2220, env ? 0.35 : 1.3));
    const sunL = new THREE.DirectionalLight(0xffa860, 2.4);
    sunL.position.copy(this.sunDir).multiplyScalar(500);
    const rim = new THREE.DirectionalLight(0x8aa0e0, env ? 0.5 : 1.1);
    rim.position.set(300, 200, 400);
    s.add(sunL, rim);

    // the helmet for the entrance: rides on the camera, lit by its own key and a warm rim (dark when unused)
    this.helm = new THREE.Group();
    this.helm.scale.setScalar(HELM_K);
    this.helm.visible = false;
    this.camera.add(this.helm);
    this.helmet3d = new RealSuit('helmetB', { castShadow: false });
    if (this.helmet3d.ok) {
      this.helmet3d.root.position.y = -this.helmet3d.height / 2; // turn about its centre
      this.helm.add(this.helmet3d.root);
      this.helmet3d.eyes = 0;
    } else this.helmet3d = null;
    this.helmKey = new THREE.PointLight(0xe6eeff, 0, 14, 2);
    this.helmKey.position.set(1.8, 1.4, -1.2);
    this.helmRim = new THREE.PointLight(0xff7a30, 0, 14, 2);
    this.helmRim.position.set(-2.2, 0.6, -5.2);
    this.camera.add(this.helmKey, this.helmRim);

    // drones (a fixed pool, reused)
    this.drones = [];
    for (let i = 0; i < N_DRONES; i++) {
      const g = createDrone();
      g.scale.setScalar(4);
      // the eye: a small hot point of light, not a halo
      const glow = glowSprite(0xff3a2a, 0.55, 0.8);
      glow.material.color.multiplyScalar(3.5); glow.material.toneMapped = false;
      glow.position.set(0, -0.05, 0.6);
      g.add(glow);
      s.add(g);
      const d = {
        g, glow, i, id: `UAV-${String(i + 1).padStart(2, '0')}`, type: TYPES[i % 3],
        state: 'fly', pos: g.position, prev: new THREE.Vector3(), vel: new THREE.Vector3(), fallV: new THREE.Vector3(), spin: 0,
        atk: 0, atkPhase: 0, atkT: 0, fireT: 0, respawn: 0, grow: 1, locked: false, inbound: false, sx: 0, sy: 0, on: false, dist: 0, threat: 0,
        tag: null, row: null,
      };
      this._plan(d, true);
      this.drones.push(d);
    }

    // micro-missiles: one instanced mesh, smoke and flame from particle pools
    const body = new THREE.CylinderGeometry(0.07, 0.07, 0.8, 8); body.rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.07, 0.22, 8); nose.rotateX(Math.PI / 2); nose.translate(0, 0, 0.51);
    const fins = new THREE.BoxGeometry(0.3, 0.02, 0.14); fins.translate(0, 0, -0.33);
    const fins2 = fins.clone(); fins2.rotateZ(Math.PI / 2);
    const mGeo = mergeGeometries([body, nose, fins, fins2].map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }));
    this.missileMesh = new THREE.InstancedMesh(mGeo, new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.7, roughness: 0.35, emissive: 0x201008 }), N_MISSILES);
    this.missileMesh.frustumCulled = false;
    this.missiles = Array.from({ length: N_MISSILES }, () => ({ active: false, t: 0, dur: 1, p0: new THREE.Vector3(), p1: new THREE.Vector3(), end: new THREE.Vector3(), pos: new THREE.Vector3(), prev: new THREE.Vector3(), target: null }));
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._zero = new THREE.Vector3(0, 0, 0); this._one = new THREE.Vector3(1, 1, 1); this._z = new THREE.Vector3(0, 0, 1);
    this._m4.makeScale(0, 0, 0);
    for (let k = 0; k < N_MISSILES; k++) this.missileMesh.setMatrixAt(k, this._m4);
    s.add(this.missileMesh);
    this.smoke = new ParticlePool({ count: app.low ? 800 : 1400, blending: THREE.NormalBlending, drag: 1.4, buoyancy: 0.5, turbulence: 0.6, softness: 2.2 });
    this.flame = new ParticlePool({ count: app.low ? 400 : 700, drag: 2, softness: 1.6 });
    s.add(this.smoke.points, this.flame.points);
    this.smokeCols = [new THREE.Color(0x6a6460), new THREE.Color(0x7e7670), new THREE.Color(0x4e4844)];
    this.smoke.points.renderOrder = 1; this.flame.points.renderOrder = 2;
    this.flameCols = [new THREE.Color(0xffc070), new THREE.Color(0xff8a30), new THREE.Color(0xffe0b0)].map((c) => c.multiplyScalar(2.6));
    this.boom = new Explosions(s, { lights: 2, low: app.low });
    // fireballs with dark rolling smoke, not blobs of glow; the hottest cores still bloom
    realisticBooms(this.boom, 1.6, [new THREE.Color(0x2e2925), new THREE.Color(0x3a332e), new THREE.Color(0x24201d)]);
    this.beams = new Beams(s, 8);
    this.flashes = Array.from({ length: 6 }, () => { const f = glowSprite(0xffa050, 1, 0); f.material.fog = false; f.material.color.multiplyScalar(4); f.material.toneMapped = false; f.visible = false; s.add(f); return { f, age: 1, size: 40 }; });
    this._flashI = 0;

    this._buildUI();
  }

  /** New flight pattern for a drone (relative to your patrol: mostly ahead of you). */
  _plan(d, first = false) {
    d.ax = rand(40, 115); d.ay = rand(10, 35); d.az = rand(15, 50);
    d.y0 = rand(-45, 30); d.z0 = first ? rand(80, 260) : rand(220, 300);
    d.w1 = rand(0.12, 0.3); d.w2 = rand(0.2, 0.5); d.w3 = rand(0.1, 0.25);
    d.p1 = rand(0, TAU); d.p2 = rand(0, TAU); d.p3 = rand(0, TAU);
    d.side = Math.random() < 0.5 ? -1 : 1;
    d.atk = 0; d.atkPhase = 0; d.atkT = 0;
    d.state = 'fly'; d.grow = first ? 1 : 0;
    d.g.visible = true;
    d.g.rotation.set(0, 0, 0);
    d.inbound = false;
  }

  _buildUI() {
    const touch = this.app.isTouch;
    // the helmet: dark curved edges, the glass, the warning glow
    this.closeEl = h('div.hd-close');
    this.helmet = h('div.hd-helmet.hd-el.hd-b', {}, h('div.hd-glass'), h('div.hd-warn'), h('div.hd-sweep'));
    this.wipe = h('div.hd-bootwipe');
    this.ui.append(this.closeEl, this.helmet, this.wipe);

    this.intro({
      kicker: 'Chapter 06 · Inside the helmet',
      title: 'Heads-Up <em>Display</em>',
      jp: 'HUD',
      desc: 'What the pilot sees: horizon, heading, speed and altitude drawn on the inside of the visor, J.A.R.V.I.S., the suit’s AI, reading the world back, and targeting that tracks every threat at once. Hostile drones are circling the city.',
      extra: [
        this.gestures(touch
          ? [['tap', '<b>Tap</b> a drone to lock'], ['drag', '<b>Drag</b> to look around'], ['key', '<b>Fire</b> · <b>Remove helmet</b>']]
          : [['move', '<b>Point</b> at a drone to analyse'], ['tap', '<b>Click</b> to lock (up to 6)'], ['key', '<b>F</b> fire · <b>S</b> scan · <b>N</b> night · <b>H</b> helmet']]),
      ],
    });

    // horizon & pitch ladder (centred on the view)
    this.ladder = h('div.hd-ladder');
    this.rungs = [];
    for (let a = -30; a <= 30; a += 10) {
      const r = h(`div.hd-rung${a === 0 ? '.zero' : a < 0 ? '.neg' : ''}`, {}, a ? h('span', { text: String(a) }) : null, a ? h('span', { text: String(a) }) : null);
      r.dataset.a = a;
      this.ladder.append(r);
      this.rungs.push(r);
    }
    this.fpm = h('div.hd-fpm');
    this.ui.append(h('div.hd-ladder-clip.hd-el.hd-b', {}, this.ladder), h('div.reticle.hd-reticle.hd-el.hd-b'), this.fpm);
    this.fpm.classList.add('hd-el');

    // compass
    this.compassCanvas = h('canvas', { width: 720, height: 64 });
    this.compassCtx = this.compassCanvas.getContext('2d');
    this.headingEl = h('b', { text: '000' });
    this.ui.append(h('div.hd-compass.hd-el.hd-b', {}, this.compassCanvas, this.headingEl));

    // speed and altitude tapes (long strips of labels, slid by a transform)
    const tape = (max, cls, label, unit) => {
      const strip = h('div.hd-strip');
      for (let v = 0; v <= max; v += 10) strip.append(h('i', { style: `top:${(max - v) * TAPE_PX}px`, text: String(v) }));
      const val = h('b', { text: '0' });
      const el = h(`div.hd-tape.hd-el.hd-b.${cls}`, {}, h('div.hd-tape-win', {}, strip), h('div.hd-tape-val', {}, val), h('span.hd-tape-lbl', { text: `${label} · ${unit}` }));
      this.ui.append(el);
      return { strip, val, max };
    };
    this.spdTape = tape(300, 'hd-spd', 'SPD', 'km/h');
    this.altTape = tape(400, 'hd-alt', 'ALT', 'm');

    // right column: power ring, suit status, threat, kills, scan list
    this.powerFg = null;
    const ring = h('div.hd-power', { html: `<svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="50"/><circle class="tk" cx="60" cy="60" r="57"/><circle class="fg" cx="60" cy="60" r="50"/><circle class="core" cx="60" cy="60" r="16"/></svg>` });
    this.powerFg = ring.querySelector('.fg');
    this.powerTxt = h('b', { text: '100%' });
    ring.append(h('div.hd-power-txt', {}, this.powerTxt, h('span', { text: 'Reactor' })));
    const sc = h('canvas', { width: 240, height: 400 });
    this._drawSuit(sc.getContext('2d'));
    this.parts = {};
    const partBox = h('div.hd-parts');
    for (const [k, l, t, w, hh] of [['head', 40, 3, 20, 17], ['torso', 30, 22, 40, 30], ['armR', 10, 24, 20, 42], ['armL', 70, 24, 20, 42], ['legR', 32, 52, 18, 45], ['legL', 50, 52, 18, 45]]) {
      const p = h('i', { style: `left:${l}%;top:${t}%;width:${w}%;height:${hh}%` });
      this.parts[k] = p;
      partBox.append(p);
    }
    this.integrityTxt = h('b', { text: '100%' });
    const status = h('div.hd-status', {}, sc, partBox, h('span', {}, 'Armor ', this.integrityTxt));
    this.threatFill = h('div.meter-fill');
    this.threatTxt = h('span', { text: 'Low' });
    this.killTxt = h('b', { text: '0' });
    this.lockTxt = h('b', { text: '0/6' });
    this.listEl = h('div.hd-list.hud-panel');
    this.side = h('div.hd-side.hd-el.hd-b', {},
      h('div.hd-sys', {}, ring, status),
      h('div.meter.hd-threat', {}, h('div.meter-label', {}, h('span', { text: 'Threat' }), this.threatTxt), h('div.meter-track', {}, this.threatFill)),
      h('div.hd-pills', {}, h('div.pill', {}, 'Down', this.killTxt), h('div.pill', {}, 'Locks', this.lockTxt)),
      this.listEl);
    this.ui.append(this.side);
    for (const d of this.drones) {
      d.row = h('div.hd-row', {}, h('b', { text: d.id }), h('span', { text: d.type.name }), h('em'), h('i'));
      this.listEl.append(d.row);
      d.tag = h('div.hd-tag.hd-el', {}, h('span'));
      this.ui.append(d.tag);
    }

    // J.A.R.V.I.S.: the suit's AI, typing its reports
    this.aiLines = h('div.hd-ai-lines');
    this.ui.append(h('div.hd-ai.hud-panel.hd-el.hd-b', {}, h('span.hd-ai-head', { text: 'J.A.R.V.I.S.' }), this.aiLines));

    // targeting: analysis box, lock boxes
    this.anaName = h('b'); this.anaType = h('span'); this.anaRange = h('span'); this.anaThreat = h('span');
    this.ana = h('div.hd-ana.hd-el', {}, h('div.hd-ana-box'), h('div.hd-ana-info', {}, this.anaName, this.anaType, this.anaRange, this.anaThreat));
    this.ui.append(this.ana);
    this.lockEls = Array.from({ length: MAX_LOCKS }, () => { const el = h('div.lock-box.hd-lock.hd-el', {}, h('span')); this.ui.append(el); return el; });

    // controls
    this.fireBtn = this.button('Fire', () => this._fire(), 'btn-primary');
    this.scanBtn = this.button('Scan', () => this._scan());
    this.nvBtn = this.button('Night vision', () => this._nightVision());
    this.clearBtn = this.button('Clear locks', () => this._clearLocks());
    this.helmBtn = this.button('Remove helmet', () => this._toggleHelmet());
    this.ui.append(h('div.controls', {}, this.fireBtn, h('div.group', {}, this.scanBtn, this.nvBtn, this.clearBtn, this.helmBtn)));
    this.ui.classList.add('hd-off');
    this._hc = { line: 'rgba(95,227,255,0.85)', text: '#bff6ff' };
  }

  /** The suit-status wireframe, drawn once. */
  _drawSuit(x) {
    x.scale(2, 2);
    x.lineJoin = 'round';
    x.strokeStyle = 'rgba(95,227,255,0.9)';
    x.fillStyle = 'rgba(95,227,255,0.1)';
    x.lineWidth = 1.2;
    x.beginPath();
    x.ellipse(60, 22, 11, 14, 0, 0, TAU); // head
    x.moveTo(36, 44); x.lineTo(84, 44); x.lineTo(78, 70); x.lineTo(72, 100); x.lineTo(48, 100); x.lineTo(42, 70); x.closePath(); // torso
    x.moveTo(34, 46); x.lineTo(26, 48); x.lineTo(18, 88); x.lineTo(16, 124); x.lineTo(24, 126); x.lineTo(28, 90); x.lineTo(38, 62); x.closePath(); // arm (right)
    x.moveTo(86, 46); x.lineTo(94, 48); x.lineTo(102, 88); x.lineTo(104, 124); x.lineTo(96, 126); x.lineTo(92, 90); x.lineTo(82, 62); x.closePath(); // arm (left)
    x.moveTo(47, 103); x.lineTo(59, 103); x.lineTo(58, 150); x.lineTo(56, 190); x.lineTo(44, 190); x.lineTo(44, 150); x.closePath(); // leg (right)
    x.moveTo(61, 103); x.lineTo(73, 103); x.lineTo(76, 150); x.lineTo(76, 190); x.lineTo(64, 190); x.lineTo(62, 150); x.closePath(); // leg (left)
    x.fill(); x.stroke();
    // plate lines and the reactor
    x.strokeStyle = 'rgba(95,227,255,0.4)';
    x.beginPath();
    x.moveTo(60, 44); x.lineTo(60, 100); x.moveTo(44, 78); x.lineTo(76, 78); x.moveTo(52, 22); x.lineTo(68, 22);
    x.moveTo(20, 88); x.lineTo(28, 90); x.moveTo(100, 88); x.lineTo(92, 90); x.moveTo(44, 150); x.lineTo(58, 150); x.moveTo(62, 150); x.lineTo(76, 150);
    x.stroke();
    x.fillStyle = 'rgba(191,246,255,0.95)';
    x.beginPath(); x.arc(60, 58, 4.5, 0, TAU); x.fill();
  }

  /* ------------------------------------------------------------------ */
  /* the onboard AI                                                      */
  /* ------------------------------------------------------------------ */

  say(text) {
    const el = h('div.hd-line');
    this.aiLines.append(el);
    const item = { el, text, n: 0 };
    this.lines.push(item);
    while (this.lines.length > 4) { const old = this.lines.shift(); old.el.remove(); if (this.typing === old) this.typing = null; }
    this._ambT = 16;
  }

  _typeAI(dt) {
    if (!this.typing) this.typing = this.lines.find((l) => l.n < l.text.length) || null;
    const l = this.typing;
    if (!l) return;
    const before = Math.floor(l.n);
    l.n = Math.min(l.text.length, l.n + dt * 48);
    const now = Math.floor(l.n);
    if (now !== before) {
      l.el.textContent = l.text.slice(0, now);
      if (before === 0) this.app.sfx.beep(1);
    }
    if (l.n >= l.text.length) { l.el.classList.add('done'); this.typing = null; }
  }

  /* ------------------------------------------------------------------ */
  /* actions                                                             */
  /* ------------------------------------------------------------------ */

  _toggleLock(d) {
    const app = this.app;
    if (!d || d.state !== 'fly' || !this.worn) return;
    if (d.locked) {
      d.locked = false;
      this.locks.splice(this.locks.indexOf(d), 1);
      app.sfx.click();
      return;
    }
    if (this.locks.length >= MAX_LOCKS) { app.sfx.wrong(); this.say('Lock list full: six targets maximum.'); return; }
    d.locked = true;
    d.inbound = false;
    this.locks.push(d);
    app.sfx.lock();
    const el = this.lockEls[this.locks.length - 1];
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (this.locks.length === 1 || Math.random() < 0.4) this.say(`Target locked: ${d.id}, ${d.type.name.toLowerCase()}, ${Math.round(d.dist)} metres.`);
  }

  _clearLocks() {
    for (const d of this.locks) d.locked = false;
    this.locks.length = 0;
  }

  _fire() {
    const app = this.app;
    if (!this._needHelmet()) return;
    const ready = this.locks.filter((d) => !d.inbound && d.state === 'fly');
    if (!ready.length && this.hovered && this.hovered.state === 'fly' && !this.hovered.locked) { this._toggleLock(this.hovered); ready.push(this.hovered); }
    if (!ready.length) { app.sfx.wrong(); this.say(this.locks.length ? 'Missiles already in flight.' : 'No targets locked. Point at a drone and tap to lock.'); return; }
    let n = 0;
    for (const d of ready) {
      if (this.power < 0.05) { this.say('Reactor output low. Recharging before the next salvo.'); break; }
      this.power -= 0.05;
      d.inbound = true;
      this.launchQ.push(d);
      n++;
    }
    if (n) {
      this.say(`Micro-missiles away: ${n}.`);
      app.sfx.setMood('battle', 14);
    }
  }

  _launch(d) {
    const m = this.missiles.find((x) => !x.active);
    if (!m) { d.inbound = false; return; }
    const cam = this.camera;
    this._side = -(this._side || 1);
    const side = this._side;
    m.p0.set(side * 1.5, -1.1, -1.6);
    cam.localToWorld(m.p0);
    cam.getWorldDirection(this._v);
    this._v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    m.p1.copy(m.p0).addScaledVector(this._v, rand(35, 60)).addScaledVector(this._v2, side * rand(18, 34)).add(this._v3.set(0, rand(8, 26), 0));
    m.end.copy(d.pos);
    m.pos.copy(m.p0); m.prev.copy(m.p0);
    m.t = 0;
    m.dur = 0.6 + m.p0.distanceTo(d.pos) / 190;
    m.target = d;
    m.active = true;
    this.app.sfx.missile();
    this.app.flash(0.06, 0xffc890);
  }

  _hit(m) {
    const app = this.app, d = m.target;
    m.active = false;
    this.boom.at(m.end, 3.2);
    this._flash(m.end, 26);
    if (this._boomT <= 0) { app.sfx.boom(); this._boomT = 0.15; }
    app.flash(0.08, 0xffb070);
    if (d && d.state === 'fly') {
      d.state = 'fall';
      d.fallV.copy(d.vel).multiplyScalar(0.35);
      d.fallV.y = Math.max(d.fallV.y, 2);
      d.spin = rand(2, 5) * (Math.random() < 0.5 ? -1 : 1);
      if (d.locked) { d.locked = false; this.locks.splice(this.locks.indexOf(d), 1); }
      this.kills++;
      d.glow.material.opacity = 0;
      if (Math.random() < 0.6) this.say(`${d.id} down. Debris falling clear of the streets.`);
    } else if (d) d.inbound = false;
  }

  _flash(pos, size) {
    const f = this.flashes[this._flashI];
    this._flashI = (this._flashI + 1) % this.flashes.length;
    f.f.position.copy(pos); f.age = 0; f.size = size; f.f.visible = true;
  }

  _scan() {
    const app = this.app;
    if (!this._needHelmet()) return;
    app.sfx.scan();
    this.scanT = 4.5;
    this.helmet.classList.remove('scanning'); void this.helmet.offsetWidth; this.helmet.classList.add('scanning');
    const alive = this.drones.filter((d) => d.state === 'fly').sort((a, b) => a.dist - b.dist);
    for (const d of this.drones) {
      const on = d.state === 'fly';
      d.row.style.display = on ? '' : 'none';
      if (on) {
        d.row.style.order = String(alive.indexOf(d));
        d.row.children[2].textContent = `${Math.round(d.dist)} m`;
        d.row.children[3].textContent = this._threatName(d.threat);
      }
    }
    this.listEl.classList.add('on');
    this.say(`Scan complete: ${alive.length} contacts, all hostile. Nearest ${alive[0] ? `${alive[0].id} at ${Math.round(alive[0].dist)} metres` : 'none'}.`);
  }

  _nightVision() {
    const app = this.app;
    if (!this._needHelmet()) return;
    this.nv = !this.nv;
    this.nvBtn.classList.toggle('active', this.nv);
    this.ui.classList.toggle('nv', this.nv);
    if (this.nv) {
      Object.assign(this.grade, { tint: 0x7dff9a, tintAmt: 0.92, grain: 0.12, sat: 0.2, vig: 0.55, ca: 0.004 });
      this.exposure = 1.15;
      this._hc = { line: 'rgba(125,255,154,0.85)', text: '#d4ffdf' };
      app.sfx.hologram();
    } else {
      Object.assign(this.grade, this.baseGrade);
      this.exposure = 1;
      this._hc = { line: 'rgba(95,227,255,0.85)', text: '#bff6ff' };
      app.sfx.powerDown();
    }
    this._compassDeg = null;
    this.say(this.nv ? 'Night vision on. Thermal contrast boosted.' : 'Night vision off.');
  }

  _hurt() {
    const app = this.app;
    app.bleed();
    app.flash(0.18, 0xff3030);
    app.sfx.zap();
    this.integrity = Math.max(0.35, this.integrity - rand(0.04, 0.08));
    this._hurtT = 0;
    const keys = Object.keys(this.parts);
    const k = keys[Math.floor(Math.random() * keys.length)];
    const el = this.parts[k];
    el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
    const names = { head: 'helmet', torso: 'chest plate', armR: 'right arm', armL: 'left arm', legR: 'right leg', legL: 'left leg' };
    this.say(`Laser graze on the ${names[k]}. Plating holding.`);
  }

  /** The HUD lives in the helmet: without it on, its functions are unavailable. */
  _needHelmet() {
    if (this.worn) return true;
    this.app.sfx.wrong();
    if (this.helmState === 'off') this.app.toast('The HUD lives in the helmet. Press <b>Helmet on</b>.', 2400);
    return false;
  }

  _toggleHelmet() {
    if (this.helmState === 'worn') this._helmetOff();
    else if (this.helmState === 'off') this._helmetOn();
  }

  /** Put the helmet on: it turns to face you, comes onto the view, dark for a beat, then the HUD boots. */
  _helmetOn() {
    // (already hovering in front of you after "Remove helmet": skip the rise into view)
    const fromOff = this.helmState === 'off' && this.helm.visible;
    this.helmState = 'on'; this.helmT = fromOff ? 1.5 : 0; this.worn = false;
    this._cues = { eyes: fromOff, whoosh: false, clank: false, dark: false, boot: false, hello: false };
    this.ui.classList.add('hd-off');
    this.ui.classList.remove('boot');
    this.helm.visible = !!this.helmet3d;
    if (this.helmet3d) this.helmet3d.eyes = fromOff ? 1 : 0;
    this._setHelmBtn('Remove helmet', true);
    this.app.sfx.servo(0.4);
  }

  /** Take it off: the HUD powers down and the helmet comes away from the view to hover in front of you. */
  _helmetOff() {
    this.helmState = 'removing'; this.helmT = 0; this.worn = false;
    this._clearLocks();
    this.ui.classList.add('hd-off');
    this.ui.classList.remove('boot', 'hd-alert');
    this.helm.visible = !!this.helmet3d;
    if (this.helmet3d) this.helmet3d.eyes = 1;
    this._setHelmBtn('Helmet on', true);
    this.app.sfx.powerDown();
    this.app.sfx.servo(0.5);
    this.app.setHover(false);
    this.hovered = null;
  }

  _setHelmBtn(text, disabled) {
    this.helmBtn.innerHTML = text;
    this.helmBtn.disabled = disabled;
  }

  _helmet(dt, t) {
    const st = this.helmState;
    if (st === 'worn') return;
    const app = this.app, H = this.helm, c = this._cues;
    this.helmT += dt;
    const T = this.helmT;
    let close = 0;
    if (st === 'on') {
      if (T < 1.9) {
        // rising into view, turning from profile to face you
        const k = easeInOut(clamp(T / 1.3, 0, 1));
        H.position.set(HELM_SHOW.x, lerp(-0.9, HELM_SHOW.y, k) + Math.sin(T * 2) * 0.02, HELM_SHOW.z);
        H.rotation.set(0.08 * (1 - k), lerp(1.35, 0, k), 0);
        if (!c.eyes && T > 0.95) { c.eyes = true; if (this.helmet3d) this.helmet3d.eyes = 1; app.sfx.hologram(); }
      } else {
        // it turns round (as you would wear it) and comes onto the view
        const k = easeInOut(clamp((T - 1.9) / 1.3, 0, 1));
        H.position.lerpVectors(HELM_SHOW, HELM_WORN, k);
        H.rotation.set(0, Math.PI * k, 0);
        if (!c.whoosh) { c.whoosh = true; app.sfx.whoosh(); }
        if (!c.clank && T > 2.95) { c.clank = true; app.sfx.visor(); }
      }
      // the closing vignette, a dark beat, then it opens on the booting HUD
      close = T < 2.5 ? 0 : T < 3.2 ? (T - 2.5) / 0.7 : T < 3.8 ? 1 : Math.max(0, 1 - (T - 3.8) / 0.7);
      if (!c.dark && T > 3.2) { c.dark = true; H.visible = false; }
      if (!c.boot && T > 3.8) {
        c.boot = true;
        this.worn = true;
        this.ui.classList.remove('hd-off');
        this.ui.classList.add('boot');
        app.sfx.powerUp();
        app.sfx.scan();
        this._compassDeg = null;
      }
      if (!c.hello && T > 4.5) {
        c.hello = true;
        this._boots++;
        if (this._boots === 1) {
          this.say('J.A.R.V.I.S. online. Helmet sealed, display aligned to your eyes.');
          this.say('Patrol altitude one hundred fifty metres. Ten unidentified drones over the district, marked hostile.');
        } else this.say(this._boots % 2 ? 'Display back up. Tracking resumed where we left off.' : 'Welcome back. Every contact is still where I left it.');
      }
      if (T > SEQ_ON) {
        this.helmState = 'worn';
        this.ui.classList.remove('boot');
        this._setHelmBtn('Remove helmet', false);
        if (!this._toldHud) { this._toldHud = true; this.onEnter(); }
      }
    } else if (st === 'removing') {
      const k = easeInOut(clamp(T / SEQ_OFF, 0, 1));
      H.position.lerpVectors(HELM_WORN, HELM_SHOW, k);
      H.rotation.set(0, Math.PI * (1 - k), 0);
      close = Math.max(0, 0.7 - T * 1.4);
      if (T > SEQ_OFF) { this.helmState = 'off'; this._setHelmBtn('Helmet on', false); }
    } else if (st === 'off') {
      H.position.set(HELM_SHOW.x, HELM_SHOW.y + Math.sin(t * 1.3) * 0.03, HELM_SHOW.z);
      H.rotation.set(Math.sin(t * 0.7) * 0.05, Math.sin(t * 0.45) * 0.5, 0);
    }
    if (this._close !== close) { this._close = close; this.closeEl.style.setProperty('--close', close.toFixed(3)); this.closeEl.style.opacity = close > 0 ? '1' : '0'; }
    if (this.helmet3d && H.visible) this.helmet3d.update(dt);
  }

  _threatName(v) { return v > 0.7 ? 'High' : v > 0.4 ? 'Moderate' : 'Low'; }

  /** The drone nearest a screen point (within r px), or null. */
  _pick(x, y, r) {
    let best = null, bd = r * r;
    for (const d of this.drones) {
      if (d.state !== 'fly' || !d.on) continue;
      const dd = (d.sx - x) ** 2 + (d.sy - y) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle & input                                                   */
  /* ------------------------------------------------------------------ */

  onEnter() {
    this.app.toast(this.app.isTouch
      ? '<b>Tap</b> a drone to lock it, then hit <b>Fire</b>.'
      : '<b>Point</b> at a drone to analyse it, <b>click</b> to lock, <b>F</b> to fire.', 3600);
  }

  enter() {
    this._compassDeg = null;
    this._helmetOn(); // every arrival: the helmet goes on
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    this.app.setHover(false);
    this.hovered = null;
    this.warn = false;
    this.ui.classList.remove('hd-alert', 'boot');
    this.ui.classList.add('hd-off');
    this.helm.visible = false;
    this.worn = false;
    this.helmState = 'off';
    this._close = null;
    this.closeEl.style.opacity = '0';
  }

  resize(w, hh) {
    this.camera.fov = w / hh < 0.9 ? 74 : 58;
    super.resize(w, hh);
    this.portrait = w / hh < 0.9;
    this.cx = w / hh > 1.1 ? w * (0.5 + this.shiftView) : w / 2;
    this.ui.style.setProperty('--cx', `${Math.round(this.cx)}px`);
    this.focal = (hh / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    for (const r of this.rungs) r.style.top = `${Math.round(-Math.tan(THREE.MathUtils.degToRad(+r.dataset.a)) * this.focal)}px`;
  }

  pointerMove(p) {
    if (p.down && p.type !== 'mouse') {
      this.lookYawT = clamp(this.lookYawT - p.dx * 0.004, -0.7, 0.7);
      this.lookPitchT = clamp(this.lookPitchT - p.dy * 0.003, -0.35, 0.3);
    }
  }

  click(p) {
    if (!this.worn) return;
    const d = this._pick(p.x, p.y, this.app.isTouch ? 80 : 60);
    if (d) {
      this._toggleLock(d);
      this.tapped = d; this._tapT = 3;
    }
  }

  key(e) {
    const k = e.key;
    if (k === 'Enter' && e.target?.closest?.('button')) return false;
    if (k === 'f' || k === 'F' || k === 'Enter') { this._fire(); return true; }
    if (k === 's' || k === 'S') { this._scan(); return true; }
    if (k === 'n' || k === 'N') { this._nightVision(); return true; }
    if (k === 'c' || k === 'C') { this._clearLocks(); return true; }
    if (k === 'h' || k === 'H') { if (!this.helmBtn.disabled) this._toggleHelmet(); return true; }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                               */
  /* ------------------------------------------------------------------ */

  update(dt, t) {
    const app = this.app, p = app.pointer, cam = this.camera;
    this._boomT -= dt;

    // ---- the patrol: a slow loop over the city, bobbing and banking ----
    this.speed = 22 + Math.sin(t * 0.13) * 6;
    const R0 = 250;
    this.pathA += (this.speed / R0) * dt;
    const a = this.pathA;
    const R = R0 + Math.sin(a * 3) * 40;
    this.base.set(Math.cos(a) * R, 150 + Math.sin(a * 2) * 12, Math.sin(a) * R);
    // tangent (counter-clockwise from above), used as the patrol heading
    const tx = -Math.sin(a) * R + Math.cos(a) * 120 * Math.cos(a * 3), tz = Math.cos(a) * R + Math.sin(a) * 120 * Math.cos(a * 3);
    const pathYaw = Math.atan2(-tx, -tz);
    this.yaw = pathYaw;
    this._fwd.set(-Math.sin(pathYaw), 0, -Math.cos(pathYaw));
    this._right.set(Math.cos(pathYaw), 0, -Math.sin(pathYaw));

    // ---- where you look: the mouse nudges the head; touch drags it; tilt turns it ----
    if (p.type === 'mouse') { this.lookYawT = -p.ndc.x * 0.14; this.lookPitchT = p.ndc.y * 0.07; }
    else if (!p.down) { this.lookYawT = damp(this.lookYawT, 0, 0.5, dt); this.lookPitchT = damp(this.lookPitchT, 0, 0.5, dt); }
    const g = app.gyro;
    this.lookYaw = damp(this.lookYaw, this.lookYawT - (g ? g.x * 0.35 : 0), 2, dt);
    this.lookPitch = damp(this.lookPitch, this.lookPitchT + (g ? g.y * 0.2 : 0), 2, dt);
    this.pitch = -0.06 + Math.sin(t * 0.37) * 0.035 + this.lookPitch;
    this.roll = 0.09 + Math.sin(t * 0.29) * 0.05 + Math.sin(t * 1.3) * 0.008;
    cam.position.copy(this.base);
    cam.position.y += Math.sin(t * 1.1) * 0.4;
    cam.rotation.set(this.pitch, pathYaw + this.lookYaw, this.roll);
    cam.updateMatrixWorld();
    this.sky.position.copy(cam.position);

    // ---- drones ----
    this._drones(dt, t);

    // ---- missiles ----
    this._launchT -= dt;
    if (this.launchQ.length && this._launchT <= 0) { this._launch(this.launchQ.shift()); this._launchT = 0.11; }
    this._missiles(dt);

    // ---- effects ----
    for (const f of this.flashes) {
      if (!f.f.visible) continue;
      f.age += dt;
      const k = f.age / 0.5;
      if (k >= 1) { f.f.visible = false; continue; }
      f.f.scale.setScalar(f.size * (0.4 + k));
      f.f.material.opacity = (1 - k) * (1 - k) * 0.7;
    }
    this.boom.update(dt, t);
    this.smoke.update(dt, t);
    this.flame.update(dt, t);
    this.beams.update(dt, cam);

    // ---- suit systems ----
    this.power = Math.min(1, this.power + dt * 0.018);
    this._hurtT += dt;
    if (this._hurtT > 4) this.integrity = Math.min(1, this.integrity + dt * 0.012);
    this.scanT = Math.max(0, this.scanT - dt);
    if (this.scanT <= 0 && this.listEl.classList.contains('on')) this.listEl.classList.remove('on');
    this._ambT -= dt;
    if (this._ambT <= 0) this.say(AMBIENT[Math.floor(Math.random() * AMBIENT.length)]);
    this._typeAI(dt);

    // warning: a drone too close
    if (this.warn) {
      this._alarmT -= dt;
      if (this._alarmT <= 0) { this._alarmT = 2.6; app.sfx.alarm(); }
    }
    // the helmet entrance; while its lacquer is in view only true light sources bloom
    this._helmet(dt, t);
    this.helmKey.intensity = this.helm.visible ? 22 : 0;
    this.helmRim.intensity = this.helm.visible ? 30 : 0;
    this.bloom.strength = 0.8 + (this.nv ? 0.3 : 0);
    this.bloom.threshold = this.helm.visible ? 2.8 : this.nv ? 1.6 : 2.5;

    this._hud(dt, t);
  }

  _drones(dt, t) {
    const app = this.app, cam = this.camera;
    const aspectK = clamp((app.width / app.height) * 0.75, 0.45, 1);
    // every few seconds one drone makes a run at you
    if (this.worn) this._attackT -= dt;
    if (this._attackT <= 0) {
      this._attackT = rand(7, 12);
      const pool = this.drones.filter((d) => d.state === 'fly' && d.atkPhase === 0 && d.grow >= 1);
      if (pool.length) { const d = pool[Math.floor(Math.random() * pool.length)]; d.atkPhase = 1; d.atkT = 0; }
    }
    let threat = 0, warn = false;
    for (const d of this.drones) {
      d.prev.copy(d.pos);
      if (d.state === 'fly') {
        // attack run: approach (1), fire (2), withdraw (3)
        if (d.atkPhase) {
          d.atkT += dt;
          if (d.atkPhase === 1) { d.atk = Math.min(1, d.atkT / 2.6); if (d.atkT > 2.6) { d.atkPhase = 2; d.atkT = 0; d.fireT = 0.3; } }
          else if (d.atkPhase === 2) {
            d.fireT -= dt;
            if (d.fireT <= 0) { d.fireT = rand(0.6, 1); this._laser(d); }
            if (d.atkT > 2.8) { d.atkPhase = 3; d.atkT = 0; }
          } else { d.atk = Math.max(0, 1 - d.atkT / 3); if (d.atk <= 0) d.atkPhase = 0; }
        }
        const e = d.atk * d.atk * (3 - 2 * d.atk);
        let lx = d.ax * Math.sin(d.w1 * t + d.p1) * aspectK;
        let ly = d.y0 + d.ay * Math.sin(d.w2 * t + d.p2);
        let lz = d.z0 + d.az * Math.sin(d.w3 * t + d.p3);
        lx = lerp(lx, d.side * 9, e); ly = lerp(ly, -1.5, e); lz = lerp(lz, 22, e);
        d.pos.copy(this.base).addScaledVector(this._right, lx).addScaledVector(this._fwd, lz);
        d.pos.y += ly;
        d.pos.y = Math.max(d.pos.y, this.city.heightAt(d.pos.x, d.pos.z) + 12);
        d.grow = Math.min(1, d.grow + dt * 0.8);
        d.g.scale.setScalar(4 * d.grow);
        d.glow.material.opacity = 0.6 + Math.sin(t * 6 + d.i) * 0.2;
      } else if (d.state === 'fall') {
        d.fallV.y -= 18 * dt;
        d.pos.addScaledVector(d.fallV, dt);
        d.g.rotation.z += d.spin * dt;
        d.g.rotation.x += d.spin * 0.6 * dt;
        this.smoke.emit({ x: d.pos.x, y: d.pos.y, z: d.pos.z, vx: rand(-1, 1), vy: rand(0, 2), vz: rand(-1, 1), life: rand(1.2, 2.2), size: rand(2, 3.5), color: this.smokeCols[d.i % 3], grow: 1.5, alpha: 0.5 });
        this.flame.emit({ x: d.pos.x, y: d.pos.y, z: d.pos.z, vx: rand(-1, 1), vy: rand(0, 1), vz: rand(-1, 1), life: rand(0.2, 0.4), size: rand(1.2, 2.2), color: this.flameCols[d.i % 2] });
        const floor = this.city.heightAt(d.pos.x, d.pos.z);
        if (d.pos.y <= floor + 1) {
          this.boom.at(d.pos, 2);
          this._flash(d.pos, 16);
          d.state = 'dead';
          d.g.visible = false;
          d.respawn = rand(6, 10);
        }
      } else {
        d.respawn -= dt;
        if (d.respawn <= 0) {
          this._plan(d);
          if (Math.random() < 0.5) this.say(`New contact inbound: ${d.id}, ${d.type.name.toLowerCase()}.`);
        }
        d.on = false;
        continue;
      }
      // face along the motion
      d.vel.subVectors(d.pos, d.prev).divideScalar(Math.max(dt, 1e-3));
      if (d.state === 'fly' && d.vel.lengthSq() > 0.5) {
        this._v.copy(d.pos).addScaledVector(d.vel, 0.2);
        if (d.atk > 0.4) this._v.lerp(cam.position, d.atk); // it turns its eye on you
        d.g.lookAt(this._v);
      }
      d.dist = d.pos.distanceTo(cam.position);
      d.threat = clamp(d.type.base * 0.45 + clamp(1 - d.dist / 320, 0, 1) * 0.55 + d.atk * 0.3, 0, 1);
      if (d.state === 'fly') { threat = Math.max(threat, d.threat); if (d.dist < 70) warn = true; }
      const s = toScreen(d.pos, cam, app.width, app.height);
      d.sx = s.x; d.sy = s.y;
      d.on = !s.behind && s.x > -40 && s.x < app.width + 40 && s.y > -40 && s.y < app.height + 40;
    }
    this.threat = damp(this.threat, threat, 3, dt);
    if (warn !== this.warn) {
      this.warn = warn;
      this.ui.classList.toggle('hd-alert', warn);
      if (warn) { this._alarmT = 0; this.say('Contact inside seventy metres. Evasive advised.'); app.sfx.setMood('battle', 14); }
    }
  }

  _laser(d) {
    const cam = this.camera;
    const graze = Math.random() < 0.35;
    const from = this._v.set(0, -0.05, 0.62);
    d.g.localToWorld(from);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = graze ? rand(0.9, 1.4) : rand(2.5, 5);
    const to = this._v2.set(side * off, rand(-1.2, 0.8), -1.5);
    cam.localToWorld(to);
    // carry the beam on past you
    to.sub(from).multiplyScalar(1.6).add(from);
    this.beams.fire(from, to, { width: 0.35, life: 0.28, color: 0xff3030 });
    this.app.sfx.zap();
    if (graze) this._hurt();
  }

  _missiles(dt) {
    let any = false;
    for (let i = 0; i < N_MISSILES; i++) {
      const m = this.missiles[i];
      if (!m.active) continue;
      any = true;
      m.t += dt / m.dur;
      if (m.target && m.target.state === 'fly') m.end.copy(m.target.pos);
      if (m.t >= 1) { this._hit(m); this._m4.makeScale(0, 0, 0); this.missileMesh.setMatrixAt(i, this._m4); continue; }
      const k = m.t, a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
      m.prev.copy(m.pos);
      m.pos.set(a * m.p0.x + b * m.p1.x + c * m.end.x, a * m.p0.y + b * m.p1.y + c * m.end.y, a * m.p0.z + b * m.p1.z + c * m.end.z);
      this._v.subVectors(m.pos, m.prev);
      if (this._v.lengthSq() > 1e-8) this._q.setFromUnitVectors(this._z, this._v.normalize());
      this._m4.compose(m.pos, this._q, this._one);
      this.missileMesh.setMatrixAt(i, this._m4);
      // flame and smoke from the tail
      const tx = m.pos.x - this._v.x * 0.5, ty = m.pos.y - this._v.y * 0.5, tz = m.pos.z - this._v.z * 0.5;
      this.flame.emit({ x: tx, y: ty, z: tz, vx: -this._v.x * 4, vy: -this._v.y * 4, vz: -this._v.z * 4, life: rand(0.08, 0.16), size: rand(0.35, 0.6), color: this.flameCols[i % 3] });
      // a continuous ribbon of exhaust smoke: puffs laid along the whole step, not one per frame
      const step = m.pos.distanceTo(m.prev);
      for (let j = 0; j < 3; j++) {
        const back = step * (j / 3);
        this.smoke.emit({ x: tx - this._v.x * back, y: ty - this._v.y * back, z: tz - this._v.z * back, vx: rand(-0.4, 0.4), vy: rand(0, 0.5), vz: rand(-0.4, 0.4), life: rand(0.8, 1.3), size: rand(0.7, 1.2), color: this.smokeCols[i % 3], grow: 3, alpha: 0.28 });
      }
    }
    if (any || this._missilesDirty) this.missileMesh.instanceMatrix.needsUpdate = true;
    this._missilesDirty = any;
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                 */
  /* ------------------------------------------------------------------ */

  _txt(el, v) { if (el._v !== v) { el._v = v; el.textContent = v; } }
  _tf(el, v) { if (el._t !== v) { el._t = v; el.style.transform = v; } }
  _show(el, on) { if (el._on !== on) { el._on = on; el.classList.toggle('on', on); } }

  _hud(dt) {
    const app = this.app, p = app.pointer;
    // horizon and ladder follow the head
    const py = Math.round(Math.tan(this.pitch) * this.focal);
    this._tf(this.ladder, `translate(${Math.round(this.cx)}px, ${Math.round(app.height / 2)}px) rotate(${(this.roll * 57.3).toFixed(1)}deg) translateY(${py}px)`);
    // flight-path marker: where the patrol is heading
    const fs = toScreen(this._v.copy(this.camera.position).addScaledVector(this._fwd, 100), this.camera, app.width, app.height);
    this._tf(this.fpm, `translate(${Math.round(fs.x)}px, ${Math.round(fs.y)}px)`);

    // compass
    const deg = Math.round((((-(this.yaw + this.lookYaw) * 180) / Math.PI) % 360 + 360) % 360);
    if (deg !== this._compassDeg) { this._compassDeg = deg; this._drawCompass(deg); this.headingEl.textContent = String(deg).padStart(3, '0'); }

    // tapes
    const kmh = this.speed * 3.6;
    this._tf(this.spdTape.strip, `translateY(${Math.round(-(300 - kmh) * TAPE_PX)}px)`);
    this._txt(this.spdTape.val, String(Math.round(kmh)));
    const alt = this.camera.position.y;
    this._tf(this.altTape.strip, `translateY(${Math.round(-(400 - alt) * TAPE_PX)}px)`);
    this._txt(this.altTape.val, String(Math.round(alt)));

    // systems
    const pw = Math.round(this.power * 100);
    if (pw !== this._pw) { this._pw = pw; this.powerFg.style.strokeDashoffset = String(314.2 * (1 - this.power)); this.powerTxt.textContent = `${pw}%`; this.powerFg.classList.toggle('low', pw < 25); }
    this._txt(this.integrityTxt, `${Math.round(this.integrity * 100)}%`);
    const th = Math.round(this.threat * 100);
    if (th !== this._th) { this._th = th; this.threatFill.style.width = `${th}%`; this.threatFill.classList.toggle('red', th > 70); this.threatTxt.textContent = this._threatName(this.threat); }
    this._txt(this.killTxt, String(this.kills));
    this._txt(this.lockTxt, `${this.locks.length}/${MAX_LOCKS}`);
    if (this.fireBtn._n !== this.locks.length) { this.fireBtn._n = this.locks.length; this.fireBtn.textContent = this.locks.length ? `Fire ×${this.locks.length}` : 'Fire'; }

    // targeting: hover analysis
    let hov = null;
    if (!app.isTouch && !this.app.busy && this.worn) hov = this._pick(p.x, p.y, 60);
    this._tapT -= dt;
    if (!hov && this.worn && this._tapT > 0 && this.tapped && this.tapped.state === 'fly' && this.tapped.on) hov = this.tapped;
    if (hov !== this.hovered) {
      if (hov && !app.isTouch) app.sfx.hover();
      this.hovered = hov;
      app.setHover(!!hov);
    }
    this._show(this.ana, !!hov);
    if (hov) {
      this._tf(this.ana, `translate(${Math.round(hov.sx)}px, ${Math.round(hov.sy)}px)`);
      this._txt(this.anaName, `${hov.id}${hov.locked ? ' · locked' : ''}`);
      this._txt(this.anaType, hov.type.name);
      this._txt(this.anaRange, `Range ${Math.round(hov.dist / 5) * 5} m`);
      this._txt(this.anaThreat, `Threat ${this._threatName(hov.threat)}`);
      if (this.ana._hi !== hov.threat > 0.7) { this.ana._hi = hov.threat > 0.7; this.ana.classList.toggle('hi', this.ana._hi); }
    }

    // lock boxes
    for (let k = 0; k < MAX_LOCKS; k++) {
      const el = this.lockEls[k], d = this.locks[k];
      const on = !!d && d.on;
      this._show(el, on);
      if (on) {
        const sz = clamp(900 / d.dist, 0.7, 1.6);
        this._tf(el, `translate(${Math.round(d.sx)}px, ${Math.round(d.sy)}px) scale(${sz.toFixed(2)})`);
        this._txt(el.firstChild, `${d.id} · ${d.inbound ? 'impact' : `${Math.round(d.dist)} m`}`);
        if (el._inb !== d.inbound) { el._inb = d.inbound; el.classList.toggle('inbound', d.inbound); }
      }
    }

    // scan tags
    for (const d of this.drones) {
      const on = this.scanT > 0 && d.state === 'fly' && d.on;
      this._show(d.tag, on);
      if (on) {
        this._tf(d.tag, `translate(${Math.round(d.sx)}px, ${Math.round(d.sy)}px)`);
        this._txt(d.tag.firstChild, `${d.id} · ${Math.round(d.dist)} m`);
      }
    }
  }

  _drawCompass(deg) {
    const x = this.compassCtx, W = 720, H = 64, span = 100, ppd = W / span;
    x.clearRect(0, 0, W, H);
    x.strokeStyle = this._hc.line;
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(0, H - 3); x.lineTo(W, H - 3);
    for (let d = Math.ceil((deg - span / 2) / 5) * 5; d <= deg + span / 2; d += 5) {
      const px = W / 2 + (d - deg) * ppd;
      const n = ((d % 360) + 360) % 360;
      x.moveTo(px, H - 3); x.lineTo(px, n % 30 === 0 ? H - 24 : n % 10 === 0 ? H - 15 : H - 9);
    }
    x.stroke();
    x.fillStyle = this._hc.text;
    x.font = '700 21px Rajdhani, sans-serif';
    x.textAlign = 'center';
    for (let d = Math.ceil((deg - span / 2) / 30) * 30; d <= deg + span / 2; d += 30) {
      const n = ((d % 360) + 360) % 360;
      x.fillText(n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : String(n / 10).padStart(2, '0'), W / 2 + (d - deg) * ppd, 24);
    }
  }
}
