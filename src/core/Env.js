import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { fetchBinary } from './Assets.js';

/*
 * Real-world light and surfaces (all CC0, from Poly Haven; fetched by tools/fetch_polyhaven.py):
 *
 *   await loadEnv('venice_sunset', { backdrop: true });   // in a chapter's load()
 *   scene.environment = envMap('venice_sunset');           // image-based light: reflections + ambient
 *   scene.background = backdrop('venice_sunset');          // the photographed sky, 4k (only some have one)
 *
 *   await loadTextures(['concrete_floor_worn_001']);
 *   const floor = pbr('concrete_floor_worn_001', { repeat: 6 });  // a MeshStandardMaterial with colour,
 *                                                                   // normal and AO/roughness/metal maps
 *
 * Everything is cached: an HDRI is decoded and prefiltered (PMREM) once, a texture set is uploaded once,
 * and every pbr() material shares the same images (only the tiling differs).
 */

export const HDRIS = {
  studio: 'studio_small_08',
  shop: 'machine_shop_02',
  foundry: 'industrial_workshop_foundry',
  sunset: 'venice_sunset',
  fire: 'the_sky_is_on_fire',
  moonrise: 'qwantani_moonrise_puresky',
};

const ENV = './env/';
const TEX = './tex/';
let _renderer = null;
let _pmrem = null;
const _envLoads = new Map(); // name -> Promise
const _env = new Map();      // name -> prefiltered env texture
const _bg = new Map();       // name -> equirect backdrop texture
const _texLoads = new Map(); // set -> Promise
const _tex = new Map();      // set -> { diff, nor, arm }

/** Call once at start-up with the renderer (prefiltering needs it). */
export function initEnv(renderer) {
  _renderer = renderer;
}

function decodeHDR(buf) {
  const loader = new HDRLoader();
  const data = loader.parse(buf);
  const tex = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, data.type);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

function loadImage(url, srgb) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

/** Loads (once) an HDRI's light, and with backdrop: true its 4k sky image too. */
export function loadEnv(name, { backdrop = false } = {}) {
  const key = name + (backdrop ? '+bg' : '');
  if (!_envLoads.has(key)) {
    const jobs = [];
    if (!_env.has(name)) {
      jobs.push(fetchBinary(ENV + name + '.hdr').then((buf) => {
        if (!buf || _env.has(name)) return;
        try {
          const hdr = decodeHDR(buf);
          if (_renderer) {
            _pmrem ||= new THREE.PMREMGenerator(_renderer);
            _env.set(name, _pmrem.fromEquirectangular(hdr).texture);
            hdr.dispose();
          } else {
            _env.set(name, hdr);
          }
        } catch (e) { console.warn('[env]', name, e); }
      }));
    }
    if (backdrop && !_bg.has(name)) {
      jobs.push(loadImage(ENV + name + '_bg.jpg', true).then((t) => {
        if (!t) return;
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.anisotropy = 4;
        _bg.set(name, t);
      }));
    }
    _envLoads.set(key, Promise.all(jobs));
  }
  return _envLoads.get(key);
}

/** The prefiltered light of a loaded HDRI (null if it is missing). */
export function envMap(name) { return _env.get(name) || null; }

/** The sky image of a loaded HDRI (null if it has none). */
export function backdrop(name) { return _bg.get(name) || null; }

/** Loads (once) PBR texture sets: colour, OpenGL normal, and AO/roughness/metalness packed (ARM). */
export function loadTextures(sets) {
  return Promise.all(sets.map((set) => {
    if (!_texLoads.has(set)) {
      _texLoads.set(set, Promise.all([
        loadImage(`${TEX}${set}/diff.jpg`, true),
        loadImage(`${TEX}${set}/nor.jpg`, false),
        loadImage(`${TEX}${set}/arm.jpg`, false),
      ]).then(([diff, nor, arm]) => {
        if (!diff) return;
        const aniso = _renderer ? Math.min(8, _renderer.capabilities.getMaxAnisotropy()) : 4;
        for (const t of [diff, nor, arm]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; }
        _tex.set(set, { diff, nor, arm });
      }));
    }
    return _texLoads.get(set);
  }));
}

export function hasTextures(set) { return _tex.has(set); }

/**
 * A MeshStandardMaterial from a loaded texture set. Options: repeat (number or [x, y]), color (a tint),
 * roughness / metalness (multipliers on the maps), normalScale, aoMapIntensity, envMapIntensity,
 * plus any other material parameter. Falls back to a plain material of `fallback` colour when missing.
 * AO needs a second UV set on some three versions; the maps use uv channel 0 here.
 */
export function pbr(set, opts = {}) {
  const { repeat = 1, color = 0xffffff, roughness = 1, metalness = 1, normalScale = 1, aoMapIntensity = 1, fallback = 0x777777, offset = null, ...rest } = opts;
  const t = _tex.get(set);
  if (!t) return new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.8, metalness: 0, ...rest });
  const [rx, ry] = Array.isArray(repeat) ? repeat : [repeat, repeat];
  const tile = (src) => {
    if (!src) return null;
    const c = src.clone();
    c.repeat.set(rx, ry);
    if (offset) c.offset.set(offset[0], offset[1]);
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    map: tile(t.diff),
    normalMap: tile(t.nor),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: tile(t.arm),
    metalnessMap: tile(t.arm),
    aoMap: tile(t.arm),
    aoMapIntensity,
    color,
    roughness,
    metalness,
    ...rest,
  });
}
