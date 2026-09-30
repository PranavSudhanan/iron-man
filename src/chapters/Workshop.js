import * as THREE from 'three';
import './Workshop.css';
import { Chapter } from '../core/Chapter.js';
import { Suit, holoMaterial, suitEnvironment } from '../objects/Suit.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { glowSprite } from '../objects/FX.js';
import { mergeStatic } from '../core/mergeStatic.js';
import { glossyFloor } from '../objects/GlossyFloor.js';
import { loadEnv, envMap, loadTextures, pbr, HDRIS } from '../core/Env.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { rand, damp, clamp, TAU, h, drawTexture, pointerOnPlane, shared } from '../core/utils.js';
import { SYSTEMS } from '../data/content.js';

/*
 * The workshop at night: concrete, benches, a covered car, glass, cool strip lights — and in the middle a
 * projection table with the suit floating over it as a hologram. Turn it, pull it apart, pick a system to
 * study, run a diagnostic scan, or swap the hologram for the painted suit. A little bench arm keeps you company.
 */

// which way the hologram turns to show each system off (radians of yaw)
const SYS_YAW = { helmet: 0.25, reactor: 0, repulsors: 0.75, boots: 0.4, torso: -0.35, shoulders: -0.8 };
// diagnostic readouts, bottom to top (height in the hologram's space at which the scan reaches them)
const SCAN_LINES = [['Boot jets', 0.1], ['Knee servos', 0.4], ['Repulsors', 0.66], ['Armor shell', 0.92], ['Arc reactor', 1.12], ['Helmet & HUD', 1.4]];
const SCAN_TOP = 1.62;
const SUIT_SCALE = 0.8;
const ARM_L1 = 0.34, ARM_L2 = 0.3;

