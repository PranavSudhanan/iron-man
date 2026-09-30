import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared, NOISE_GLSL, clamp, easeOutCubic } from '../core/utils.js';

/*
 * A powered armor suit, built entirely from code (an original design in the classic red-and-gold style).
 * About 1.9 units tall, feet on y = 0, facing +z; its left is +x.
 *
 *   const suit = new Suit({ scheme: 'classic' });
 *   scene.add(suit.root);
 *   suit.pose('hover');            // or suit.pose({ shoulderR: [-1.4, 0, 0], ... }, 0.3) to blend towards one
 *   suit.update(dt);               // every frame: eases the joints toward the pose, animates the glows and flames
 *   suit.reactor = 1; suit.eyes = 1; suit.thrust = 0.6; suit.palm.r = 1; suit.faceOpen = 0;
 *
 * Joints (all THREE.Group, rotations in radians): hips, spine, neck, head, shoulderL/R, elbowL/R, wristL/R,
 * hipL/R, kneeL/R, ankleL/R. The whole body moves with suit.root.
 * Extras: suit.setHologram(on), suit.explode(t 0..1), suit.pieces + suit.assemble(t) for a suit-up.
 */

/* ---------------- lighting environment for the metal ---------------- */

let _env = null;
/**
 * The default light for the armor and every scene without its own (call once at start-up): a real
 * photographed studio when given (see core/Env.js), otherwise a generated room.
 */
export function setSuitEnvironment(renderer, tex = null) {
  if (_env || !renderer) return;
  if (tex) { _env = tex; return; }
  const pm = new THREE.PMREMGenerator(renderer);
  _env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
}
export function suitEnvironment() { return _env; }

/* ---------------- colour schemes (the "Marks") ---------------- */

export const SCHEMES = {
  classic: { primary: 0x9c0f1c, secondary: 0xc08a2c, metal: 0x2b2f36, reactor: 0x9ff3ff, eyes: 0xdff9ff, shape: 'round' },
  mk1: { primary: 0x5b5d61, secondary: 0x45474a, metal: 0x2a2a2a, reactor: 0x8fe8ff, eyes: 0xbfe9ff, shape: 'round', rough: true, bulk: 1.12 },
  mk2: { primary: 0xb4bcc6, secondary: 0x8d96a1, metal: 0x3a3f46, reactor: 0x9ff3ff, eyes: 0xdff9ff, shape: 'round', chrome: true },
  mk3: { primary: 0x980e1b, secondary: 0xc4902f, metal: 0x2b2f36, reactor: 0x9ff3ff, eyes: 0xdff9ff, shape: 'round' },
  mk5: { primary: 0xa5101e, secondary: 0xbcc3cc, metal: 0x30343a, reactor: 0x9ff3ff, eyes: 0xdff9ff, shape: 'round', slim: true },
  mk6: { primary: 0xa0101e, secondary: 0xc08a2c, metal: 0x2b2f36, reactor: 0xa8f4ff, eyes: 0xdff9ff, shape: 'triangle' },
  mk7: { primary: 0xa6111e, secondary: 0xc9942f, metal: 0x2b2f36, reactor: 0xa8f4ff, eyes: 0xdff9ff, shape: 'round', bulk: 1.05 },
  stealth: { primary: 0x1a1d22, secondary: 0x2c3138, metal: 0x111317, reactor: 0x7fd8ff, eyes: 0x9fe6ff, shape: 'round' },
  patriot: { primary: 0x1c3d8a, secondary: 0xb5122a, metal: 0x3a3f46, reactor: 0xffffff, eyes: 0xffffff, shape: 'star' },
  silver: { primary: 0xc4ccd6, secondary: 0x2a2f38, metal: 0x2a2f36, reactor: 0x9ff3ff, eyes: 0xdff9ff, shape: 'round', chrome: true, bulk: 1.02 },
  heavy: { primary: 0x9c0f1c, secondary: 0xbd872a, metal: 0x2a2e33, reactor: 0x9ff3ff, eyes: 0xdff9ff, shape: 'round', bulk: 1.55 },
  nano: { primary: 0x8a0b18, secondary: 0xb88a2e, metal: 0x1f2227, reactor: 0xa8f4ff, eyes: 0xdff9ff, shape: 'hex', slim: true },
};

function paint(color, { rough = false, chrome = false } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: chrome ? 1 : rough ? 0.55 : 0.85,
    roughness: chrome ? 0.16 : rough ? 0.62 : 0.3,
    clearcoat: rough ? 0 : 0.7,
    clearcoatRoughness: 0.18,
    envMap: _env,
    envMapIntensity: rough ? 0.25 : chrome ? 0.55 : 0.4,
  });
}

