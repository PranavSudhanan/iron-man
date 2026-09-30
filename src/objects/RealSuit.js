import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchBinary, parseGLB } from '../core/Assets.js';
import { suitEnvironment, holoMaterial, thrusterFlame } from './Suit.js';
import { glowTexture, clamp, easeOutCubic, shared } from '../core/utils.js';
import { mergeStatic } from '../core/mergeStatic.js';

/*
 * The detailed armor models (public/models/*.glb), with the same controls as the procedural Suit where they
 * make sense: reactor / eyes / thrust glow, a hologram look, an exploded view and a plate-by-plate assembly.
 * They are sculpted in one pose, so pose() does nothing; chapters that need arms that move use Suit.
 *
 *   await loadModels(['classic']);             // in a chapter's load()
 *   const s = new RealSuit('classic');         // in build()
 *   scene.add(s.root); s.update(dt);           // every frame
 *
 * Each model is scaled to its height with its feet on y = 0, centred, facing +z.
 * The artists' credits (required by their licences) are in MODELS and shown in the site's credits.
 */

export const MODELS = {
  classic: {
    file: 'mark-classic.glb', height: 1.9, yaw: 0, reactorY: 0.705, eyeY: 0.934, eyeX: 0.033,
    title: 'Iron Man', author: 'Grant Riley', license: 'CC BY-NC 4.0', source: 'https://sketchfab.com/3d-models/iron-man-69dde1ad49e94852984e3d83928efd65',
  },
  mk1: {
    file: 'mark-1.glb', height: 2.05, yaw: 0, reactorY: 0.715, eyeY: 0.925, eyeX: 0.04, eyeColor: 0x9ff3ff,
    // measured on the model (its face sits a little right of centre): the reactor is the round disc in
    // the chest; the eyes are open slots in the helmet, lit from inside
    reactor: [0.034, 1.579, 0.202], reactorR: 0.028,
    eyeHoles: [[-0.02, 1.92, 0.016, 1.942], [0.06, 1.92, 0.096, 1.942]], eyeHoleZ: 0.084,
    title: 'Iron Man - Mark 1', author: 'Nathang30', license: 'CC BY-NC-SA 4.0', source: 'https://sketchfab.com/3d-models/iron-man-mark-1-57b18282c1a84c5899fcc7f67762a386',
  },
  nano: {
    file: 'mark-nano.glb', height: 1.9, yaw: 0, reactorY: 0.72, eyeY: 0.93, eyeX: 0.032,
    title: '500 likes special Iron Man nano tech', author: '#3D $Resource$', license: 'CC BY 4.0', source: 'https://sketchfab.com/3d-models/500-likes-special-iron-man-nano-tech-5160141d6eaf41cd83ee692b65df20f6',
  },
  mk85: {
    file: 'mark-85.glb', height: 1.9, yaw: 0, reactorY: 0.72, eyeY: 0.935, eyeX: 0.032,
    title: 'Iron Man Mark 85', author: 'LLIypuk', license: 'CC BY 4.0 (simplified to 180k triangles for the web)', source: 'https://sketchfab.com/3d-models/iron-man-mark-85-8da781aa74024366844b36444c650d69',
  },
  heavy: {
    file: 'mark-heavy.glb', height: 3.2, yaw: 0, footX: 0.42, reactorY: 0.74, eyeY: 0.92, eyeX: 0.045,
    title: 'Iron Man Mark 44 Hulkbuster', author: 'supplied model (author unknown)', license: 'used with permission of the site owner', source: '',
  },
  tpose: {
    file: 'mark-obj.glb', height: 1.9, yaw: 0, reactorY: 0.72, eyeY: 0.935, eyeX: 0.034,
    // shown as authored (T-pose, the suit-up stance); its hands are out at arm's length
    hands: [[-0.97, 1.55, 0.02], [0.97, 1.55, 0.02]],
    reactor: [0, 1.462, 0.195], reactorR: 0.03, // its reactor has no glow of its own to find: measured on the model (a recessed disc)
    title: 'Iron Man (rigged, T-pose)', author: 'supplied model (author unknown)', license: 'used with permission of the site owner', source: '',
  },
  mk42: {
    file: 'mark-42.glb', height: 1.9, yaw: 0, reactorY: 0.72, eyeY: 0.93, eyeX: 0.032,
    title: 'iron man for blender', author: 'colts43752', license: 'CC BY 4.0', source: 'https://sketchfab.com/3d-models/iron-man-for-blender-5e7796081e1c41e1b7f39dbff1172381',
  },
  mk5raw: {
    // the Mark V with its paint stripped: bare steel all over (the unpainted prototype of the first flight)
    file: 'mark-5.glb', height: 1.9, yaw: Math.PI / 2, reactorY: 0.72, eyeY: 0.93, eyeX: 0.032,
    bare: { paint: ['material'], steel: 0xb4b8bd }, // (the same grey as its own unpainted metal)
    title: 'Iron Man - Mark V Rig (Low Poly), unpainted', author: 'wonderstark', license: 'CC BY 4.0 (rig removed, pose baked, paint removed)', source: 'https://sketchfab.com/3d-models/iron-man-mark-v-rig-low-poly-ea6f480ebb0f42d58b34ea1913c457e0',
  },
  mk5: {
    // rigged at the source; baked static in its modelled pose (tools/bake_static.mjs)
    file: 'mark-5.glb', height: 1.9, yaw: Math.PI / 2, reactorY: 0.72, eyeY: 0.93, eyeX: 0.032,
    title: 'Iron Man - Mark V Rig (Low Poly)', author: 'wonderstark', license: 'CC BY 4.0 (rig removed, pose baked)', source: 'https://sketchfab.com/3d-models/iron-man-mark-v-rig-low-poly-ea6f480ebb0f42d58b34ea1913c457e0',
  },
  spider: {
    file: 'homecoming.glb', height: 1.72, yaw: 0, glow: false,
    title: 'Homecoming Suit', author: 'supplied model (purchased by the site owner)', license: 'purchased', source: '',
  },
  helmetA: {
    file: 'helmet-a.glb', height: 0.5, yaw: Math.PI, glow: false, eyesOnly: true, eyeY: 0.66, eyeX: 0.07,
    title: 'Iron Man helmet', author: 'Sergei', license: 'CC BY 4.0', source: 'https://sketchfab.com/3d-models/iron-man-helmet-3fb9b4f22925487692d9bc24f4c50211',
  },
  helmetB: {
    file: 'helmet-b.glb', height: 0.34, yaw: 0, glow: false, eyesOnly: true, eyeY: 0.6, eyeX: 0.06,
    title: 'Iron Man Helmet', author: 'Ashwani-Tyagi', license: 'CC BY-NC 4.0', source: 'https://sketchfab.com/3d-models/iron-man-helmet-4cb973027cfb430d8d815531dfad65fd',
  },
  reactor: {
    file: 'arc-reactor.glb', height: 0.3, yaw: Math.PI / 2, glow: false, fitWidth: true,
    title: 'Arc Reactor', author: 'supplied model (author unknown)', license: 'used with permission of the site owner', source: '',
  },
};

