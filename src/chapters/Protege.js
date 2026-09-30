import * as THREE from 'three';
import './Protege.css';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Chapter } from '../core/Chapter.js';
import { CineCam } from '../core/CineCam.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { AutoRig } from '../objects/AutoRig.js';
import { ParticlePool } from '../objects/Particles.js';
import { createCity, glowSprite } from '../objects/FX.js';
import { suitEnvironment } from '../objects/Suit.js';
import { mergeStatic } from '../core/mergeStatic.js';
import { rand, damp, clamp, TAU, h } from '../core/utils.js';
import { loadEnv, envMap, backdrop, loadTextures, pbr, HDRIS } from '../core/Env.js';

/*
 * Mentor & Protégé. Golden hour on a Queens rooftop: gravel and tar, a brick parapet, an old timber water
 * tower, HVAC boxes, cables and an antenna with its red light. The Stark-built protégé suit waits by the
 * parapet; hold (or press the button) and Iron Man flies in over the city on his boot jets and lands beside
 * it. Tap either suit for its card, compare the two suits' tech, tap the city to shoot a web line from the
 * wrist, and link the suits. The models are shown exactly as sculpted: only whole models move.
 */

const IRON = 'classic';
const ROOF_H = 21;                       // the roof is 21 m above the street
const RX = 10, RZ = 9.5;                 // the roof: x -10..10, z -9.5..9.5 (the parapet on its edge)
const PARA = 1.05, PT = 0.35;            // parapet height and thickness
const YAW0 = 0.6;                        // the default view: the camera to the right front, looking out over the city
const FACE = new THREE.Vector3(Math.sin(YAW0), 0, Math.cos(YAW0));   // toward the camera
const VIEW = FACE.clone().negate();                                   // out toward the skyline
const RIGHT = new THREE.Vector3(Math.cos(YAW0), 0, -Math.sin(YAW0));  // screen right
const T0 = new THREE.Vector3(0, 1.0, -5.4);                           // between the two suits
const SP = T0.clone().addScaledVector(RIGHT, -0.8).setY(0);            // the protégé
const SP_YAW = YAW0 + 0.42;
const LAND = T0.clone().addScaledVector(RIGHT, 0.95).addScaledVector(FACE, 0.2).setY(0);
const IRON_YAW = YAW0 - 0.5;
const COM = 1.0;                         // the armor turns in flight about its middle, not its feet
const HOVER = 2.6;                       // hover height before it sets down
const FLY = 5.4, DESC = 1.8, LEAVE = 4.4;
// the photographed sunset (venice_sunset): its sun (u = 0.6 of the panorama) turned onto SUN_DIR; the dome uses
// the clean stretch u 0.31..0.765 (no palazzi), mirrored round the circle (as in Hud.js)
const SUN_DIR = new THREE.Vector3(-0.3, 0.07, -0.95).normalize();
const SUN_AZ = Math.atan2(SUN_DIR.z, SUN_DIR.x);
const SKY_ROT = (0.6 - 0.5) * TAU - SUN_AZ;
const SKY_U0 = 0.31, SKY_U1 = 0.765;
const SKY_MROT = ((0.6 - SKY_U0) / (SKY_U1 - SKY_U0) / 2 - 0.5) * TAU - SUN_AZ;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

const CARDS = {
  iron: {
    jp: 'Mentor · Stark armor',
    name: 'Iron Man',
    text: 'A powered exoskeleton of layered gold-titanium alloy, carried on repulsors in the boots and palms and fed by the arc reactor in its chest. An onboard AI flies, targets and diagnoses faster than any pilot could — the armor is as much a computer as a machine.',
    spec: [['Height', '1.9 m'], ['Power', 'Arc reactor'], ['Flight', 'Boot & palm repulsors'], ['Weapons', 'Repulsors, chest beam, micro-missiles'], ['AI', 'J.A.R.V.I.S., later F.R.I.D.A.Y.']],
  },
  spider: {
    jp: 'Protégé · Stark-built suit',
    name: 'The Stark suit',
    text: 'Built for a kid from Queens who had been fighting crime in a homemade outfit. Under the fabric sit sensors, a heater, an airbag, a parachute and a small drone hidden in the chest emblem — much of it locked away until its wearer proved ready for it.',
    spec: [['Height', '1.72 m'], ['Mobility', 'Web-swinging, wall-crawling'], ['Web-shooters', 'Wrist-mounted, 576 combinations'], ['Lenses', 'Adjustable, like a camera aperture'], ['AI', 'A built-in suit assistant']],
  },
};
const TECH = [
  ['Power', 'Arc reactor in the chest', 'Its wearer\'s own strength'],
  ['Movement', 'Repulsor flight, supersonic', 'Web lines, rooftop to rooftop'],
  ['Eyes', 'Helmet display, full sensor suite', 'Lenses that narrow to focus'],
  ['Assistant', 'J.A.R.V.I.S. / F.R.I.D.A.Y.', 'A suit AI with a voice of its own'],
  ['Signature', 'Palm repulsors', 'Wrist web-shooters'],
  ['Built from', 'Gold-titanium alloy plates', 'Tech-woven fabric'],
  ['Hidden extra', 'Micro-missiles', 'A drone in the emblem'],
];

/* ---- photographed sky, aerial perspective, the far city (local copies of the helpers in Battle.js / Hud.js) ---- */

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

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
        gu *= uBlur; gv *= uBlur;
        vec3 col = textureGrad(uMap, vec2(u, v), vec2(gu.x, gv.x), vec2(gu.y, gv.y)).rgb;
        if (uSmoothTop > 0.0) {
          vec3 soft = textureGrad(uMap, vec2(u, v), vec2(gu.x, gv.x) * 24.0, vec2(gu.y, gv.y) * 24.0).rgb;
          col = mix(col, soft, smoothstep(0.08, 0.35, y) * uSmoothTop);
        }
        float m = max(col.r, max(col.g, col.b));
        col *= uInt * (1.0 + smoothstep(0.9, 1.0, m) * uBoost);
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