/** A glowing hologram look (fresnel edges, scan lines), additive. */
export function holoMaterial(color = 0x5fe3ff, opacity = 0.9) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.2);
        float scan = 0.55 + 0.45 * sin(vW.y * 90.0 - uTime * 6.0);
        float band = smoothstep(0.0, 0.08, fract(vW.y * 0.6 - uTime * 0.35)) * 0.3;
        float a = (0.08 + f * 0.9) * (0.7 + scan * 0.3) + band * f;
        gl_FragColor = vec4(uColor * (0.6 + f * 1.6), a * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** A thruster flame: a cone of flickering light, hot white at the nozzle, blue-orange at the tip. Scale y = length. */
export function thrusterFlame(color = 0x8fd8ff) {
  const geo = new THREE.ConeGeometry(0.075, 1, 16, 8, true);
  geo.translate(0, -0.5, 0); // the nozzle at the origin, the flame down -y
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(color) }, uPower: { value: 0 }, uSeed: { value: Math.random() * 10 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime; uniform vec3 uColor; uniform float uPower; uniform float uSeed;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float along = 1.0 - vUv.y; // 0 at the nozzle, 1 at the tip
        float n = snoise(vec3(vUv.x * 6.0, along * 5.0 - uTime * 14.0, uSeed)) * 0.5 + 0.5;
        float body = pow(abs(dot(normalize(vN), vV)), 1.4);
        float fade = pow(1.0 - along, 1.6) * (0.65 + n * 0.5);
        vec3 hot = mix(vec3(1.0), uColor, smoothstep(0.0, 0.35, along));
        hot = mix(hot, vec3(1.0, 0.55, 0.2), smoothstep(0.45, 1.0, along) * 0.5);
        gl_FragColor = vec4(hot * (1.4 + n), fade * body * uPower);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.userData.power = mat.uniforms.uPower;
  return m;
}

/* ---------------- poses ---------------- */

const J = ['hips', 'spine', 'neck', 'head', 'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR'];

export const POSES = {
  stand: { shoulderL: [0, 0, 0.14], shoulderR: [0, 0, -0.14], elbowL: [-0.18, 0, 0], elbowR: [-0.18, 0, 0], hipL: [0, 0, 0.03], hipR: [0, 0, -0.03] },
  ready: { spine: [0.06, 0, 0], shoulderL: [-0.2, 0, 0.3], shoulderR: [-0.2, 0, -0.3], elbowL: [-0.9, 0, 0], elbowR: [-0.9, 0, 0], wristL: [0.3, 0, 0], wristR: [0.3, 0, 0], hipL: [-0.2, 0, 0.1], hipR: [0.1, 0, -0.1], kneeL: [0.3, 0, 0], kneeR: [0.15, 0, 0] },
  hover: { spine: [0.05, 0, 0], shoulderL: [0.25, 0, 0.5], shoulderR: [0.25, 0, -0.5], elbowL: [-0.25, 0, 0], elbowR: [-0.25, 0, 0], wristL: [1.3, 0, 0], wristR: [1.3, 0, 0], hipL: [-0.08, 0, 0.06], hipR: [0.05, 0, -0.06], kneeL: [0.25, 0, 0], kneeR: [0.12, 0, 0], ankleL: [0.45, 0, 0], ankleR: [0.4, 0, 0] },
  // body tilted by the chapter (root.rotation.x ≈ 1.3) for level flight: arms back along the body
  fly: { neck: [-0.9, 0, 0], shoulderL: [0.35, 0, 0.18], shoulderR: [0.35, 0, -0.18], elbowL: [0, 0, 0], elbowR: [0, 0, 0], wristL: [1.2, 0, 0], wristR: [1.2, 0, 0], hipL: [0.05, 0, 0.04], hipR: [0.05, 0, -0.04], kneeL: [0.1, 0, 0], kneeR: [0.2, 0, 0], ankleL: [0.8, 0, 0], ankleR: [0.8, 0, 0] },
  blastR: { spine: [0, -0.25, 0], neck: [0, 0.2, 0], shoulderR: [-1.5, 0, 0.05], elbowR: [0, 0, 0], wristR: [1.35, 0, 0], shoulderL: [0.1, 0, 0.35], elbowL: [-0.5, 0, 0], hipL: [-0.15, 0, 0.1], hipR: [0.1, 0, -0.08], kneeL: [0.2, 0, 0] },
  blastL: { spine: [0, 0.25, 0], neck: [0, -0.2, 0], shoulderL: [-1.5, 0, -0.05], elbowL: [0, 0, 0], wristL: [1.35, 0, 0], shoulderR: [0.1, 0, -0.35], elbowR: [-0.5, 0, 0], hipR: [-0.15, 0, -0.1], hipL: [0.1, 0, 0.08], kneeR: [0.2, 0, 0] },
  blastBoth: { spine: [-0.05, 0, 0], shoulderL: [-1.5, 0.15, -0.1], shoulderR: [-1.5, -0.15, 0.1], wristL: [1.35, 0, 0], wristR: [1.35, 0, 0], hipL: [-0.2, 0, 0.1], hipR: [0.15, 0, -0.1], kneeL: [0.25, 0, 0] },
  unibeam: { spine: [-0.18, 0, 0], neck: [0.12, 0, 0], shoulderL: [0.5, 0, 0.55], shoulderR: [0.5, 0, -0.55], elbowL: [-0.4, 0, 0], elbowR: [-0.4, 0, 0], wristL: [0.6, 0, 0], wristR: [0.6, 0, 0], hipL: [-0.25, 0, 0.12], hipR: [0.2, 0, -0.12], kneeL: [0.3, 0, 0], kneeR: [0.1, 0, 0] },
  // the three-point landing: one knee down, one fist on the ground
  land: { hips: [0.45, 0, 0], spine: [0.5, 0, 0], neck: [-0.7, 0, 0], shoulderR: [-0.55, 0, -0.1], elbowR: [-0.1, 0, 0], shoulderL: [0.6, 0, 0.7], elbowL: [-0.6, 0, 0], hipL: [-1.6, 0, 0.12], kneeL: [2.2, 0, 0], ankleL: [-0.6, 0, 0], hipR: [-0.35, 0, -0.1], kneeR: [2.35, 0, 0], ankleR: [0.6, 0, 0] },
  crossed: { shoulderL: [-0.55, 0.5, 0.2], shoulderR: [-0.5, -0.5, -0.2], elbowL: [-1.9, 0, 0], elbowR: [-1.85, 0, 0], hipL: [0, 0, 0.08], hipR: [0, 0, -0.08] },
  tpose: { shoulderL: [0, 0, 1.5], shoulderR: [0, 0, -1.5], elbowL: [0, 0, 0], elbowR: [0, 0, 0], hipL: [0, 0, 0.05], hipR: [0, 0, -0.05] },
  fist: { spine: [0.05, 0, 0], shoulderR: [-1.2, 0, -0.2], elbowR: [-1.5, 0, 0], wristR: [0, 0, 0], shoulderL: [0.1, 0, 0.2], elbowL: [-0.3, 0, 0] },
};

/* ---------------- the suit ---------------- */

export class Suit {
  constructor({ scheme = 'classic', castShadow = true, low = false } = {}) {
    this.scheme = typeof scheme === 'string' ? SCHEMES[scheme] || SCHEMES.classic : scheme;
    const S = this.scheme;
    const bulk = S.bulk || 1, slim = S.slim ? 0.92 : 1;
    this.low = low;
    this.root = new THREE.Group();
    this.root.name = 'suit';
    this.meshes = [];
    this.pieces = []; // { mesh, base, from, spin, order } for suit-up
    this.j = {};
    this.reactor = 1; this.eyes = 1; this.thrust = 0; this.faceOpen = 0;
    this.palm = { l: 0, r: 0 };
    this.palmThrust = 0;
    this._target = {};
    this._shown = { reactor: 0, eyes: 0, thrust: 0, face: 0, palmL: 0, palmR: 0, palmThrust: 0 };

    const M = this.mat = {
      primary: paint(S.primary, S),
      secondary: paint(S.secondary, S),
      metal: new THREE.MeshStandardMaterial({ color: S.metal, metalness: 0.8, roughness: 0.45, envMap: _env, envMapIntensity: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0b0d10, metalness: 0.5, roughness: 0.6 }),
      glow: new THREE.MeshBasicMaterial({ color: S.reactor, toneMapped: false }),
      eye: new THREE.MeshBasicMaterial({ color: S.eyes, toneMapped: false }),
      palmGlow: new THREE.MeshBasicMaterial({ color: S.reactor, toneMapped: false }),
      ring: new THREE.MeshStandardMaterial({ color: 0x9aa6b2, metalness: 1, roughness: 0.25, envMap: _env, envMapIntensity: 0.5 }),
    };
    this._baseColors = { glow: M.glow.color.clone(), eye: M.eye.color.clone(), palm: M.palmGlow.color.clone() };

    const add = (parent, geo, mat, [x, y, z] = [0, 0, 0], { rot, scale, piece = true, order = 0, from } = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      if (scale) m.scale.set(scale[0], scale[1], scale[2]);
      m.castShadow = castShadow;
      m.receiveShadow = true;
      parent.add(m);
      this.meshes.push(m);
      if (piece) this.pieces.push({ mesh: m, base: m.position.clone(), baseRot: m.rotation.clone(), order, from });
      return m;
    };
    const joint = (name, parent, [x, y, z]) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      this.j[name] = g;
      return g;
    };
    const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
    const B = (v) => v * bulk;
    const W = (v) => v * bulk * slim; // widths
    /**
     * A smooth shell turned from a profile of [radius, y] points (top to bottom), squashed to an oval
     * (sx across, sz front to back). phiStart/phiLength limit it to an arc (0 faces +z) for plates.
     */
    const shell = (profile, sx = 1, sz = 1, { seg = 32, phiStart = 0, phiLength = Math.PI * 2 } = {}) => {
      const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)).reverse();
      const g = new THREE.LatheGeometry(pts, seg, phiStart, phiLength);
      g.scale(sx, 1, sz);
      g.computeVertexNormals();
      return g;
    };
    /** A thin dark seam ring around a shell (panel lines). */
    const seam = (r, sx, sz) => { const g = new THREE.TorusGeometry(r, 0.0035, 4, 40); g.rotateX(Math.PI / 2); g.scale(sx, 1, sz); return g; };

    /* ---- hips & torso ---- */
    const hips = joint('hips', this.root, [0, 0.98, 0]);
    // pelvis: a rounded belt, gold codpiece
    add(hips, shell([[0.13, 0.08], [0.165, 0.05], [0.17, -0.02], [0.15, -0.08], [0.09, -0.11]], W(1.18), B(0.82)), M.primary, [0, 0, 0], { order: 3 });
    add(hips, seam(0.168, W(1.18), B(0.82)), M.dark, [0, 0.035, 0], { piece: false });
    add(hips, shell([[0.075, 0.03], [0.07, -0.05], [0.03, -0.1]], 1.25, 0.6, { phiStart: -0.9, phiLength: 1.8 }), M.secondary, [0, -0.01, B(0.06)], { order: 3 });
    const spine = joint('spine', hips, [0, 0.07, 0]);
    // abdomen: a gold core with red side plates and dark seams between the segments
    add(spine, shell([[0.145, 0.24], [0.14, 0.16], [0.135, 0.08], [0.14, 0.0]], W(1.2), B(0.78)), M.secondary, [0, 0, 0], { order: 4 });
    for (const y of [0.06, 0.12, 0.18]) add(spine, seam(0.141, W(1.2), B(0.78)), M.dark, [0, y, 0], { piece: false });
    for (const sx of [-1, 1]) add(spine, shell([[0.15, 0.24], [0.145, 0.1], [0.14, 0.0]], W(1.22), B(0.8), { phiStart: sx > 0 ? 0.9 : Math.PI * 2 - 2.2, phiLength: 1.3, seg: 12 }), M.primary, [0, 0, 0], { order: 4 });
    // the chest: broad at the pecs, narrowing to the waist (the V of the classic armor)
    const chestProfile = [[0.07, 0.62], [0.15, 0.6], [0.215, 0.55], [0.245, 0.47], [0.245, 0.38], [0.225, 0.3], [0.185, 0.24], [0.15, 0.2]];
    add(spine, shell(chestProfile, W(1.25), B(0.74), { seg: 48 }), M.primary, [0, 0, 0], { order: 5 });
    // pectoral plates, slightly raised, split down the middle; gold trim along the ribs
    for (const sx of [-1, 1]) {
      const pec = shell([[0.2, 0.56], [0.235, 0.49], [0.236, 0.41], [0.215, 0.35]], W(1.28), B(0.8), { phiStart: sx > 0 ? 0.08 : Math.PI * 2 - 1.18, phiLength: 1.1, seg: 18 });
      add(spine, pec, M.primary, [0, 0, 0.004], { order: 5 });
      add(spine, shell([[0.195, 0.33], [0.19, 0.27], [0.165, 0.22]], W(1.29), B(0.8), { phiStart: sx > 0 ? 0.5 : Math.PI * 2 - 1.4, phiLength: 0.9, seg: 12 }), M.secondary, [0, 0, 0.003], { order: 5 });
    }
    add(spine, seam(0.244, W(1.25), B(0.74)), M.dark, [0, 0.4, 0], { piece: false });
    add(spine, shell([[0.1, 0.66], [0.155, 0.62], [0.16, 0.6]], W(1.2), B(0.85)), M.metal, [0, 0, 0], { order: 6 }); // collar
    // the back: a raised spine plate and the two flight flaps
    add(spine, rbox(W(0.2), 0.3, 0.05, 0.02), M.primary, [0, 0.42, -B(0.17)], { rot: [0.08, 0, 0], order: 5 });
    for (const sx of [-1, 1]) add(spine, rbox(0.11, 0.2, 0.025, 0.01), M.metal, [sx * 0.1, 0.44, -B(0.19)], { rot: [0.3, 0, sx * 0.18], order: 5 });

    /* ---- the arc reactor ---- */
    const reactorG = new THREE.Group();
    reactorG.position.set(0, 0.43, B(0.245 * 0.74) + 0.004);
    spine.add(reactorG);
    this.reactorGroup = reactorG;
    add(reactorG, new THREE.CylinderGeometry(0.068, 0.07, 0.02, 32).rotateX(Math.PI / 2), M.dark, [0, 0, -0.006], { piece: false }); // the housing
    const shape = S.shape || 'round';
    if (shape === 'triangle') {
      const tri = new THREE.CylinderGeometry(0.075, 0.075, 0.02, 3, 1);
      tri.rotateX(Math.PI / 2); tri.rotateZ(Math.PI / 2 * 3);
      add(reactorG, tri, M.ring, [0, 0, 0.002], { order: 6 });
      const core = new THREE.CylinderGeometry(0.056, 0.056, 0.022, 3, 1); core.rotateX(Math.PI / 2); core.rotateZ(Math.PI / 2 * 3);
      this.reactorCore = add(reactorG, core, M.glow, [0, 0, 0.006], { order: 6 });
    } else if (shape === 'star' || shape === 'hex') {
      const n = shape === 'star' ? 5 : 6;
      const ring = new THREE.CylinderGeometry(0.07, 0.07, 0.02, n, 1); ring.rotateX(Math.PI / 2);
      add(reactorG, ring, M.ring, [0, 0, 0.002], { order: 6 });
      const core = new THREE.CylinderGeometry(0.052, 0.052, 0.022, n, 1); core.rotateX(Math.PI / 2);
      this.reactorCore = add(reactorG, core, M.glow, [0, 0, 0.006], { order: 6 });
    } else {
      add(reactorG, new THREE.TorusGeometry(0.056, 0.012, 10, 36), M.ring, [0, 0, 0.004], { order: 6 });
      const core = new THREE.CylinderGeometry(0.046, 0.046, 0.02, 32); core.rotateX(Math.PI / 2);
      this.reactorCore = add(reactorG, core, M.glow, [0, 0, 0.002], { order: 6 });
      // the coil segments round the core
      const coil = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const b = new THREE.BoxGeometry(0.011, 0.02, 0.01); b.rotateZ(a); b.translate(Math.cos(a) * 0.036, Math.sin(a) * 0.036, 0.014);
        coil.push(b);
      }
      add(reactorG, mergeGeometries(coil), M.dark, [0, 0, 0], { piece: false });
    }
    // the reactor's light on whatever it faces (held well out from the plate: a light right against a
    // surface would burn it white)
    this.reactorLight = new THREE.PointLight(S.reactor, 0, 3, 2);
    this.reactorLight.position.set(0, 0, 0.55);
    reactorG.add(this.reactorLight);

    /* ---- head ---- */
    const neck = joint('neck', spine, [0, 0.64, -0.01]);
    add(neck, new THREE.CylinderGeometry(0.055, 0.07, 0.1, 18), M.metal, [0, 0.03, 0], { order: 7 });
    const head = joint('head', neck, [0, 0.08, 0]);
    // the helmet: an egg, a little longer front to back
    const helmProfile = [[0.0, 0.29], [0.07, 0.28], [0.108, 0.245], [0.122, 0.19], [0.122, 0.12], [0.114, 0.06], [0.1, 0.02], [0.07, -0.005]];
    add(head, shell(helmProfile, 1, 1.12, { seg: 40 }), M.primary, [0, 0, 0], { order: 8 });
    add(head, seam(0.121, 1, 1.12), M.dark, [0, 0.15, 0], { piece: false });
    // the faceplate: the front of a slightly larger egg, with a squared jaw; hinged at the brow
    const facePivot = new THREE.Group();
    facePivot.position.set(0, 0.235, 0.05);
    head.add(facePivot);
    this.facePivot = facePivot;
    const faceProfile = [[0.1, 0.235], [0.118, 0.2], [0.126, 0.14], [0.124, 0.09], [0.112, 0.045], [0.088, 0.01], [0.055, -0.01]];
    add(facePivot, shell(faceProfile, 1.02, 1.16, { seg: 28, phiStart: -1.05, phiLength: 2.1 }), M.secondary, [0, -0.235, -0.05], { order: 9 });
    // brow line, cheek lines, mouth slit
    add(facePivot, new THREE.BoxGeometry(0.1, 0.006, 0.01), M.dark, [0, -0.07, 0.093], { piece: false });
    add(facePivot, new THREE.BoxGeometry(0.05, 0.005, 0.01), M.dark, [0, -0.2, 0.088], { piece: false });
    for (const sx of [-1, 1]) add(facePivot, new THREE.BoxGeometry(0.004, 0.06, 0.008), M.dark, [sx * 0.05, -0.17, 0.086], { rot: [0.2, sx * 0.5, sx * -0.35], piece: false });
    // the eyes: narrow angled slits of light
    this.eyeMeshes = [];
    for (const sx of [-1, 1]) {
      const e = add(facePivot, new THREE.BoxGeometry(0.046, 0.011, 0.012), M.eye, [sx * 0.04, -0.09, 0.092], { rot: [0, sx * 0.4, sx * -0.14], piece: false });
      this.eyeMeshes.push(e);
    }
    // ear pieces
    for (const sx of [-1, 1]) add(head, new THREE.CylinderGeometry(0.038, 0.04, 0.02, 24).rotateZ(Math.PI / 2), M.secondary, [sx * 0.119, 0.13, -0.01], { piece: false });

    /* ---- arms ---- */
    const armSide = (side, sx) => {
      const sh = joint(`shoulder${side}`, spine, [sx * W(0.265), 0.53, -0.01]);
      add(sh, new THREE.SphereGeometry(B(0.068), 20, 14), M.metal, [0, 0, 0], { order: 10 });
      // the pauldron: a rounded cap over the joint, a second layer beneath
      const paul = shell([[0.0, 0.1], [0.07, 0.085], [0.1, 0.03], [0.105, -0.03], [0.095, -0.07]], B(1.05), B(1.0));
      add(sh, paul, M.primary, [sx * 0.012, 0.0, 0], { rot: [0, 0, sx * -0.25], order: 11 });
      add(sh, shell([[0.1, -0.05], [0.098, -0.1], [0.085, -0.12]], B(1.0), B(0.95)), M.primary, [sx * 0.012, 0, 0], { rot: [0, 0, sx * -0.2], order: 11 });
      // the upper arm: gold, with a bicep swell
      add(sh, shell([[0.058, -0.04], [0.066, -0.1], [0.064, -0.18], [0.055, -0.26], [0.05, -0.29]], B(1.05), B(1.0)), M.secondary, [0, 0, 0], { order: 12 });
      const el = joint(`elbow${side}`, sh, [0, -0.3, 0]);
      add(el, new THREE.SphereGeometry(B(0.047), 16, 12), M.metal, [0, 0, 0], { order: 13 });
      // the forearm: red, thick at the top, tapering to the wrist, a gold cuff
      add(el, shell([[0.05, 0.0], [0.062, -0.06], [0.06, -0.14], [0.05, -0.23], [0.045, -0.26]], B(1.1), B(1.0)), M.primary, [0, 0, 0], { order: 13 });
      add(el, seam(0.058, B(1.1), B(1.0)), M.dark, [0, -0.1, 0], { piece: false });
      add(el, shell([[0.05, -0.2], [0.051, -0.245], [0.047, -0.265]], B(1.12), B(1.02)), M.secondary, [0, 0, 0], { order: 13 });
      const wr = joint(`wrist${side}`, el, [0, -0.275, 0]);
      // the hand: palm, thumb, four jointed fingers; the repulsor in the palm (+z)
      add(wr, rbox(0.078, 0.088, 0.036, 0.014), M.primary, [0, -0.048, 0], { order: 14 });
      const fingers = [], tips = [];
      for (let f = 0; f < 4; f++) {
        const fx = (f - 1.5) * 0.019;
        const a = rbox(0.016, 0.042, 0.02, 0.006); a.rotateX(-0.25); a.translate(fx, -0.11, 0.006); fingers.push(a);
        const b = rbox(0.015, 0.034, 0.018, 0.006); b.rotateX(-0.6); b.translate(fx, -0.143, 0.018); tips.push(b);
      }
      add(wr, mergeGeometries(fingers), M.metal, [0, 0, 0], { order: 14 });
      add(wr, mergeGeometries(tips), M.primary, [0, 0, 0], { order: 14 });
      add(wr, rbox(0.018, 0.045, 0.02, 0.006), M.primary, [sx * -0.045, -0.06, 0.014], { rot: [0.3, 0, sx * 0.5], order: 14 });
      const palmDisc = new THREE.CylinderGeometry(0.017, 0.017, 0.006, 20); palmDisc.rotateX(Math.PI / 2);
      const pd = add(wr, palmDisc, M.palmGlow, [0, -0.05, 0.02], { piece: false });
      const pl = new THREE.PointLight(S.reactor, 0, 1.6, 2);
      pl.position.set(0, -0.05, 0.4);
      wr.add(pl);
      const flame = thrusterFlame(S.reactor);
      flame.rotation.x = -Math.PI / 2; // out of the palm, along +z
      flame.position.set(0, -0.05, 0.025);
      flame.scale.set(0.8, 0.001, 0.8);
      wr.add(flame);
      return { disc: pd, light: pl, flame };
    };
    this.hands = { l: armSide('L', 1), r: armSide('R', -1) };

    /* ---- legs ---- */
    const legSide = (side, sx) => {
      const hp = joint(`hip${side}`, hips, [sx * W(0.098), -0.06, 0]);
      add(hp, new THREE.SphereGeometry(B(0.075), 18, 12), M.metal, [0, 0, 0], { order: 1 });
      // the thigh: full at the top, tapering to the knee; a gold plate on the outside
      add(hp, shell([[0.088, 0.02], [0.098, -0.06], [0.094, -0.2], [0.08, -0.34], [0.066, -0.44]], B(1.05), B(1.0)), M.primary, [0, 0, 0], { order: 1 });
      add(hp, shell([[0.1, -0.08], [0.097, -0.2], [0.085, -0.32]], B(1.06), B(1.01), { phiStart: sx > 0 ? 1.2 : Math.PI * 2 - 1.95, phiLength: 0.75, seg: 10 }), M.secondary, [0, 0, 0], { order: 1 });
      const kn = joint(`knee${side}`, hp, [0, -0.45, 0]);
      add(kn, new THREE.SphereGeometry(B(0.058), 16, 12), M.metal, [0, 0, 0], { order: 0 });
      add(kn, shell([[0.02, 0.04], [0.06, 0.03], [0.066, -0.01], [0.05, -0.05]], B(1.05), B(0.9), { phiStart: -1.3, phiLength: 2.6, seg: 16 }), M.secondary, [0, 0, B(0.012)], { order: 0 }); // knee cap
      // the shin: a calf swell behind, straight in front
      add(kn, shell([[0.064, -0.02], [0.074, -0.1], [0.07, -0.22], [0.06, -0.33], [0.056, -0.41]], B(1.0), B(1.08)), M.primary, [0, 0, -0.004], { order: 0 });
      add(kn, seam(0.071, B(1.0), B(1.08)), M.dark, [0, -0.2, -0.004], { piece: false });
      const an = joint(`ankle${side}`, kn, [0, -0.43, 0]);
      // the boot: a heel block, the foot, a sole; the thruster nozzle underneath
      add(an, shell([[0.058, 0.03], [0.068, -0.01], [0.072, -0.05], [0.07, -0.07]], B(1.1), B(1.25)), M.primary, [0, 0, -0.005], { order: 0 });
      add(an, rbox(B(0.1), 0.055, B(0.13), 0.025), M.primary, [0, -0.045, B(0.085)], { rot: [0.12, 0, 0], order: 0 });
      add(an, rbox(B(0.105), 0.016, B(0.24), 0.007), M.dark, [0, -0.075, B(0.045)], { order: 0 });
      const nozzle = new THREE.CylinderGeometry(0.035, 0.04, 0.02, 20);
      const nz = add(an, nozzle, M.palmGlow, [0, -0.08, -0.005], { piece: false });
      const flame = thrusterFlame(S.reactor);
      flame.position.set(0, -0.09, -0.005);
      flame.scale.set(1, 0.001, 1);
      an.add(flame);
      return { flame, nozzle: nz };
    };
    this.feet = { l: legSide('L', 1), r: legSide('R', -1) };

    // mirror-safe outward directions for the exploded view, taken in the rest pose
    this.root.updateMatrixWorld(true);
    const centre = new THREE.Vector3(0, 1.15, 0), wp = new THREE.Vector3();
    for (const m of this.meshes) {
      m.getWorldPosition(wp);
      const d = wp.sub(centre);
      d.y *= 0.6;
      m.userData.out = d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(0, 1, 0);
      m.userData.base = m.position.clone();
    }
    // suit-up: each piece flies in from its own direction
    for (const p of this.pieces) {
      p.from = p.from || p.mesh.userData.out.clone().multiplyScalar(1.6 + Math.random() * 1.4).add(new THREE.Vector3(0, Math.random() * 0.8 - 0.2, -0.6 - Math.random()));
      p.spin = new THREE.Vector3(Math.random() * 3 - 1.5, Math.random() * 3 - 1.5, Math.random() * 3 - 1.5);
    }
    this.pieces.sort((a, b) => a.order - b.order);
    this._originalMats = new Map(this.meshes.map((m) => [m, m.material]));
    this.pose('stand', 1);
  }

  /** Blend toward a pose (a name from POSES or an object of joint: [x, y, z]); speed 0..1 per frame-ish, 1 = snap. */
  pose(p, snap = 0) {
    const def = typeof p === 'string' ? POSES[p] || POSES.stand : p;
    for (const name of J) this._target[name] = def[name] || [0, 0, 0];
    this.poseName = typeof p === 'string' ? p : 'custom';
    if (snap >= 1) for (const name of J) { const t = this._target[name]; this.j[name].rotation.set(t[0], t[1], t[2]); }
  }

  /** Swap every surface to a hologram (e.g. in the workshop) or back. */
  setHologram(on, color = 0x5fe3ff) {
    if (on) {
      this._holo = this._holo || holoMaterial(color);
      for (const m of this.meshes) m.material = this._holo;
    } else for (const m of this.meshes) m.material = this._originalMats.get(m);
    this.hologram = on;
  }

  /** Pull the plates apart along their own directions (0 = assembled, 1 = fully exploded). */
  explode(t) {
    const k = easeOutCubic(clamp(t, 0, 1)) * 0.55;
    for (const m of this.meshes) m.position.copy(m.userData.base).addScaledVector(m.userData.out, k * (0.6 + (m.userData.out.y + 1) * 0.2));
  }

  /**
   * Suit-up: t runs 0..1 over the whole sequence; each piece arrives in turn (legs first, helmet last).
   * Returns the index of the last piece that has landed, so a chapter can clank as they lock on.
   */
  assemble(t) {
    const n = this.pieces.length;
    let landed = -1;
    this.pieces.forEach((p, i) => {
      const start = (i / n) * 0.75, local = clamp((t - start) / 0.25, 0, 1);
      const e = easeOutCubic(local);
      p.mesh.visible = local > 0;
      p.mesh.position.copy(p.base).addScaledVector(p.from, 1 - e);
      p.mesh.rotation.set(p.baseRot.x + p.spin.x * (1 - e), p.baseRot.y + p.spin.y * (1 - e), p.baseRot.z + p.spin.z * (1 - e));
      if (local >= 1) landed = i;
    });
    return landed;
  }

  /** Every frame. */
  update(dt) {
    const k = 1 - Math.exp(-8 * dt);
    for (const name of J) {
      const t = this._target[name], r = this.j[name].rotation;
      r.x += (t[0] - r.x) * k; r.y += (t[1] - r.y) * k; r.z += (t[2] - r.z) * k;
    }
    const s = this._shown, e = 1 - Math.exp(-10 * dt);
    s.reactor += (this.reactor - s.reactor) * e;
    s.eyes += (this.eyes - s.eyes) * e;
    s.thrust += (this.thrust - s.thrust) * e;
    s.face += (this.faceOpen - s.face) * (1 - Math.exp(-6 * dt));
    s.palmL += (this.palm.l - s.palmL) * e;
    s.palmR += (this.palm.r - s.palmR) * e;
    s.palmThrust += (this.palmThrust - s.palmThrust) * e;
    const t = shared.uTime.value;
    const flick = 0.92 + Math.sin(t * 31) * 0.04 + Math.sin(t * 17) * 0.04;
    this.mat.glow.color.copy(this._baseColors.glow).multiplyScalar(0.08 + s.reactor * 1.6 * flick);
    this.reactorLight.intensity = s.reactor * 0.6;
    this.mat.eye.color.copy(this._baseColors.eye).multiplyScalar(0.05 + s.eyes * 1.8);
    const pm = Math.max(s.palmL, s.palmR, s.thrust * 0.6, s.palmThrust);
    this.mat.palmGlow.color.copy(this._baseColors.palm).multiplyScalar(0.1 + pm * 2.2);
    this.hands.l.light.intensity = s.palmL * 1.5;
    this.hands.r.light.intensity = s.palmR * 1.5;
    this.facePivot.rotation.x = -s.face * 1.9;
    this.facePivot.position.z = 0.06 + s.face * 0.02;
    // flames: length flickers with power
    for (const f of [this.feet.l.flame, this.feet.r.flame]) {
      const p = s.thrust;
      f.userData.power.value = p;
      f.scale.y = Math.max(0.001, p * (0.55 + Math.random() * 0.12));
      f.visible = p > 0.01;
    }
    for (const f of [this.hands.l.flame, this.hands.r.flame]) {
      const p = s.palmThrust;
      f.userData.power.value = p;
      f.scale.y = Math.max(0.001, p * (0.35 + Math.random() * 0.08));
      f.visible = p > 0.01;
    }
  }

  /** World position of a palm (for aiming blasts), and the direction it faces. */
  palmWorld(side, pos = new THREE.Vector3(), dir = new THREE.Vector3()) {
    const w = this.j[side === 'l' ? 'wristL' : 'wristR'];
    w.updateWorldMatrix(true, false);
    pos.set(0, -0.05, 0.03).applyMatrix4(w.matrixWorld);
    dir.set(0, 0, 1).transformDirection(w.matrixWorld);
    return { pos, dir };
  }

  /** World position of the chest reactor. */
  reactorWorld(pos = new THREE.Vector3()) {
    this.reactorGroup.updateWorldMatrix(true, false);
    return pos.setFromMatrixPosition(this.reactorGroup.matrixWorld);
  }

  /** Eyes' world position (for a camera looking through the helmet). */
  headWorld(pos = new THREE.Vector3()) {
    this.j.head.updateWorldMatrix(true, false);
    return pos.set(0, 0.1, 0.05).applyMatrix4(this.j.head.matrixWorld);
  }
}