const BASE = './models/';
const _gltf = new Map(); // key -> Promise<gltf>
const _ready = new Map(); // key -> gltf
const _info = new Map(); // key -> measured anchors (in the normalized frame)

/** Downloads and parses the given models (once). Resolves when all are ready; missing files are skipped. */
export function loadModels(keys) {
  return Promise.all(keys.map((k) => {
    if (!_gltf.has(k)) {
      const cfg = MODELS[k];
      _gltf.set(k, fetchBinary(BASE + cfg.file)
        .then((buf) => (buf ? parseGLB(new GLTFLoader(), buf, BASE) : null))
        .then((g) => { if (g) { prepare(g, cfg); _ready.set(k, g); } return g; })
        .catch((e) => { console.warn('[model]', k, e); return null; }));
    }
    return _gltf.get(k);
  }));
}

/** Starts the download of model files in the background (no parsing). */
export function prefetchModels(keys) { keys.forEach((k) => fetchBinary(BASE + MODELS[k].file)); }

export function hasModel(key) { return _ready.has(key); }

function prepare(gltf, cfg = {}) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      // bare: the paint stripped off, every painted panel the same raw steel as the rest (keeping each
      // panel's own roughness and normal maps, so the wear and panel lines stay)
      if (cfg.bare && cfg.bare.paint.includes(m.name)) { m.color.set(cfg.bare.steel); m.metalness = 1; }
      // an "emissive map" that is just the colour texture (an export quirk) would light the whole suit
      if (m.emissiveMap && m.map && (m.emissiveMap === m.map || m.emissiveMap.image === m.map.image)) { m.emissiveMap = null; m.emissive?.set(0x000000); }
      // the models were authored for image-based light: give them the studio reflections at full strength
      // (no fixed envMap: each chapter's own scene.environment, a real HDRI, lights and reflects in them)
      if (!m.isMeshBasicMaterial) m.envMapIntensity = 1;
      // their emissive maps (eyes, reactor, seams) are driven by the suit's power instead of a fixed strength
      m.userData.baseEmissive = Math.min(m.emissiveIntensity ?? 1, 1.5);
      if (m.emissiveMap) m.emissiveIntensity = m.userData.baseEmissive * 0.1;
    }
  });
}

/* Reading a texture's pixels on the CPU (small copies, once per texture). */
const _pixels = new WeakMap();
function texPixels(tex) {
  if (!tex || !tex.image) return null;
  if (_pixels.has(tex)) return _pixels.get(tex);
  let out = null;
  try {
    const S = 512;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(tex.image, 0, 0, S, S);
    out = { S, data: x.getImageData(0, 0, S, S).data, flipY: tex.flipY };
  } catch (_) { out = null; }
  _pixels.set(tex, out);
  return out;
}

/**
 * The lit spots of a model inside a region, as clusters { p (centre, at the front-most z), area (cm²) }.
 * A spot is lit where the surface glows cyan-white: a bright cyan-white texel of the colour map, a bright
 * texel of the emissive map, or a material whose own emissive colour is cyan-white (the Infinity Stones'
 * yellow, green, red and purple don't count). Triangles are sampled across their area (a low-poly model's
 * reactor often lies inside a single large triangle), with a fixed seed so the result never changes.
 * `inside(p)` tests a point in the suit's own space (feet at 0, facing +z).
 */