function farTowers({ n, rMin, rMax, hMin, hMax, a0 = 0, a1 = TAU, wMin = 12, wMax = 32, color = 0x2a2828, win = 0xffb070, winK = 0.5 }) {
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
          float w = mix(0.07, inWin * lit, fine) * (1.0 - step(0.5, vUp));
          totalEmissiveRadiance += uWin * w;
        }`);
  };
  const tower = merge([new THREE.BoxGeometry(1, 0.82, 1).translate(0, 0.41, 0), new THREE.BoxGeometry(0.62, 0.14, 0.7).translate(0.08, 0.89, 0), new THREE.BoxGeometry(0.3, 0.06, 0.3).translate(0.1, 0.99, 0.05)]);
  const mesh = new THREE.InstancedMesh(tower, mat, n);
  const dm = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const a = rand(a0, a1), r = rMin + (rMax - rMin) * Math.pow(Math.random(), 1.2);
    dm.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    dm.rotation.set(0, Math.round(rand(0, 4)) * Math.PI / 2 + rand(-0.08, 0.08), 0);
    const w = rand(wMin, wMax);
    dm.scale.set(w, rand(hMin, hMax) * (Math.random() < 0.08 ? 1.5 : 1), w * rand(0.6, 1.4));
    dm.updateMatrix();
    mesh.setMatrixAt(i, dm.matrix);
  }
  mesh.computeBoundingSphere();
  return mesh;
}

/* ---- geometry helpers: textures tile at a real-world size (metres per tile), so merged parts share a material ---- */

function box(w, hh, d, x, y, z, tile = 1, ry = 0) {
  const g = new THREE.BoxGeometry(w, hh, d);
  const uv = g.attributes.uv;
  const size = [[d, hh], [d, hh], [w, d], [w, d], [w, hh], [w, hh]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * size[f][0] / tile, uv.getY(i) * size[f][1] / tile);
  }
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
}

function cyl(r0, r1, hh, x, y, z, seg = 16, tile = 1, open = false) {
  const g = new THREE.CylinderGeometry(r0, r1, hh, seg, 1, open);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * Math.max(r0, r1) / tile, uv.getY(i) * hh / tile);
  return g.translate(x, y, z);
}

/** A rod between two points. */
function rod(a, b, r = 0.02, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** A slack cable hanging between two points (a catenary-ish sag). */
function cable(a, b, sag, r = 0.012) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const s = i / 24;
    pts.push(new THREE.Vector3().lerpVectors(a, b, s).add(new THREE.Vector3(0, -sag * 4 * s * (1 - s), 0)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r, 5, false);
}

const merge = (list) => { const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x))); list.forEach((x) => x.dispose()); return g; };

function bez(p0, p1, p2, p3, s, out) {
  const u = 1 - s;
  return out.set(0, 0, 0).addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * s).addScaledVector(p2, 3 * u * s * s).addScaledVector(p3, s * s * s);
}

export class Protege extends Chapter {
  constructor(app) {
    super(app, { id: 'protege', title: 'Protégé', jp: 'QUEENS' });
    this.bloom = { strength: 0.8, radius: 0.5, threshold: 2.6 }; // only true light sources bloom
    this.grade = { ...this.grade, grain: 0.022, vig: 0.4, ca: 0.0015, sat: 1.02, tint: 0xffa860, tintAmt: 0.025 };
    this.mood = 'calm';
    this.exposure = 1.2;
    this.shiftView = 0.14;
    this.trail = false;
    this.state = 'away'; // away | arriving | landed | leaving
    this.seen = false;
  }

  load() {
    return Promise.all([
      loadModels(['spider', IRON]),
      loadEnv(HDRIS.sunset, { backdrop: true }),
      loadTextures(['coast_sand_01', 'rock_wall_08', 'concrete_floor_worn_001', 'old_planks_02']),
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* build                                                               */
  /* ------------------------------------------------------------------ */

  build() {
    const s = this.scene, low = this.app.low;
    const env = envMap(HDRIS.sunset), skyTex = backdrop(HDRIS.sunset);
    s.environment = env || suitEnvironment();
    s.environmentIntensity = env ? 0.75 : 0.7;
    if (env) s.environmentRotation.set(0, SKY_ROT, 0);
    const haze = this.haze = horizonColor(skyTex, SKY_U0, SKY_U1, 0x9a7468).multiplyScalar(0.9);
    s.background = haze.clone();
    s.fog = new THREE.FogExp2(haze.clone(), 0.00055);
    this.camera.fov = 40; this.camera.near = 0.1; this.camera.far = 7000;
    this.camera.updateProjectionMatrix();

    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._look = new THREE.Vector3(); this._camP = new THREE.Vector3();

    // the sky: the photograph itself on a dome
    if (skyTex) s.add(photoSky(skyTex, { radius: 5500, rot: SKY_MROT, fog: haze, sun: SUN_DIR, intensity: 0.95, haze: 0.035, u0: SKY_U0, u1: SKY_U1, mirror: true, blur: 2, boost: 0.9, smoothTop: 1 }));

    // the city: Queens low-rise around the building, the Manhattan towers across the river in the haze
    const city = this.city = createCity({ size: 630, block: 30, street: 9, clear: { x: 0, y: 0, r: 20 }, fogColor: haze.getHex(), fogDensity: 0.00055, maxH: 24, win: 0xffc98a, base: 0x4a3c36, sun: SUN_DIR, sunColor: 0xffa860, sunStrength: 2.2, ambient: 0.4, lit: 0.3, sky: haze.getHex() });
    city.group.position.y = -ROOF_H;
    s.add(city.group);
    const skyA = Math.atan2(VIEW.z, VIEW.x);
    const ring = farTowers({ n: low ? 350 : 700, rMin: 330, rMax: 1500, hMin: 6, hMax: 26, color: 0x4a3e3a, winK: 0.35 });
    const towers = farTowers({ n: low ? 110 : 200, rMin: 2600, rMax: 3600, hMin: 60, hMax: 380, a0: skyA - 0.5, a1: skyA + 0.45, wMin: 20, wMax: 48, color: 0x3a3440, winK: 0.25 });
    for (const m of [ring, towers]) { m.position.y = -ROOF_H; s.add(m); }
    const land = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0x1a1614, roughness: 0.95 }));
    land.rotation.x = -Math.PI / 2; land.position.y = -ROOF_H - 0.6;
    s.add(land);

    // light: the photo's low sun (warm, behind-left: it rims the suits), its sky as a soft fill
    s.add(new THREE.HemisphereLight(0xb0c0e8, 0x5a4232, env ? 0.7 : 1.2));
    const sun = this.sun = new THREE.DirectionalLight(0xffb070, 2.8);
    // (the light sits a little higher than the photo's sun, so the suits' shadows land on the roof rather than off it)
    sun.position.copy(T0).addScaledVector(this._v.copy(SUN_DIR).setY(0.22).normalize(), 60);
    sun.target.position.copy(T0);
    sun.castShadow = !low;
    const sc = sun.shadow.camera; sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 20; sc.far = 110;
    s.add(sun, sun.target);

    this._buildRoof();
    this._buildSuits();
    this._buildFx();
    this.cine = new CineCam(this.camera);
    this.orb = { yaw: YAW0, pitch: 0.1, dist: 5.8, target: T0.clone(), yawT: YAW0, pitchT: 0.1, distT: 5.8, targetT: T0.clone() };
    this._placeCamera(1);
    this._buildUI();
  }

  _buildRoof() {
    const s = this.scene, low = this.app.low;
    const g = this.world = new THREE.Group();
    s.add(g);
    const gravel = pbr('coast_sand_01', { color: 0x8a8278, roughness: 1, metalness: 0, normalScale: 1.2, fallback: 0x6a645c });
    const brick = pbr('rock_wall_08', { color: 0xb07860, roughness: 1, metalness: 0, fallback: 0x6a4034 });
    const conc = pbr('concrete_floor_worn_001', { color: 0xb8b0a4, roughness: 1, metalness: 0, fallback: 0x8a847a });
    const wood = pbr('old_planks_02', { color: 0x9a8270, roughness: 1, metalness: 0, fallback: 0x5a4636 });
    const tar = new THREE.MeshStandardMaterial({ color: 0x1e1b19, roughness: 0.75, metalness: 0 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.62, metalness: 0.65 });
    const galv = new THREE.MeshStandardMaterial({ color: 0x8a8e90, roughness: 0.6, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7, metalness: 0.3 });
    // (grime from the concrete scan on the painted metal)
    if (conc.normalMap) for (const m of [galv, steel]) { m.normalMap = conc.normalMap; m.normalScale.set(0.4, 0.4); m.roughnessMap = conc.roughnessMap; }
    const parts = new Map([[gravel, []], [brick, []], [conc, []], [wood, []], [tar, []], [steel, []], [galv, []], [dark, []]]);
    const add = (m, geo) => parts.get(m).push(geo);

    // the building and its roof
    add(brick, box(2 * RX + 0.1, ROOF_H, 2 * RZ + 0.1, 0, -ROOF_H / 2 - 0.05, 0, 2.2));
    const roof = new THREE.PlaneGeometry(2 * RX - 2 * PT, 2 * RZ - 2 * PT).rotateX(-Math.PI / 2);
    roof.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 ? (2 * RZ) / 3 : (2 * RX) / 3); });
    add(gravel, roof.translate(0, 0.01, 0));
    // tar seams and patches over the gravel
    add(tar, box(2 * RX - 1, 0.02, 0.35, 0, 0.02, -1.5, 1));
    add(tar, box(0.3, 0.02, 2 * RZ - 1, -3.5, 0.02, 0, 1));
    add(tar, box(3.2, 0.015, 2.4, 2.5, 0.018, 4.2, 1));
    // the parapet: brick, with a concrete coping that overhangs a little
    for (const [w, d, x, z] of [[2 * RX, PT, 0, -RZ + PT / 2], [2 * RX, PT, 0, RZ - PT / 2], [PT, 2 * RZ, -RX + PT / 2, 0], [PT, 2 * RZ, RX - PT / 2, 0]]) {
      add(brick, box(w, PARA, d, x, PARA / 2, z, 1.1));
      add(conc, box(w + 0.1, 0.08, d + 0.1, x, PARA + 0.04, z, 1.2));
    }
    // the stair bulkhead: a brick box with a steel door and a tarred roof
    const BH = [-6.2, 0, 3.6];
    add(brick, box(3.2, 2.9, 3.4, BH[0], 1.45, BH[2], 1.1));
    add(tar, box(3.4, 0.12, 3.6, BH[0], 2.96, BH[2], 1));
    add(steel, box(0.06, 2.1, 1.0, BH[0] + 1.62, 1.05, BH[2] - 0.4, 1));
    add(conc, box(0.9, 0.16, 1.4, BH[0] + 2.1, 0.08, BH[2] - 0.4, 1));
    // the antenna on the bulkhead, with guy wires
    const top = new THREE.Vector3(BH[0] + 0.6, 9.2, BH[2] + 0.5);
    add(steel, rod(new THREE.Vector3(top.x, 3, top.z), top, 0.035, 8));
    add(steel, rod(new THREE.Vector3(top.x - 0.5, 8.3, top.z), new THREE.Vector3(top.x + 0.5, 8.3, top.z), 0.015));
    add(steel, rod(new THREE.Vector3(top.x, 7.4, top.z - 0.4), new THREE.Vector3(top.x, 7.4, top.z + 0.4), 0.015));
    for (const [x, z] of [[BH[0] - 1.5, BH[2] - 1.6], [BH[0] + 1.5, BH[2] - 1.6], [BH[0] + 0.2, BH[2] + 1.7]]) add(dark, rod(new THREE.Vector3(top.x, 7, top.z), new THREE.Vector3(x, 3.02, z), 0.006, 4));
    this.beaconPos = top.clone().add(new THREE.Vector3(0, 0.08, 0));

    // the water tower: a timber tank on a steel stand, hooped, with a conical roof and a ladder
    const WT = this.towerPos = new THREE.Vector3(-7.3, 0, -7.1);
    const R = 2.1, B = 2.8, TH = 3.6;
    const tank = new THREE.CylinderGeometry(R, R * 1.03, TH, 48, 1, true);
    { const uv = tank.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v * TH / 2.4, u * TAU * R / 2.4); } }
    add(wood, tank.translate(WT.x, B + TH / 2, WT.z));
    add(wood, cyl(R - 0.02, R - 0.02, 0.1, WT.x, B + 0.05, WT.z, 32, 2));
    add(tar, new THREE.ConeGeometry(R + 0.18, 1.2, 40, 1, true).translate(WT.x, B + TH + 0.6, WT.z));
    add(tar, new THREE.CircleGeometry(R, 32).rotateX(Math.PI / 2).translate(WT.x, B + TH, WT.z));
    add(steel, new THREE.SphereGeometry(0.12, 10, 8).translate(WT.x, B + TH + 1.22, WT.z));
    for (let k = 0; k < 7; k++) { const y = B + 0.25 + k * (TH - 0.45) / 6; add(steel, new THREE.TorusGeometry(R + 0.03 + y * 0.0, 0.028, 5, 64).rotateX(Math.PI / 2).translate(WT.x, y, WT.z)); }
    // the stand: four legs, beams under the tank, cross bracing
    const L = 1.55;
    const legs = [[-L, -L], [L, -L], [L, L], [-L, L]];
    for (const [x, z] of legs) add(steel, box(0.22, B, 0.22, WT.x + x, B / 2, WT.z + z, 1));
    for (const x of [-L, 0, L]) add(steel, box(0.2, 0.26, 2 * L + 0.8, WT.x + x, B - 0.13, WT.z, 1));
    for (const z of [-L, L]) add(steel, box(2 * L + 0.8, 0.26, 0.2, WT.x, B - 0.13, WT.z + z, 1));
    for (let k = 0; k < 4; k++) {
      const [x1, z1] = legs[k], [x2, z2] = legs[(k + 1) % 4];
      const a = new THREE.Vector3(WT.x + x1, 0.25, WT.z + z1), b = new THREE.Vector3(WT.x + x2, B - 0.35, WT.z + z2);
      const c = new THREE.Vector3(WT.x + x2, 0.25, WT.z + z2), d = new THREE.Vector3(WT.x + x1, B - 0.35, WT.z + z1);
      add(steel, rod(a, b, 0.018)); add(steel, rod(c, d, 0.018));
      add(conc, box(0.5, 0.2, 0.5, WT.x + x1, 0.1, WT.z + z1, 1));
    }
    // the ladder up the side that faces the roof
    const la = Math.atan2(FACE.z, FACE.x) + 0.3, lr = R + 0.18;
    for (const off of [-0.22, 0.22]) {
      const px = WT.x + Math.cos(la) * lr - Math.sin(la) * off, pz = WT.z + Math.sin(la) * lr + Math.cos(la) * off;
      add(steel, rod(new THREE.Vector3(px, 0.1, pz), new THREE.Vector3(px, B + TH + 0.3, pz), 0.02));
    }
    for (let y = 0.4; y < B + TH; y += 0.32) {
      const cx = WT.x + Math.cos(la) * lr, cz = WT.z + Math.sin(la) * lr;
      add(steel, rod(new THREE.Vector3(cx + Math.sin(la) * 0.22, y, cz - Math.cos(la) * 0.22), new THREE.Vector3(cx - Math.sin(la) * 0.22, y, cz + Math.cos(la) * 0.22), 0.012, 4));
    }

    // HVAC units: galvanized boxes with a fan on top and louvres down the sides
    const hvac = (x, z, ry) => {
      const c = Math.cos(ry), sn = Math.sin(ry), P = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
      let [px, pz] = P(0, 0);
      add(galv, box(2.3, 1.25, 1.4, px, 0.72, pz, 1, ry));
      add(steel, box(2.5, 0.1, 1.6, px, 0.05, pz, 1, ry));
      for (const lx of [-0.55, 0.55]) {
        [px, pz] = P(lx, 0);
        add(dark, cyl(0.42, 0.42, 0.05, px, 1.36, pz, 24, 1));
        add(galv, new THREE.TorusGeometry(0.45, 0.03, 5, 32).rotateX(Math.PI / 2).translate(px, 1.39, pz));
      }
      for (let k = 0; k < 7; k++) { [px, pz] = P(-0.9 + k * 0.3, 0.71); add(dark, box(0.2, 0.9, 0.02, px, 0.7, pz, 1, ry)); }
      // its duct into the roof
      [px, pz] = P(0, -1.1);
      add(galv, box(0.6, 0.5, 0.8, px, 0.3, pz, 1, ry));
    };
    hvac(4.6, -7.4, 0.25);
    hvac(-2.5, 4.5, -0.1);
    // vent stacks, a conduit along the parapet, a skylight
    for (const [x, z] of [[8.8, -6.2], [-8.6, 1.5], [0.8, 6.8], [8.6, 2.5]]) {
      add(galv, cyl(0.09, 0.09, 0.9, x, 0.45, z, 12, 1));
      add(galv, cyl(0.2, 0.12, 0.14, x, 0.95, z, 12, 1));
    }
    add(galv, rod(new THREE.Vector3(-9.4, 0.25, -9.0), new THREE.Vector3(9.4, 0.25, -9.0), 0.04, 8));
    add(galv, rod(new THREE.Vector3(9.45, 0.25, -9.0), new THREE.Vector3(9.45, 0.25, 8.5), 0.04, 8));
    add(steel, box(2.0, 0.35, 1.3, -6.5, 0.18, 6.0, 1));
    const glass = new THREE.Mesh(box(1.8, 0.04, 1.1, -6.5, 0.4, 6.0, 1), new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.08, metalness: 0.2 }));
    g.add(glass);
    // cables: from the bulkhead to the water tower, and off the roof across the street
    add(dark, cable(new THREE.Vector3(BH[0] - 0.8, 2.7, BH[2] - 1.7), new THREE.Vector3(WT.x - L + 0.1, B - 0.2, WT.z + L), 0.5));
    add(dark, cable(new THREE.Vector3(BH[0] - 1.6, 2.5, BH[2] + 1.0), new THREE.Vector3(-34, -4, 16), 2.2, 0.014));
    add(dark, cable(new THREE.Vector3(RX - 0.2, 0.9, 7.5), new THREE.Vector3(30, -3, 10), 1.8, 0.012));

    for (const [m, list] of parts) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(merge(list), m);
      mesh.castShadow = !low && m !== gravel; mesh.receiveShadow = !low;
      g.add(mesh);
    }
    this.worldMeshes = g.children.slice();

    // the antenna's red light, blinking (a hot point that blooms, no light source)
    this.beacon = glowSprite(0xff2a1a, 0.5, 1);
    this.beacon.material.color.multiplyScalar(6); this.beacon.material.toneMapped = false;
    this.beacon.position.copy(this.beaconPos);
    s.add(this.beacon);
    // anchors for the web-shooter button: the tower's stand, its hoops, the antenna mast, the bulkhead
    this.anchors = [
      new THREE.Vector3(WT.x + L, 1.6, WT.z + L),
      new THREE.Vector3(WT.x + R * Math.cos(la - 0.6), B + 1.6, WT.z + R * Math.sin(la - 0.6)),
      new THREE.Vector3(top.x, 6.2, top.z),
      new THREE.Vector3(BH[0] + 1.6, 2.4, BH[2] - 1.2),
    ];
    this._anchorI = 0;
  }

  _buildSuits() {
    const s = this.scene, low = this.app.low;
    // the protégé: its own copy of the materials (its lenses are brightened when the suits link)
    const sp = this.spider = new RealSuit('spider', { castShadow: !low, uniqueMaterials: true });
    this.lensMats = [];
    sp.root.updateMatrixWorld(true); // (measured at the origin, placed afterwards)
    // the right wrist (the model's -x side; it faces +z), measured on the sculpt: the web-shooter sits under it
    this.wristLocal = new THREE.Vector3(-0.435, 1.05, 0.05);
    if (sp.ok) {
      for (const m of sp.meshes) for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
        if (/lens/i.test(mt.name || '') && !this.lensMats.includes(mt)) { mt.emissive = new THREE.Color(0xffffff); mt.emissiveIntensity = 0; this.lensMats.push(mt); }
      }
    }
    // a skeleton for the protégé (the sculpt has none): he stands relaxed, breathes, looks round and
    // raises the right hand to fire a web (the joints are found on the sculpt; see AutoRig)
    this.spRig = sp.ok ? new AutoRig(sp, { shoulder: [0.19, 1.39, 0.02], hipsY: 0.98, chestY: 1.3, neckY: 1.46, headY: 1.53 }) : null;
    this.webSide = 'r';
    this.bodyYaw = SP_YAW; this.bodyYawT = SP_YAW;
    this._webPending = null;
    sp.root.position.copy(SP);
    sp.root.rotation.y = SP_YAW;
    s.add(sp.root);
    this.spiderHit = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.72, 0.45).translate(0, 0.86, 0), new THREE.MeshBasicMaterial({ visible: false }));
    sp.root.add(this.spiderHit);

    // the mentor: its rig turns about its middle in flight
    const im = this.iron = new RealSuit(IRON, { castShadow: !low });
    this.rig = new THREE.Group();
    this.rig.rotation.order = 'YXZ';
    im.root.position.y = -COM;
    this.rig.add(im.root);
    s.add(this.rig);
    im.reactor = 1; im.eyes = 1; im.thrust = 0;
    this.ironHit = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.9, 0.55).translate(0, 0.95, 0), new THREE.MeshBasicMaterial({ visible: false }));
    im.root.add(this.ironHit);
    // a hot point at the boots, so the armor reads from far off as it comes in over the city
    this.bootGlow = glowSprite(0xffe2b0, 1, 0);
    this.bootGlow.material.color.multiplyScalar(4); this.bootGlow.material.toneMapped = false;
    this.bootGlow.position.set(0, 0.02, 0);
    im.root.add(this.bootGlow);
    // soft contact shadows under the feet (the low sun throws the real ones long and faint)
    const blob = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const shadow = (w, d) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: 0.6, color: 0x000000 }));
      m.renderOrder = 1;
      s.add(m);
      return m;
    };
    this.spShadow = shadow(0.75, 0.55); this.spShadow.position.copy(SP).setY(0.03); this.spShadow.rotation.y = SP_YAW;
    this.imShadow = shadow(0.85, 0.6); this.imShadow.position.copy(LAND).setY(0.03); this.imShadow.rotation.y = IRON_YAW;
    this._setAway();
  }

  _buildFx() {
    const s = this.scene, low = this.app.low;
    this.vapor = new ParticlePool({ count: low ? 200 : 400, blending: THREE.NormalBlending, drag: 0.6, turbulence: 0.3, softness: 2.4 });
    this.dust = new ParticlePool({ count: low ? 200 : 360, blending: THREE.NormalBlending, drag: 2.2, buoyancy: 0.25, turbulence: 0.5, softness: 2.2 });
    this.grit = new ParticlePool({ count: 160, blending: THREE.NormalBlending, gravity: -9.8, drag: 0.4, softness: 0.8 });
    s.add(this.vapor.points, this.dust.points, this.grit.points);
    this.cVapor = [new THREE.Color(0xd8c8b8), new THREE.Color(0xc8b8a8)];
    this.cDust = [new THREE.Color(0x8a7c6c), new THREE.Color(0x9a8c7a), new THREE.Color(0x6e6458)];
    this.cGrit = [new THREE.Color(0x3a342e), new THREE.Color(0x4e463e)];

    // the web line: a thin off-white strand (a tube a few millimetres across), rebuilt on the CPU each frame
    const SEG = this.webSeg = 40, RAD = this.webRad = 5;
    const geo = new THREE.BufferGeometry();
    this.webPos = new Float32Array((SEG + 1) * RAD * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.webPos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < SEG; i++) for (let j = 0; j < RAD; j++) {
      const a = i * RAD + j, b = i * RAD + (j + 1) % RAD, c = a + RAD, d = b + RAD;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    this.webGeo = geo;
    this.webMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf0e8dc, roughness: 0.85, metalness: 0, envMapIntensity: 0.5, transparent: true, opacity: 0.92 }));
    this.webMesh.frustumCulled = false;
    this.webMesh.visible = false;
    s.add(this.webMesh);
    // where it sticks: a small splat of strands
    const sg = new THREE.BufferGeometry();
    this.splatPos = new Float32Array(10 * 2 * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.splatPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.splat = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xe9e6de, transparent: true, opacity: 0.85 }));
    this.splat.frustumCulled = false; this.splat.visible = false;
    s.add(this.splat);
    this.web = { on: false, t: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), free: new THREE.Vector3(), fv: new THREE.Vector3(), len: 1, released: false };

    // the suit link: a faint scan ring passing down the protégé suit
    this.scanRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.004, 4, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfeeff).multiplyScalar(2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.scanRing.rotation.x = Math.PI / 2;
    this.scanRing.visible = false;
    s.add(this.scanRing);
    this.link = { on: false, t: 0, lens: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */

  _buildUI() {
    this.intro({
      kicker: 'Chapter 11 · The protégé',
      title: 'Mentor &amp; <em>Protégé</em>',
      jp: 'QUEENS',
      desc: 'Golden hour over Queens. A kid in a Stark-built suit waits on a rooftop by the old water tower, and the man who made that suit is on his way. Call him in, study both suits up close, and see how a mentor\'s armor and a protégé\'s suit solve the same problems in very different ways.',
      extra: [this.gestures([['hold', '<b>Hold</b> to call Iron Man'], ['tap', '<b>Tap</b> a suit to inspect it'], ['tap', '<b>Tap</b> the roof or city: web line'], ['drag', '<b>Drag</b> to look around']])],
    });
    this.cardJp = h('span.card-jp');
    this.cardH = h('h3');
    this.cardP = h('p');
    this.cardBody = h('div');
    this.card = h('div.card.pg-card.hidden', { 'aria-live': 'polite' },
      h('button.close', { type: 'button', 'aria-label': 'Close', text: '×', onclick: (e) => { e.stopPropagation(); this._closeCard(); } }),
      this.cardJp, this.cardH, this.cardP, this.cardBody);
    this.ui.append(this.card);

    this.btnCall = this.button('Call Iron Man', () => (this.state === 'landed' ? this._leave() : this._arrive()), 'btn-primary');
    this.btnWeb = this.button('Web shot', () => this._webButton());
    this.btnTech = this.button('Suit tech', () => (this.cardMode === 'tech' ? this._closeCard() : this._showCard('tech')));
    this.btnLink = this.button('Suit link', () => this._suitLink());
    this.btnTech.setAttribute('aria-pressed', 'false');
    this.ui.append(h('div.controls', {}, this.btnCall, h('div.group', {}, this.btnWeb, this.btnTech, this.btnLink)));
    this.banner = h('div.big-title', {}, h('b', { text: 'Mentor & Protégé' }), h('span', { text: 'Queens · golden hour' }));
    this.ui.append(this.banner);
  }

  _showCard(mode) {
    this.cardMode = mode;
    this.banner.classList.remove('on'); // (the title card never sits under a panel)
    this.card.classList.remove('hidden', 'min');
    this.btnTech.setAttribute('aria-pressed', String(mode === 'tech'));
    this.cardBody.innerHTML = '';
    if (mode === 'tech') {
      this.cardJp.textContent = 'Side by side';
      this.cardH.textContent = 'Suit tech';
      this.cardP.textContent = 'One engineer designed both. The armor carries its pilot; the suit trusts its wearer.';
      const cells = [h('span'), h('span.hd', { text: 'Iron Man' }), h('span.hd.sp', { text: 'Protégé suit' })];
      for (const [k, a, b] of TECH) cells.push(h('dt', { text: k }), h('dd', { text: a }), h('dd', { text: b }));
      this.cardBody.append(h('dl.pg-tech', {}, cells));
      this._focus('both');
    } else {
      const c = CARDS[mode];
      this.cardJp.textContent = c.jp;
      this.cardH.textContent = c.name;
      this.cardP.textContent = c.text;
      this.cardBody.append(h('dl.spec', {}, c.spec.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
    }
    this.app.sfx.hologram();
  }

  _closeCard() {
    if (!this.cardMode) return;
    this.cardMode = null;
    this.card.classList.add('hidden');
    this.btnTech.setAttribute('aria-pressed', 'false');
    this._focus(null);
  }

  /** Frames one suit up close (or, with null, the two of them). */
  _focus(who) {
    const o = this.orb;
    this.focus = who;
    if (who === 'spider') { o.targetT.copy(SP).setY(0.95); o.distT = this.portrait ? 4.4 : 3.3; o.yawT = SP_YAW - 0.15; o.pitchT = 0.06; }
    else if (who === 'iron') { o.targetT.copy(LAND).setY(1.05); o.distT = this.portrait ? 4.8 : 3.6; o.yawT = IRON_YAW + 0.15; o.pitchT = 0.06; }
    else { o.targetT.copy(T0); o.distT = this.portrait ? 8.2 : who === 'both' ? 7.2 : 5.8; o.yawT = YAW0; o.pitchT = 0.1; }
    o.yawT = o.yaw + wrapA(o.yawT - o.yaw); // (the short way round)
    // (on a wide screen the card sits on the right: aim past the suit so it stands in the clear middle)
    if (who && !this.portrait) o.targetT.addScaledVector(this._v.set(Math.cos(o.yawT), 0, -Math.sin(o.yawT)), o.distT * (who === 'both' ? 0.23 : 0.17));
    // (on a phone the card sits at the bottom: the suit rises into the clear top half)
    else if (who && this.portrait) o.targetT.y -= o.distT * 0.22;
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  onEnter() { this._hint(); }

  enter() {
    if (!this.seen) { this.seen = true; setTimeout(() => this._hint(), 900); }
  }

  _hint() {
    if (!this.active || this._hinted) return;
    this._hinted = true;
    this.app.toast('<b>Hold</b> anywhere to call Iron Man — or press <b>Call Iron Man</b>.', 4200);
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    if (this.state === 'arriving') { this.cine.stop(); this._touchdown(true); }
    if (this.state === 'leaving') this._setAway();
    this.app.cinema(false);
  }

  resize(w, hgt) {
    this.portrait = w / hgt < 0.85;
    if (!this.cine?.active) { this.camera.fov = this.portrait ? 58 : 40; if (this.cine) this.cine.baseFov = this.camera.fov; }
    if (this.orb) this._focus(this.focus || null);
    super.resize(w, hgt);
  }

  /* ------------------------------------------------------------------ */
  /* the arrival                                                         */
  /* ------------------------------------------------------------------ */

  _setAway() {
    this.state = 'away';
    this.rig.visible = false;
    this.iron.thrust = 0;
    this.rig.position.copy(LAND).add(this._v.set(0, COM, 0)).addScaledVector(VIEW, 600).setY(150);
    if (this.btnCall) { this.btnCall.innerHTML = 'Call Iron Man'; this.btnCall.disabled = false; }
    if (this.cardMode === 'iron') this._closeCard();
    if (this.link) this.link.lens = 0;
  }

  _arrive() {
    if (this.state !== 'away') return;
    this.state = 'arriving';
    this.flyT = 0;
    this.rig.visible = true;
    this.iron.thrust = 1;
    this.tilt = 1.3;
    const up = (y) => new THREE.Vector3(0, y, 0);
    const L0 = LAND.clone().add(up(COM));
    this.path = [
      L0.clone().addScaledVector(VIEW, 560).addScaledVector(RIGHT, -140).add(up(120)),
      L0.clone().addScaledVector(VIEW, 190).addScaledVector(RIGHT, -70).add(up(45)),
      L0.clone().addScaledVector(VIEW, 26).addScaledVector(RIGHT, 6).add(up(10)),
      L0.clone().add(up(HOVER)),
    ];
    bez(...this.path, 0, this.rig.position);
    this.btnCall.disabled = true;
    this._closeCard();
    this.app.sfx.whoosh();
    this.app.cinema(true);
    // the shots: the protégé in the foreground as a glint crosses the skyline; low on the roof as the armor
    // comes over; the touchdown; then the two of them
    const ip = () => this.rig.position;
    const spHead = SP.clone().add(up(1.55));
    const A0 = SP.clone().addScaledVector(FACE.clone().applyAxisAngle(up(1).normalize(), 0.35), 2.7).add(up(1.2));
    const A1 = A0.clone().addScaledVector(RIGHT, 0.35).add(up(0.05));
    const lookA = () => this._look.copy(ip()).sub(this.camera.position).normalize().multiplyScalar(0.7)
      .add(this._v3.copy(spHead).sub(this.camera.position).normalize().multiplyScalar(0.3)).normalize().multiplyScalar(20).add(this.camera.position);
    const B0 = LAND.clone().addScaledVector(RIGHT, 2.6).addScaledVector(FACE, 2.4).add(up(0.35));
    const B1 = B0.clone().addScaledVector(RIGHT, -0.5).add(up(0.1));
    const C0 = LAND.clone().addScaledVector(RIGHT, 2.1).addScaledVector(FACE, 3.4).add(up(0.7));
    const C1 = C0.clone().addScaledVector(FACE, -0.7).addScaledVector(RIGHT, -0.3);
    const lookC = () => this._look.set(LAND.x, Math.max(1.0, this.rig.position.y - 0.1), LAND.z);
    this.cine.baseFov = this.camera.fov;
    const f = this.portrait ? 1.35 : 1;
    this.cine.play([
      { t: 0.9, pos: A0, look: lookA, fov: 30 * f },
      { t: 3.5, pos: A1, look: lookA, fov: 28 * f, linear: true },
      { t: 3.6, pos: B0, look: ip, fov: 44 * f, cut: true },
      { t: 5.3, pos: B1, look: ip, fov: 40 * f, linear: true },
      { t: 5.4, pos: C0, look: lookC, fov: 36 * f, cut: true },
      { t: 7.6, pos: C1, look: lookC, fov: 36 * f, linear: true },
      { t: 9.6, pos: () => this._orbitPos(this._camP), look: T0.clone(), fov: this.camera.fov },
    ], { onEnd: () => { this.app.cinema(false); this._syncOrbitFromCamera(); } });
  }

  _touchdown(silent = false) {
    this.state = 'landed';
    this.rig.position.copy(LAND).setY(COM);
    this.rig.rotation.set(0, IRON_YAW, 0);
    this.iron.thrust = 0;
    this.btnCall.innerHTML = 'Send him off';
    this.btnCall.disabled = false;
    if (silent) return;
    // the landing: a ring of dust and grit blown out across the gravel
    const p = this._v.copy(LAND).setY(0.05);
    for (let k = 0; k < 70; k++) {
      const a = rand(0, TAU), sp = rand(2, 6);
      this.dust.emit({ x: p.x + Math.cos(a) * 0.3, y: rand(0.05, 0.25), z: p.z + Math.sin(a) * 0.3, vx: Math.cos(a) * sp, vy: rand(0.1, 0.8), vz: Math.sin(a) * sp, life: rand(1.2, 2.6), size: rand(0.25, 0.55), grow: 2.2, alpha: 0.4, color: this.cDust[k % 3] });
    }
    this.grit.burst(p, 40, { speed: 3.5, up: 2.2, life: [0.4, 0.9], size: [0.015, 0.035], colors: this.cGrit });
    this.cine.shake = 0.05;
    this.app.sfx.thud();
    this.app.sfx.clank();
    this.app.flash(0.08, 0xffd0a0);
    setTimeout(() => { if (this.active) { this.banner.classList.remove('on'); void this.banner.offsetWidth; this.banner.classList.add('on'); } }, 900);
  }

  _leave() {
    if (this.state !== 'landed') return;
    this.state = 'leaving';
    this.flyT = 0;
    this.iron.thrust = 1;
    this.btnCall.disabled = true;
    if (this.cardMode === 'iron') this._closeCard();
    const up = (y) => new THREE.Vector3(0, y, 0);
    const L0 = LAND.clone().add(up(COM));
    this.path = [L0.clone(), L0.clone().add(up(18)), L0.clone().addScaledVector(VIEW, 160).addScaledVector(RIGHT, 90).add(up(70)), L0.clone().addScaledVector(VIEW, 700).addScaledVector(RIGHT, 260).add(up(170))];
    this.dust.burst(this._v.copy(LAND).setY(0.1), 30, { speed: 3, up: 0.3, life: [1, 2], size: [0.2, 0.45], colors: this.cDust, grow: 2, alpha: 0.35 });
    this.app.sfx.whoosh();
  }

  _updateIron(dt) {
    const rig = this.rig, im = this.iron;
    if (this.state === 'arriving') {
      this.flyT += dt;
      const prev = this._v2.copy(rig.position);
      if (this.flyT < FLY) {
        const u = this.flyT / FLY;
        const sArc = 1 - Math.pow(1 - u, 1.8);
        bez(...this.path, sArc, rig.position);
        const vel = this._v3.subVectors(rig.position, prev).divideScalar(Math.max(dt, 1e-4));
        const speed = vel.length();
        const velYaw = speed > 0.5 ? Math.atan2(vel.x, vel.z) : rig.rotation.y;
        const k = smooth(0.72, 1, u);
        rig.rotation.y = velYaw + wrapA(IRON_YAW - velYaw) * k;
        // nose-down at speed, a flare (leaning back to brake) as it comes over the roof, upright to hover
        const tiltT = 1.35 * smooth(6, 40, speed) - 0.35 * Math.sin(Math.PI * smooth(0.8, 1, u)) * (1 - k * 0.3);
        this.tilt = damp(this.tilt, tiltT, 5, dt);
        rig.rotation.x = this.tilt;
        im.thrust = 1;
      } else {
        const k = clamp((this.flyT - FLY) / DESC, 0, 1);
        rig.position.copy(LAND).setY(COM + HOVER * (1 - k) * (1 - k) + Math.sin(this.flyT * 5) * 0.03 * (1 - k));
        this.tilt = damp(this.tilt, 0, 4, dt);
        rig.rotation.x = this.tilt;
        rig.rotation.y = IRON_YAW;
        im.thrust = 1 - k * 0.45;
        // the jets kick up the gravel as it comes down
        if (Math.random() < dt * 40 * k) {
          const a = rand(0, TAU), sp = rand(1.5, 3.5);
          this.dust.emit({ x: LAND.x, y: 0.1, z: LAND.z, vx: Math.cos(a) * sp, vy: rand(0.1, 0.5), vz: Math.sin(a) * sp, life: rand(0.8, 1.6), size: rand(0.18, 0.4), grow: 2, alpha: 0.3, color: this.cDust[0] });
        }
        if (k >= 1) this._touchdown();
      }
    } else if (this.state === 'leaving') {
      this.flyT += dt;
      const prev = this._v2.copy(rig.position);
      const u = clamp(this.flyT / LEAVE, 0, 1);
      bez(...this.path, Math.pow(u, 1.7), rig.position);
      const vel = this._v3.subVectors(rig.position, prev).divideScalar(Math.max(dt, 1e-4));
      const speed = vel.length();
      if (speed > 3) {
        const vy = Math.atan2(vel.x, vel.z);
        rig.rotation.y += wrapA(vy - rig.rotation.y) * (1 - Math.exp(-3 * dt)) * smooth(0.15, 0.4, u);
      }
      rig.rotation.x = damp(rig.rotation.x, 1.3 * smooth(10, 40, speed), 3, dt);
      if (u >= 1) this._setAway();
    }
    // its contact shadow grows as it comes down
    const hgt = Math.max(0, rig.position.y - COM);
    this.imShadow.visible = rig.visible && hgt < 6 && rig.position.distanceTo(this._v.copy(LAND).setY(COM)) < 7;
    this.imShadow.material.opacity = 0.6 * Math.exp(-hgt * 0.7);
    this.imShadow.scale.setScalar(1 + hgt * 0.35);
    // the far glint of the boots, and a thin vapour trail
    const dist = this.camera.position.distanceTo(rig.position);
    const flying = this.state === 'arriving' || this.state === 'leaving';
    const glowK = flying ? smooth(8, 30, dist) : 0;
    this.bootGlow.material.opacity = glowK * 0.9;
    this.bootGlow.scale.setScalar(0.4 + dist * 0.012);
    if (flying && dist > 10 && Math.random() < dt * 45) {
      const p = im.root.getWorldPosition(this._v);
      this.vapor.emit({ x: p.x, y: p.y, z: p.z, vx: rand(-0.3, 0.3), vy: rand(-0.2, 0.3), vz: rand(-0.3, 0.3), life: rand(1.2, 2.2), size: rand(0.5, 0.9) * (1 + dist * 0.01), grow: 3, alpha: 0.18, color: this.cVapor[0] });
    }
    im.update(dt);
    this.app.sfx.thrust(this.active ? im._shown.thrust * clamp(18 / Math.max(dist, 1), 0.08, 0.8) : 0);
  }

  /* ------------------------------------------------------------------ */
  /* web-shooter and suit link                                           */
  /* ------------------------------------------------------------------ */

  _wrist(out) {
    if (this.spRig) return this.spRig.wristWorld(this.webSide, out);
    return out.copy(this.wristLocal).applyMatrix4(this.spider.root.matrixWorld);
  }

  _webButton() {
    const a = this.anchors[this._anchorI++ % this.anchors.length];
    this._shootWeb(a, null);
  }

  /** Turn toward the point, raise the hand on that side (wrist cocked back), then fire when the arm is up. */
  _shootWeb(point, normal) {
    if (!this.spRig) { this._fireWeb(point, normal); return; }
    const root = this.spider.root;
    // his body turns part of the way when the point is well off to a side or behind him
    const toP = this._v.subVectors(point, root.position);
    const want = Math.atan2(toP.x, toP.z);
    let off = Math.atan2(Math.sin(want - SP_YAW), Math.cos(want - SP_YAW));
    this.bodyYawT = SP_YAW + clamp(off * 0.6, -0.9, 0.9);
    // the hand on the side of the point, aimed from its shoulder
    root.updateMatrixWorld(true);
    const local = root.worldToLocal(point.clone());
    this.webSide = local.x >= 0 ? 'l' : 'r';
    const other = this.webSide === 'l' ? 'r' : 'l';
    this.spRig.relax(other);
    const sh = this.spRig.arms[this.webSide].sh;
    // aim in the body's turned frame: the direction as it will be once he has turned
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.bodyYawT - root.rotation.y);
    const dir = local.clone().sub(sh).applyQuaternion(turn.invert());
    this.spRig.aim(this.webSide, dir, { wrist: 0.95 });
    this.spRig.lookAt(point);
    this._lookDefault = false;
    this._webPending = { point: point.clone(), normal: normal ? normal.clone() : null, t: 0.32 };
  }

  _fireWeb(point, normal) {
    const w = this.web;
    this.spider.root.updateMatrixWorld(true);
    this._wrist(w.a);
    w.b.copy(point);
    w.len = w.a.distanceTo(w.b);
    w.t = 0; w.on = true; w.released = false;
    w.normal = (normal || this._v.subVectors(w.a, w.b)).clone().normalize();
    this.webMesh.visible = true;
    this.webMesh.material.opacity = 0.92;
    this.splat.visible = false;
    this.app.sfx.tone?.({ freq: 2400, to: 900, type: 'triangle', dur: 0.09, vol: 0.05, reverb: 0.05 });
    this.app.sfx.noise?.({ dur: 0.18, vol: 0.1, type: 'bandpass', freq: 4200, to: 1800, q: 1.4 });
  }

  _updateWeb(dt) {
    const w = this.web;
    if (!w.on) return;
    w.t += dt;
    const SHOOT = Math.min(0.28, 0.05 + w.len * 0.006), HOLD = 3.2, FALL = 1.4;
    let tip = this._v.copy(w.b), start = this._v2.copy(w.a), sag = 0;
    if (w.t < SHOOT) {
      if (this.spRig) this._wrist(w.a);
      tip.lerpVectors(w.a, w.b, w.t / SHOOT);
    } else if (w.t < SHOOT + HOLD) {
      if (!this.splat.visible) this._placeSplat(w.b, w.normal);
      if (this.spRig) this._wrist(w.a);
      // it strikes taut, then settles into a slight sag with a small twang
      const k = w.t - SHOOT;
      sag = w.len * 0.012 * (1 - Math.exp(-k * 3)) + Math.sin(k * 22) * Math.exp(-k * 5) * 0.03 * Math.min(1, w.len / 6);
    } else {
      // let go at the wrist: the free end drops and swings from the anchor
      if (!w.released) {
        w.released = true; w.free.copy(w.a); w.fv.set(0, 0, 0);
        if (this.spRig) { this.spRig.relax(this.webSide); this.bodyYawT = SP_YAW; this._lookDefault = true; }
      }
      w.fv.y -= 9.8 * dt;
      w.free.addScaledVector(w.fv, dt);
      const d = this._v3.subVectors(w.free, w.b);
      if (d.length() > w.len * 0.98) { d.setLength(w.len * 0.98); w.free.copy(w.b).add(d); w.fv.multiplyScalar(0.9); }
      start.copy(w.free);
      sag = w.len * 0.06;
      const f = (w.t - SHOOT - HOLD) / FALL;
      this.webMesh.material.opacity = 0.92 * (1 - f);
      this.splat.material.opacity = 0.85 * (1 - f);
      if (f >= 1) { w.on = false; this.webMesh.visible = false; this.splat.visible = false; this.splat.material.opacity = 0.85; return; }
    }
    // the strand: start → tip with a parabolic sag, as a thin tube
    const SEG = this.webSeg, RAD = this.webRad, P = this.webPos;
    const T = this._look.subVectors(tip, start).normalize();
    const N = this._camP.crossVectors(T, Math.abs(T.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const Bn = new THREE.Vector3().crossVectors(N, T);
    const r = 0.0055;
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG;
      const cx = start.x + (tip.x - start.x) * s, cy = start.y + (tip.y - start.y) * s - sag * 4 * s * (1 - s), cz = start.z + (tip.z - start.z) * s;
      for (let j = 0; j < RAD; j++) {
        const a = (j / RAD) * TAU, c = Math.cos(a) * r, sn = Math.sin(a) * r, o = (i * RAD + j) * 3;
        P[o] = cx + N.x * c + Bn.x * sn; P[o + 1] = cy + N.y * c + Bn.y * sn; P[o + 2] = cz + N.z * c + Bn.z * sn;
      }
    }
    this.webGeo.attributes.position.needsUpdate = true;
    this.webGeo.computeVertexNormals();
  }

  _placeSplat(p, n) {
    const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1);
    const S = this.splatPos;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + rand(-0.2, 0.2), L = rand(0.07, 0.16);
      const q = p.clone().addScaledVector(n, 0.01);
      const e = q.clone().addScaledVector(t1, Math.cos(a) * L).addScaledVector(t2, Math.sin(a) * L);
      S.set([q.x, q.y, q.z, e.x, e.y, e.z], k * 6);
    }
    this.splat.geometry.attributes.position.needsUpdate = true;
    this.splat.visible = true;
  }

  _suitLink() {
    if (this.state !== 'landed') {
      if (this.state === 'away') this.app.toast('Call <b>Iron Man</b> first — the link runs through his armor.', 3000);
      return;
    }
    if (this.link.on) return;
    this.link.on = true; this.link.t = 0;
    this.iron.reactor = 1.9;
    this.app.sfx.scan();
    this.app.sfx.hologram();
    setTimeout(() => { if (this.active) this.app.toast('Suit link established — the protégé suit\'s full feature set is unlocked.', 3400); }, 1400);
  }

  _updateLink(dt) {
    const L = this.link;
    if (L.on) {
      L.t += dt;
      const k = clamp(L.t / 1.6, 0, 1);
      this.scanRing.visible = k < 1;
      this.scanRing.position.copy(SP).setY(1.78 - k * 1.75);
      this.scanRing.scale.setScalar(0.75 + Math.sin(k * Math.PI) * 0.3);
      this.scanRing.material.opacity = Math.sin(k * Math.PI) * 0.35;
      if (L.t > 1.1) L.lens = 1;
      if (L.t > 2.2) this.iron.reactor = 1;
      if (L.t > 2.4) L.on = false;
    }
    this._lensShown = damp(this._lensShown || 0, L.lens, 2.5, dt);
    for (const m of this.lensMats) m.emissiveIntensity = this._lensShown * 0.55;
  }

  /* ------------------------------------------------------------------ */
  /* input                                                               */
  /* ------------------------------------------------------------------ */

  pointerMove(p) {
    if (this.cine.active) return;
    if (p.down && p.moved > 6) {
      const o = this.orb;
      o.yawT -= p.dx * 0.0055;
      o.pitchT = clamp(o.pitchT + p.dy * 0.004, -0.04, 0.75);
      this._dragged = true;
      return;
    }
    if (p.type === 'mouse') {
      const hit = this.app.raycast([this.spiderHit, this.ironHit], false)[0];
      this.app.setHover(!!hit && (hit.object !== this.ironHit || this.rig.visible));
    }
  }

  click(p) {
    if (this.cine.active) return;
    const hits = this.app.raycast([this.spiderHit, ...(this.rig.visible ? [this.ironHit] : [])], false);
    if (hits.length) {
      const who = hits[0].object === this.spiderHit ? 'spider' : 'iron';
      if (this.cardMode === who) { this._closeCard(); return; }
      this._showCard(who);
      this._focus(who);
      return;
    }
    // anywhere else: a web line to it (from the protégé's wrist), when in reach
    const world = this.app.raycast([...this.worldMeshes, this.city.mesh], false)[0];
    if (world) {
      const wr = this._wrist(this._v);
      const d = world.point.distanceTo(wr);
      if (d > 1.2 && d < 70) {
        const n = world.face ? world.face.normal.clone().transformDirection(world.object.matrixWorld) : null;
        this._shootWeb(world.point, n);
        return;
      }
      if (d >= 70) { this.app.toast('Out of reach — a web line holds to about seventy metres here.', 2400); return; }
    }
    if (this.cardMode) this._closeCard();
  }

  key(e) {
    const k = e.key.toLowerCase();
    if (k === 'w') { this._webButton(); return true; }
    if (k === 'c') { this.state === 'landed' ? this._leave() : this._arrive(); return true; }
    if (k === 't') { this.cardMode === 'tech' ? this._closeCard() : this._showCard('tech'); return true; }
    if (k === 'l') { this._suitLink(); return true; }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* camera                                                              */
  /* ------------------------------------------------------------------ */

  _orbitPos(out, o = this.orb, useTarget = false) {
    const yaw = useTarget ? o.yawT : o.yaw, pitch = useTarget ? o.pitchT : o.pitch, dist = useTarget ? o.distT : o.dist;
    const tg = useTarget ? o.targetT : o.target;
    return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(tg);
  }

  _syncOrbitFromCamera() {
    const o = this.orb;
    this._focus(this.focus);
    o.target.copy(o.targetT);
    const d = this._v.subVectors(this.camera.position, o.target);
    o.dist = d.length();
    o.yaw = Math.atan2(d.x, d.z);
    o.pitch = Math.asin(clamp(d.y / o.dist, -1, 1));
  }

  _placeCamera(snap = 0, dt = 0, t = 0) {
    const o = this.orb;
    if (snap) { o.yaw = o.yawT; o.pitch = o.pitchT; o.dist = o.distT; o.target.copy(o.targetT); }
    else {
      o.yaw = damp(o.yaw, o.yawT, 4, dt);
      o.pitch = damp(o.pitch, o.pitchT, 4, dt);
      o.dist = damp(o.dist, o.distT, 2.5, dt);
      o.target.lerp(o.targetT, 1 - Math.exp(-2.5 * dt));
    }
    const cam = this.camera;
    this._orbitPos(cam.position);
    // a camera operator's breathing, barely there
    cam.position.x += Math.sin(t * 0.7) * 0.012; cam.position.y += Math.sin(t * 0.53 + 1) * 0.01;
    cam.position.y = Math.max(0.25, cam.position.y);
    cam.lookAt(o.target);
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                               */
  /* ------------------------------------------------------------------ */

  update(dt, t) {
    const hold = this.trackHold(1.1, this.state === 'away' && !this.cine.active);
    if (hold.fired) this._arrive();

    this._updateIron(dt);
    if (this.spRig) {
      const root = this.spider.root;
      this.bodyYaw = damp(this.bodyYaw, this.bodyYawT, 3.5, dt);
      root.rotation.y = this.bodyYaw;
      if (this._webPending && (this._webPending.t -= dt) <= 0) {
        const pnd = this._webPending; this._webPending = null;
        root.updateMatrixWorld(true);
        this._fireWeb(pnd.point, pnd.normal);
      }
      // he watches his mentor once he is here, otherwise looks out over the city now and then
      if (this._lookDefault !== false) {
        if (this.state !== 'away' && this.rig.visible) this.spRig.lookAt(this.rig.getWorldPosition(this._v3).setY(this.rig.position.y + 0.7));
        else this.spRig.lookAt(this._v3.copy(root.position).add(this._v2.set(Math.sin(SP_YAW + Math.sin(t * 0.13) * 0.7) * 10, 1.4 + Math.sin(t * 0.21) * 0.4, Math.cos(SP_YAW + Math.sin(t * 0.13) * 0.7) * 10)));
      }
      this.spRig.update(dt, t);
    }
    this.spider.update(dt);
    this._updateWeb(dt);
    this._updateLink(dt);
    this.vapor.update(dt, t); this.dust.update(dt, t); this.grit.update(dt, t);
    // the antenna light: a short red blink every two seconds
    const ph = (t * 0.5) % 1;
    this.beacon.material.opacity = ph < 0.12 ? 1 : ph < 0.2 ? 1 - (ph - 0.12) / 0.08 : 0;

    if (!this.cine.update(dt)) this._placeCamera(0, dt, t);
    else if (this.cine.shake > 0.001) this.cine.shake *= 0.92;
  }
}