const FLAT_VS = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** The projector's cone of light: bright at the emitter, fading upward, soft at the silhouette. */
function coneMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0.3 } },
    vertexShader: FLAT_VS,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float fade = pow(1.0 - vUv.y, 1.5);
        float body = pow(abs(dot(normalize(vN), vV)), 1.3);
        float streak = 0.8 + 0.2 * sin(vUv.x * 6.2832 * 14.0 + uTime * 0.7) * sin(vUv.x * 6.2832 * 5.0 - uTime * 0.4);
        float flick = 0.93 + 0.07 * sin(uTime * 41.0) * sin(uTime * 17.0);
        gl_FragColor = vec4(uColor, fade * body * streak * flick * uAlpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

/** The scan plane: a disc of grid with a bright sweeping rim. */
function scanMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 } },
    vertexShader: FLAT_VS,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
      varying vec2 vUv;
      void main(){
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;
        float rim = smoothstep(0.84, 0.985, r) * (1.0 - smoothstep(0.985, 1.0, r));
        vec2 g = abs(fract(c * 18.0) - 0.5);
        float grid = (1.0 - smoothstep(0.0, 0.05, min(g.x, g.y))) * 0.08 * (1.0 - r);
        float sweep = 0.5 + 0.5 * sin(atan(c.y, c.x) * 3.0 - uTime * 5.0);
        float a = (0.03 + grid + rim * (0.45 + sweep * 0.3)) * uAlpha;
        gl_FragColor = vec4(uColor * 1.2, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export class Workshop extends Chapter {
  constructor(app) {
    super(app, { id: 'workshop', title: 'The Workshop', jp: 'BLUEPRINT' });
    this.bloom = { strength: 0.6, radius: 0.45, threshold: 2.8 }; // metal glints stay crisp; only lamps and the projector's hottest light bloom
    this.grade = { ...this.grade, grain: 0.024, vig: 0.42, ca: 0.0012, sat: 1, tint: 0x5fe3ff, tintAmt: 0.012 };
    this.mood = 'calm';
    this.shiftView = 0.12;
    this.trailColor = '120,220,255';
    this.yaw = 0.5; this.yawV = 0.25; this._dragAcc = 0;
    this.zoom = 1; this.zoomShown = 1;
    this.fit = 1; this.portraitLift = 0;
    this.explodeTarget = 0; this.explodeShown = 0;
    this.sel = null; this.autoTurn = false; this.targetYaw = 0;
    this.realMode = false; this.realShown = 0;
    this.scanT = -1; this.scanShown = 0;
    this.armJoy = 0; this._hinted = false; this._armHint = false;
  }

  load() {
    return Promise.all([loadModels(['tpose', 'classic']), loadEnv(HDRIS.shop), loadTextures(['concrete_floor_worn_001', 'metal_plate'])]);
  }

  build() {
    const s = this.scene;
    // a real machine shop for the image light (reflections in the steel and the painted suit), held low:
    // the room's own fixtures light it. Depth falls off into a dim, neutral haze, not a black void.
    const bg = 0x0d0e10;
    s.background = new THREE.Color(bg);
    s.fog = new THREE.Fog(bg, 10, 26);
    s.environment = envMap(HDRIS.shop) || suitEnvironment();
    s.environmentIntensity = 0.65;
    this.camera.fov = 40;
    this.camera.position.set(0, 1.9, 5);
    this.look = new THREE.Vector3(0, 1.6, 0);
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();

    this._buildLights();
    this._buildRoom();
    this._buildTable();
    this._buildHologram();
    this._buildArm();
    this._buildPanels();

    // dust in the light, glints off the scan
    this.dust = new ParticlePool({ count: 320, drag: 0.4, turbulence: 0.2, softness: 2 });
    this.glints = new ParticlePool({ count: 240, drag: 1.2, softness: 1.4 });
    s.add(this.dust.points, this.glints.points);
    this.dustColors = [new THREE.Color(0xb4b0a8), new THREE.Color(0x9fd6e6)];
    this.glintColors = [new THREE.Color(0xbff6ff).multiplyScalar(3.5), new THREE.Color(0xffffff).multiplyScalar(3)];
    this.goldColor = new THREE.Color(0xffd27a).multiplyScalar(3.5);
    // a few motes already hanging in the air when the room opens
    for (let i = 0; i < 90; i++) this._emitDust(rand(0, 4));

    this._buildUI();
  }

  /* ---------------- scene ---------------- */

  _buildLights() {
    const s = this.scene, low = this.app.low;
    // practical light only: the ceiling fixtures (soft area lights), one focused key over the projection
    // table (the shadow caster), a warm lamp on the bench, and the projector's own faint spill
    s.add(new THREE.HemisphereLight(0x8a9098, 0x4a4540, 0.3)); // (the ground colour stands in for light bounced off the floor onto the ceiling)
    const key = new THREE.SpotLight(0xfff2e6, 75, 14, 0.62, 0.85, 1.4);
    key.position.set(0.9, 3.75, 1.7);
    key.target.position.set(0, 0.9, 0);
    key.castShadow = !low;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02; key.shadow.radius = 5;
    s.add(key, key.target);
    if (!low) {
      RectAreaLightUniformsLib.init();
      for (const x of [-2.25, 2.25]) {
        const panel = new THREE.RectAreaLight(0xf2f5ff, 5, 1.7, 3.5);
        panel.position.set(x, 3.56, -1.2); panel.lookAt(x, 0, -1.2);
        s.add(panel);
      }
    } else {
      for (const x of [-2.25, 2.25]) { const p = new THREE.PointLight(0xf2f5ff, 7, 9, 1.5); p.position.set(x, 3.2, -1.2); s.add(p); }
    }
    // the bench lamp: warm tungsten pooled on the bench top
    this.benchLamp = new THREE.SpotLight(0xffc27a, 14, 5, 0.75, 0.7, 1.6);
    this.benchLamp.position.set(3.25, 1.62, -1.05);
    this.benchLamp.target.position.set(2.7, 0.9, -0.8);
    s.add(this.benchLamp, this.benchLamp.target);
    // the projector's own glow on the table and the floor
    this.tableLight = new THREE.PointLight(0x7fd8f0, 1.2, 4, 2);
    this.tableLight.position.set(0, 1.25, 0.5);
    s.add(this.tableLight);
  }

  _buildRoom() {
    const s = this.scene;
    const env = s.environment;
    const low = this.app.low;
    // sealed, polished concrete: the photographed surface, and a real (blurred) mirror of the room in it
    const floorMat = pbr('concrete_floor_worn_001', { repeat: 7, color: 0x8e9196, roughness: 0.42, metalness: 0, normalScale: 0.6, fallback: 0x3a3d42 });
    this.floor = glossyFloor(new THREE.PlaneGeometry(30, 30), floorMat, { renderer: this.app.renderer, low, scale: 0.5, strength: 0.85, blur: 4 });
    this.floor.rotation.x = -Math.PI / 2;
    s.add(this.floor);

    // static clutter: built into one group, then merged by material into a handful of draw calls
    const st = new THREE.Group();
    const conc = (repeat, color, o = {}) => pbr('concrete_floor_worn_001', { repeat, color, roughness: 0.95, metalness: 0, fallback: 0x2a2d31, ...o });
    const M = {
      wallBack: conc([7, 2], 0x6c7076),
      wallSide: conc([3.5, 2], 0x62666c),
      ceil: conc([7, 3.5], 0x3a3c40),
      panel: pbr('concrete_floor_worn_001', { repeat: [0.6, 1], color: 0x5c626a, roughness: 0.5, metalness: 0.3, normalScale: 0.25, fallback: 0x22272d }),
      steel: new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.32, metalness: 1, envMap: env, envMapIntensity: 0.9 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6, envMap: env, envMapIntensity: 0.6 }),
      top: pbr('metal_plate', { repeat: [2.4, 0.9], color: 0xa0a4a8, roughness: 0.8, metalness: 1, fallback: 0x55595f, envMap: env, envMapIntensity: 0.8 }),
      red: new THREE.MeshStandardMaterial({ color: 0x6a0c14, roughness: 0.42, metalness: 0.05, envMap: env, envMapIntensity: 0.6 }),
      cloth: pbr('concrete_floor_worn_001', { repeat: 3, color: 0x42464c, roughness: 1, metalness: 0, normalScale: 0.35, fallback: 0x5d626b, map: null }),
      tire: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.85 }),
      strip: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2f5ff).multiplyScalar(1.8), toneMapped: false }),
      diffuser: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2f5ff).multiplyScalar(1.4), toneMapped: false }),
      glassFrame: new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.35, metalness: 0.9, envMap: env, envMapIntensity: 0.8 }),
      joint: new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.9, metalness: 0 }),
    };
    // (the cover's weave only needs the normal detail, not the concrete's colour)
    M.cloth.map = null;
    const box = (w, hh, d, mat, x, y, z, ry = 0, cast = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
      m.position.set(x, y, z); m.rotation.y = ry;
      m.castShadow = cast && !low; m.receiveShadow = true;
      st.add(m);
      return m;
    };
    const cyl = (rt, rb, hh, mat, x, y, z, seg = 20) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, hh, seg), mat);
      m.position.set(x, y, z); m.receiveShadow = true;
      st.add(m);
      return m;
    };

    // walls and ceiling: board-formed concrete
    box(30, 8, 0.2, M.wallBack, 0, 4, -5.6);
    box(0.2, 8, 14, M.wallSide, -7.5, 4, -1);
    box(0.2, 8, 14, M.wallSide, 7.5, 4, -1);
    box(30, 0.2, 14, M.ceil, 0, 3.95, -1);
    // saw-cut control joints in the floor, every 3 m
    for (let i = -4; i <= 4; i++) {
      box(0.012, 0.004, 30, M.joint, i * 3, 0.002, 0);
      box(30, 0.004, 0.012, M.joint, 0, 0.002, i * 3);
    }
    // wall panelling with seams on the back wall
    for (let i = -6; i <= 6; i++) box(1.9, 3.2, 0.06, M.panel, i * 2, 1.7, -5.46);
    // overhead light fixtures: a diffuser panel in a dark housing (the centre one, over the projector, is off)
    for (const x of [-3, -1.5, 1.5, 3]) {
      box(0.36, 0.07, 3.6, M.dark, x, 3.8, -1.2);
      box(0.3, 0.012, 3.45, M.diffuser, x, 3.762, -1.2);
    }
    box(0.36, 0.07, 3.6, M.dark, 0, 3.8, -1.2);
    // a strip on the back wall over the tool board
    box(5.6, 0.03, 0.05, M.strip, 1.7, 3.05, -5.35);

    // tool wall behind the glass: a pegboard, wrenches, spanners and a row of drawers
    box(5.8, 1.9, 0.05, M.panel, 1.7, 1.95, -5.36);
    for (let i = 0; i < 26; i++) {
      const x = -0.9 + (i % 13) * 0.4 + rand(-0.05, 0.05), y = i < 13 ? 2.45 : 1.65;
      const l = rand(0.22, 0.46);
      const t = box(0.035, l, 0.02, i % 5 === 0 ? M.red : M.steel, x, y + rand(-0.08, 0.08), -5.31);
      t.rotation.z = rand(-0.12, 0.12);
      if (i % 3 === 0) { const hd = box(0.09, 0.05, 0.02, M.steel, x, y + l / 2 + 0.01, -5.31); hd.rotation.z = t.rotation.z; }
    }
    box(5.8, 0.9, 0.55, M.dark, 1.7, 0.45, -5.2);
    for (let i = 0; i < 6; i++) box(0.9, 0.02, 0.02, M.steel, -0.8 + i * 1, 0.62, -4.9);

    // glass partition between the lab and the tool corridor
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fc8e8, transparent: true, opacity: 0.09, roughness: 0.05, metalness: 0.9, envMap: env, envMapIntensity: 0.9, depthWrite: false });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.3), glassMat);
    glass.position.set(1.8, 1.65, -3.3);
    s.add(glass); // kept apart from the merge (transparent, drawn after)
    for (let i = 0; i <= 3; i++) box(0.06, 3.4, 0.08, M.glassFrame, -1.2 + i * 2, 1.7, -3.3);
    box(6.1, 0.08, 0.1, M.glassFrame, 1.8, 0.04, -3.3);
    box(6.1, 0.08, 0.1, M.glassFrame, 1.8, 3.33, -3.3);

    // the bench on the right, with drawers, a vise and some parts
    const bx = 2.55, bz = -0.9;
    box(2.4, 0.06, 0.9, M.top, bx, 0.87, bz, 0, true);
    box(2.44, 0.04, 0.94, M.dark, bx, 0.82, bz, 0, true);
    for (const [dx, dz] of [[-1.1, -0.38], [1.1, -0.38], [-1.1, 0.38], [1.1, 0.38]]) box(0.07, 0.82, 0.07, M.steel, bx + dx, 0.41, bz + dz);
    box(0.7, 0.55, 0.8, M.dark, bx + 0.75, 0.52, bz);
    for (let i = 0; i < 3; i++) box(0.5, 0.012, 0.02, M.steel, bx + 0.75, 0.35 + i * 0.17, bz + 0.41);
    box(0.18, 0.12, 0.14, M.steel, bx + 0.95, 0.96, bz + 0.2, 0, true);
    box(0.24, 0.05, 0.08, M.dark, bx + 0.95, 1.04, bz + 0.2);
    cyl(0.06, 0.07, 0.1, M.red, bx - 0.4, 0.95, bz + 0.25);
    cyl(0.04, 0.04, 0.16, M.steel, bx - 0.2, 0.98, bz - 0.2);
    box(0.3, 0.02, 0.22, M.panel, bx + 0.4, 0.91, bz + 0.1, 0.3);
    // a spare gauntlet plate and a helmet shell waiting for paint
    const shellG = new THREE.SphereGeometry(0.13, 20, 12, 0, TAU, 0, Math.PI * 0.6);
    const shell = new THREE.Mesh(shellG, M.red); shell.position.set(bx + 0.35, 0.9, bz - 0.25); shell.scale.set(1, 1.2, 1.1); shell.castShadow = !low; st.add(shell);

    // the car under its cover: a draped body, a cabin swell and the tyres peeking out
    const car = new THREE.Group();
    car.position.set(-3.7, 0, -1.9);
    car.rotation.y = 0.55;
    // the cover is draped: soft creases run over the body, and the hem hangs in vertical folds
    const drape = (geo, k, fold) => {
      const p = geo.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const a = Math.atan2(v.z, v.x);
        const crease = Math.sin(a * 7 + v.y * 4 + Math.sin(v.x * 3) * 1.5) * 0.5 + Math.sin(a * 13 - v.y * 6 + v.z * 2) * 0.3 + Math.sin(v.x * 11 + v.z * 7) * 0.2;
        const hang = fold ? (1 - (v.y + 0.5)) : Math.max(0, 0.3 - v.y);
        const r = 1 + crease * k * (0.35 + hang);
        p.setXYZ(i, v.x * r, v.y, v.z * r);
      }
      geo.computeVertexNormals();
      return geo;
    };
    const body = new THREE.Mesh(drape(new THREE.SphereGeometry(1, 64, 32), 0.025, false), M.cloth); body.scale.set(2.15, 0.5, 0.95); body.position.y = 0.52; body.castShadow = !low; body.receiveShadow = true; car.add(body);
    const cabin = new THREE.Mesh(drape(new THREE.SphereGeometry(1, 48, 24), 0.03, false), M.cloth); cabin.scale.set(1.05, 0.42, 0.78); cabin.position.set(-0.2, 0.86, 0); cabin.castShadow = !low; car.add(cabin);
    const skirt = new THREE.Mesh(drape(new THREE.CylinderGeometry(1, 1.05, 0.36, 96, 6, true), 0.04, true), M.cloth); skirt.scale.set(2.1, 1, 0.94); skirt.position.y = 0.3; car.add(skirt);
    const red = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 1.6), M.red); red.position.y = 0.2; car.add(red);
    for (const [x, z] of [[-1.3, 0.72], [1.3, 0.72], [-1.3, -0.72], [1.3, -0.72]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 24), M.tire);
      t.rotation.x = Math.PI / 2; t.position.set(x, 0.32, z); car.add(t);
    }
    st.add(car);

    // a rolling tool cart by the table
    const cart = new THREE.Group(); cart.position.set(-1.7, 0, 0.2); cart.rotation.y = -0.3;
    for (const y of [0.2, 0.55, 0.85]) { const sh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.45), M.red); sh.position.y = y; cart.add(sh); }
    for (const [x, z] of [[-0.33, -0.2], [0.33, -0.2], [-0.33, 0.2], [0.33, 0.2]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.85, 0.03), M.steel); p.position.set(x, 0.45, z); cart.add(p); }
    for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, rand(0.18, 0.3)), M.steel); t.position.set(-0.24 + i * 0.12, 0.88, 0); cart.add(t); }
    st.add(cart);

    s.add(st);
    mergeStatic(st);

    // contact shadows: soft dark pools where things meet the floor (ambient occlusion the lights don't give)
    const blobTex = drawTexture(128, 128, (x, w) => {
      const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.8)'); g.addColorStop(0.55, 'rgba(0,0,0,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, w);
    });
    const blobs = [[-3.7, -1.9, 4.9, 2.4, 0.55], [-1.7, 0.2, 1.05, 0.8, -0.3], [2.55, -0.9, 2.9, 1.4, 0], [0, 0, 1.9, 1.9, 0], [1.7, -5.15, 6.3, 1.0, 0]];
    const blobMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.85 }), blobs.length);
    const d = new THREE.Object3D();
    blobs.forEach(([x, z, sx, sz, r], i) => { d.position.set(x, 0.006, z); d.rotation.set(0, r, 0); d.scale.set(sx, 1, sz); d.updateMatrix(); blobMesh.setMatrixAt(i, d.matrix); });
    s.add(blobMesh);
  }

  _buildTable() {
    const s = this.scene;
    const env = s.environment;
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2e34, metalness: 1, roughness: 0.38, envMap: env, envMapIntensity: 0.8 });
    const table = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.86, 48), metal);
    base.position.y = 0.43; base.castShadow = !this.app.low; base.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.76, 0.08, 64), metal);
    top.position.y = 0.9; top.castShadow = !this.app.low; top.receiveShadow = true;
    table.add(base, top);
    s.add(table);
    this.tableMeshes = [base, top];

    // the emitter: a smoked-glass top over a fine array of projector lenses, faintly lit from inside
    const tex = drawTexture(256, 256, (x, w) => {
      const c = w / 2;
      const g = x.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(210,245,255,0.55)'); g.addColorStop(0.35, 'rgba(120,200,230,0.22)'); g.addColorStop(1, 'rgba(60,120,150,0.0)');
      x.fillStyle = g; x.beginPath(); x.arc(c, c, c, 0, TAU); x.fill();
      x.fillStyle = 'rgba(220,250,255,0.5)';
      for (let yy = -c; yy < c; yy += 7) for (let xx = -c; xx < c; xx += 7) {
        const r = Math.hypot(xx + ((yy / 7) % 2) * 3.5, yy);
        if (r < c * 0.62) { x.globalAlpha = 0.25 + 0.75 * (1 - r / (c * 0.62)); x.fillRect(c + xx + ((yy / 7) % 2) * 3.5, c + yy, 1.6, 1.6); }
      }
      x.globalAlpha = 1;
      x.strokeStyle = 'rgba(160,220,240,0.18)'; x.lineWidth = 1.5; x.beginPath(); x.arc(c, c, c * 0.64, 0, TAU); x.stroke();
    });
    this.emitterMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0x9fe6ff).multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    this.emitter = new THREE.Mesh(new THREE.CircleGeometry(0.68, 64), this.emitterMat);
    this.emitter.rotation.x = -Math.PI / 2;
    this.emitter.position.y = 0.945;
    s.add(this.emitter);
    // (a dark glass top, which the key light and the room reflect in)
    const glassTop = new THREE.Mesh(new THREE.CircleGeometry(0.76, 64), new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.08, metalness: 0.2, envMap: env, envMapIntensity: 1, transparent: true, opacity: 0.55, depthWrite: false }));
    glassTop.rotation.x = -Math.PI / 2; glassTop.position.y = 0.942;
    s.add(glassTop);
    this.rings = [];
    // the cone of light
    this.coneMat = coneMaterial(0x8fdcf2);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.64, 2.0, 48, 1, true), this.coneMat);
    cone.position.y = 0.95 + 1.0;
    s.add(cone);
    this.cone = cone;
    this.tableGlow = glowSprite(0x7fe6ff, 1.1, 0.2);
    this.tableGlow.position.set(0, 1.0, 0);
    s.add(this.tableGlow);
  }

  _buildHologram() {
    const s = this.scene;
    this.pivot = new THREE.Group();
    this.pivot.position.set(0, 0.97, 0);
    this.spin = new THREE.Group();
    this.pivot.add(this.spin);
    s.add(this.pivot);

    // the hologram: the plated model (212 separate plates, so it can be pulled apart), exactly as authored,
    // in its T-pose blueprint stance. The painted suit is the detailed classic model. One is shown at a time.
    const low = this.app.low;
    this.holo = new RealSuit('tpose', { pieces: true, uniqueMaterials: true, castShadow: false });
    if (!this.holo.ok) this.holo = new Suit({ scheme: 'classic', castShadow: false }); // silent fallback: model missing
    this.real = new RealSuit('classic', { castShadow: !low });
    if (!this.real.ok) this.real = new Suit({ scheme: 'classic', castShadow: !low });
    // where each plate sits, measured with the root at the origin before scaling (normalized frame)
    const wp = new THREE.Vector3();
    this.holo.root.updateMatrixWorld(true);
    const centres = this.holo.meshes.map((m) => (m.userData.worldCentre ? m.userData.worldCentre.clone() : m.getWorldPosition(wp).clone()));
    for (const suit of [this.holo, this.real]) {
      suit.root.scale.setScalar(SUIT_SCALE);
      suit.reactor = 1; suit.eyes = 1;
      this.spin.add(suit.root);
    }
    this.holo.setHologram(true);
    this.holoBase = this.holo._holo;
    // hologram colours pushed past the bloom threshold so the edges flare (the painted metal must not)
    this.holoBase.uniforms.uColor.value.set(0x8fdcf2).multiplyScalar(1.2);
    this.holoBase.uniforms.uOpacity.value = 0.75;
    this.real.root.visible = false;
    // highlight materials, made now so nothing compiles later
    this.goldMat = holoMaterial(new THREE.Color(0xffc25a).multiplyScalar(1.8), 1);
    this.dimMat = holoMaterial(0x8fdcf2, 0.16);

    // which system each plate belongs to, by where it sits
    const classify = (c) => {
      const ax = Math.abs(c.x), y = c.y;
      if (y > 1.66) return 'helmet';
      if (ax < 0.2 && y > 1.2 && y < 1.62) return 'reactor';
      if (ax > 0.12 && ax < 0.36 && y > 1.45) return 'shoulders';
      if (ax > 0.3 && y > 1.35) return 'repulsors';
      if (y < 0.3) return 'boots';
      return 'torso';
    };
    this.meshSystem = new Map();
    this.sysIndex = {};
    for (const sys of SYSTEMS) this.sysIndex[sys.key] = { idx: new Set(), centre: new THREE.Vector3(), radius: 0.3 };
    this.holo.meshes.forEach((m, i) => {
      const key = classify(centres[i]);
      const info = this.sysIndex[key];
      if (!info) return;
      info.idx.add(i);
      info.centre.add(centres[i]);
      this.meshSystem.set(m, key);
    });
    for (const info of Object.values(this.sysIndex)) {
      if (info.idx.size) info.centre.multiplyScalar(1 / info.idx.size);
      let spread = 0;
      for (const i of info.idx) spread = Math.max(spread, Math.hypot(centres[i].x - info.centre.x, centres[i].z - info.centre.z));
      info.centre.multiplyScalar(SUIT_SCALE);
      info.radius = clamp(spread * SUIT_SCALE + 0.1, 0.16, 0.8);
    }

    // a gold ring that frames the chosen system
    this.focusRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.008, 6, 96), this.goldMat);
    this.focusRing.rotation.x = Math.PI / 2;
    this.focusRing.scale.setScalar(0.62);
    this.focusRing.position.y = 0.02;
    this.pivot.add(this.focusRing);
    this.focusY = 0.02; this.focusR = 0.62;

    // the scan: a disc that climbs the hologram, and its bright edge
    this.scanMat = scanMaterial(new THREE.Color(0x9fe6ff).multiplyScalar(1.5));
    this.scanPlane = new THREE.Mesh(new THREE.CircleGeometry(0.72, 64), this.scanMat);
    this.scanPlane.rotation.x = -Math.PI / 2;
    this.scanPlane.visible = false;
    this.pivot.add(this.scanPlane);

    // upload the painted suit's textures now (it is hidden at first; a first upload later would hitch)
    const r = this.app.renderer;
    for (const m of this.real.meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const v of Object.values(mat)) if (v && v.isTexture) r.initTexture(v);
  }

  /** The friendly bench arm: a turret, three segments and a two-finger claw, solved with a little IK. */
  _buildArm() {
    const env = this.scene.environment;
    const white = new THREE.MeshStandardMaterial({ color: 0xd2d6da, metalness: 0.1, roughness: 0.38, envMap: env, envMapIntensity: 0.6 });
    const joint = new THREE.MeshStandardMaterial({ color: 0x24282e, metalness: 0.8, roughness: 0.4 });
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0x5fe3ff, toneMapped: false });
    this.ledBase = new THREE.Color(0x5fe3ff).multiplyScalar(2);
    this.ledHappy = new THREE.Color(0x7dff9a).multiplyScalar(4);
    const cast = !this.app.low;
    const mesh = (geo, mat, parent, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = cast; parent.add(m); return m; };

    const arm = new THREE.Group();
    arm.position.set(1.85, 0.9, -0.75);
    this.scene.add(arm);
    mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.05, 28), joint, arm, 0.025);
    this.armYaw = new THREE.Group(); this.armYaw.position.y = 0.05; arm.add(this.armYaw);
    mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.12, 24), white, this.armYaw, 0.06);
    const led = mesh(new THREE.SphereGeometry(0.014, 10, 8), this.ledMat, this.armYaw, 0.09); led.position.z = 0.085;
    this.armSh = new THREE.Group(); this.armSh.position.y = 0.13; this.armYaw.add(this.armSh);
    mesh(new THREE.SphereGeometry(0.05, 16, 12), joint, this.armSh);
    const seg1 = new THREE.BoxGeometry(0.055, ARM_L1, 0.06); seg1.translate(0, ARM_L1 / 2, 0);
    mesh(seg1, white, this.armSh);
    this.armEl = new THREE.Group(); this.armEl.position.y = ARM_L1; this.armSh.add(this.armEl);
    mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 16).rotateZ(Math.PI / 2), joint, this.armEl);
    const seg2 = new THREE.BoxGeometry(0.045, ARM_L2, 0.05); seg2.translate(0, ARM_L2 / 2, 0);
    mesh(seg2, white, this.armEl);
    this.armWr = new THREE.Group(); this.armWr.position.y = ARM_L2; this.armEl.add(this.armWr);
    mesh(new THREE.SphereGeometry(0.03, 12, 10), joint, this.armWr);
    mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.1, 16), white, this.armWr, 0.06);
    this.claws = [-1, 1].map((sx) => {
      const g = new THREE.Group(); g.position.set(sx * 0.018, 0.11, 0); this.armWr.add(g);
      const f = new THREE.BoxGeometry(0.012, 0.07, 0.022); f.translate(0, 0.035, 0);
      mesh(f, joint, g);
      g.userData.sx = sx;
      return g;
    });
    this.armMeshes = [];
    arm.traverse((o) => { if (o.isMesh) this.armMeshes.push(o); });
    arm.updateMatrixWorld(true);
    this.armShoulderW = this.armSh.getWorldPosition(new THREE.Vector3());
    this.armTarget = this.armShoulderW.clone().add(new THREE.Vector3(-0.2, 0.35, 0.2));
    this.armGoal = this.armTarget.clone();
    this.armPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(this.armShoulderW.z + 0.6));
  }

  /** Holo screens floating round the table: a trace, bars, a gauge and a schematic, drawn once each. */
  _buildPanels() {
    const titles = ['Power curve', 'Servo load', 'Thermal', 'Mk schematic'];
    const draw = (kind) => drawTexture(512, 320, (x, w, hh) => {
      const line = 'rgba(150,225,245,0.85)', faint = 'rgba(110,200,230,0.14)', gold = 'rgba(255,205,130,0.85)';
      x.strokeStyle = line; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(20, 4); x.lineTo(w - 4, 4); x.lineTo(w - 4, hh - 20); x.lineTo(w - 20, hh - 4); x.lineTo(4, hh - 4); x.lineTo(4, 20); x.closePath(); x.stroke();
      x.fillStyle = 'rgba(40,120,150,0.06)'; x.fill();
      x.fillStyle = line; x.font = '700 30px Rajdhani, sans-serif';
      x.fillText(titles[kind].toUpperCase(), 24, 44);
      x.fillStyle = gold; x.font = '600 20px Rajdhani, sans-serif';
      x.fillText(`SYS-${String(kind + 1).padStart(2, '0')} · NOMINAL`, w - 210, 44);
      x.strokeStyle = faint; x.lineWidth = 1;
      x.beginPath();
      for (let i = 0; i <= 8; i++) { x.moveTo(24 + i * 58, 66); x.lineTo(24 + i * 58, hh - 22); }
      for (let i = 0; i <= 4; i++) { x.moveTo(24, 66 + i * 56); x.lineTo(w - 24, 66 + i * 56); }
      x.stroke();
      x.lineWidth = 3;
      if (kind === 0) {
        x.strokeStyle = line; x.beginPath();
        for (let i = 0; i <= 60; i++) { const px = 24 + i * 7.7, py = 200 - Math.sin(i * 0.25) * 50 - i * 1.2 + rand(-8, 8); i ? x.lineTo(px, py) : x.moveTo(px, py); }
        x.stroke();
        x.strokeStyle = gold; x.beginPath();
        for (let i = 0; i <= 60; i++) { const px = 24 + i * 7.7, py = 250 - Math.cos(i * 0.18) * 30 + rand(-5, 5); i ? x.lineTo(px, py) : x.moveTo(px, py); }
        x.stroke();
      } else if (kind === 1) {
        x.fillStyle = line;
        for (let i = 0; i < 14; i++) { const v = rand(40, 200); x.fillRect(34 + i * 32, hh - 24 - v, 20, v); }
        x.fillStyle = gold; x.fillRect(34 + 9 * 32, hh - 24 - 216, 20, 216);
      } else if (kind === 2) {
        const cx = w / 2, cy = 190;
        x.strokeStyle = faint; x.lineWidth = 16; x.beginPath(); x.arc(cx, cy, 100, Math.PI * 0.8, Math.PI * 2.2); x.stroke();
        x.strokeStyle = line; x.beginPath(); x.arc(cx, cy, 100, Math.PI * 0.8, Math.PI * 1.75); x.stroke();
        x.lineWidth = 3; x.strokeStyle = gold; x.beginPath(); x.arc(cx, cy, 76, Math.PI * 0.8, Math.PI * 1.3); x.stroke();
        x.fillStyle = line; x.font = '900 46px Orbitron, sans-serif'; x.textAlign = 'center'; x.fillText('72°', cx, cy + 16);
      } else {
        x.strokeStyle = line; x.lineWidth = 2; x.beginPath();
        // a stick figure of the suit's joints with callout leaders
        const pts = [[256, 80], [256, 130], [256, 210], [206, 130], [180, 205], [306, 130], [332, 205], [232, 210], [228, 295], [280, 210], [284, 295]];
        [[0, 1], [1, 2], [1, 3], [3, 4], [1, 5], [5, 6], [2, 7], [7, 8], [2, 9], [9, 10]].forEach(([a, b]) => { x.moveTo(pts[a][0], pts[a][1]); x.lineTo(pts[b][0], pts[b][1]); });
        x.moveTo(306, 130); x.lineTo(400, 100); x.lineTo(480, 100);
        x.moveTo(206, 130); x.lineTo(110, 160); x.lineTo(34, 160);
        x.stroke();
        x.fillStyle = gold; for (const [px, py] of pts) x.fillRect(px - 4, py - 4, 8, 8);
      }
    });
    this.panels = [[-1.25, 1.95, 0.1], [-1.05, 1.3, -0.95], [1.2, 1.85, -0.35], [0.95, 1.25, -1.0]].map(([x, y, z], k) => {
      const mat = new THREE.MeshBasicMaterial({ map: draw(k), color: 0xa8e4f4, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.45), mat);
      m.position.set(x, y, z);
      m.lookAt(x * 0.3, y, 5);
      m.userData.y = y; m.userData.ph = k * 1.7;
      this.scene.add(m);
      return m;
    });
  }

  /* ---------------- UI ---------------- */

  _buildUI() {
    this.intro({
      kicker: 'Home lab · after midnight',
      title: 'The <em>Workshop</em>',
      jp: 'BLUEPRINT',
      desc: 'Where the suit was perfected, one late night at a time. Spin the hologram, pull the armor apart, pick a system to study, or run a full diagnostic scan.',
      extra: [
        this.gestures([['drag', '<b>Drag</b> to turn the hologram'], ['tap', '<b>Tap</b> a plate or a system'], ['tap', '<b>Tap</b> the bench arm']]),
      ],
    });

    // the systems list
    this.sysBtns = {};
    this.sysList = h('div.ws-systems.pe', { role: 'group', 'aria-label': 'Suit systems' },
      h('span.ws-label', { text: 'Systems' }),
      SYSTEMS.map((sys) => {
        const b = this.button(`<i>${sys.code}</i><span>${sys.name}</span>`, () => this._select(sys.key), 'btn-sm');
        b.setAttribute('aria-pressed', 'false');
        this.sysBtns[sys.key] = b;
        return b;
      }));
    this.ui.append(this.sysList);

    // the system card
    this.cardJp = h('span.card-jp');
    this.cardTitle = h('h3');
    this.cardText = h('p');
    this.cardSpec = h('dl.spec');
    this.card = h('div.card.ws-card.hidden.pe', { 'aria-live': 'polite' },
      h('button.close', { type: 'button', 'aria-label': 'Close', text: '×', onclick: (e) => { e.stopPropagation(); this.app.sfx.click(); this._deselect(); } }),
      this.cardJp, this.cardTitle, this.cardText, this.cardSpec);
    this.ui.append(this.card);

    // the scan readout
    this.scanRows = SCAN_LINES.map(([name]) => {
      const val = h('b', { text: '--.-%' });
      const row = h('div.ws-row', {}, h('span', { text: name }), val);
      return { row, val, shown: false };
    });
    this.scanStatus = h('div.ws-scan-status', { text: 'Scanning…' });
    this.scanBar = h('div.meter-fill');
    this.scanPanel = h('div.hud-panel.ws-scan.hidden', { 'aria-live': 'polite' },
      h('div.hud-text.ws-scan-title', { text: 'Diagnostic scan' }),
      h('div.meter-track', {}, this.scanBar),
      h('div.readout', {}, this.scanRows.map((r) => r.row)),
      this.scanStatus);
    this.ui.append(this.scanPanel);

    this.btnExplode = this.button('Explode', () => this._toggleExplode(), 'btn-primary');
    this.btnScan = this.button('Scan', () => this._scan());
    this.btnReal = this.button('Real suit', () => this._toggleReal());
    this.btnReal.setAttribute('aria-pressed', 'false');
    const zOut = this.button('−', () => this._zoom(1), 'btn-sm');
    const zIn = this.button('+', () => this._zoom(-1), 'btn-sm');
    zOut.setAttribute('aria-label', 'Zoom out');
    zIn.setAttribute('aria-label', 'Zoom in');
    this.ui.append(h('div.controls', {}, this.btnExplode, h('div.group', {}, this.btnScan, this.btnReal), h('div.group.ws-zoom', {}, zOut, zIn)));
  }

  onEnter() { this._hint(); }

  enter() {
    this.yawV = 0.3;
    if (!this._hinted) setTimeout(() => this._hint(), 900);
  }

  _hint() {
    if (!this.active || this._hinted) return;
    this._hinted = true;
    this.app.toast('<b>Drag</b> the hologram to turn it — pick a <b>system</b> to study it.', 3600);
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    if (this.scanT >= 0) this._endScan(true);
  }

  /* ---------------- actions ---------------- */

  _select(key) {
    if (this.sel === key) { this._deselect(); return; }
    const sys = SYSTEMS.find((x) => x.key === key);
    if (!sys) return;
    if (this.realMode) this._toggleReal(); // the highlight lives on the hologram
    this.sel = key;
    this.app.sfx.hologram();
    this.app.sfx.beep(SYSTEMS.indexOf(sys));
    this._applyHighlight();
    this.cardJp.textContent = sys.code;
    this.cardTitle.textContent = sys.name;
    this.cardText.textContent = sys.text;
    this.cardSpec.replaceChildren(...sys.specs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
    this.card.classList.remove('hidden');
    for (const [k, b] of Object.entries(this.sysBtns)) b.setAttribute('aria-pressed', String(k === key));
    this.targetYaw = SYS_YAW[key] ?? 0;
    this.autoTurn = true;
    const info = this.sysIndex[key];
    this.focusY = info.centre.y; this.focusR = info.radius;
    if (this.scanT < 0) this.scanPanel.classList.add('hidden');
    this.app.flash(0.08, 0xffd27a);
    // a puff of gold glints at the part
    this._v1.copy(info.centre).applyMatrix4(this.spin.matrixWorld);
    this.glints.burst(this._v1, 24, { speed: 0.8, spread: 1.5, life: [0.4, 1], size: [0.02, 0.05], color: this.goldColor });
  }

  _deselect() {
    if (!this.sel) return;
    this.sel = null;
    this._applyHighlight();
    this.card.classList.add('hidden');
    for (const b of Object.values(this.sysBtns)) b.setAttribute('aria-pressed', 'false');
    this.autoTurn = false;
    this.focusY = 0.02; this.focusR = 0.62;
    this.app.sfx.swoosh();
  }

  _applyHighlight() {
    const set = this.sel ? this.sysIndex[this.sel].idx : null;
    this.holo.meshes.forEach((m, i) => { m.material = !set ? this.holoBase : set.has(i) ? this.goldMat : this.dimMat; });
  }

  _toggleExplode() {
    if (this.realMode) this._toggleReal(); // the plates come apart on the hologram
    this.explodeTarget = this.explodeTarget > 0.5 ? 0 : 1;
    const on = this.explodeTarget > 0.5;
    this.btnExplode.textContent = on ? 'Assemble' : 'Explode';
    this.app.sfx.servo(0.5);
    setTimeout(() => this.app.sfx.clank(), on ? 120 : 520);
    this.app.flash(0.1, 0x9ff3ff);
    this._v1.set(0, 0.8, 0).applyMatrix4(this.spin.matrixWorld);
    this.glints.burst(this._v1, 40, { speed: 1.6, spread: 3, life: [0.4, 1.1], size: [0.02, 0.05], colors: this.glintColors });
  }

  _toggleReal() {
    this.realMode = !this.realMode;
    this.holo.root.visible = !this.realMode;
    this.real.root.visible = this.realMode;
    this.btnReal.setAttribute('aria-pressed', String(this.realMode));
    this.btnReal.textContent = this.realMode ? 'Hologram' : 'Real suit';
    this.app.sfx.hologram();
    if (this.realMode) this.app.sfx.clank();
    this.app.flash(0.3, this.realMode ? 0xffffff : 0x9ff3ff);
    this._v1.set(0, 0.8, 0).applyMatrix4(this.spin.matrixWorld);
    this.glints.burst(this._v1, 60, { speed: 1.2, spread: 4, up: 0.4, life: [0.5, 1.2], size: [0.02, 0.05], colors: this.glintColors });
  }

  _zoom(dir) {
    this.zoom = clamp(this.zoom + dir * 0.15, 0.55, 1.4);
    this.app.sfx.beep(dir > 0 ? 1 : 3);
  }

  _scan() {
    if (this.scanT >= 0) return;
    this.scanT = 0;
    this.card.classList.add('hidden');
    this.scanPanel.classList.remove('hidden');
    clearTimeout(this._scanHideT);
    for (const r of this.scanRows) {
      const reactor = r.row.firstChild.textContent === 'Arc reactor';
      r.value = reactor ? rand(97.2, 99.9) : Math.random() < 0.2 ? rand(84, 89.5) : rand(91, 99.6);
      r.shown = false;
      r.val.textContent = '--.-%';
      r.row.classList.remove('on', 'warn');
    }
    this.scanStatus.textContent = 'Scanning…';
    this.scanStatus.classList.remove('done');
    this._scanPct = '0%';
    this.scanBar.style.width = '0%';
    this.btnScan.disabled = true;
    this.scanPlane.visible = true;
    this.app.sfx.scan();
  }

  _endScan(silent = false) {
    this.scanT = -1;
    this.btnScan.disabled = false;
    this.scanPlane.visible = false;
    this.scanMat.uniforms.uAlpha.value = 0;
    if (silent) { this.scanPanel.classList.add('hidden'); return; }
    const warn = this.scanRows.filter((r) => r.value < 90).length;
    this.scanStatus.textContent = warn ? `Complete · ${warn} to check` : 'Complete · all nominal';
    this.scanStatus.classList.add('done');
    this.app.sfx.chime();
    this.app.flash(0.12, 0x9ff3ff);
    this._scanHideT = setTimeout(() => { if (this.scanT < 0) this.scanPanel.classList.add('hidden'); }, 5200);
  }

  _armTap() {
    this.armJoy = 1;
    const sfx = this.app.sfx;
    sfx.beep(5);
    setTimeout(() => sfx.beep(8), 110);
    setTimeout(() => sfx.beep(6), 230);
    sfx.servo(0.25);
    this._v1.set(0, 0.14, 0).applyMatrix4(this.armWr.matrixWorld);
    this.glints.burst(this._v1, 16, { speed: 0.9, spread: 0.5, up: 0.5, life: [0.3, 0.8], size: [0.015, 0.035], colors: this.glintColors });
    if (!this._armHint) { this._armHint = true; this.app.toast('<b>Beep.</b> The bench arm is always happy to help.', 2600); }
  }

  /* ---------------- input ---------------- */

  pointerDown(p) {
    this._dragAcc = 0;
    this.yawV = 0;
    this._downOnArm = this.app.raycast(this.armMeshes, false, p.ndc).length > 0;
  }

  pointerMove(p) {
    if (p.down && !this._downOnArm) {
      this._dragAcc += p.dx * 0.009;
      if (Math.abs(p.dx) > 1) this.autoTurn = false;
    } else if (!p.down) {
      const hit = this.app.raycast(this.armMeshes, false, p.ndc).length > 0;
      this._hoverArm = hit;
    }
  }

  click(p) {
    if (this.app.raycast(this.armMeshes, false, p.ndc).length) { this._armTap(); return; }
    const suit = this.realMode ? this.real : this.holo;
    const hit = this.app.raycast(suit.meshes, false, p.ndc)[0];
    if (hit) {
      const key = this.meshSystem.get(hit.object);
      if (key && key !== this.sel) this._select(key);
      else if (!key) this.app.sfx.beep(0);
    }
  }

  key(e) {
    const k = e.key.toLowerCase();
    if (k === 'e') { this._toggleExplode(); return true; }
    if (k === 's') { this._scan(); return true; }
    if (k === 'r') { this._toggleReal(); return true; }
    if (k === '+' || k === '=') { this._zoom(-1); return true; }
    if (k === '-' || k === '_') { this._zoom(1); return true; }
    if (k === 'escape' && this.sel) { this._deselect(); return true; }
    const n = Number(k);
    if (n >= 1 && n <= SYSTEMS.length) { this._select(SYSTEMS[n - 1].key); return true; }
    return false;
  }

  resize(w, hh) {
    super.resize(w, hh);
    if (this.floor?.resizeMirror) { const v = this.app.renderer.getDrawingBufferSize(new THREE.Vector2()); this.floor.resizeMirror(v.x, v.y); }
    const aspect = w / hh;
    this.fit = aspect < 1 ? clamp(0.95 / aspect * 0.62, 1, 1.75) : 1;
    // portrait: the systems row and the card sit low, so lift the scene a little
    if (aspect < 0.8) {
      this.camera.setViewOffset(w, hh, 0, hh * 0.08, w, hh);
      this.camera.updateProjectionMatrix();
    }
  }

  /* ---------------- frame ---------------- */

  _emitDust(age = 0) {
    const inCone = Math.random() < 0.55;
    const r = inCone ? rand(0, 0.85) : 0, a = rand(0, TAU);
    this.dust.emit({
      x: inCone ? Math.cos(a) * r : rand(-5, 5), y: inCone ? rand(1.0, 2.9) : rand(0.2, 3.5), z: inCone ? Math.sin(a) * r : rand(-3, 2),
      vx: rand(-0.04, 0.04), vy: inCone ? rand(0.02, 0.08) : rand(-0.02, 0.03), vz: rand(-0.04, 0.04),
      life: rand(4, 8) + age, size: rand(0.01, inCone ? 0.025 : 0.03), color: this.dustColors[inCone ? 1 : 0], alpha: inCone ? 0.35 : 0.18,
    });
  }

  _solveArm(T) {
    const B = this.armShoulderW;
    const dx = T.x - B.x, dy = T.y - B.y, dz = T.z - B.z;
    this.armYaw.rotation.y = Math.atan2(dx, dz);
    const hz = Math.hypot(dx, dz);
    const D = clamp(Math.hypot(hz, dy), 0.12, ARM_L1 + ARM_L2 - 0.01);
    const alpha = Math.atan2(hz, dy);
    const a1 = Math.acos(clamp((ARM_L1 * ARM_L1 + D * D - ARM_L2 * ARM_L2) / (2 * ARM_L1 * D), -1, 1));
    const a2 = Math.acos(clamp((ARM_L1 * ARM_L1 + ARM_L2 * ARM_L2 - D * D) / (2 * ARM_L1 * ARM_L2), -1, 1));
    this.armSh.rotation.x = alpha - a1;
    this.armEl.rotation.x = Math.PI - a2;
  }

  update(dt, t) {
    const app = this.app;
    const p = app.pointer;

    // turning: drag (with inertia), auto-turn to a chosen system, a slow idle spin otherwise
    if (p.down && !this._downOnArm) {
      this.yaw += this._dragAcc;
      this.yawV = damp(this.yawV, this._dragAcc / Math.max(dt, 1 / 120), 12, dt);
      this._dragAcc = 0;
    } else if (this.autoTurn) {
      const d = Math.atan2(Math.sin(this.targetYaw - this.yaw), Math.cos(this.targetYaw - this.yaw));
      this.yaw += d * (1 - Math.exp(-3 * dt));
      this.yawV = 0;
    } else {
      this.yawV = damp(this.yawV, this.sel ? 0 : 0.18, 1.6, dt);
      this.yaw += this.yawV * dt;
    }
    this.spin.rotation.y = this.yaw;
    this.pivot.position.y = 0.97 + Math.sin(t * 1.1) * 0.015;

    // explode / assemble, eased
    const prevE = this.explodeShown;
    this.explodeShown = damp(this.explodeShown, this.explodeTarget, 3.2, dt);
    if (Math.abs(this.explodeShown - prevE) > 1e-4) this.holo.explode(this.explodeShown);

    this.holo.update(dt);
    this.real.update(dt);

    // the focus ring glides to the chosen system
    const fr = this.focusRing;
    fr.position.y = damp(fr.position.y, this.focusY, 5, dt);
    const rs = damp(fr.scale.x, this.focusR, 5, dt);
    fr.scale.setScalar(rs);
    fr.rotation.z = t * 0.6;
    fr.visible = !!this.sel; // (a marker for the chosen system only: no idle decorative ring)
    this.goldMat.uniforms.uOpacity.value = 0.85 + Math.sin(t * 4) * 0.15;

    // projector: rings turn, the cone breathes; brighter while scanning, softer with the real suit
    this.realShown = damp(this.realShown, this.realMode ? 1 : 0, 4, dt);
    for (const r of this.rings) r.rotation.z += r.userData.sp * dt;
    this.coneMat.uniforms.uAlpha.value = (0.11 + Math.sin(t * 2.2) * 0.01 + this.scanShown * 0.07) * (1 - this.realShown * 0.6);
    this.tableLight.intensity = 1.1 + Math.sin(t * 2.2) * 0.1 + this.scanShown * 1.2 - this.realShown * 0.6;
    this.tableGlow.material.opacity = 0.16 + this.scanShown * 0.12;
    for (const m of this.panels) {
      m.position.y = m.userData.y + Math.sin(t * 0.8 + m.userData.ph) * 0.006;
      // projected light: a faint shimmer, and now and then a brief dropout
      const drop = Math.sin(t * 0.9 + m.userData.ph * 3.1) > 0.995 ? 0.4 : 1;
      m.material.opacity = (0.36 + Math.sin(t * 3 + m.userData.ph) * 0.03 + Math.sin(t * 47 + m.userData.ph) * 0.015) * drop - this.realShown * 0.18;
    }

    // the scan
    this.scanShown = damp(this.scanShown, this.scanT >= 0 ? 1 : 0, 5, dt);
    if (this.scanT >= 0) {
      this.scanT = Math.min(1, this.scanT + dt / 2.8);
      const y = this.scanT * SCAN_TOP;
      this.scanPlane.position.y = y;
      const edge = Math.min(1, this.scanT * 8, (1 - this.scanT) * 8);
      this.scanMat.uniforms.uAlpha.value = edge;
      this.scanPlane.scale.setScalar(0.85 + Math.sin(this.scanT * Math.PI) * 0.2);
      const pct = `${Math.round(this.scanT * 100)}%`;
      if (pct !== this._scanPct) { this._scanPct = pct; this.scanBar.style.width = pct; }
      this.scanRows.forEach((r, i) => {
        if (r.shown || y < SCAN_LINES[i][1]) return;
        r.shown = true;
        r.val.textContent = `${r.value.toFixed(1)}%`;
        r.row.classList.add('on');
        if (r.value < 90) r.row.classList.add('warn');
        app.sfx.beep(i);
      });
      if (Math.random() < dt * 40) {
        const a = rand(0, TAU), rr = 0.62 * this.scanPlane.scale.x;
        this._v1.set(Math.cos(a) * rr, y, Math.sin(a) * rr).applyMatrix4(this.pivot.matrixWorld);
        this.glints.emit({ x: this._v1.x, y: this._v1.y, z: this._v1.z, vx: Math.cos(a) * 0.2, vy: rand(0.05, 0.2), vz: Math.sin(a) * 0.2, life: rand(0.4, 0.9), size: rand(0.015, 0.035), color: this.glintColors[0] });
      }
      if (this.scanT >= 1) this._endScan();
    }

    // the bench arm: follows the pointer loosely; a happy wiggle when tapped
    if (pointerOnPlane(p.ndc, this.camera, this.armPlane, this._v2)) {
      const d = this._v2.sub(this.armShoulderW);
      d.y = d.y * 0.6 + 0.25;
      const len = d.length();
      if (len > 1e-3) d.multiplyScalar(clamp(len, 0.3, 0.52) / len);
      this.armGoal.copy(this.armShoulderW).add(d);
    }
    this.armJoy = Math.max(0, this.armJoy - dt * 0.8);
    const joy = this.armJoy;
    this._v3.copy(this.armGoal);
    this._v3.y += Math.sin(t * 1.3) * 0.02 + joy * Math.abs(Math.sin(t * 14)) * 0.08;
    this.armTarget.lerp(this._v3, 1 - Math.exp(-2.5 * dt));
    this._solveArm(this.armTarget);
    this.armWr.rotation.x = 0.5 + Math.sin(t * 0.9) * 0.1 + joy * Math.sin(t * 22) * 0.45;
    this.armWr.rotation.y = joy * Math.sin(t * 9) * 0.6;
    const open = joy > 0 ? 0.15 + 0.35 * Math.abs(Math.sin(t * 18)) : 0.18 + Math.sin(t * 0.7) * 0.05;
    for (const c of this.claws) c.rotation.z = c.userData.sx * open;
    this.ledMat.color.copy(this.ledBase).lerp(this.ledHappy, joy).multiplyScalar(1.4 + Math.sin(t * 5) * 0.4);

    // dust
    if (Math.random() < dt * 24) this._emitDust();
    this.dust.update(dt, t);
    this.glints.update(dt, t);

    // camera: orbit-free framing with zoom, lean toward the chosen system, gentle parallax
    const g = app.gyro;
    const px = g ? g.x : p.ndc.x, py = g ? g.y : p.ndc.y;
    const selZoom = this.sel ? 0.78 : 1;
    this.zoomShown = damp(this.zoomShown, this.zoom * selZoom, 4, dt);
    const lookY = this.sel ? 0.97 + this.focusY : 1.62;
    this.look.y = damp(this.look.y, lookY, 3, dt);
    const dist = 4.9 * this.zoomShown * this.fit;
    const cam = this.camera;
    cam.position.x = damp(cam.position.x, px * 0.45, 2, dt);
    cam.position.y = damp(cam.position.y, this.look.y + 0.3 + py * 0.2, 2, dt);
    cam.position.z = damp(cam.position.z, dist, 3, dt);
    cam.lookAt(this.look);

    app.setHover(!p.down && !!this._hoverArm);
  }
}