function litClusters(meshes, inside, cell = 0.03) {
  const cells = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const add = (x, y, z, w) => {
    const key = Math.round(x / cell) + ',' + Math.round(y / cell);
    const q = cells.get(key) || { s: 0, x: 0, y: 0, z: -Infinity };
    q.s += w; q.x += x * w; q.y += y * w; q.z = Math.max(q.z, z);
    cells.set(key, q);
  };
  for (const m of meshes) {
    const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
    if (!pos) continue;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = list[gr.materialIndex] || list[0];
      const e = mat.emissive;
      const flat = !mat.emissiveMap && e && e.b > 0.5 && e.g > 0.5 && e.r < 0.8;
      const px = flat ? null : texPixels(mat.emissiveMap) || texPixels(mat.map);
      const emis = !!mat.emissiveMap;
      if (!flat && (!px || !uv)) continue;
      for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
        p.copy(a).add(b).add(c).divideScalar(3);
        if (!inside(p)) continue;
        const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
        if (flat) { add(p.x, p.y, Math.max(a.z, b.z, c.z), area * Math.max(e.r, e.g, e.b)); continue; }
        const n = Math.min(40, Math.max(3, Math.round(area / 0.00004)));
        for (let k = 0; k < n; k++) {
          let r1 = rnd(), r2 = rnd();
          if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
          const w0 = 1 - r1 - r2;
          let u = (uv.getX(i0) * w0 + uv.getX(i1) * r1 + uv.getX(i2) * r2) % 1;
          let v = (uv.getY(i0) * w0 + uv.getY(i1) * r1 + uv.getY(i2) * r2) % 1;
          if (u < 0) u += 1;
          if (v < 0) v += 1;
          const tx = Math.min(px.S - 1, Math.floor(u * px.S)), ty = Math.min(px.S - 1, Math.floor((px.flipY ? 1 - v : v) * px.S));
          const q = (ty * px.S + tx) * 4;
          const R = px.data[q] / 255, G = px.data[q + 1] / 255, B = px.data[q + 2] / 255;
          const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          const score = emis ? lum : (B > 0.65 && G > 0.55 && B >= R) ? lum * (B - R * 0.5) : 0;
          if (score <= 0.2) continue;
          add(a.x * w0 + b.x * r1 + c.x * r2, a.y * w0 + b.y * r1 + c.y * r2, a.z * w0 + b.z * r1 + c.z * r2, score * area / n);
        }
      }
    }
  }
  // neighbouring cells join into one spot
  const seen = new Set(), out = [];
  for (const k0 of cells.keys()) {
    if (seen.has(k0)) continue;
    const stack = [k0]; seen.add(k0);
    const cl = { s: 0, x: 0, y: 0, z: -Infinity };
    while (stack.length) {
      const k = stack.pop(), q = cells.get(k);
      cl.s += q.s; cl.x += q.x; cl.y += q.y; cl.z = Math.max(cl.z, q.z);
      const [i, j] = k.split(',').map(Number);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const kk = (i + di) + ',' + (j + dj);
        if (cells.has(kk) && !seen.has(kk)) { seen.add(kk); stack.push(kk); }
      }
    }
    out.push({ p: new THREE.Vector3(cl.x / cl.s, cl.y / cl.s, cl.z), area: cl.s * 1e4 });
  }
  return out.filter((q) => q.area > 1.5).sort((q, r) => r.area - q.area);
}

/**
 * The model's own lights: the arc reactor (the biggest lit spot on the chest, preferring the centre line
 * over the smaller lights either side), the eyes and the palm repulsors (the biggest lit spot each side).
 * Anything not found is null, and the configured positions are used instead.
 */
function findLights(meshes, H, { hands = true } = {}) {
  const pick = (list, score) => list.reduce((best, q) => (!best || score(q) > score(best) ? q : best), null);
  const torso = litClusters(meshes, (p) => p.y > H * 0.55 && p.y < H * 0.86 && Math.abs(p.x) < H * 0.14 && p.z > -0.02 * H);
  const reactor = pick(torso, (q) => q.area * Math.exp(-((q.p.x / (0.035 * H)) ** 2)));
  const side = (s, region) => pick(litClusters(meshes, (p) => region(p) && p.x * s > 0), (q) => q.area);
  const eye = (s) => side(s, (p) => p.y > H * 0.86 && p.y < H * 0.99 && Math.abs(p.x) > 0.008 * H && Math.abs(p.x) < 0.07 * H && p.z > 0);
  const palm = (s) => side(s, (p) => Math.abs(p.x) > H * 0.12 && p.y > H * 0.3 && p.y < H * 0.62);
  const e = [eye(-1), eye(1)];
  const h = hands ? [palm(-1), palm(1)] : [null, null];
  return {
    reactor: reactor && Math.abs(reactor.p.x) < 0.06 * H ? reactor.p : null,
    eyes: e[0] && e[1] ? e.map((q) => q.p) : null,
    hands: h[0] && h[1] ? h.map((q) => q.p) : null,
  };
}

/* ---------------- eyes that glow in their own shape ---------------- */

// an eye light in a texture: bright near-white, or a saturated cyan (a grey steel faceplate is neither)
const eyeLit = (R, G, B) => Math.min(R, G, B) > 0.85 || (B > 0.6 && G > 0.5 && B - R > 0.25);

/**
 * The model's own eye surfaces: the triangles around the visor that carry an eye light (in the colour or
 * emissive map, or a glowing eye material), copied in the suit's own space with their UVs. Returns
 * [{ geometry, map, emis }] (one per texture), or [] when the model has no eye light to find.
 */
