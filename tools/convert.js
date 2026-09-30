/*
 * Dev-only model converter: loads OBJ/FBX sources served by tools/assetsrv.cjs (port 5199), fixes their
 * materials and textures (downscaled, JPEG), and saves GLBs to public/models/ through the same server.
 * Run from the browser console: await convert.arc(), await convert.homecoming(), …
 */
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const SRC = 'http://localhost:5199/';
const log = (...a) => { document.getElementById('log').textContent += a.join(' ') + '\n'; console.log(...a); };

const imgCache = new Map();
function loadImage(url) {
  if (!imgCache.has(url)) {
    imgCache.set(url, new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; }));
  }
  return imgCache.get(url);
}

/** A texture from a URL, downscaled to `max`, marked for JPEG export (unless it needs alpha). */
async function tex(url, { max = 1024, srgb = true, alpha = false } = {}) {
  const im = await loadImage(url);
  if (!im) { log('  missing', url); return null; }
  const k = Math.min(1, max / Math.max(im.width, im.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const t = new THREE.Texture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = false;
  t.userData.mimeType = alpha ? 'image/png' : 'image/jpeg';
  t.needsUpdate = true;
  return t;
}

async function save(obj, name, maxTextureSize = 2048) {
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(obj, { binary: true, maxTextureSize, onlyVisible: true });
  await fetch(`${SRC}save/${name}`, { method: 'POST', body: glb });
  log(`saved ${name}: ${(glb.byteLength / 1e6).toFixed(1)} MB`);
}

function stats(obj) {
  let tris = 0, meshes = 0;
  obj.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  const box = new THREE.Box3().setFromObject(obj);
  return { meshes, tris: Math.round(tris), size: box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)) };
}

/** Re-index an OBJ mesh (OBJ meshes are non-indexed triangle soup) so it is smaller and smooth-shaded where it was. */
function tidy(mesh) {
  let g = mesh.geometry;
  g.deleteAttribute('color');
  g = mergeVertices(g, 1e-5);
  mesh.geometry = g;
}

async function loadOBJ(obj, mtl) {
  let materials = null;
  if (mtl) { materials = await new MTLLoader().setResourcePath(SRC).loadAsync(SRC + mtl); materials.preload(); }
  const l = new OBJLoader();
  if (materials) l.setMaterials(materials);
  return l.loadAsync(SRC + obj);
}

const metal = (color, rough = 0.35, metalness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness });

