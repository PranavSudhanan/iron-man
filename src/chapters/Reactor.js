import './Reactor.css';
import * as THREE from 'three';
import { Chapter } from '../core/Chapter.js';
import { mergeStatic } from '../core/mergeStatic.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { suitEnvironment } from '../objects/Suit.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { Beams, Shockwaves, glowSprite, plasmaMaterial } from '../objects/FX.js';
import { glossyFloor } from '../objects/GlossyFloor.js';
import { loadEnv, envMap, loadTextures, pbr, HDRIS } from '../core/Env.js';
import { rand, damp, clamp, lerp, TAU, h, shared, drawTexture, glowTexture, easeInOut, easeOutCubic } from '../core/utils.js';

/*
 * New Element: the palladium core is poisoning him, and the fix is hidden in an old expo model of his
 * father's. A three-stage puzzle in a basement lab ringed by a home-made particle accelerator:
 * map the lattice (drag / tap), align the prisms (tap to turn), fire the ring (hold) — and a glowing
 * triangular core is born and seated in the heart of the old reactor (the detailed arc reactor model), which
 * turns from a sickly, failing glow to a clean white-blue.
 */

const RING_R = 5, BEAM_Y = 1.1;
const EMIT = new THREE.Vector2(-4.55, -1.2);
const PRISMS = [ // position on the floor plane (x, z) and the mirror angle that sends the beam on
  { x: -1.6, z: -1.2, solve: 45 },
  { x: -1.6, z: 1.0, solve: 45 },
  { x: 1.6, z: 1.0, solve: 135 },
];
const TARGET = new THREE.Vector2(1.6, -2.2);
const HOUSING = new THREE.Vector3(-1.35, 1.16, -3.38);
const LATTICE = new THREE.Vector3(-0.2, 2.05, -3.5);

const SHOTS = [
  [[-0.2, 2.2, -1.25], [-0.2, 2.0, -3.5]],
  [[0.2, 4.6, 4.7], [0, 0.7, -0.5]],
  [[3.5, 2.4, 3.1], [0.1, 1.1, -1.1]],
  [[-0.75, 1.62, -2.0], [-1.35, 1.16, -3.4]],
];

const CARDS = [
  { jp: 'Stage 01 · Structure', title: 'Map the lattice', text: 'The palladium reactor on the bench (the one that keeps him alive) is failing, and it is slowly poisoning him. The cure was hidden in plain sight: the layout of an old expo model his father left behind encodes the structure of an element nobody had made yet. Drag to turn the hologram; tap the six pulsing gaps to complete it.' },
  { jp: 'Stage 02 · Optics', title: 'Align the prisms', text: 'A particle accelerator does not fit in a basement, so he builds one around the room anyway. Tap a prism to turn it 45°. Guide the beam from the ring\'s port, off all three prisms, onto the target plate.' },
  { jp: 'Stage 03 · Synthesis', title: 'Fire the accelerator', text: 'Hold to spin up the ring. Let go early and the charge bleeds away. At full power the beam strikes the target, and the new element is forged in the flash.' },
];

/**
 * An instanced hologram that reads as projected light rather than glass: each node is a soft dot, hottest
 * in the middle and falling off to nothing at its edge; bonds are fine soft lines. Faint interference lines,
 * an unsteady projector flicker. Takes a colour per instance.
 */