function eyeSurfaces(meshes, inside) {
  const sets = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const nm = new THREE.Matrix3(), n = new THREE.Vector3();
  const lit = (px, u, v, emis) => {
    u %= 1; v %= 1; if (u < 0) u += 1; if (v < 0) v += 1;
    const tx = Math.min(px.S - 1, Math.floor(u * px.S)), ty = Math.min(px.S - 1, Math.floor((px.flipY ? 1 - v : v) * px.S));
    const q = (ty * px.S + tx) * 4, R = px.data[q] / 255, G = px.data[q + 1] / 255, B = px.data[q + 2] / 255;
    return emis ? 0.2126 * R + 0.7152 * G + 0.0722 * B > 0.35 : eyeLit(R, G, B);
  };
  for (const m of meshes) {
    const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal, idx = g.index;
    if (!pos) continue;
    nm.getNormalMatrix(m.matrixWorld);
    const list = Array.isArray(m.material) ? m.material : [m.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = list[gr.materialIndex] || list[0];
      const e = mat.emissive;
      // a glowing material: cyan or white (not a stone's yellow, green, red or purple)
      const flat = !mat.emissiveMap && e && e.b > 0.5 && e.g > 0.5;
      const tex = flat ? null : mat.emissiveMap || mat.map;
      const px = tex ? texPixels(tex) : null;
      if (!flat && (!px || !uv)) continue;
      const emis = !!mat.emissiveMap;
      const key = flat ? 'flat' : tex.uuid;
      for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) {
        const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
        a.fromBufferAttribute(pos, ids[0]).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(pos, ids[1]).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(pos, ids[2]).applyMatrix4(m.matrixWorld);
        p.copy(a).add(b).add(c).divideScalar(3);
        if (!inside(p)) continue;
        if (!flat) {
          // any of the corners, edge middles or the centre on an eye light
          const U = ids.map((i) => uv.getX(i)), V = ids.map((i) => uv.getY(i));
          const probes = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3]];
          if (!probes.some(([x, y, z]) => lit(px, U[0] * x + U[1] * y + U[2] * z, V[0] * x + V[1] * y + V[2] * z, emis))) continue;
        }
        const set = sets.get(key) || { pos: [], uv: [], nor: [], map: tex, emis };
        for (const [k, v] of [[0, a], [1, b], [2, c]]) {
          set.pos.push(v.x, v.y, v.z);
          set.uv.push(uv ? uv.getX(ids[k]) : 0, uv ? uv.getY(ids[k]) : 0);
          if (nor) n.fromBufferAttribute(nor, ids[k]).applyMatrix3(nm).normalize(); else n.set(0, 0, 1);
          set.nor.push(n.x, n.y, n.z);
        }
        sets.set(key, set);
      }
    }
  }
  return [...sets.values()].map((set) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(set.pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(set.uv, 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(set.nor, 3));
    return { geometry, map: set.map, emis: set.emis };
  });
}