export const convert = {
  /** The arc reactor: a machined metal housing, copper coils, a glowing core. */
  async arc(map = null) {
    const root = await loadOBJ('arc.obj');
    log('arc', JSON.stringify(stats(root)));
    const M = {
      steel: metal(0xa7b0ba, 0.28, 1), dark: metal(0x2e3339, 0.45, 0.85), copper: metal(0xb86d34, 0.32, 1),
      glow: new THREE.MeshStandardMaterial({ color: 0xdff9ff, emissive: 0x8fecff, emissiveIntensity: 2.5, roughness: 0.2 }),
      ring: metal(0xc9d0d8, 0.18, 1),
    };
    for (const [k, m] of Object.entries(M)) m.name = k;
    const n = (name) => {
      if (map && map[name]) return map[name];
      if (/^Reacton_Chamber/.test(name)) return 'glow';
      // the ten wound coil blocks round the rim, the spiral heat sink, the cage at the back
      if (/^HeatSinkCoil|^Box03\d|^Box040|^Box002$|^Box02[2-9]|^Box030/.test(name)) return 'copper';
      if (/^Torus|^Cylinder00[5-6]/.test(name)) return 'ring';
      if (/^Box01\d|^Box02[01]/.test(name)) return 'steel';
      return 'dark';
    };
    const drop = [];
    root.traverse((o) => { if (!o.isMesh) return; if (o.name === 'Plane001') { drop.push(o); return; } tidy(o); o.material = M[n(o.name)]; });
    drop.forEach((o) => o.removeFromParent()); // a stray backdrop plane
    await save(root, 'arc-reactor.glb');
  },

  /** A full classic suit from an OBJ with flat red/gold/silver materials: given real painted metal. */
  async classicObj() {
    const root = await loadOBJ('jzb/IronMan/IronMan.obj', 'jzb/IronMan/IronMan.mtl');
    log('jzb', JSON.stringify(stats(root)));
    const paint = { red: new THREE.MeshPhysicalMaterial({ color: 0x8e0c18, metalness: 0.7, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 }),
      gold: new THREE.MeshPhysicalMaterial({ color: 0xc28b30, metalness: 0.9, roughness: 0.3, clearcoat: 0.6 }),
      silver: metal(0xa9b1ba, 0.3, 1), darksilver: metal(0x4a5058, 0.4, 0.9), glow: new THREE.MeshStandardMaterial({ color: 0xdff9ff, emissive: 0x9ff3ff, emissiveIntensity: 2 }) };
    for (const [k, m] of Object.entries(paint)) m.name = k;
    paint['Iron_man_leg:red'] = paint.red;
    paint.black = metal(0x16181b, 0.5, 0.6);
    paint.yellow = paint.glow;
    const gizmos = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // the rig's control shapes (circles and balls round the joints) are not armor
      if (mats.every((m) => m.name === 'lambert1')) { gizmos.push(o); return; }
      tidy(o);
      // and the balls round the joints and the root box: identical small closed shapes, off the body
      const tris = o.geometry.index.count / 3;
      const sz = new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position).getSize(new THREE.Vector3());
      const cube = Math.abs(sz.x - sz.y) < 0.6 && Math.abs(sz.y - sz.z) < 0.6;
      if ((tris === 2016 && cube && sz.x > 10 && sz.x < 13) || (tris <= 12 && cube && sz.x > 5)) { gizmos.push(o); return; }
      const out = mats.map((m) => paint[m.name] || paint.darksilver);
      o.material = out.length === 1 ? out[0] : out;
    });
    gizmos.forEach((o) => o.removeFromParent());
    log('  removed gizmos', gizmos.length, JSON.stringify(stats(root)));
    await save(root, 'mark-obj.glb');
  },

  /**
   * The Homecoming suit. The body's textures are UDIM tiles (1001–1010, laid out along u): the body is split
   * into one mesh per tile, each with that tile's maps and its UVs brought back into 0..1.
   */
  async homecoming() {
    const base = 'homecoming/';
    const root = await loadOBJ(base + 'HOMECOMING SUIT.obj', base + 'HOMECOMING SUIT.mtl');
    log('homecoming', JSON.stringify(stats(root)));
    const T = (set, tile, map) => `${SRC}${base}textures/HOMECOMING SUIT new head SUSBTANCE 2_${set}_${map}.${tile}.png`;
    const pbr = async (set, tile = 1001, { max = 1024, color = 0xffffff, rough = 1, metal = 1 } = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
      m.map = await tex(T(set, tile, 'BaseColor'), { max });
      m.normalMap = await tex(T(set, tile, 'Normal'), { max, srgb: false });
      m.roughnessMap = await tex(T(set, tile, 'Roughness'), { max: max / 2, srgb: false });
      m.metalnessMap = await tex(T(set, tile, 'Metallic'), { max: max / 2, srgb: false });
      m.name = `${set}_${tile}`;
      return m;
    };
    const group = new THREE.Group();
    const meshes = [];
    root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const g = o.geometry;
      g.deleteAttribute('color');
      const pos = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal;
      // each triangle to its material group (OBJ may carry several usemtl groups) and, for the body, its tile
      const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
      for (const gr of groups) {
        const mat = mats[gr.materialIndex || 0];
        const name = mat.name;
        const buckets = new Map();
        for (let t = gr.start; t < gr.start + gr.count; t += 3) {
          let tile = 1001;
          if (name.startsWith('Spider-man_HC_New') && uv) {
            const cu = (uv.getX(t) + uv.getX(t + 1) + uv.getX(t + 2)) / 3, cv = (uv.getY(t) + uv.getY(t + 1) + uv.getY(t + 2)) / 3;
            tile = 1001 + Math.floor(cu) + 10 * Math.floor(cv);
          }
          if (!buckets.has(tile)) buckets.set(tile, []);
          buckets.get(tile).push(t);
        }
        for (const [tile, tris] of buckets) {
          const n = tris.length * 3;
          const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
          const du = (tile - 1001) % 10, dv = Math.floor((tile - 1001) / 10);
          tris.forEach((t, k) => {
            for (let j = 0; j < 3; j++) {
              const s = t + j, d = k * 3 + j;
              P.set([pos.getX(s), pos.getY(s), pos.getZ(s)], d * 3);
              if (nrm) N.set([nrm.getX(s), nrm.getY(s), nrm.getZ(s)], d * 3);
              if (uv) U.set([uv.getX(s) - du, 1 - (uv.getY(s) - dv)], d * 2); // glTF UVs run top-down
            }
          });
          let geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
          if (nrm) geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
          if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
          geo = mergeVertices(geo, 1e-5);
          let m;
          if (name.startsWith('Spider-man_HC_New')) m = await pbr('Spider-man_HC_New_3', tile, { max: 1024 });
          else if (name === 'LOGO_HC') m = await pbr('LOGO_HC', 1001, { max: 512 });
          else if (name.startsWith('Lenses')) m = await pbr('Lenses.001', 1001, { max: 512 });
          else if (name.startsWith('Frame')) m = await pbr('Frame.002', 1001, { max: 512 });
          else {
            // small parts keep their flat colours, as proper PBR
            const c = mat.color || new THREE.Color(0.2, 0.2, 0.2);
            m = new THREE.MeshStandardMaterial({ color: c, roughness: name.includes('Metal') ? 0.35 : 0.6, metalness: name.includes('Metal') || name.includes('cartridge') || name.includes('Cartridge') ? 0.8 : 0.1 });
            m.name = name;
          }
          const mesh = new THREE.Mesh(geo, m);
          mesh.name = `${o.name}_${tile}`;
          group.add(mesh);
        }
      }
    }
    log('  parts', group.children.length, JSON.stringify(stats(group)));
    await save(group, 'homecoming.glb', 1024);
  },

  /** A helmet out of a display scene (room, pedestal and spotlights dropped), textures kept. */
  async helmetA() {
    const { GLTFLoader: GL } = await import('three/addons/loaders/GLTFLoader.js');
    const g = await new GL().loadAsync('/public/models/helmet-a.glb');
    const keep = [];
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => { if (o.isMesh && /^ironhead/.test(o.name)) keep.push(o); });
    const root = new THREE.Group();
    for (const o of keep) {
      const m = o.clone();
      o.matrixWorld.decompose(m.position, m.quaternion, m.scale);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
        const t = m.material[k];
        if (t) t.userData.mimeType = k === 'map' || k === 'emissiveMap' ? 'image/jpeg' : 'image/jpeg';
      }
      root.add(m);
    }
    log('helmetA', JSON.stringify(stats(root)));
    await save(root, 'helmet-a.glb', 1024);
  },

  /** The heavy armor, from FBX: no paint in the file (only wear masks), so each part is painted by hand here. */
  async hulk() {
    const root = await new FBXLoader().loadAsync(SRC + 'hulk/Iron_Man_Mark_44_Hulkbuster/Iron_Man_Mark_44_Hulkbuster_fbx.FBX');
    const drop = [];
    root.traverse((o) => { if (o.isMesh && /^Plane01[7-9]$|^Plane020$/.test(o.name)) drop.push(o); });
    drop.forEach((o) => o.removeFromParent()); // four display plates under its feet
    const P = {
      red: new THREE.MeshPhysicalMaterial({ color: 0x8a0c17, metalness: 0.65, roughness: 0.36, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      gold: new THREE.MeshPhysicalMaterial({ color: 0xb8842c, metalness: 0.9, roughness: 0.32, clearcoat: 0.5 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x8d949c, metalness: 1, roughness: 0.32 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.85, roughness: 0.45 }),
      glow: new THREE.MeshStandardMaterial({ color: 0xdff9ff, emissive: 0x9ff3ff, emissiveIntensity: 2.5 }),
    };
    for (const [k, m] of Object.entries(P)) m.name = k;
    const paint = (n) => {
      if (n === 'Object086') return 'glow';
      if (/^Object(099|100|073|005|080|081|076|033)$/.test(n)) return 'gold';
      if (/^Object(092|087|088)$/.test(n)) return 'steel';
      if (/^(Cylinder|Object0(3[5-9]|4\d|5[0-5]|6[0-4]|6[6-9]|7[01])$|Object0(74|79|78|15|97|98|83|91)$)/.test(n)) return 'dark';
      return 'red';
    };
    let tris = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry;
      for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
      g.clearGroups();
      g = mergeVertices(g, 1e-4);
      o.geometry = g;
      tris += g.index.count / 3;
      o.material = P[paint(o.name)];
    });
    log('hulk tris', Math.round(tris));
    await save(root, 'mark-heavy.glb');
  },
};
/* ---------------- preview ---------------- */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
let _view = null;
/** Shows a model: preview('models/x.glb' | Object3D, { yaw, pitch, dist, labels }) ; returns the root. */
export async function preview(src, { yaw = 0.5, pitch = 0.15, dist = 2.4, labels = false } = {}) {
  if (!_view) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d22);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(3, 5, 4); scene.add(key);
    _view = { renderer, scene, camera: new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 1000), root: null };
  }
  const v = _view;
  if (v.root) v.scene.remove(v.root);
  const root = typeof src === 'string' ? (await new GLTFLoader().loadAsync('/public/' + src.replace(/^\/?public\//, ''))).scene : src;
  // fit to a unit height
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = 1.8 / Math.max(size.x, size.y, size.z);
  const wrap = new THREE.Group(); root.position.sub(c); wrap.add(root); wrap.scale.setScalar(s);
  v.root = wrap; v.scene.add(wrap);
  v.camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
  v.camera.lookAt(0, 0, 0);
  window.__cam = v.camera;
  v.renderer.render(v.scene, v.camera);
  if (labels) {
    document.querySelectorAll('.lbl').forEach((e) => e.remove());
    root.traverse((o) => {
      if (!o.isMesh) return;
      const p = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).project(v.camera);
      const d = document.createElement('div'); d.className = 'lbl'; d.textContent = o.name;
      Object.assign(d.style, { position: 'fixed', left: `${(p.x + 1) / 2 * innerWidth}px`, top: `${(1 - p.y) / 2 * innerHeight}px`, color: '#ff0', font: '10px monospace' });
      document.body.append(d);
    });
  }
  return { root, size: size.toArray().map((x) => +x.toFixed(3)), center: c.toArray().map((x) => +x.toFixed(3)), stats: stats(root) };
}
window.preview = preview;
/** Saves what the preview shows as scratch/assets/shot-<name>.jpg (for looking at models without the pane). */
window.shot = async (name = 'view') => {
  const blob = await new Promise((r) => _view.renderer.domElement.toBlob(r, 'image/jpeg', 0.85));
  await fetch(`${SRC}save/shot-${name}.jpg`, { method: 'POST', body: await blob.arrayBuffer() });
  return name;
};
window.THREE = THREE;
window.convert = convert;
log('converter ready: await convert.arc() | convert.classicObj() | convert.homecoming() | convert.hulk()');