function instancedHolo(opacity = 1, gain = 1.6, core = 1.6) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uOpacity: { value: opacity }, uGain: { value: gain }, uCore: { value: core } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vC;
      void main(){
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #else
          vC = vec3(1.0);
        #endif
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uOpacity; uniform float uGain; uniform float uCore;
      varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vC;
      void main(){
        float ndv = abs(dot(normalize(vN), vV));
        float body = pow(ndv, uCore);                                   // soft falloff to the silhouette
        float lines = 0.86 + 0.14 * sin(vW.y * 260.0 - uTime * 1.5);    // fine interference lines
        float flick = 0.93 + 0.07 * sin(uTime * 41.0) * sin(uTime * 7.3 + vW.x * 2.0);
        gl_FragColor = vec4(vC * body * lines * flick * uGain * uOpacity, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** A faint cone of light in haze: brightest where you look through most of it, fading along its length. */
function shaftMaterial(color, alpha, { fadeTop = true } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
    vertexShader: /* glsl */ `
      varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vY = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uAlpha; varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.5);
        float len = ${fadeTop ? 'pow(1.0 - vY, 1.6) * smoothstep(0.0, 0.06, vY)' : 'smoothstep(0.0, 0.6, vY) * (0.4 + 0.6 * vY)'};
        float drift = 0.8 + 0.2 * sin(vW.y * 9.0 + uTime * 0.7 + sin(vW.x * 5.0 + uTime * 0.4) * 2.0);
        gl_FragColor = vec4(uColor * uAlpha * f * len * drift, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

/** A soft round shadow texture (contact shadows under things that stand on the floor). */
let _blob;
function blobTexture() {
  return _blob ||= drawTexture(128, 128, (x) => {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  });
}

/** Oiled butcher-block wood for the bench top: long strips, grain, a few knots and stains. */
function woodTexture() {
  return drawTexture(1024, 256, (x, w, hh) => {
    x.fillStyle = '#5a3d27'; x.fillRect(0, 0, w, hh);
    const strips = 9;
    for (let s = 0; s < strips; s++) {
      const y0 = (s / strips) * hh, sh = hh / strips;
      const base = 70 + Math.random() * 30;
      x.fillStyle = `rgb(${base + 8 | 0},${base * 0.74 | 0},${base * 0.54 | 0})`; x.fillRect(0, y0, w, sh);
      for (let k = 0; k < 40; k++) {
        const y = y0 + Math.random() * sh, a = 0.05 + Math.random() * 0.12;
        x.strokeStyle = `rgba(${Math.random() < 0.5 ? '30,16,8' : '150,105,70'},${a})`; x.lineWidth = 0.6 + Math.random() * 1.6;
        x.beginPath(); x.moveTo(0, y);
        for (let px = 0; px <= w; px += 32) x.lineTo(px, y + Math.sin(px * 0.01 + k) * 1.5);
        x.stroke();
      }
      x.fillStyle = 'rgba(20,10,5,0.5)'; x.fillRect(0, y0, w, 1.2);
    }
    for (let k = 0; k < 14; k++) { // burns, stains and oil rings from years of work
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(15,8,4,0.35)'); g.addColorStop(1, 'rgba(15,8,4,0)');
      x.save(); x.translate(Math.random() * w, Math.random() * hh); x.scale(10 + Math.random() * 40, 6 + Math.random() * 18);
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, 1, 0, TAU); x.fill(); x.restore();
    }
  });
}

/** The accelerator's light strip: packets of light running round the ring, faster and brighter with charge. */
function runnerMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uCharge: { value: 0 }, uPhase: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `varying float vA; void main(){ vA = atan(position.y, position.x); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uCharge; uniform float uPhase; uniform vec3 uColor; varying float vA;
      void main(){
        float a = vA / 6.2831853 + 0.5;
        float packets = 3.0 + floor(uCharge * 5.0);
        float run = pow(fract(a * packets - uPhase), mix(14.0, 3.0, uCharge));
        // idle it is a dim indicator line; spun up, the packets run hot enough to light the room
        float v = 0.012 + uCharge * uCharge * 0.9 + run * (0.05 + uCharge * 3.4);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), run * uCharge * 0.6) * v * 2.4, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export class Reactor extends Chapter {
  constructor(app) {
    super(app, { id: 'reactor', title: 'New Element', jp: 'ELEMENT' });
    // a high threshold, as in a studio viewer: the models' metal stays crisp, only HDR light sources bloom
    this.bloom = { strength: 0.8, radius: 0.5, threshold: 2.8 };
    this.grade = { ...this.grade, grain: 0.025, vig: 0.45, ca: 0.002, sat: 1.0, tint: 0x9fd8ff, tintAmt: 0 };
    this.mood = 'calm';
    this.shiftView = 0.08;
    this.trailColor = '160,220,255';
    this._seen = false;
  }

  load() {
    return Promise.all([loadModels(['reactor']), loadEnv(HDRIS.shop), loadTextures(['concrete_floor_worn_001', 'metal_plate'])]);
  }

  resize(w, hh) {
    super.resize(w, hh);
    if (this.floor?.resizeMirror) { const v = this.app.renderer.getDrawingBufferSize(new THREE.Vector2()); this.floor.resizeMirror(v.x, v.y); }
  }

  /* ================================================================ */
  build() {
    const s = this.scene, low = this.app.low;
    s.background = new THREE.Color(0x0b0c0e);
    // a photographed machine shop for reflections and ambient bounce, turned well down: it is night, and
    // the room is lit by its own fixtures
    s.environment = envMap(HDRIS.shop) || suitEnvironment();
    s.environmentIntensity = 0.3;
    s.fog = new THREE.Fog(0x0b0c0e, 10, 30);
    this.camera.fov = 48;
    this.camPos = new THREE.Vector3(...SHOTS[0][0]);
    this.look = new THREE.Vector3(...SHOTS[0][1]);
    this.camera.position.copy(this.camPos);
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._sp = new THREE.Vector3(); this._sl = new THREE.Vector3();
    this.path = Array.from({ length: 8 }, () => new THREE.Vector3());
    this.pathLen = 0;

    /* ---- light: night in a basement. One hanging fluorescent over the bench, a tungsten work lamp
       (the shadow), two caged bulbs on the walls, a little cold spill from the stairwell; then the
       machine's own light: the hologram, the ring, the flash ---- */
    s.add(new THREE.HemisphereLight(0x3a414c, 0x16110c, low ? 0.6 : 0.4));
    const key = new THREE.SpotLight(0xffd9b0, 55, 16, 0.7, 0.9, 1.6);
    key.position.set(1.4, 4.7, 1.6);
    key.target.position.set(-0.4, 0.4, -1.6);
    key.castShadow = !low;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    s.add(key, key.target);
    if (!low) {
      RectAreaLightUniformsLib.init();
      const tube = new THREE.RectAreaLight(0xe6efff, 5.5, 2.2, 0.16);
      tube.position.set(-0.5, 3.35, -3.1); tube.lookAt(-0.5, 0, -3.3);
      s.add(tube);
    }
    const ambA = new THREE.PointLight(0xffb266, 9, 11, 2); ambA.position.set(-5.2, 2.7, -4.6); s.add(ambA);
    const ambB = new THREE.PointLight(0xffb266, 7, 11, 2); ambB.position.set(5.4, 2.5, 3.6); s.add(ambB);
    this.holoLight = new THREE.PointLight(0x9fd0ff, 1.4, 3.2, 2); this.holoLight.position.copy(LATTICE); s.add(this.holoLight);
    this.ringLight = new THREE.PointLight(0x9fd8ff, 0, 12, 1.4); this.ringLight.position.set(0, 1.8, 0); s.add(this.ringLight);
    this.burstLight = new THREE.PointLight(0xe0f6ff, 0, 10, 1.6); this.burstLight.position.set(TARGET.x, BEAM_Y, TARGET.y + 0.4); s.add(this.burstLight);
    this.housingLight = new THREE.PointLight(0xa8f4ff, 0, 3.5, 1.8); this.housingLight.position.set(HOUSING.x, HOUSING.y + 0.1, HOUSING.z + 0.5); s.add(this.housingLight);
    this.burstE = 0;

    this._buildRoom();
    this._buildRing();
    this._buildLattice();
    this._buildPrisms();
    this._buildCore();
    this._buildContactShadows();

    /* ---- effects ---- */
    this.guide = new Beams(s, 8);
    for (const b of this.guide.items) b.m.material.uniforms.uColor.value.set(0xff9a4a);
    this.shots = new Beams(s, 8);
    this.waves = new Shockwaves(s, 5);
    this.sparks = new ParticlePool({ count: low ? 400 : 700, gravity: -6, drag: 0.7, softness: 1.1 });
    this.motes = new ParticlePool({ count: 260, drag: 0.4, turbulence: 0.25, softness: 2 });
    this.gather = new ParticlePool({ count: 300, drag: 0, softness: 1.4 });
    s.add(this.sparks.points, this.motes.points, this.gather.points);
    const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k); // past the bloom threshold
    this.cSpark = [hdr(0xdff6ff, 4), hdr(0x9fe8ff, 4), hdr(0xffffff, 4)];
    this.cAmber = [hdr(0xffc070, 3.5), hdr(0xff9a3a, 3.5)];
    this.cSick = hdr(0xb8ff9a, 1.2);
    this.cMote = new THREE.Color(0x8fb4d8);
    this.cGather = hdr(0xbff4ff, 3.5);

    this._buildUI();
    this._reset(true);
  }

  _buildRoom() {
    const s = this.scene, low = this.app.low;
    // the floor: sealed, worn concrete that softly mirrors the machine's light
    const floorMat = pbr('concrete_floor_worn_001', { repeat: 5, color: 0x8e8b86, roughness: 0.7, metalness: 0, normalScale: 0.8, fallback: 0x26282b });
    this.floor = glossyFloor(new THREE.PlaneGeometry(16, 14), floorMat, { renderer: this.app.renderer, low, scale: 0.5, strength: 0.45, blur: 6 });
    this.floor.rotation.x = -Math.PI / 2;
    s.add(this.floor);
    // poured concrete walls and a concrete slab above
    const wallMat = pbr('concrete_floor_worn_001', { repeat: [4, 1.4], color: 0x7a7771, roughness: 1, metalness: 0, normalScale: 1.2, fallback: 0x1e2024 });
    const wallMatS = pbr('concrete_floor_worn_001', { repeat: [3.5, 1.4], offset: [0.37, 0.21], color: 0x7a7771, roughness: 1, metalness: 0, normalScale: 1.2, fallback: 0x1e2024 });
    const wall = (w, x, z, ry, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 5.2), mat); m.position.set(x, 2.6, z); m.rotation.y = ry; m.receiveShadow = true; s.add(m); };
    wall(16, 0, -7, 0, wallMat); wall(16, 0, 7, Math.PI, wallMat);
    wall(14, -8, 0, Math.PI / 2, wallMatS); wall(14, 8, 0, -Math.PI / 2, wallMatS);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 14), pbr('concrete_floor_worn_001', { repeat: 4, color: 0x4a4946, roughness: 1, metalness: 0, fallback: 0x121315 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 5.2;
    s.add(ceil);

    const plate = (color, rough, metal, repeat = 1) => pbr('metal_plate', { repeat, color, roughness: rough, metalness: metal, fallback: color });
    const woodTex = woodTexture(); woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
    const M = this.M = {
      steel: plate(0xb4b9bf, 0.75, 1),
      dark: plate(0x3a3d42, 0.9, 0.55),          // powder-coated black steel
      wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.62, metalness: 0 }),
      copper: new THREE.MeshStandardMaterial({ color: 0xb87345, metalness: 1, roughness: 0.38 }),
      white: new THREE.MeshStandardMaterial({ color: 0x9a8a6e, roughness: 0.95, metalness: 0 }), // cardboard, paper
      rubber: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.75, metalness: 0 }),
      paint: plate(0x6b6f66, 0.95, 0.25),         // grey enamel (cabinets)
      red: plate(0x7a1712, 0.7, 0.3),             // a rolling tool chest
      amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(3), toneMapped: false }),
    };
    const g = new THREE.Group(); s.add(g);
    const box = (w, hh, d, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    const cyl = (r, hh, mat, x, y, z, rx = 0, rz = 0, seg = 12) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hh, seg), mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    const tube = (pts, r, mat, seg = 40) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, 6), mat); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    const blobs = []; // contact shadows: [x, z, sx, sz]

    // the long bench along the back wall: a thick butcher-block top on a black steel frame
    box(4.8, 0.08, 1.0, M.wood, -0.6, 0.92, -3.55);
    for (const x of [-2.9, 1.7]) for (const z of [-3.95, -3.15]) box(0.06, 0.88, 0.06, M.dark, x, 0.44, z);
    box(4.6, 0.04, 0.9, M.dark, -0.6, 0.3, -3.55);
    box(4.7, 0.06, 0.04, M.dark, -0.6, 0.85, -3.08);
    blobs.push([-0.6, -3.55, 5.6, 1.6]);
    // clutter on it: tool cases, a soldering station and its iron, a microscope, a scope, cables, papers
    box(0.4, 0.18, 0.3, M.dark, 0.9, 1.05, -3.7);
    box(0.25, 0.1, 0.2, M.steel, 1.4, 1.01, -3.4, 0.4);
    box(0.3, 0.14, 0.24, M.paint, 1.25, 1.03, -3.85, -0.2);
    cyl(0.06, 0.34, M.steel, -2.7, 1.13, -3.7);
    box(0.2, 0.05, 0.28, M.dark, -2.7, 0.985, -3.7);
    cyl(0.03, 0.2, M.dark, -2.7, 1.36, -3.64, 0.5);
    box(0.5, 0.3, 0.35, M.paint, -2.0, 1.11, -3.8, 0.1); // oscilloscope
    box(0.36, 0.2, 0.01, M.rubber, -2.0, 1.14, -3.62, 0.1);
    for (let k = 0; k < 4; k++) box(rand(0.22, 0.32), 0.003, rand(0.3, 0.4), M.white, rand(-1.4, 0.4), 0.962 + k * 0.003, rand(-3.3, -3.2), rand(-0.4, 0.4));
    for (let i = 0; i < 5; i++) cyl(0.008, rand(0.3, 0.7), i % 2 ? M.copper : M.rubber, rand(-2.5, 1.5), 0.968, rand(-3.9, -3.2), 0, Math.PI / 2 + rand(-0.4, 0.4), 6);
    // the hologram projector: a heavy black puck with a glass lens
    cyl(0.28, 0.08, M.dark, LATTICE.x, 1.0, LATTICE.z, 0, 0, 32);
    cyl(0.2, 0.03, M.steel, LATTICE.x, 1.05, LATTICE.z, 0, 0, 32);
    // the fluorescent fixture over the bench, on two chains
    box(2.4, 0.07, 0.26, M.paint, -0.5, 3.42, -3.1);
    for (const x of [-1.5, 0.5]) cyl(0.008, 1.72, M.steel, x, 4.32, -3.1, 0, 0, 4);
    // shelving on the side walls, boxes and parts on them
    for (const sx of [-1, 1]) {
      for (const z of [-3.75, -0.65]) for (const zz of [-0.22, 0.22]) box(0.04, 3.2, 0.04, M.dark, sx * 7.55 + zz * sx, 1.6, z);
      for (const y of [0.35, 1.2, 2.0, 2.8]) {
        box(0.55, 0.03, 3.2, M.dark, sx * 7.65, y, -2.2);
        for (let k = 0; k < 4; k++) if (Math.random() < 0.85) box(rand(0.3, 0.42), rand(0.2, 0.45), rand(0.3, 0.6), k % 2 ? M.white : M.paint, sx * 7.65 + rand(-0.05, 0.05), y + 0.15, -3.4 + k * 0.8 + rand(-0.1, 0.1), rand(-0.1, 0.1));
      }
      blobs.push([sx * 7.6, -2.2, 1.1, 3.8]);
    }
    // ceiling: steel beams and the building's services (copper water, grey conduit, a duct)
    for (let i = 0; i < 5; i++) box(16, 0.3, 0.14, M.dark, 0, 5.05, -5.6 + i * 2.8);
    for (const z of [-6.6, 6.6]) cyl(0.07, 16, M.copper, 0, 4.7, z, 0, Math.PI / 2);
    cyl(0.05, 14, M.steel, -7.6, 4.5, 0, Math.PI / 2, 0);
    cyl(0.03, 16, M.paint, 0, 4.85, -6.75, 0, Math.PI / 2, 8);
    box(16, 0.4, 0.6, M.steel, 0, 4.6, 5.4);
    // an electrical panel and its conduit on the back-left wall, heavy cables to the ring and the bench
    box(0.9, 1.3, 0.25, M.paint, -6.4, 1.7, -6.85);
    box(0.5, 0.7, 0.2, M.paint, -5.4, 1.5, -6.88);
    cyl(0.025, 3.2, M.steel, -6.2, 3.6, -6.9, 0, 0, 8);
    tube([[-6.3, 1.05, -6.7], [-6.2, 0.05, -6.2], [-5.8, 0.04, -3.5], [-5.2, 0.04, -1.9], [-4.9, 0.6, -1.4], [-4.8, BEAM_Y - 0.12, -1.25]], 0.035, M.rubber, 60);
    tube([[-5.4, 1.15, -6.75], [-5.3, 0.04, -6.0], [-3.0, 0.04, -4.6], [-2.2, 0.04, -4.1], [-1.9, 0.5, -3.95], [-1.8, 0.95, -3.9]], 0.02, M.rubber, 60);
    tube([[1.5, 0.94, -3.2], [1.9, 0.5, -2.9], [2.2, 0.03, -2.6], [3.2, 0.03, -2.0], [3.9, 0.03, -1.0], [4.6, 0.03, 0.2], [RING_R * 0.97, 0.3, 1.3], [RING_R * 0.95, BEAM_Y - 0.2, 1.4]], 0.018, M.rubber, 60);
    // a red rolling tool chest in the corner, a stool, a crate
    box(1.1, 1.0, 0.55, M.red, 5.6, 0.58, -6.3);
    for (let k = 0; k < 5; k++) box(1.0, 0.012, 0.02, M.steel, 5.6, 0.25 + k * 0.18, -6.02);
    for (const [x, z] of [[5.15, -6.1], [6.05, -6.1], [5.15, -6.5], [6.05, -6.5]]) cyl(0.04, 0.08, M.rubber, x, 0.04, z, Math.PI / 2, 0, 10);
    blobs.push([5.6, -6.3, 1.6, 0.9]);
    cyl(0.2, 0.04, M.dark, -3.2, 0.7, -2.4, 0, 0, 20);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; cyl(0.015, 0.72, M.steel, -3.2 + Math.cos(a) * 0.14, 0.35, -2.4 + Math.sin(a) * 0.14, Math.sin(a) * 0.18, -Math.cos(a) * 0.18, 6); }
    blobs.push([-3.2, -2.4, 0.7, 0.7]);
    box(0.8, 0.6, 0.6, M.wood, 6.4, 0.3, 4.8, 0.3);
    box(0.6, 0.45, 0.5, M.white, 6.3, 0.83, 4.75, 0.1);
    blobs.push([6.4, 4.8, 1.3, 1.1]);
    // the expo model: a miniature fairground on a table, its paths tracing the hidden pattern
    const ex = new THREE.Vector3(3.4, 0, -1.0);
    box(1.4, 0.06, 1.0, M.wood, ex.x, 0.82, ex.z, -0.3);
    for (const [dx, dz] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) box(0.05, 0.8, 0.05, M.dark, ex.x + dx * 0.95, 0.4, ex.z + dz, -0.3);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xb9b3a4, roughness: 0.85 });
    const modelMat = new THREE.MeshStandardMaterial({ color: 0xd9d3c3, roughness: 0.7 });
    box(1.25, 0.04, 0.88, baseMat, ex.x, 0.87, ex.z, -0.3);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), M.steel); sphere.position.set(ex.x, 1.02, ex.z); sphere.castShadow = true; g.add(sphere);
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * TAU + 0.1, r = k % 2 ? 0.34 : 0.24;
      const m = box(0.06, rand(0.05, 0.16), 0.06, modelMat, ex.x + Math.cos(a - 0.3) * r * 1.3, 0.93, ex.z + Math.sin(a - 0.3) * r, -0.3 + a);
      m.position.y = 0.89 + m.geometry.parameters.height / 2;
    }
    blobs.push([ex.x, ex.z, 1.9, 1.4]);
    mergeStatic(g);
    // caged work lamps: a bare warm bulb in a wire cage
    const cageMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.5, wireframe: true });
    for (const [x, y, z] of [[-5.2, 2.7, -4.6], [5.4, 2.5, 3.6]]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), M.amber); b.position.set(x, y, z); s.add(b);
      const cage = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), cageMat); cage.position.set(x, y, z); s.add(cage);
      const gl = glowSprite(0xffb070, 0.55, 0.35); gl.material.color.multiplyScalar(2); gl.position.set(x, y, z); s.add(gl);
    }
    // the fluorescent tube itself: the only bright surface in the room
    const tubeFace = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.035, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xeef4ff).multiplyScalar(3.2), toneMapped: false }));
    tubeFace.position.set(-0.5, 3.37, -3.1);
    s.add(tubeFace);
    // pinned drafting sheets on the back wall: pencil on paper, his own working of the lattice
    const bp = drawTexture(1024, 640, (x, w, hh) => {
      x.fillStyle = '#d8d2c2'; x.fillRect(0, 0, w, hh);
      for (let i = 0; i < 2500; i++) { const v = 170 + Math.random() * 60 | 0; x.fillStyle = `rgba(${v},${v - 6},${v - 18},0.25)`; x.fillRect(Math.random() * w, Math.random() * hh, 2, 2); }
      const vg = x.createRadialGradient(w / 2, hh / 2, hh * 0.2, w / 2, hh / 2, w * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(90,70,40,0.35)');
      x.fillStyle = vg; x.fillRect(0, 0, w, hh);
      x.strokeStyle = 'rgba(60,90,130,0.12)'; x.lineWidth = 1; x.beginPath();
      for (let i = 0; i < w; i += 32) { x.moveTo(i, 0); x.lineTo(i, hh); }
      for (let j = 0; j < hh; j += 32) { x.moveTo(0, j); x.lineTo(w, j); }
      x.stroke();
      x.strokeStyle = 'rgba(40,40,45,0.75)'; x.lineWidth = 2.2; x.lineCap = 'round'; x.beginPath();
      const cx = 330, cy = 320, sp = 110;
      const jitter = () => (Math.random() - 0.5) * 2;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        x.moveTo(cx + i * sp - sp + jitter(), cy + j * sp + jitter()); x.lineTo(cx + i * sp + sp + jitter(), cy + j * sp + jitter());
        x.moveTo(cx + i * sp + jitter(), cy + j * sp - sp + jitter()); x.lineTo(cx + i * sp + jitter(), cy + j * sp + sp + jitter());
      }
      x.moveTo(cx - sp, cy - sp); x.lineTo(cx + sp, cy + sp); x.moveTo(cx + sp, cy - sp); x.lineTo(cx - sp, cy + sp);
      x.stroke();
      x.beginPath(); x.arc(780, 230, 110, 0, TAU); x.moveTo(780, 120); x.lineTo(685, 285); x.lineTo(875, 285); x.closePath(); x.stroke();
      x.fillStyle = 'rgba(40,40,45,0.8)'; x.font = 'italic 600 30px "Segoe Print", "Comic Sans MS", cursive';
      x.fillText('lattice, rev. 7', 610, 440); x.fillText('core housing: tri', 610, 490);
      x.strokeStyle = 'rgba(160,30,20,0.7)'; x.lineWidth = 3; x.beginPath(); x.ellipse(cx + sp * 0.5, cy - sp * 0.5, 38, 30, 0.3, 0, TAU); x.stroke();
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), new THREE.MeshStandardMaterial({ map: bp, color: 0x8f8b82, roughness: 0.95, metalness: 0 }));
    board.position.set(-0.6, 2.4, -6.965); board.rotation.z = 0.012;
    s.add(board);
    const cork = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.0, 0.03), new THREE.MeshStandardMaterial({ color: 0x6d5334, roughness: 1 }));
    cork.position.set(-0.6, 2.4, -6.985);
    s.add(cork);
    this._blobs = blobs;
  }

  /** Soft contact shadows on the floor (one instanced draw), so nothing floats. */
  _buildContactShadows() {
    const list = this._blobs;
    const mat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, depthWrite: false, opacity: 0.75 });
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, list.length);
    const d = new THREE.Object3D();
    list.forEach(([x, z, sx, sz], i) => { d.position.set(x, 0.004, z); d.scale.set(sx, 1, sz); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
    m.renderOrder = 1;
    this.scene.add(m);
  }

  _buildRing() {
    const s = this.scene, M = this.M;
    // the pipe: eight arcs with gaps for the magnets, merged into one mesh
    const pipe = new THREE.Group(); s.add(pipe);
    const segs = 8, gap = 0.12;
    // brushed stainless beam pipe (the plate texture's scratches read as brushing at this tiling)
    const pipeMat = pbr('metal_plate', { repeat: [24, 1], color: 0xc9ced4, roughness: 0.55, metalness: 1, normalScale: 0.4, fallback: 0x8a939e });
    for (let i = 0; i < segs; i++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.13, 12, 24, TAU / segs - gap), pipeMat);
      m.rotation.set(-Math.PI / 2, 0, (i / segs) * TAU + gap / 2);
      m.position.y = BEAM_Y;
      m.castShadow = true; m.receiveShadow = true;
      pipe.add(m);
    }
    mergeStatic(pipe);
    // the light strip on the inside of the pipe
    this.runner = runnerMaterial(0x7fdcff);
    const strip = new THREE.Mesh(new THREE.TorusGeometry(RING_R - 0.13, 0.028, 6, 220), this.runner);
    strip.rotation.x = -Math.PI / 2; strip.position.y = BEAM_Y + 0.05;
    s.add(strip);
    // clamps, magnets and legs (instanced)
    const d = new THREE.Object3D();
    const nC = 48;
    const clamps = new THREE.InstancedMesh(new THREE.TorusGeometry(0.17, 0.035, 6, 14), M.dark, nC);
    for (let k = 0; k < nC; k++) {
      const a = (k / nC) * TAU;
      d.position.set(Math.cos(a) * RING_R, BEAM_Y, Math.sin(a) * RING_R);
      d.rotation.set(0, -a, 0); d.scale.setScalar(1); d.updateMatrix();
      clamps.setMatrixAt(k, d.matrix);
    }
    clamps.castShadow = true;
    // dipole magnets: blue-enamelled yokes with copper coil packs either side of the pipe
    const magMat = pbr('metal_plate', { repeat: 0.5, color: 0x1f3f78, roughness: 0.85, metalness: 0.25, fallback: 0x1f3f78 });
    const mags = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.5, 0.5), magMat, segs);
    const coils = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.12, 0.3), M.copper, segs * 2);
    const feet = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.02, 0.3), M.steel, 16);
    const blobs = this._blobs;
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), M.amber, segs);
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, BEAM_Y, 0.2), M.dark, 16);
    for (let k = 0; k < segs; k++) {
      const a = -((k / segs) * TAU); // matches the arcs' gaps (the torus runs the other way once laid flat)
      d.position.set(Math.cos(a) * RING_R, BEAM_Y, Math.sin(a) * RING_R);
      d.rotation.set(0, -a, 0); d.updateMatrix(); mags.setMatrixAt(k, d.matrix);
      for (const dy of [-1, 1]) { d.position.y = BEAM_Y + dy * 0.18; d.updateMatrix(); coils.setMatrixAt(k * 2 + (dy > 0 ? 1 : 0), d.matrix); }
      blobs.push([Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0.9, 0.9]);
      d.position.set(Math.cos(a) * (RING_R - 0.22), BEAM_Y + 0.12, Math.sin(a) * (RING_R - 0.22));
      d.rotation.set(0, -a + Math.PI / 2, 0); d.updateMatrix(); lamps.setMatrixAt(k, d.matrix);
    }
    for (let k = 0; k < 16; k++) {
      const a = ((k + 0.5) / 16) * TAU;
      d.position.set(Math.cos(a) * RING_R, BEAM_Y / 2, Math.sin(a) * RING_R);
      d.rotation.set(0, -a, 0); d.updateMatrix(); legs.setMatrixAt(k, d.matrix);
      d.position.y = 0.01; d.updateMatrix(); feet.setMatrixAt(k, d.matrix);
      blobs.push([Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0.5, 0.5]);
    }
    mags.castShadow = legs.castShadow = coils.castShadow = true;
    mags.receiveShadow = coils.receiveShadow = true;
    s.add(clamps, mags, coils, lamps, legs, feet);
    // the beam port on the ring
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.5, 16), M.steel);
    port.rotation.z = -Math.PI / 2; port.position.set(EMIT.x - 0.1, BEAM_Y, EMIT.y);
    port.castShadow = true;
    s.add(port);
    this.portGlow = glowSprite(0xffb070, 0.3, 0.6);
    this.portGlow.material.color.multiplyScalar(2.2);
    this.portGlow.position.set(EMIT.x + 0.16, BEAM_Y, EMIT.y);
    s.add(this.portGlow);
  }

  _buildLattice() {
    const g = this.lattice = new THREE.Group();
    g.position.copy(LATTICE);
    this.scene.add(g);
    const nodes = [], sp = 0.3;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) nodes.push({ p: new THREE.Vector3(i * sp, j * sp, k * sp), r: 0.042, centre: false });
    for (const i of [-0.5, 0.5]) for (const j of [-0.5, 0.5]) for (const k of [-0.5, 0.5]) nodes.push({ p: new THREE.Vector3(i * sp, j * sp, k * sp), r: 0.055, centre: true });
    const bonds = [];
    nodes.forEach((a, ia) => nodes.forEach((b, ib) => {
      if (ib <= ia) return;
      const dd = a.p.distanceTo(b.p);
      if (!a.centre && !b.centre && Math.abs(dd - sp) < 1e-3) bonds.push([ia, ib]);
      else if (a.centre !== b.centre && Math.abs(dd - sp * Math.sqrt(3) / 2) < 1e-3) bonds.push([ia, ib]);
    }));
    this.nodes = nodes; this.bonds = bonds;
    // projected light: nodes are soft dots, bonds fine soft lines, in the pale blue of a DLP projector's lamp
    const mat = instancedHolo(1, 1.25, 2.6);
    const bondMat = instancedHolo(1, 0.95, 0.9);
    this.nodeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), mat, nodes.length);
    this.nodeHit = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ visible: false }), nodes.length);
    const d = new THREE.Object3D();
    nodes.forEach((n, i) => {
      d.position.copy(n.p); d.scale.setScalar(n.r * 0.85); d.updateMatrix(); this.nodeMesh.setMatrixAt(i, d.matrix);
      d.scale.setScalar(n.centre ? 0.11 : 0.06); d.updateMatrix(); this.nodeHit.setMatrixAt(i, d.matrix);
      this.nodeMesh.setColorAt(i, new THREE.Color(0x8ec8ff));
    });
    this.nodeHit.computeBoundingSphere();
    this.nodeMesh.computeBoundingSphere();
    this.bondMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), bondMat, bonds.length);
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
    bonds.forEach(([a, b], i) => {
      const pa = nodes[a].p, pb = nodes[b].p;
      dir.subVectors(pb, pa);
      d.position.copy(pa).add(pb).multiplyScalar(0.5);
      d.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      d.scale.set(0.0045, dir.length(), 0.0045); d.updateMatrix();
      this.bondMesh.setMatrixAt(i, d.matrix);
      this.bondMesh.setColorAt(i, new THREE.Color(0x5f9ccc));
    });
    this.bondMesh.computeBoundingSphere();
    g.add(this.nodeMesh, this.bondMesh, this.nodeHit);
    // the projector's light: a faint cone through the air's haze, a soft scatter around the image,
    // and the pool of light it throws on the bench around the lens
    this.holoShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.17, 1.35, 40, 1, true), shaftMaterial(0x9fcfff, 0.2));
    this.holoShaft.position.set(LATTICE.x, 1.07 + 1.35 / 2, LATTICE.z);
    this.scene.add(this.holoShaft);
    this.holoHaze = glowSprite(0x8fc4ff, 1.9, 0.07);
    this.holoHaze.position.copy(LATTICE);
    this.scene.add(this.holoHaze);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x2a4a6a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.position.set(LATTICE.x, 0.962, LATTICE.z);
    this.scene.add(pool);
    this.holoRing = new THREE.Object3D(); // (the old decorative ring is gone; kept as a handle)
    this.cNode = new THREE.Color(0x8ec8ff); this.cMiss = new THREE.Color(0xff6a45); this.cGold = new THREE.Color(0xffc870);
    this.cBond = new THREE.Color(0x5f9ccc); this.cBondDim = new THREE.Color(0x0e1c28); this.cTmp = new THREE.Color();
    this.centreIdx = nodes.map((n, i) => (n.centre ? i : -1)).filter((i) => i >= 0);
    this.yaw = 0.5; this.yawV = 0; this.pitch = 0.35;
  }

  _buildPrisms() {
    const s = this.scene, M = this.M;
    // optical glass (clear, a little green at the edges) around a silvered front-surface mirror
    const crystal = new THREE.MeshPhysicalMaterial({ color: 0xe2f0ea, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.2, depthWrite: false });
    const facet = new THREE.MeshStandardMaterial({ color: 0xd6dbe0, metalness: 1, roughness: 0.06, envMapIntensity: 1.6, side: THREE.DoubleSide });
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    this.prismHits = [];
    this.prisms = PRISMS.map((P, i) => {
      const g = new THREE.Group();
      g.position.set(P.x, 0, P.z);
      s.add(g);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.84, 10), M.dark); pole.position.y = 0.42; pole.castShadow = true;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 20), M.dark); foot.position.y = 0.025;
      const table = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 32), M.steel); table.position.y = 0.86; table.castShadow = true; table.receiveShadow = true;
      g.add(pole, foot, table);
      this._blobs.push([P.x, P.z, 0.8, 0.8]);
      const rotor = new THREE.Group();
      rotor.position.y = BEAM_Y;
      g.add(rotor);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 3), crystal);
      body.rotation.y = Math.PI / 6;
      const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), facet);
      mirror.rotation.y = Math.PI / 2; // its normal along local +x
      const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, 0.03), M.amber);
      pointer.position.set(0.12, -0.21, 0);
      rotor.add(body, mirror, pointer);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.25, 8), hitMat);
      hit.position.y = 0.62; hit.userData.index = i;
      g.add(hit);
      this.prismHits.push(hit);
      const glow = glowSprite(0xffb060, 0.32, 0);
      glow.material.color.multiplyScalar(2.2);
      glow.position.set(P.x, BEAM_Y, P.z);
      s.add(glow);
      return { group: g, rotor, angle: 0, shown: 0, solve: P.solve, glow, flash: 0 };
    });
    // the target plate
    const tg = new THREE.Group();
    tg.position.set(TARGET.x, 0, TARGET.y);
    s.add(tg);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), M.dark); post.position.set(0, 0.55, -0.1); post.castShadow = true;
    this.targetMat = pbr('metal_plate', { repeat: 0.4, color: 0x9a9ea3, roughness: 0.7, metalness: 1, fallback: 0x4a4f56 });
    this.targetMat.emissive.setRGB(0, 0, 0);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.05), this.targetMat); plate.position.y = BEAM_Y; plate.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.01, 6, 48), M.amber); rim.position.set(0, BEAM_Y, 0.03);
    tg.add(post, plate, rim);
    this._blobs.push([TARGET.x, TARGET.y - 0.1, 0.5, 0.4]);
    this.targetGlow = glowSprite(0xdff6ff, 0.6, 0);
    this.targetGlow.material.color.multiplyScalar(4);
    this.targetGlow.position.set(TARGET.x, BEAM_Y, TARGET.y + 0.1);
    s.add(this.targetGlow);
  }

  _buildCore() {
    const s = this.scene, M = this.M;
    // the new core: a glowing triangle, point down
    this.core = new THREE.Group();
    const tri = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 3); tri.rotateX(Math.PI / 2);
    const plasma = new THREE.Mesh(tri, plasmaMaterial(0xa8f4ff, { speed: 1.4, scale: 7 }));
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 3).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8fbff).multiplyScalar(4), toneMapped: false }));
    this.core.add(plasma, inner);
    this.coreGlow = glowSprite(0xa8f4ff, 0.5, 0.9);
    this.coreGlow.material.color.multiplyScalar(2.2);
    this.core.add(this.coreGlow);
    this.core.visible = false;
    s.add(this.core);
    // the old palladium reactor (the detailed model) in a cradle on the bench, tilted up to the room; the
    // new triangular core ends up seated in its centre, inside a small triangular insert
    const hg = new THREE.Group();
    hg.position.copy(HOUSING);
    hg.rotation.x = -0.35;
    s.add(hg);
    const real = new RealSuit('reactor', { uniqueMaterials: true, castShadow: !this.app.low });
    let front = 0.03;
    if (real.ok) {
      this.oldReactor = real;
      real.root.position.set(0, -real.size.y / 2, -0.02); // centred on the cradle's pivot
      front = real.size.z / 2 - 0.02;
      hg.add(real.root);
      // its own glowing parts (emissive maps) are driven here: sickly and failing, then clean
      const mats = new Set();
      for (const m of real.meshes) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
      this.reactorMats = [...mats].filter((m) => m.emissiveMap && m.emissive);
    } else {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.05, 32).rotateX(Math.PI / 2), M.dark);
      base.position.z = -0.03; base.castShadow = true;
      hg.add(base);
      this.reactorMats = [];
    }
    const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.08), M.dark);
    cradle.position.set(0, -0.22, -0.06);
    cradle.castShadow = true;
    const insert = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 8, 3), M.steel);
    insert.rotation.z = -Math.PI / 2; insert.position.z = front + 0.004;
    insert.scale.setScalar(0.001); // appears with the new core
    this.housingGlowMat = new THREE.MeshBasicMaterial({ color: 0x0a2a33, toneMapped: false });
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.006, 6, 3), this.housingGlowMat);
    glowRing.rotation.z = -Math.PI / 2; glowRing.position.z = front + 0.012;
    glowRing.scale.setScalar(0.001);
    hg.add(cradle, insert, glowRing);
    this.insert = [insert, glowRing];
    // the old core's glow: pale, green-tinged, unsteady
    this.sickGlow = glowSprite(0xc8ffb0, 0.34, 0.6);
    this.sickGlow.position.set(0, 0, front + 0.02);
    hg.add(this.sickGlow);
    this.cSickGlow = new THREE.Color(0xc8ffb0).multiplyScalar(1.6);
    this.cHealGlow = new THREE.Color(0xa8f4ff).multiplyScalar(1.8);
    this.cSickEm = new THREE.Color(0x9cff7a);
    this.cHealEm = new THREE.Color(0x9ff3ff).multiplyScalar(3);
    this.housing = hg;
    this.coreFrom = new THREE.Vector3(TARGET.x, BEAM_Y, TARGET.y + 0.32);
    this.coreCtrl = new THREE.Vector3(0.2, 2.6, -2.2);
    this.coreTo = new THREE.Vector3().set(0, 0, front + 0.016).applyEuler(hg.rotation).add(HOUSING);
    this.sickT = 0;
  }

  _buildUI() {
    this.intro({
      kicker: 'Chapter 09 · Legacy',
      title: 'New <strong>Element</strong>',
      jp: 'ELEMENT',
      desc: 'The reactor in his chest is killing him. In his father\'s old work lies the shape of an element that has never existed. Map it, focus the beam, fire the ring, and forge a new heart.',
      extra: [this.gestures([['drag', '<b>Drag</b> to turn the hologram'], ['tap', '<b>Tap</b> nodes &amp; prisms'], ['hold', '<b>Hold</b> to fire the ring']])],
    });
    const stat = (label) => { const b = h('b', { text: '—' }); const el = h('div.stat', {}, b, h('span', { text: label })); el._b = b; return el; };
    this.stStage = stat('Stage'); this.stNodes = stat('Nodes'); this.stPrisms = stat('Prisms');
    this.meterFill = h('div.meter-fill');
    this.meterVal = h('b', { text: '0%' });
    this.ui.append(h('div.rx-panel', {},
      h('div.stats', {}, this.stStage, this.stNodes, this.stPrisms),
      h('div.meter', {}, h('div.meter-label', {}, h('span', { text: 'Charge' }), this.meterVal), h('div.meter-track', {}, this.meterFill))));
    this.cardJp = h('span.card-jp');
    this.cardH = h('h3');
    this.cardP = h('p');
    this.cardSpec = h('dl.spec');
    this.card = h('div.card.rx-card.pe', {}, this.cardJp, this.cardH, this.cardP, this.cardSpec);
    this.ui.append(this.card);
    this.btnAct = this.button('Fill gap', () => this._action(), 'btn-primary');
    this.btnReset = this.button('Reset', () => { this._reset(); this.app.sfx.powerDown(); });
    this.ui.append(h('div.controls', {}, this.btnAct, h('div.group', {}, this.btnReset)));
    this.banner = h('div.big-title', {}, h('b', { text: 'New element' }), h('span', { text: 'A heart that no longer poisons' }));
    this.ui.append(this.banner);
  }

  /* ================================================================ */
  _reset(silent = false) {
    this.stage = 0;
    this.stageT = 0;
    this.marked = 0;
    const shuffled = this.centreIdx.slice().sort(() => Math.random() - 0.5);
    this.missing = new Set(shuffled.slice(0, 6));
    this.markedSet = new Set();
    this.yaw = 0.5; this.pitch = 0.35; this.yawV = 0;
    this.prisms.forEach((p) => {
      const opts = [0, 45, 90, 135].filter((a) => a % 180 !== p.solve % 180);
      p.angle = opts[(Math.random() * opts.length) | 0];
      p.shown = p.angle; p.flash = 0;
    });
    this.solved = false; this.solvedT = 0;
    this.charge = 0; this.autoHold = 0; this.fired = false; this.fireT = -1;
    this.core.visible = false; this.core.scale.setScalar(0.001);
    this.housingE = 0;
    this.targetMat.emissive.setRGB(0, 0, 0);
    this.banner.classList.remove('on');
    this.shake = 0;
    for (const b of this.guide.items) b.m.visible = false;
    this.app.sfx.charge(0);
    this._colorLattice(0);
    this._syncCard();
    this._syncStats(true);
    if (!silent) this.app.toast('Lab reset. <b>Tap</b> the pulsing gaps in the hologram.', 2600);
  }

  _setStage(n) {
    this.stage = n;
    this.stageT = 0;
    this.autoHold = 0;
    this._syncCard();
    this._syncStats(true);
  }

  _syncCard() {
    const c = this.card;
    c.classList.toggle('final', this.stage >= 3);
    if (this.stage < 3) {
      const d = CARDS[this.stage];
      this.cardJp.textContent = d.jp; this.cardH.textContent = d.title; this.cardP.textContent = d.text;
      this.cardSpec.replaceChildren();
    } else {
      this.cardJp.textContent = 'Synthesized · Core online';
      this.cardH.textContent = 'The new element';
      this.cardP.textContent = 'An element invented for the films: built from a structure hidden in an old expo model, and made real in a basement with a home-built particle accelerator.';
      this.cardSpec.replaceChildren(...[['Status', 'Fictional (film)'], ['Made with', 'Home-built accelerator'], ['Powers', 'Mark VI triangular reactor'], ['Result', 'Ended the palladium poisoning']]
        .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
    }
    const labels = ['Fill gap', 'Turn prism', 'Charge', ''];
    this.btnAct.hidden = this.stage >= 3 || this.fired;
    this.btnAct.textContent = labels[this.stage] || '';
    c.classList.remove('hidden');
  }

  _syncStats(force = false) {
    const aligned = this.prisms.reduce((n, p) => n + ((((p.angle - p.solve) % 180) + 180) % 180 === 0 ? 1 : 0), 0);
    const vals = [`${Math.min(this.stage + 1, 3)} / 3`, `${this.marked} / 6`, `${aligned} / 3`];
    const els = [this.stStage, this.stNodes, this.stPrisms];
    vals.forEach((v, i) => { if (force || els[i]._b.textContent !== v) els[i]._b.textContent = v; });
    this.stNodes.classList.toggle('ok', this.marked >= 6);
    this.stPrisms.classList.toggle('ok', aligned >= 3);
    this.stStage.classList.toggle('ok', this.stage >= 3);
    const pc = Math.round(this.charge * 100);
    if (force || pc !== this._pc) {
      this._pc = pc;
      this.meterFill.style.width = `${pc}%`;
      this.meterVal.textContent = `${pc}%`;
    }
  }

  _colorLattice(t) {
    const nm = this.nodeMesh, bm = this.bondMesh;
    const pulse = 0.55 + 0.45 * Math.sin(t * 6);
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.markedSet.has(i)) this.cTmp.copy(this.cGold).multiplyScalar(this.stage >= 1 ? 1.2 + Math.sin(t * 3) * 0.2 : 1.4);
      else if (this.missing.has(i)) this.cTmp.copy(this.cMiss).multiplyScalar(0.25 + pulse * 1.1);
      else this.cTmp.copy(this.cNode);
      nm.setColorAt(i, this.cTmp);
    }
    nm.instanceColor.needsUpdate = true;
    for (let i = 0; i < this.bonds.length; i++) {
      const [a, b] = this.bonds[i];
      const gap = (this.missing.has(a) && !this.markedSet.has(a)) || (this.missing.has(b) && !this.markedSet.has(b));
      const gold = this.markedSet.has(a) || this.markedSet.has(b);
      bm.setColorAt(i, gap ? this.cBondDim : gold ? this.cGold : this.cBond);
    }
    bm.instanceColor.needsUpdate = true;
  }

  _mark(i) {
    const sfx = this.app.sfx;
    if (this.missing.has(i) && !this.markedSet.has(i)) {
      this.markedSet.add(i);
      this.marked++;
      sfx.hologram();
      this.nodeMesh.getMatrixAt(i, this._m4 = this._m4 || new THREE.Matrix4());
      this._v.setFromMatrixPosition(this._m4).applyMatrix4(this.lattice.matrixWorld);
      this.sparks.burst(this._v, 14, { speed: 1.2, life: [0.2, 0.6], size: [0.015, 0.035], colors: this.cAmber });
      this._syncStats();
      if (this.marked >= 6) {
        sfx.chime();
        this.app.flash(0.15, 0xffc24a);
        this.app.toast('Structure mapped. Now <b>tap</b> the prisms to steer the beam onto the target.', 3400);
        this._setStage(1);
      }
    } else if (!this.markedSet.has(i)) {
      sfx.wrong();
    }
  }

  _turn(i) {
    const p = this.prisms[i];
    p.angle += 45;
    p.flash = 1;
    this.app.sfx.servo(0.2);
    this.app.sfx.beep(i);
    this._syncStats();
  }

  _action() {
    if (this.stage === 0) {
      const next = [...this.missing].find((i) => !this.markedSet.has(i));
      if (next !== undefined) this._mark(next);
    } else if (this.stage === 1) {
      const i = this.prisms.findIndex((p) => (((p.angle - p.solve) % 180) + 180) % 180 !== 0);
      if (i >= 0) this._turn(i);
    } else if (this.stage === 2 && !this.fired && !this.autoHold) this.autoHold = 1e-3;
  }

  /** Traces the beam over the floor plane, off the prisms' mirrors, to the target or a wall. Returns true on a hit. */
  _trace() {
    const P = this.path;
    let px = EMIT.x + 0.3, pz = EMIT.y, dx = 1, dz = 0, last = -1, hit = false, n = 0;
    P[n++].set(px, BEAM_Y, pz);
    for (let bounce = 0; bounce < 6; bounce++) {
      let best = Infinity, kind = 0, idx = -1;
      for (let i = 0; i < PRISMS.length; i++) {
        if (i === last) continue;
        const ox = PRISMS[i].x - px, oz = PRISMS[i].z - pz;
        const t = ox * dx + oz * dz;
        if (t < 0.05) continue;
        const perp = Math.abs(ox * dz - oz * dx);
        if (perp < 0.24 && t < best) { best = t; kind = 1; idx = i; }
      }
      {
        const ox = TARGET.x - px, oz = TARGET.y - pz;
        const t = ox * dx + oz * dz, perp = Math.abs(ox * dz - oz * dx);
        if (t > 0.05 && perp < 0.3 && t < best) { best = t; kind = 2; }
      }
      if (kind === 0) {
        // run to the walls of the room
        const tx = dx > 1e-4 ? (7.8 - px) / dx : dx < -1e-4 ? (-7.8 - px) / dx : Infinity;
        const tz = dz > 1e-4 ? (6.8 - pz) / dz : dz < -1e-4 ? (-6.8 - pz) / dz : Infinity;
        const t = Math.min(tx, tz, 20);
        P[n++].set(px + dx * t, BEAM_Y, pz + dz * t);
        break;
      }
      if (kind === 2) { P[n++].set(TARGET.x, BEAM_Y, TARGET.y + 0.03); hit = true; break; }
      const pr = PRISMS[idx];
      px = pr.x; pz = pr.z;
      P[n++].set(px, BEAM_Y, pz);
      const a = THREE.MathUtils.degToRad(this.prisms[idx].shown);
      const nx = Math.cos(a), nz = -Math.sin(a);
      const dot = dx * nx + dz * nz;
      dx -= 2 * dot * nx; dz -= 2 * dot * nz;
      const len = Math.hypot(dx, dz); dx /= len; dz /= len;
      last = idx;
      if (Math.abs(dot) > 0.995) break; // straight back: the prism blocks it
    }
    this.pathLen = n;
    return hit;
  }

  _fire() {
    const app = this.app, sfx = app.sfx;
    this.fired = true;
    this.fireT = 0;
    this.btnAct.hidden = true;
    sfx.charge(0);
    sfx.unibeam();
    sfx.zap();
    for (let i = 0; i < this.pathLen - 1; i++) this.shots.fire(this.path[i], this.path[i + 1], { width: 0.15, life: 1.1, color: 0xd8f6ff });
  }

  _impact() {
    const app = this.app, sfx = app.sfx;
    const c = this._v.set(TARGET.x, BEAM_Y, TARGET.y + 0.08);
    sfx.boom();
    app.flash(0.35, 0xdff6ff);
    // the flash is real light: it fills the room for a moment (no graphic rings); dust jumps off the floor
    this.burstE = 60;
    this.shake = 0.14;
    for (let k = 0; k < 40; k++) {
      const a = rand(0, TAU), r = rand(0.2, 1.4);
      this.motes.emit({ x: TARGET.x + Math.cos(a) * r, y: rand(0.02, 0.2), z: TARGET.y + Math.sin(a) * r, vx: Math.cos(a) * rand(0.3, 0.9), vy: rand(0.1, 0.5), vz: Math.sin(a) * rand(0.3, 0.9), life: rand(1.5, 3), size: rand(0.03, 0.07), color: this.cMote, alpha: 0.4 });
    }
    this.sparks.burst(c, 140, { speed: 6, up: 1.5, life: [0.3, 1.1], size: [0.02, 0.06], colors: this.cSpark });
    this.targetMat.emissive.setRGB(3, 4, 4.5);
    this.core.visible = true;
    this.core.position.copy(this.coreFrom);
    this.core.scale.setScalar(0.001);
  }

  _docked() {
    const app = this.app, sfx = app.sfx;
    sfx.clank(); sfx.powerUp();
    app.flash(0.2, 0xa8f4ff);
    this.housingE = 1;
    this.sparks.burst(this.coreTo, 50, { speed: 2.5, life: [0.3, 0.8], size: [0.02, 0.05], colors: this.cSpark });
    this.banner.classList.remove('on'); void this.banner.offsetWidth; this.banner.classList.add('on');
    this._setStage(3);
    setTimeout(() => { if (this.active && this.stage === 3) app.toast('Core online. Next: the <b>battle</b> ahead.', 3600); }, 3400);
  }

  /* ================================================================ */
  enter() {
    if (!this._seen) {
      this._seen = true;
      setTimeout(() => { if (this.active && this.stage === 0) this.app.toast('<b>Drag</b> to turn the hologram, <b>tap</b> the six pulsing gaps.', 3600); }, 900);
    }
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    this.autoHold = 0;
  }

  pointerMove(p) {
    if (p.down && this.stage === 0) {
      this.yaw += p.dx * 0.009;
      this.yawV = p.dx * 0.009;
      this.pitch = clamp(this.pitch + p.dy * 0.006, -1.1, 1.1);
    }
  }

  click() {
    if (this.stage === 0) {
      const hit = this.app.raycast([this.nodeHit], false);
      if (hit.length) this._mark(hit[0].instanceId);
    } else if (this.stage === 1) {
      const hit = this.app.raycast(this.prismHits, false);
      if (hit.length) this._turn(hit[0].object.userData.index);
    }
  }

  key(e) {
    if (e.key === ' ' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); this._action(); return true; }
    return false;
  }

  update(dt, t) {
    const app = this.app, sfx = app.sfx;
    this.stageT += dt;

    /* ---- the hologram ---- */
    if (app.pointer.down && this.stage === 0) this.yawV = damp(this.yawV, 0, 12, dt);
    else { this.yawV = damp(this.yawV, dt * 0.35, 1.5, dt); this.yaw += this.yawV; }
    this.lattice.rotation.set(this.pitch, this.yaw, 0);
    const pulseScale = this.stage >= 1 ? 1 + Math.sin(t * 2) * 0.02 : 1;
    this.lattice.scale.setScalar(pulseScale);
    this._colorLattice(t);
    this.holoRing.rotation.z = t * 0.4;
    // a projector lamp is never quite steady: a slow breathe and the odd quick dip
    const flick = 0.92 + Math.sin(t * 2.3) * 0.04 + (Math.sin(t * 17.3) * Math.sin(t * 5.1) > 0.8 ? -0.12 : 0);
    this.holoLight.intensity = 1.4 * flick;
    this.holoShaft.material.uniforms.uAlpha.value = 0.2 * flick;
    this.holoHaze.material.opacity = 0.07 * flick;

    /* ---- prisms and the guide beam ---- */
    for (const p of this.prisms) {
      p.shown = damp(p.shown, p.angle, 9, dt);
      p.rotor.rotation.y = THREE.MathUtils.degToRad(p.shown);
      p.flash = damp(p.flash, 0, 4, dt);
    }
    const beamOn = this.stage >= 1;
    const hit = beamOn ? this._trace() : false;
    const settled = this.prisms.every((p) => Math.abs(p.shown - p.angle) < 1.5);
    if (this.stage === 1 && hit && settled && !this.solved) {
      this.solved = true;
      sfx.lock(); sfx.chime();
      app.flash(0.12, 0xffb060);
      this.sparks.burst(this._v.set(TARGET.x, BEAM_Y, TARGET.y + 0.05), 30, { speed: 2, life: [0.2, 0.6], size: [0.02, 0.04], colors: this.cAmber });
      app.toast('Beam on target. <b>Hold</b> to fire the accelerator.', 3200);
      this._setStage(2);
    }
    const G = this.guide.items;
    const guideW = this.stage === 2 ? 0.04 + this.charge * 0.05 : 0.035;
    for (let i = 0; i < G.length; i++) {
      const b = G[i];
      if (beamOn && !this.fired && i < this.pathLen - 1) {
        b.from.copy(this.path[i]); b.to.copy(this.path[i + 1]);
        b.width = guideW; b.life = 1; b.age = 0.2;
        b.m.visible = true;
        b.m.material.uniforms.uColor.value.setRGB(1, 0.62 + this.charge * 0.38, 0.3 + this.charge * 0.7);
      } else b.m.visible = false;
    }
    this.prisms.forEach((p, i) => {
      let lit = false;
      if (beamOn && !this.fired) for (let k = 1; k < this.pathLen; k++) { const q = this.path[k]; if (Math.abs(q.x - PRISMS[i].x) < 1e-3 && Math.abs(q.z - PRISMS[i].z) < 1e-3) lit = true; }
      p.glow.material.opacity = damp(p.glow.material.opacity, (lit ? 0.55 : 0) + p.flash * 0.5, 6, dt);
    });
    this.portGlow.material.opacity = beamOn ? 0.7 + this.charge * 0.3 : 0.25;
    this.portGlow.scale.setScalar(0.3 + this.charge * 0.5);
    this.targetGlow.material.opacity = damp(this.targetGlow.material.opacity, hit && !this.fired ? 0.5 + this.charge * 0.5 : 0, 6, dt);

    /* ---- charging the ring ---- */
    const canHold = this.stage === 2 && !this.fired;
    const hold = this.trackHold(2.2, canHold && !this.autoHold);
    if (canHold && this.autoHold > 0) { this.autoHold += dt / 2.2; sfx.charge(Math.min(1, this.autoHold)); }
    const target = canHold ? Math.max(hold.progress, this.autoHold > 0 ? Math.min(1, this.autoHold) : 0) : this.fired ? 0 : 0;
    this.charge = target > this.charge ? damp(this.charge, target, 12, dt) : damp(this.charge, target, 2.5, dt);
    if (canHold && (hold.fired || this.autoHold >= 1)) { this.autoHold = 0; this._fire(); }
    const ringE = this.fired ? Math.max(0, 1 - this.fireT * 0.5) : this.charge;
    this.runner.uniforms.uCharge.value = ringE;
    this.runner.uniforms.uPhase.value += dt * (0.12 + ringE * 2.8);
    this.ringLight.intensity = ringE * 24;
    this.grade.tintAmt = ringE * 0.05;
    this.bloom.strength = 0.8 + ringE * 0.35;
    if (canHold) this.shake = Math.max(this.shake, this.charge * 0.035);
    if (canHold && this.charge > 0.3 && Math.random() < dt * 30 * this.charge) {
      const a = rand(0, TAU);
      this.sparks.emit({ x: Math.cos(a) * RING_R, y: BEAM_Y + 0.1, z: Math.sin(a) * RING_R, vx: rand(-0.5, 0.5), vy: rand(0.5, 2), vz: rand(-0.5, 0.5), life: rand(0.2, 0.5), size: rand(0.02, 0.04), color: this.cSpark[1] });
    }

    /* ---- the shot, the flash, the core ---- */
    if (this.fired) {
      const t0 = this.fireT;
      this.fireT += dt;
      const ft = this.fireT;
      if (t0 < 0.12 && ft >= 0.12) this._impact();
      // the core forms in the light
      if (ft > 0.12 && ft < 1.9) {
        const k = clamp((ft - 0.2) / 1.2, 0, 1);
        this.core.scale.setScalar(0.001 + easeOutCubic(k));
        this.core.rotation.set(0, 0, ft * (8 - k * 6));
        if (k < 1 && Math.random() < dt * 90) {
          const a = rand(0, TAU), r = rand(0.5, 1.1);
          this.gather.emit({ x: this.coreFrom.x + Math.cos(a) * r, y: this.coreFrom.y + Math.sin(a) * r, z: this.coreFrom.z + rand(-0.2, 0.2), vx: -Math.cos(a) * r * 2.2, vy: -Math.sin(a) * r * 2.2, vz: 0, life: 0.45, size: rand(0.02, 0.05), color: this.cGather });
        }
      }
      if (t0 < 1.3 && ft >= 1.3) sfx.hologram();
      // it flies to the housing
      if (ft >= 1.9 && ft < 3.4) {
        const k = easeInOut(clamp((ft - 1.9) / 1.5, 0, 1));
        const a = this._v.copy(this.coreFrom).lerp(this.coreCtrl, k), b = this._v2.copy(this.coreCtrl).lerp(this.coreTo, k);
        this.core.position.copy(a.lerp(b, k));
        this.core.rotation.set(-0.35 * k, 0, lerp(ft * 2, Math.PI * 2 * 3, k));
        this.core.scale.setScalar(1 - k * 0.5);
        if (Math.random() < dt * 40) this.sparks.emit({ x: this.core.position.x, y: this.core.position.y, z: this.core.position.z, vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4), vz: rand(-0.4, 0.4), life: rand(0.3, 0.7), size: rand(0.015, 0.035), color: this.cSpark[0] });
      }
      if (t0 < 1.9 && ft >= 1.9) sfx.whoosh();
      if (t0 < 3.4 && ft >= 3.4) { this.core.position.copy(this.coreTo); this.core.rotation.set(-0.35, 0, 0); this.core.scale.setScalar(0.5); this._docked(); }
    }
    this.coreGlow.material.opacity = (this.stage >= 3 ? 0.35 : 0.6) + Math.sin(t * 7) * 0.1;
    this.burstE *= Math.exp(-4 * dt);
    // the laser's spot on the target plate throws a little amber into the room; the flash, a lot of white
    const spot = hit && !this.fired ? 0.5 + this.charge * 2.5 : 0;
    this.burstLight.intensity = this.burstE + spot;
    if (this.burstE > 0.5) this.burstLight.color.setHex(0xe0f6ff); else this.burstLight.color.setRGB(1, 0.6 + this.charge * 0.4, 0.3 + this.charge * 0.7);
    this.targetMat.emissive.multiplyScalar(Math.exp(-1.2 * dt));
    this.housingE = damp(this.housingE, this.stage >= 3 ? 1 : 0, 3, dt);
    const hf = this.housingE * (0.9 + Math.sin(t * 9) * 0.1);
    this.housingGlowMat.color.setRGB(0.04 + hf * 2.2, 0.16 + hf * 4, 0.2 + hf * 4.5);
    for (const m of this.insert) m.scale.setScalar(0.001 + this.housingE);
    // the old reactor: a weak, stuttering, green-tinged glow that heals to clean white-blue
    this.sickT += dt;
    const stutter = (Math.sin(t * 13.1) * Math.sin(t * 3.7) > 0.55 ? 0.35 : 1) * (0.55 + Math.sin(t * 1.3) * 0.15 + Math.sin(t * 29) * 0.06);
    const sick = 1 - this.housingE;
    this.sickGlow.material.color.copy(this.cSickGlow).lerp(this.cHealGlow, this.housingE);
    this.sickGlow.material.opacity = sick * 0.55 * stutter + this.housingE * (0.8 + Math.sin(t * 7) * 0.1);
    this.sickGlow.scale.setScalar(0.28 + this.housingE * 0.08);
    for (const m of this.reactorMats) {
      m.emissive.copy(this.cSickEm).lerp(this.cHealEm, this.housingE);
      m.emissiveIntensity = sick * 0.35 * stutter + this.housingE * 1.2;
    }
    this.housingLight.color.setRGB(0.6 + this.housingE * 0.06, 1, 0.55 + this.housingE * 0.45);
    this.housingLight.intensity = sick * 0.5 * stutter + hf * 3;
    if (sick > 0.5 && Math.random() < dt * 3) {
      this.motes.emit({ x: HOUSING.x + rand(-0.1, 0.1), y: HOUSING.y + rand(0, 0.1), z: HOUSING.z + 0.12, vx: rand(-0.03, 0.03), vy: rand(0.06, 0.15), vz: rand(0, 0.05), life: rand(2, 3.5), size: rand(0.012, 0.025), color: this.cSick, alpha: 0.6 });
    }

    /* ---- atmosphere ---- */
    if (Math.random() < dt * 12) this.motes.emit({ x: rand(-5, 5), y: rand(0.3, 4), z: rand(-5, 5), vx: rand(-0.04, 0.04), vy: rand(-0.02, 0.03), vz: rand(-0.04, 0.04), life: rand(3, 6), size: rand(0.02, 0.04), color: this.cMote, alpha: 0.35 });
    this.sparks.update(dt, t); this.motes.update(dt, t); this.gather.update(dt, t);
    this.guide.update(dt, this.camera); this.shots.update(dt, this.camera); this.waves.update(dt);
    this._syncStats();

    /* ---- camera: per stage, pulled back on portrait screens ---- */
    const shot = SHOTS[Math.min(this.stage, 3)];
    const portrait = app.width / app.height < 0.85;
    const pull = portrait ? (this.stage === 1 ? 1.35 : 1.7) : 1;
    this._sl.set(shot[1][0], shot[1][1], shot[1][2]);
    this._sp.set(shot[0][0], shot[0][1], shot[0][2]).sub(this._sl).multiplyScalar(pull).add(this._sl);
    if (this.fired && this.stage === 2) { // follow the core to its housing
      this._sl.lerp(this.core.position, clamp((this.fireT - 1.6) / 1.2, 0, 0.7));
    }
    const g = app.gyro;
    const px = (this.stage === 0 && app.pointer.down ? 0 : app.pointer.ndc.x) + (g ? g.x * 0.8 : 0);
    const py = (this.stage === 0 && app.pointer.down ? 0 : app.pointer.ndc.y) + (g ? g.y * 0.6 : 0);
    this._sp.x += px * 0.3; this._sp.y += py * 0.2;
    this.camPos.x = damp(this.camPos.x, this._sp.x, 2, dt);
    this.camPos.y = damp(this.camPos.y, this._sp.y, 2, dt);
    this.camPos.z = damp(this.camPos.z, this._sp.z, 2, dt);
    this.look.x = damp(this.look.x, this._sl.x, 2.4, dt);
    this.look.y = damp(this.look.y, this._sl.y, 2.4, dt);
    this.look.z = damp(this.look.z, this._sl.z, 2.4, dt);
    this.shake = damp(this.shake, 0, 6, dt);
    const sh = this.shake;
    this.camera.position.set(this.camPos.x + rand(-sh, sh), this.camPos.y + rand(-sh, sh), this.camPos.z + rand(-sh, sh) * 0.5);
    this.camera.lookAt(this.look);

    // hover feedback
    let hover = false;
    if (!app.isTouch && !app.pointer.down) {
      if (this.stage === 0) { const r = app.raycast([this.nodeHit], false); hover = r.length > 0 && this.missing.has(r[0].instanceId) && !this.markedSet.has(r[0].instanceId); }
      else if (this.stage === 1) hover = app.raycast(this.prismHits, false).length > 0;
    }
    app.setHover(hover);
  }
}