/** Light on the eye surfaces, only where the texture has the eye (additive, HDR, lifted off the surface). */
function eyeGlowMaterial(map, emis, color, loose = false, disc = null) {
  return new THREE.ShaderMaterial({
    uniforms: { tMap: { value: map }, uUseMap: { value: map ? 1 : 0 }, uEmis: { value: emis ? 1 : 0 }, uLoose: { value: loose ? 1 : 0 },
      uDisc: { value: disc ? new THREE.Vector3(disc.centre.x, disc.centre.y, disc.r) : new THREE.Vector3(0, 0, 0) }, uColor: { value: new THREE.Color(color) }, uGain: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vP;
      void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * 0.0015, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap; uniform float uUseMap; uniform float uEmis; uniform float uLoose; uniform vec3 uColor; uniform float uGain; uniform vec3 uDisc;
      varying vec2 vUv; varying vec3 vP;
      void main(){
        float m = 1.0;
        if (uUseMap > 0.5) {
          vec3 c = pow(texture2D(tMap, vUv).rgb, vec3(1.0 / 2.2)); // back to the texture's own (sRGB) values
          float white = smoothstep(0.78, 0.9, min(c.r, min(c.g, c.b)));
          float cyan = smoothstep(0.5, 0.65, c.b) * smoothstep(0.4, 0.55, c.g) * smoothstep(0.18, 0.32, c.b - c.r);
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          m = uEmis > 0.5 ? smoothstep(0.3, 0.6, lum) : max(white, cyan);
          // (a reactor's area is already known: anything bright in it is its light)
          if (uLoose > 0.5) m = max(m, smoothstep(0.5, 0.78, lum));
        }
        // a round lens (a reactor with no light painted on): a clean circle, brightest at its centre
        if (uDisc.z > 0.0) { float d = length(vP.xy - uDisc.xy) / uDisc.z; m *= (1.0 - smoothstep(0.88, 1.0, d)) * (0.65 + 0.55 * (1.0 - d * d)); }
        if (m < 0.01) discard;
        gl_FragColor = vec4(uColor * m * uGain, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}
const _eyeSets = new Map(); // model key -> eye surfaces (measured once per model)
const _reactorSets = new Map(); // model key -> reactor surfaces

/**
 * Open eye slots (a helmet with holes, not painted eyes): a lit panel just inside the faceplate behind
 * each one, a little larger than the slot, so the light is seen only through the slot, in its shape.
 * holes: [[x0, y0, x1, y1], ...] in the suit's own space; z: just behind the faceplate's front.
 */
function eyePanels(holes, z, margin = 0.008) {
  const pos = [], uv = [], nor = [];
  for (const [x0, y0, x1, y1] of holes) {
    const a = [x0 - margin, y0 - margin], b = [x1 + margin, y1 + margin];
    const quad = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
    for (const [x, y] of quad) { pos.push(x, y, z); uv.push(0, 0); nor.push(0, 0, 1); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return [{ geometry, map: null, emis: false }];
}

/** The forward-facing triangles within r of a point (a reactor housing that has no light painted on). */
function frontFace(meshes, centre, r) {
  const pos3 = [], uv2 = [], nor3 = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (const m of meshes) {
    const g = m.geometry, pos = g.attributes.position, idx = g.index;
    if (!pos) continue;
    const T = (idx ? idx.count : pos.count) / 3;
    for (let t = 0; t < T; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      p.copy(a).add(b).add(c).divideScalar(3);
      if (Math.hypot(p.x - centre.x, p.y - centre.y) > r || p.z < centre.z - r * 1.5) continue;
      n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      if (n.z < 0.2) continue;
      for (const v of [a, b, c]) { pos3.push(v.x, v.y, v.z); uv2.push(0, 0); nor3.push(n.x, n.y, n.z); }
    }
  }
  if (!pos3.length) return [];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos3, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv2, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor3, 3));
  return [{ geometry, map: null, emis: false }];
}

const _ray = new THREE.Raycaster();
/** Finds a point on the front of the model at (x, y) by casting a ray from far in front. */
function frontPoint(root, x, y, fallbackZ) {
  _ray.set(new THREE.Vector3(x, y, 10), new THREE.Vector3(0, 0, -1));
  const hit = _ray.intersectObject(root, true)[0];
  return new THREE.Vector3(x, y, hit ? hit.point.z : fallbackZ);
}

/*
 * Arm poses for rigged models: per arm, `down` (from the T-pose: 0 = straight out, ~1.35 = at the side),
 * `fwd` (swing toward the front: π/2 = pointing straight ahead; negative = behind), `elbow` (bend) and
 * `wrist` (palm up / forward). l = the suit's left (+x).
 */
const ARM = (down, fwd = 0, elbow = 0, wrist = 0) => ({ down, fwd, elbow, wrist });
const REST = ARM(1.32, 0.12, 0.18, 0.1);
export const REAL_POSES = {
  stand: { l: REST, r: REST },
  tpose: { l: ARM(0), r: ARM(0) },
  ready: { l: ARM(1.1, 0.5, 1.1, 0.3), r: ARM(1.1, 0.5, 1.1, 0.3) },
  hover: { l: ARM(1.05, -0.15, 0.25, -0.2), r: ARM(1.05, -0.15, 0.25, -0.2) },
  fly: { l: ARM(1.4, -0.35, 0.05, 0.3), r: ARM(1.4, -0.35, 0.05, 0.3) },
  blastR: { l: REST, r: ARM(0.08, 1.52, 0, 1.4) },
  blastL: { l: ARM(0.08, 1.52, 0, 1.4), r: REST },
  blastBoth: { l: ARM(0.1, 1.38, 0, 1.4), r: ARM(0.1, 1.38, 0, 1.4) },
  unibeam: { l: ARM(0.85, -0.55, 0.45, 0.2), r: ARM(0.85, -0.55, 0.45, 0.2) },
  fist: { l: REST, r: ARM(1.05, 1.1, 1.6, 0) },
  crossed: { l: ARM(1.25, 0.9, 1.9, 0), r: ARM(1.25, 0.9, 1.9, 0) },
};
const _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _ax = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export class RealSuit {
  /**
   * options: castShadow; light (one reactor point light); pieces (keep every plate separate: needed for
   * explode() and assemble(); otherwise plates sharing a material are merged, far fewer draw calls);
   * uniqueMaterials (this suit gets its own copies of the materials, e.g. to clip or recolour it alone).
   */
  constructor(key, { castShadow = true, light = false, pieces = false, uniqueMaterials = false } = {}) {
    const cfg = this.cfg = MODELS[key];
    const gltf = _ready.get(key);
    this.key = key;
    this.root = new THREE.Group();
    this.root.name = `real-${key}`;
    this.reactor = 1; this.eyes = 1; this.thrust = 0; this.faceOpen = 0;
    this.palm = { l: 0, r: 0 }; this.palmThrust = 0;
    this._shown = { reactor: 0, eyes: 0, thrust: 0 };
    this.meshes = [];
    this.pieces = [];
    this.ok = !!gltf;
    if (!gltf) return;

    // the model, turned to face +z, scaled to height, feet on the floor, centred
    const inner = gltf.scene.clone(true);
    // parts the artist hid (fully transparent materials, e.g. undeployed nanotech wings) are left out:
    // they must not count in the size, catch the anchor rays, or show in a shimmer / hologram copy
    const hidden = [];
    inner.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.every((m) => m.transparent && m.opacity <= 0.01)) hidden.push(o);
    });
    for (const o of hidden) o.parent.remove(o);
    const turn = new THREE.Group();
    turn.rotation.y = cfg.yaw || 0;
    turn.add(inner);
    const holder = new THREE.Group();
    holder.add(turn);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const k = cfg.height / (cfg.fitWidth ? Math.max(size.x, size.y) : size.y);
    holder.scale.setScalar(k);
    holder.position.set(-(box.min.x + size.x / 2) * k, -box.min.y * k, -(box.min.z + size.z / 2) * k);
    this.root.add(holder);
    this.model = holder;
    this.size = size.clone().multiplyScalar(k);
    this.height = cfg.height;

    const copies = new Map();
    inner.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = castShadow;
      o.receiveShadow = true;
      if (uniqueMaterials) {
        const own = (m) => { if (!copies.has(m)) { const c = m.clone(); c.userData = { ...m.userData }; copies.set(m, c); } return copies.get(m); };
        o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
      }
      this.meshes.push(o);
    });
    this._originalMats = new Map(this.meshes.map((m) => [m, m.material]));
    this._emissive = [...new Set(this.meshes.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])).filter((m) => m.emissiveMap))];

    // anchors: reactor, eyes, feet (measured once per model)
    this.root.updateMatrixWorld(true);
    let info = _info.get(key);
    if (!info) {
      const H = cfg.height, front = this.size.z / 2;
      // the glows sit where the model itself is lit (its reactor, eyes and palms), falling back to the
      // configured positions: a sprite anywhere else shows as a second, doubled light
      const lit = cfg.eyesOnly || cfg.glow === false ? {} : findLights(this.meshes, H, { hands: !cfg.hands });
      info = {
        reactor: cfg.reactor ? new THREE.Vector3(...cfg.reactor) : lit.reactor || (cfg.reactorY ? frontPoint(this.root, 0, H * cfg.reactorY, front) : null),
        eyes: cfg.eyeHoles ? cfg.eyeHoles.map(([x0, y0, x1, y1]) => new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, cfg.eyeHoleZ)) : lit.eyes || (cfg.eyeY ? [-1, 1].map((s) => frontPoint(this.root, s * (cfg.eyeX || 0.033) * (cfg.eyesOnly ? 1 : H / 1.9), H * cfg.eyeY, front)) : []),
        feet: [-1, 1].map((s) => new THREE.Vector3(s * (cfg.footX ?? 0.1 * H / 1.9), 0.03, cfg.footZ ?? 0)),
        hands: cfg.hands ? cfg.hands.map((h) => new THREE.Vector3(...h)) : lit.hands || [-1, 1].map((s) => new THREE.Vector3(s * this.size.x * 0.36, H * 0.49, 0.03)),
      };
      _info.set(key, info);
    }
    this.info = info;

    // glows: the reactor, the eyes, the boots (sprites and flames only: no lights, so showing or hiding a
    // suit never changes the scene's light count; pass light: true for one reactor light)
    const tex = glowTexture();
    // (colours pushed past 1 so the glows flare in the bloom while plain highlights don't)
    const sprite = (color, s, o = 1, hdr = 1.3) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(hdr), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: o, toneMapped: false }));
      sp.scale.setScalar(s);
      this.root.add(sp);
      return sp;
    };
    this.glows = [];
    // the reactor glows in its own shape: its lit surfaces around the reactor (or, where nothing is
    // painted on, its forward face), light laid on the model like the eyes
    if (!_reactorSets.has(key)) {
      let set = [];
      if (cfg.glow !== false && info.reactor && !cfg.eyesOnly) {
        const R = info.reactor, rad = cfg.height * 0.035;
        if (cfg.reactorR) set = frontFace(this.meshes, R, cfg.reactorR * 1.5).map((x) => ({ ...x, disc: { centre: R, r: cfg.reactorR } }));
        else {
          set = eyeSurfaces(this.meshes, (q) => q.distanceTo(R) < rad && q.z > R.z - rad);
          if (!set.length) set = frontFace(this.meshes, R, cfg.height * 0.018);
        }
      }
      _reactorSets.set(key, set);
    }
    const reactorColor = new THREE.Color(0xbff6ff);
    this.reactorGlows = _reactorSets.get(key).map(({ geometry, map, emis, disc }) => {
      const mesh = new THREE.Mesh(geometry, eyeGlowMaterial(map, emis, reactorColor, true, disc));
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    });
    if (cfg.glow !== false && info.reactor && !this.reactorGlows.length) {
      const p = info.reactor.clone(); p.z += 0.015;
      this.reactorCore = sprite(0xe8fbff, 0.05, 1, 6);
      this.reactorHalo = sprite(0x7fe6ff, 0.2, 0.5, 0.6);
      this.reactorCore.position.copy(p); this.reactorHalo.position.copy(p);
      this.glows.push(this.reactorCore, this.reactorHalo);
    }
    // the eyes glow in their own shape: light laid on the model's eye surfaces; round sprites only for a
    // model with no eye light of its own to find
    if (!_eyeSets.has(key)) {
      const H = cfg.height, ey = cfg.eyeY || 0.93;
      const region = cfg.eyesOnly
        ? (q) => q.y > H * (ey - 0.14) && q.y < H * (ey + 0.12) && Math.abs(q.x) < H * 0.22 && q.z > 0
        : (q) => q.y > H * 0.86 && q.y < H * 0.99 && Math.abs(q.x) < H * 0.075 && q.z > 0;
      _eyeSets.set(key, cfg.eyeHoles ? eyePanels(cfg.eyeHoles, cfg.eyeHoleZ) : cfg.glow === false && !cfg.eyesOnly ? [] : eyeSurfaces(this.meshes, region));
    }
    const eyeColor = new THREE.Color(cfg.eyeColor || 0xdff9ff).multiplyScalar(1);
    this.eyeGlows = _eyeSets.get(key).map(({ geometry, map, emis }) => {
      const mesh = new THREE.Mesh(geometry, eyeGlowMaterial(map, emis, eyeColor));
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    });
    this.eyeSprites = this.eyeGlows.length ? [] : info.eyes.map((p) => { const s = sprite(cfg.eyeColor || 0xdff9ff, cfg.eyesOnly ? 0.03 : 0.02, 1, 3); s.position.copy(p).add(new THREE.Vector3(0, 0, 0.01)); return s; });
    this.flames = [];
    if (cfg.glow !== false) {
      for (const p of info.feet) {
        const f = thrusterFlame(0x8fd8ff);
        f.position.copy(p);
        f.scale.set(this.height / 1.9 * 1.2, 0.001, this.height / 1.9 * 1.2);
        this.root.add(f);
        this.flames.push(f);
      }
    }
    if (light && info.reactor) {
      this.reactorLight = new THREE.PointLight(0x9ff3ff, 0, 3, 2);
      this.reactorLight.position.copy(info.reactor).add(new THREE.Vector3(0, 0, 0.5));
      this.root.add(this.reactorLight);
    }

    // outward directions for the exploded view, and the order and paths for assembly
    const centre = new THREE.Vector3(0, cfg.height * 0.55, 0), wp = new THREE.Vector3(), c = new THREE.Vector3();
    for (const m of this.meshes) {
      m.userData.base = m.position.clone();
      m.userData.baseRot = m.rotation.clone();
      m.geometry.computeBoundingBox();
      m.geometry.boundingBox.getCenter(c);
      wp.copy(c).applyMatrix4(m.matrixWorld);
      const d = wp.clone().sub(centre); d.y *= 0.5;
      m.userData.worldCentre = wp.clone();
      // the direction in the mesh's parent space (so offsets move it the right way)
      const inv = new THREE.Matrix4().copy(m.parent.matrixWorld).invert();
      const a = centre.clone().applyMatrix4(inv), b = centre.clone().add(d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(0, 1, 0)).applyMatrix4(inv);
      m.userData.out = b.sub(a); // one metre outward, in local units
      this.pieces.push({ mesh: m, y: wp.y, spin: new THREE.Vector3(Math.random() * 3 - 1.5, Math.random() * 3 - 1.5, Math.random() * 3 - 1.5), far: 1.2 + Math.random() * 1.4, lift: Math.random() * 0.8 - 0.3 });
    }
    this.pieces.sort((p, q) => p.y - q.y); // boots first, helmet last
    if (cfg.rig) this._buildRig(cfg.rig);
    if (!pieces) this._merge();
  }

  /** Plates that share a material and move together become one mesh (per arm segment, and the body). */
  _merge() {
    if (this.rig) for (const arm of [this.rig.l, this.rig.r]) for (const g of [arm.shoulder, arm.elbow, arm.wrist]) mergeStatic(g, g.children.filter((c) => c.isMesh));
    mergeStatic(this.model);
    this.meshes = [];
    this.root.traverse((o) => { if (o.isMesh && !o.isSprite && !this.flames.includes(o)) this.meshes.push(o); });
    this._originalMats = new Map(this.meshes.map((m) => [m, m.material]));
    this.pieces = [];
  }

  /** Blend toward a pose (REAL_POSES name). Only rigged models move; the others hold their sculpted pose. */
  pose(name, snap = 0) {
    if (!this.rig) return;
    const p = REAL_POSES[name] || REAL_POSES.stand;
    this.poseName = name;
    for (const side of ['l', 'r']) {
      const a = p[side], S = side === 'l' ? 1 : -1, arm = this.rig[side];
      // shoulder: swing down (about z), then toward the front (about y)
      arm.tShoulder.setFromAxisAngle(_ax.y, -S * a.fwd).multiply(_qa.setFromAxisAngle(_ax.z, -S * a.down));
      arm.tElbow.setFromAxisAngle(_ax.y, -S * a.elbow);
      arm.tWrist.setFromAxisAngle(_ax.z, S * a.wrist);
      if (snap >= 1) { arm.shoulder.quaternion.copy(arm.tShoulder); arm.elbow.quaternion.copy(arm.tElbow); arm.wrist.quaternion.copy(arm.tWrist); }
    }
  }

  _buildRig(r) {
    // pivots in the root's (normalized) space; every plate beyond them is re-parented, keeping its place
    const make = (S) => {
      const shoulder = new THREE.Group(); shoulder.position.set(S * r.shoulder, r.armY, 0); this.root.add(shoulder);
      const elbow = new THREE.Group(); elbow.position.set(S * (r.elbow - r.shoulder), 0, 0); shoulder.add(elbow);
      const wrist = new THREE.Group(); wrist.position.set(S * (r.wrist - r.elbow), 0, 0); elbow.add(wrist);
      return { shoulder, elbow, wrist, tShoulder: new THREE.Quaternion(), tElbow: new THREE.Quaternion(), tWrist: new THREE.Quaternion(), S };
    };
    this.rig = { l: make(1), r: make(-1) };
    this.root.updateMatrixWorld(true);
    for (const m of this.meshes) {
      const c = m.userData.worldCentre; // (root at the origin during build)
      if (c.y < r.minY || Math.abs(c.x) < r.pauldron) continue;
      const arm = this.rig[c.x > 0 ? 'l' : 'r'];
      const ax = Math.abs(c.x);
      const g = ax >= r.wrist ? arm.wrist : ax >= r.elbow ? arm.elbow : arm.shoulder;
      g.attach(m);
      m.userData.rigged = true;
      // its rest place and outward direction, now in its new parent's space
      m.userData.base = m.position.clone();
      m.userData.baseRot = m.rotation.clone();
      g.updateMatrixWorld(true);
      const centre = new THREE.Vector3(0, this.cfg.height * 0.55, 0);
      const d = c.clone().sub(centre); d.y *= 0.5; d.normalize();
      const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
      m.userData.out = centre.clone().add(d).applyMatrix4(inv).sub(centre.clone().applyMatrix4(inv));
    }
    this.pose('stand', 1);
  }

  setHologram(on, color = 0x5fe3ff) {
    if (on) {
      this._holo = this._holo || holoMaterial(color);
      for (const m of this.meshes) m.material = this._holo;
    } else for (const m of this.meshes) m.material = this._originalMats.get(m);
    this.hologram = on;
  }

  /** Pull the parts apart (0 = assembled, 1 = exploded). Works best on models made of many parts. */
  explode(t) {
    const e = easeOutCubic(clamp(t, 0, 1)) * 0.5;
    for (const m of this.meshes) m.position.copy(m.userData.base).addScaledVector(m.userData.out, e);
  }

  /** Plate-by-plate assembly, t 0..1: parts fly in from around the body, feet first. Returns the last landed index. */
  assemble(t) {
    const n = this.pieces.length;
    let landed = -1;
    this.pieces.forEach((p, i) => {
      const start = (i / n) * 0.78, local = clamp((t - start) / 0.22, 0, 1);
      const e = easeOutCubic(local), m = p.mesh;
      m.visible = local > 0;
      m.position.copy(m.userData.base).addScaledVector(m.userData.out, (1 - e) * p.far);
      m.position.y += 0; // (the out vector already carries height)
      m.rotation.set(m.userData.baseRot.x + p.spin.x * (1 - e), m.userData.baseRot.y + p.spin.y * (1 - e), m.userData.baseRot.z + p.spin.z * (1 - e));
      if (local >= 1) landed = i;
    });
    return landed;
  }

  update(dt) {
    if (this.rig) {
      const k = 1 - Math.exp(-8 * dt);
      for (const arm of [this.rig.l, this.rig.r]) {
        arm.shoulder.quaternion.slerp(arm.tShoulder, k);
        arm.elbow.quaternion.slerp(arm.tElbow, k);
        arm.wrist.quaternion.slerp(arm.tWrist, k);
      }
    }
    const s = this._shown, e = 1 - Math.exp(-10 * dt);
    s.reactor += (this.reactor - s.reactor) * e;
    s.eyes += (this.eyes - s.eyes) * e;
    s.thrust += (this.thrust - s.thrust) * e;
    const t = shared.uTime.value;
    const flick = 0.92 + Math.sin(t * 31) * 0.04 + Math.sin(t * 17) * 0.04;
    if (this.reactorCore) {
      this.reactorCore.material.opacity = clamp(s.reactor * 1.1, 0, 1) * flick;
      this.reactorCore.scale.setScalar(0.035 + s.reactor * 0.03);
      this.reactorHalo.material.opacity = s.reactor * 0.4 * flick;
      this.reactorHalo.scale.setScalar(0.08 + s.reactor * 0.12);
    }
    if (this.reactorLight) this.reactorLight.intensity = s.reactor * 0.6;
    for (const m of this._emissive) m.emissiveIntensity = m.userData.baseEmissive * (0.06 + s.reactor * 0.6);
    for (const sp of this.eyeSprites || []) sp.material.opacity = s.eyes * 0.8;
    for (const g of this.eyeGlows || []) { const u = g.material.uniforms?.uGain; if (u) u.value = s.eyes * 4.5 * flick; }
    for (const g of this.reactorGlows || []) { const u = g.material.uniforms?.uGain; if (u) u.value = s.reactor * 3.2 * flick; }
    for (const f of this.flames) {
      f.userData.power.value = s.thrust;
      f.scale.y = Math.max(0.001, s.thrust * (0.55 + Math.random() * 0.12) * this.height / 1.9);
      f.visible = s.thrust > 0.01;
    }
  }

  /** World positions for aiming effects. */
  reactorWorld(pos = new THREE.Vector3()) {
    return pos.copy(this.info.reactor || new THREE.Vector3(0, this.height * 0.7, 0.15)).applyMatrix4(this.root.matrixWorld);
  }

  headWorld(pos = new THREE.Vector3()) {
    return pos.set(0, this.height * 0.93, 0.05).applyMatrix4(this.root.matrixWorld);
  }

  palmWorld(side, pos = new THREE.Vector3(), dir = new THREE.Vector3()) {
    if (this.rig) {
      const arm = this.rig[side === 'l' ? 'l' : 'r'], w = arm.wrist;
      w.updateWorldMatrix(true, false);
      pos.set(arm.S * 0.09, -0.02, 0).applyMatrix4(w.matrixWorld);
      dir.set(0, -1, 0).transformDirection(w.matrixWorld); // the palm faces down in the sculpted T-pose
      return { pos, dir };
    }
    this.root.updateWorldMatrix(true, false);
    pos.copy(this.info.hands[side === 'l' ? 1 : 0]).applyMatrix4(this.root.matrixWorld);
    dir.set(0, 0, 1).transformDirection(this.root.matrixWorld);
    return { pos, dir };
  }
}

/** Credits for every model the site uses (shown in the credits panel). */
export const MODEL_CREDITS = Object.values(MODELS).map((m) => ({ title: m.title, author: m.author, license: m.license, source: m.source }));
