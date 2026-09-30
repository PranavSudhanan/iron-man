import './Cave.css';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Chapter } from '../core/Chapter.js';
import { CineCam } from '../core/CineCam.js';
import { mergeStatic } from '../core/mergeStatic.js';
import { Suit, suitEnvironment } from '../objects/Suit.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { Explosions, Shockwaves, glowSprite } from '../objects/FX.js';
import { rand, damp, clamp, lerp, easeInOut, h, drawTexture } from '../core/utils.js';
import { loadEnv, envMap, loadTextures, pbr, hasTextures, HDRIS } from '../core/Env.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

/*
 * The Cave: captured and held underground, he builds a reactor and a crude suit from scrap. A five-step
 * build: forge the reactor (hold), hammer the plates (tap), weld the Mark I together (the detailed model is
 * revealed from the boots up behind a moving clip plane), power it up (hold) and
 * break out through the barricade toward a sliver of daylight (a short cinematic).
 */

const STEPS = [
  { name: 'Forge the reactor', hint: 'Hold on the glowing core on the workbench', btn: 'Forge' },
  { name: 'Hammer the plates', hint: 'Tap each red-hot plate three times', btn: 'Hammer' },
  { name: 'Assemble', hint: 'Tap the frame to weld the armor together', btn: 'Weld' },
  { name: 'Power up', hint: 'Hold to bring the suit to life', btn: 'Power up' },
  { name: 'Break out', hint: 'Blast through the barricade', btn: 'Break out' },
];

// camera framings per step: [position, look]
const SHOTS = [
  [[-1.05, 1.65, 2.35], [-2.1, 1.0, 0.55]],
  [[1.25, 2.05, 2.75], [2.15, 0.88, 0.62]],
  [[0.35, 1.5, 4.3], [0, 1.05, 0]],
  [[0.2, 1.62, 2.3], [0, 1.42, 0]],
  [[2.1, 1.35, 4.0], [0, 1.0, 0.8]],
  [[0.6, 1.1, 2.2], [0, 2.4, 9.5]],
];

/* ---- a little value noise for the rock ---- */
const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = sm(x - ix), fy = sm(y - iy), fz = sm(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
const fbm = (x, y, z) => vnoise(x, y, z) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.15;

/** Displaces a geometry's vertices along their direction from `centre` by rock noise; colours the crevices. */
function rockify(geo, centre, amount, freq, dark, light) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  const cols = new Float32Array(pos.count * 3);
  const cd = new THREE.Color(dark), cl = new THREE.Color(light), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    d.copy(v).sub(centre).normalize();
    const n = fbm(v.x * freq + 11, v.y * freq + 3, v.z * freq + 7);
    v.addScaledVector(d, (n - 0.35) * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
    c.copy(cd).lerp(cl, clamp(n * 1.3 - 0.1, 0, 1));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * A photographed PBR surface (colour, normal, AO/roughness/metal) projected from world space along the three
 * axes and blended by the surface normal, so a lumpy cave or a pile of scrap takes the texture at a true,
 * even scale with no stretched UVs. `scale` is tiles per metre. Static meshes only (it is fixed to the world).
 *   stretch  squashes the side projections horizontally (<1 lengthens features into bedding layers)
 *   warp     bends the projection with noise, so a regular pattern (a coursed stone wall) becomes natural,
 *            irregular fracturing
 *   dust     a second texture set (colour only) settled on every upward-facing ledge, with `dustColor`
 * With `cheap` the normal map is skipped.
 */
function triplanar(set, { scale = 0.5, color = 0xffffff, roughness = 1, metalness = 0, metalMap = false, normalScale = 1, ao = 1, stretch = 1, warp = 0, blur = 0, norSet = null, norScale = 1, dust = null, dustScale = 0.6, dustColor = 0xffffff, cheap = false, fallback = 0x4a3c30, ...rest } = {}) {
  const src = pbr(set, {});
  if (!src.map) return new THREE.MeshStandardMaterial({ color: fallback, roughness: Math.min(1, 0.9 * roughness), metalness, ...rest });
  const dustSrc = dust ? pbr(dust, {}) : null;
  const norSrc = norSet ? pbr(norSet, {}) : null;
  // (anisotropic filtering is costly across three projections on a small GPU: a little is enough here)
  for (const t of [src.map, src.normalMap, src.roughnessMap, dustSrc?.map, norSrc?.normalMap]) if (t) t.anisotropy = 2;
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...rest });
  const uni = {
    tDiff: { value: src.map }, tNor: { value: norSrc?.normalMap || src.normalMap }, tArm: { value: src.roughnessMap },
    tDust: { value: dustSrc?.map || src.map },
    uTri: { value: new THREE.Vector4(scale, normalScale, ao, metalMap ? 1 : 0) },
    uTri2: { value: new THREE.Vector4(stretch, warp, dustScale, blur) },
    uNorScale: { value: norSrc?.normalMap ? norScale : 1 },
    uDustCol: { value: new THREE.Color(dustColor) },
  };
  mat.defines = {};
  if (cheap) mat.defines.TRI_CHEAP = '';
  if (warp) mat.defines.TRI_WARP = '';
  if (dustSrc?.map) mat.defines.TRI_DUST = '';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    const NOISE = `
        float triH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float triN(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(triH(i), triH(i + vec2(1.0, 0.0)), f.x), mix(triH(i + vec2(0.0, 1.0)), triH(i + vec2(1.0, 1.0)), f.x), f.y);
        }`;
    // the warp and the dust drifts are low-frequency: worked out per vertex, not per pixel
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uTri; uniform vec4 uTri2;
        varying vec3 vTriP; varying vec3 vTriN; varying float vTriD;
        ${NOISE}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTriP = wp * uTri.x;
          #ifdef TRI_WARP
            vec3 q = wp * uTri.x * 0.6;
            vTriP += (vec3(triN(q.zy) + 0.5 * triN(q.xz * 2.3 + 5.1), triN(q.xy + 11.0) + 0.5 * triN(q.zy * 2.3 + 3.3), triN(q.xz + 17.3) + 0.5 * triN(q.xy * 2.3 + 9.7)) - 0.75) * uTri2.y;
          #endif
          vTriD = triN(wp.xz * 0.9) * 0.6 + triN(wp.xz * 3.1) * 0.4;
          vTriN = normalize(mat3(modelMatrix) * objectNormal);
          #ifdef FLIP_SIDED
            vTriN = -vTriN;
          #endif
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tDiff; uniform sampler2D tNor; uniform sampler2D tArm; uniform sampler2D tDust;
        uniform vec4 uTri; uniform vec4 uTri2; uniform vec3 uDustCol; uniform float uNorScale;
        varying vec3 vTriP; varying vec3 vTriN; varying float vTriD;
        vec3 triW; vec2 triX; vec2 triY; vec2 triZ; vec4 triArm; float triDust;
        // three projections, each read only where it contributes
        #define TRI3(tex, bias, out4) out4 = vec4(0.0); \
          if (triW.x > 0.01) out4 += texture2D(tex, triX, bias) * triW.x; \
          if (triW.y > 0.01) out4 += texture2D(tex, triY, bias) * triW.y; \
          if (triW.z > 0.01) out4 += texture2D(tex, triZ, bias) * triW.z;`)
      .replace('#include <map_fragment>', `{
          vec3 ng = normalize(vTriN);
          triW = pow(abs(ng), vec3(6.0)); triW = max(triW - 0.004, 0.0); triW /= (triW.x + triW.y + triW.z);
          triX = vTriP.zy * vec2(uTri2.x, 1.0);
          triY = vTriP.xz + 0.61;
          triZ = vTriP.xy * vec2(uTri2.x, 1.0) + 0.37;
          float bl = uTri2.w;
          vec4 c; TRI3(tDiff, bl, c)
          TRI3(tArm, bl, triArm)
          triDust = 0.0;
          #ifdef TRI_DUST
            // dust settles on what faces up, thicker in the hollows (low AO) and in drifts
            triDust = smoothstep(0.35, 0.8, ng.y + (vTriD - 0.5) * 0.5 + (1.0 - triArm.r) * 0.3);
            if (triDust > 0.001) {
              vec4 dc = texture2D(tDust, vTriP.xz * (uTri2.z / uTri.x)) * vec4(uDustCol, 1.0);
              c = mix(c, dc, triDust);
              triArm = mix(triArm, vec4(1.0, 1.0, 0.0, 1.0), triDust * 0.8);
            }
          #endif
          diffuseColor *= c;
          diffuseColor.rgb *= mix(1.0, triArm.r, 0.45 * uTri.z); // cavity darkening under direct light too
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * triArm.g;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * mix(1.0, triArm.b, uTri.w);')
      .replace('#include <normal_fragment_maps>', `
        #ifndef TRI_CHEAP
        {
          vec3 n = normalize(vTriN);
          vec3 tx = vec3(0.0, 0.0, 1.0), ty = tx, tz = tx;
          if (triW.x > 0.01) tx = texture2D(tNor, triX * uNorScale).xyz * 2.0 - 1.0;
          if (triW.y > 0.01) ty = texture2D(tNor, triY * uNorScale).xyz * 2.0 - 1.0;
          if (triW.z > 0.01) tz = texture2D(tNor, triZ * uNorScale).xyz * 2.0 - 1.0;
          float ns = uTri.y * (1.0 - triDust * 0.75);
          tx.xy *= ns; ty.xy *= ns; tz.xy *= ns;
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
          ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
          tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          vec3 wn = normalize(tx.zyx * triW.x + ty.xzy * triW.y + tz.xyz * triW.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }
        #endif`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(1.0, triArm.r, uTri.z);\nreflectedLight.indirectSpecular *= mix(1.0, triArm.r, uTri.z);');
  };
  mat.customProgramCacheKey = () => 'caveTriplanar' + Object.keys(mat.defines).join('');
  return mat;
}

/** Sawn, weathered planks: grain, knots and grime, drawn once. Grain runs along u (or v with `vertical`). */
function woodTexture(vertical = false) {
  const t = drawTexture(256, 512, (x, w, hh) => {
    x.fillStyle = '#6c5846'; x.fillRect(0, 0, w, hh);
    for (let i = 0; i < 260; i++) {
      const py = rand(0, hh), lw = rand(0.6, 3.5), dark = Math.random() < 0.6;
      x.strokeStyle = dark ? `rgba(38,24,14,${rand(0.08, 0.35)})` : `rgba(150,118,84,${rand(0.06, 0.22)})`;
      x.lineWidth = lw; x.beginPath();
      const ph = rand(0, 6), amp = rand(0.5, 3);
      for (let px = -8; px <= w + 8; px += 8) x.lineTo(px, py + Math.sin(px * 0.03 + ph) * amp);
      x.stroke();
    }
    for (let i = 0; i < 5; i++) { // knots
      const cx = rand(0, w), cy = rand(0, hh), r = rand(4, 10);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
      g.addColorStop(0, 'rgba(30,18,10,0.9)'); g.addColorStop(0.45, 'rgba(60,38,22,0.5)'); g.addColorStop(1, 'rgba(60,38,22,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, r * 3, r * 1.4, 0, 0, Math.PI * 2); x.fill();
    }
    for (let i = 0; i < 30; i++) { // grime and dust
      const cx = rand(0, w), cy = rand(0, hh), r = rand(20, 90);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, Math.random() < 0.6 ? 'rgba(25,18,12,0.25)' : 'rgba(170,150,120,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (vertical) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; }
  return t;
}

/** A glowing bed of coals: dark lumps with orange-hot gaps between them. */
function coalTexture() {
  return drawTexture(256, 256, (x, w) => {
    const c = w / 2;
    const g = x.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, '#ffb060'); g.addColorStop(0.55, '#ff5a10'); g.addColorStop(0.9, '#5a1402'); g.addColorStop(1, '#100400');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
    for (let i = 0; i < 170; i++) {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * c * 0.98, px = c + Math.cos(a) * r, py = c + Math.sin(a) * r, s = rand(6, 16);
      const lit = r / c;
      x.fillStyle = `rgba(${Math.round(18 + 30 * (1 - lit))},${Math.round(8 + 6 * (1 - lit))},4,${rand(0.75, 0.97)})`;
      x.beginPath();
      for (let k = 0; k < 6; k++) { const aa = k / 6 * Math.PI * 2 + rand(-0.3, 0.3), rr = s * rand(0.6, 1); x.lineTo(px + Math.cos(aa) * rr, py + Math.sin(aa) * rr); }
      x.closePath(); x.fill();
    }
  });
}

/** A soft round contact shadow (black, alpha falling off to the rim). */
function blobTexture() {
  return drawTexture(128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.5, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });
}

/** The cave floor's height (the same noise the floor mesh is displaced by). */
function floorHeight(x, z) {
  const n = fbm(x * 0.9, 0, z * 0.9);
  const edge = clamp((Math.abs(x) - 3.2) / 3, 0, 1);
  return (n - 0.5) * 0.08 + edge * edge * 0.9 * n;
}

/** A faint cone of light in the haze under a lamp, brightest at the bulb. */
function shaftMaterial(color, alpha) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
    vertexShader: /* glsl */ `
      varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.5); gl_FragColor = vec4(uColor, uAlpha * f * smoothstep(0.0, 0.7, vY) * (0.25 + 0.75 * vY * vY)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}

export class Cave extends Chapter {
  constructor(app) {
    super(app, { id: 'cave', title: 'The Cave', jp: 'MARK I' });
    // a high threshold: the riveted iron's highlights stay crisp; only the HDR glows (fire, sparks, lamp,
    // reactor, the weld) bloom
    this.bloom = { strength: 0.7, radius: 0.5, threshold: 2.8 };
    this.grade = { ...this.grade, grain: 0.028, vig: 0.48, ca: 0.0012, sat: 1, tint: 0xff9a4a, tintAmt: 0.03 };
    this.mood = 'calm';
    this.shiftView = 0.1;
    this.trailColor = '255,170,90';
    this.step = 0;
    this.clock = 0;
    this.timers = [];
    this._seen = false;
  }

  load() {
    return Promise.all([loadModels(['mk1', 'reactor']), loadEnv(HDRIS.foundry), loadTextures(['cliff_side', 'coast_sand_01', 'metal_plate', 'old_planks_02'])]);
  }

  /* ================================================================ */
  build() {
    const s = this.scene, low = this.app.low;
    this.app.renderer.localClippingEnabled = true; // the weld reveal (left on: other chapters are unaffected)
    // smoky, dusty air: everything recedes into a warm brown haze, never a black void
    const haze = 0x1b120b;
    s.background = new THREE.Color(haze);
    s.fog = new THREE.FogExp2(haze, 0.065);
    // the light of a real foundry for the Mark I's reflections (the scene-wide image light); the rock and props
    // carry the same map at a much lower strength of their own, so the room's lamps and fire dominate
    const env = envMap(HDRIS.foundry);
    s.environment = env || suitEnvironment();
    s.environmentIntensity = 0.3;
    const E = { envMap: s.environment, envMapIntensity: 0.2 };
    const EM = { envMap: s.environment, envMapIntensity: 0.3 };
    this.camera.fov = 46;
    this.camera.position.set(...SHOTS[0][0]);
    this.look = new THREE.Vector3(...SHOTS[0][1]);
    this.camPos = new THREE.Vector3(...SHOTS[0][0]);
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this._shotPos = new THREE.Vector3(); this._shotLook = new THREE.Vector3();

    /* ---- materials ---- */
    // photographed surfaces, projected in world space: weathered rock, dusty sand, scarred plate steel
    const tri = (set, o) => triplanar(set, { cheap: low, ...o });
    const woodTex = woodTexture(), woodTexV = woodTexture(true);
    const M = this.M = {
      rock: tri('cliff_side', { scale: 0.22, stretch: 1, warp: 0.15, color: 0xc4b09a, normalScale: 1.5, vertexColors: true, side: THREE.BackSide, dust: 'coast_sand_01', dustScale: 0.45, dustColor: 0x9a8264, ...E }),
      stone: tri('cliff_side', { scale: 0.45, stretch: 1, warp: 0.15, color: 0xb09c86, normalScale: 1.3, vertexColors: true, dust: 'coast_sand_01', dustScale: 0.45, dustColor: 0x9a8264, ...E }),
      floor: tri('coast_sand_01', { scale: 0.55, color: 0x8c7658, normalScale: 1.2, vertexColors: true, ...E }),
      // weathered planks (a photographed texture set); the drawn grain only if it failed to load
      wood: hasTextures('old_planks_02') ? pbr('old_planks_02', { repeat: 1, color: 0xd8c8b4, metalness: 0, ...E }) : new THREE.MeshStandardMaterial({ map: woodTex, color: 0xb8a48e, roughness: 0.84, metalness: 0, ...E }),
      woodDark: hasTextures('old_planks_02') ? pbr('old_planks_02', { repeat: 1, color: 0x8a7866, metalness: 0, ...E }) : new THREE.MeshStandardMaterial({ map: woodTex, color: 0x6a5846, roughness: 0.9, metalness: 0, ...E }),
      woodV: hasTextures('old_planks_02') ? pbr('old_planks_02', { repeat: [0.5, 1.5], color: 0xc8b8a2, metalness: 0, ...E }) : new THREE.MeshStandardMaterial({ map: woodTexV, color: 0xa08a72, roughness: 0.86, metalness: 0, ...E }),
      // scrap iron: the plate's rust and paint patina, blurred so its tread pattern is gone, pitted by a fine grit
      iron: tri('metal_plate', { scale: 0.8, blur: 4.5, norSet: 'coast_sand_01', norScale: 2.5, normalScale: 0.5, color: 0x9a8a7a, roughness: 0.95, metalness: 0.85, ...EM }),
      tread: tri('metal_plate', { scale: 1.4, color: 0x8a8480, roughness: 1.1, metalness: 1, metalMap: true, ...EM }),
      rust: tri('metal_plate', { scale: 0.7, blur: 4, norSet: 'coast_sand_01', norScale: 2, normalScale: 0.9, color: 0xc07448, roughness: 1.5, metalness: 0.2, ...EM }),
      olive: tri('metal_plate', { scale: 0.7, blur: 3.5, norSet: 'coast_sand_01', norScale: 2, normalScale: 0.4, color: 0x8a9068, roughness: 1.3, metalness: 0.25, ...EM }),
      dark: tri('metal_plate', { scale: 0.9, blur: 4.5, norSet: 'coast_sand_01', norScale: 2.5, normalScale: 0.4, color: 0x4a4644, roughness: 1.1, metalness: 0.7, ...EM }),
      cloth: tri('coast_sand_01', { scale: 3.5, color: 0x7a6a50, roughness: 1.2, normalScale: 0.6, ...E }),
    };
    this.M.plank = M.woodV;

    /* ---- the cave: a long, lumpy chamber seen from inside ---- */
    const caveC = new THREE.Vector3(0, 2, 1);
    const wallGeo = new THREE.SphereGeometry(1, low ? 72 : 130, low ? 44 : 80);
    wallGeo.scale(7, 4.6, 11); wallGeo.translate(caveC.x, caveC.y, caveC.z);
    rockify(wallGeo, caveC, 1.3, 0.55, 0x4a3e34, 0xffffff);
    {
      // a finer layer of ledges and knobs, and soot where the smoke has blackened the roof
      const p = wallGeo.attributes.position, col = wallGeo.attributes.color, v = new THREE.Vector3(), d = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        d.copy(v).sub(caveC).normalize();
        const n = vnoise(v.x * 2.3 + 5, v.y * 2.3, v.z * 2.3 + 9);
        const strata = Math.sin(v.y * 3.1 + vnoise(v.x * 0.7, 0, v.z * 0.7) * 3) * 0.05;
        v.addScaledVector(d, (n - 0.5) * 0.28 + strata);
        p.setXYZ(i, v.x, v.y, v.z);
        const soot = 1 - clamp((v.y - 2.6) / 2.2, 0, 1) * 0.55;
        const sootFire = 1 - clamp(1 - Math.hypot(v.x - 3.2, v.z + 0.2) / 3, 0, 1) * clamp((v.y - 1) / 3, 0, 1) * 0.5;
        col.setXYZ(i, col.getX(i) * soot * sootFire, col.getY(i) * soot * sootFire, col.getZ(i) * soot * sootFire);
      }
      wallGeo.computeVertexNormals();
    }
    const walls = new THREE.Mesh(wallGeo, M.rock);
    walls.receiveShadow = true;
    s.add(walls);
    const floorGeo = new THREE.PlaneGeometry(16, 26, low ? 60 : 110, low ? 90 : 170);
    floorGeo.rotateX(-Math.PI / 2); floorGeo.translate(0, 0, 1);
    {
      const p = floorGeo.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color(), a = new THREE.Color(0x5a4c3e), b = new THREE.Color(0xffffff);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const n = fbm(x * 0.9, 0, z * 0.9);
        const edge = clamp((Math.abs(x) - 3.2) / 3, 0, 1);
        // small stones and ruts in the dirt
        const fine = (vnoise(x * 6, 1, z * 6) - 0.5) * 0.025;
        p.setY(i, floorHeight(x, z) + fine);
        // trodden, darker dirt round the benches; paler dust drifted against the walls
        const worn = clamp(1 - Math.hypot(x * 0.5, (z - 0.6) * 0.45) / 2.2, 0, 1);
        c.copy(a).lerp(b, clamp(n * 1.1 + edge * 0.35 - worn * 0.35 + fine * 6, 0, 1)); cols.set([c.r, c.g, c.b], i * 3);
      }
      floorGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      floorGeo.computeVertexNormals();
    }
    const floor = new THREE.Mesh(floorGeo, M.floor);
    floor.receiveShadow = true;
    s.add(floor);

    /* ---- light: the swinging work lamp (the one shadow light), fire and a lantern, the reactor's glow ---- */
    s.add(new THREE.HemisphereLight(0x6e6254, 0x1a130d, 0.55));
    this.lampPivot = new THREE.Group();
    this.lampPivot.position.set(0.2, 5.6, 1.1);
    s.add(this.lampPivot);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.9, 5), M.dark);
    cable.position.y = -0.95;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0x4a4e3a, roughness: 0.65, metalness: 0.5, side: THREE.DoubleSide, ...EM }));
    shade.position.y = -1.95;
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd59a, toneMapped: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), this.bulbMat);
    bulb.position.y = -2.04;
    this.lampPivot.add(cable, shade, bulb);
    this.lamp = new THREE.SpotLight(0xffd4a4, 90, 18, 1.0, 0.75, 1.5);
    this.lamp.position.set(0, -2.05, 0);
    this.lamp.target.position.set(0, -6, 0);
    this.lamp.castShadow = !low;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.camera.near = 0.3;
    this.lamp.shadow.radius = 5;
    this.lampPivot.add(this.lamp, this.lamp.target);
    this.lampGlow = glowSprite(0xffb676, 0.45, 0.5);
    this.lampGlow.material.color.multiplyScalar(2.2);
    this.lampGlow.position.y = -2.06;
    this.lampPivot.add(this.lampGlow);
    // a faint cone of light in the smoke under the lamp
    if (!low) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 2.3, 3.4, 40, 1, true), shaftMaterial(0xffc890, 0.05));
      shaft.position.y = -2.05 - 1.7;
      this.lampPivot.add(shaft);
    }
    // a bare fluorescent tube strung up over the workbench on a wire: a cool, flat light against the fire
    {
      const tx = -2.0, ty = 2.95, tz = 0.35;
      if (low) { const p = new THREE.PointLight(0xe6efe4, 6, 7, 1.5); p.position.set(tx, ty - 0.2, tz); s.add(p); }
      else {
        RectAreaLightUniformsLib.init();
        const tube = new THREE.RectAreaLight(0xe6efe4, 45, 1.25, 0.1);
        tube.position.set(tx, ty - 0.03, tz); tube.lookAt(tx, 0, tz + 0.3);
        s.add(tube);
      }
      const tubeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xeef6ea).multiplyScalar(3.2), toneMapped: false });
      const tubeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.22, 10).rotateZ(Math.PI / 2), tubeMat);
      tubeMesh.position.set(tx, ty, tz); tubeMesh.rotation.y = 0.18;
      const hous = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 0.09), M.dark);
      hous.position.set(tx, ty + 0.035, tz); hous.rotation.y = 0.18;
      const wires = new THREE.Mesh(mergeGeometries([-0.55, 0.55].map((dx) => new THREE.CylinderGeometry(0.004, 0.004, 1.9, 4).translate(tx + dx * Math.cos(0.18), ty + 1, tz - dx * Math.sin(0.18)))), M.dark);
      s.add(tubeMesh, hous, wires);
    }
    // a kerosene lantern on the crates at the back (a practical: a flame in a glass globe)
    this.lantern = new THREE.PointLight(0xff9a48, 7, 9, 1.6); this.lantern.position.set(-3.55, 1.5, -2.35); s.add(this.lantern);
    this.lanternMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(4), toneMapped: false });
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8).scale(1, 1.8, 1), this.lanternMat);
    flame.position.set(-3.55, 1.43, -2.35);
    s.add(flame);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12).scale(1, 1.25, 1), new THREE.MeshStandardMaterial({ color: 0xffd0a0, emissive: 0xff9040, emissiveIntensity: 0.5, roughness: 0.15, transparent: true, opacity: 0.35, depthWrite: false }));
    globe.position.set(-3.55, 1.44, -2.35);
    s.add(globe);
    this.lanternGlow = glowSprite(0xffa050, 0.5, 0.35);
    this.lanternGlow.position.copy(globe.position);
    s.add(this.lanternGlow);
    // the brazier's fire and the hot plates on the forge share one warm, flickering light
    this.forgeLight = new THREE.PointLight(0xff6a1a, 0, 6, 1.8); this.forgeLight.position.set(2.8, 1.05, 0.3); s.add(this.forgeLight);
    this.coreLight = new THREE.PointLight(0x7fe8ff, 0, 5, 1.8); this.coreLight.position.set(-2.0, 1.35, 0.95); s.add(this.coreLight);
    this.dayLight = new THREE.SpotLight(0xfff0dc, 4, 22, 0.75, 0.9, 1.2); this.dayLight.position.set(0.2, 2.2, 10.2); this.dayLight.target.position.set(0, 0.4, 2); s.add(this.dayLight, this.dayLight.target);

    this._buildProps();
    this._buildReactor();
    this._buildPlates();
    this._buildBarricade();
    this._buildDaylight();

    /* ---- the Mark I on its frame: the detailed, riveted model (the procedural one if it is missing) ---- */
    const real = new RealSuit('mk1', { uniqueMaterials: true, castShadow: !low });
    this.real = real.ok;
    this.suit = real.ok ? real : new Suit({ scheme: 'mk1', castShadow: !low });
    this.suitH = this.suit.height || 1.95;
    s.add(this.suit.root);
    // the weld reveal: everything above the plane is cut away; the plane stays on these materials for good
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), -0.05);
    const mats = new Set();
    for (const m of this.suit.meshes) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
    for (const m of mats) { m.clippingPlanes = [this.clipPlane]; m.clipShadows = true; m.needsUpdate = true; }
    this.suitHalo = glowSprite(0x9ff3ff, 0.01, 0.8);
    this.suitHalo.material.color.multiplyScalar(3);
    this.suitHalo.visible = !this.real; // the real model has its own reactor glow
    s.add(this.suitHalo);
    // the weld line: a white-hot ring riding the clip height, with a glow
    const ringGeo = new THREE.TorusGeometry(1, 0.03, 6, 64); ringGeo.rotateX(Math.PI / 2);
    this.weldRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 2.4), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.weldRing.visible = false;
    s.add(this.weldRing);
    this.weldGlow = glowSprite(0xffc890, 1.2, 0.8);
    this.weldGlow.material.color.multiplyScalar(2.2);
    this.weldGlow.visible = false;
    s.add(this.weldGlow);
    this.weldR = 0.3;

    /* ---- particles ---- */
    this.dust = new ParticlePool({ count: 260, drag: 0.5, turbulence: 0.2, softness: 2 });
    // slow smoke from the brazier, pooling under the roof
    this.smoke = new ParticlePool({ count: low ? 24 : 60, blending: THREE.NormalBlending, drag: 0.25, turbulence: 0.06, softness: 2.4 });
    this.cSmokeHaze = [new THREE.Color(0x3a2c22), new THREE.Color(0x2e241c)];
    s.add(this.smoke.points);
    for (let i = 0; i < (low ? 12 : 30); i++) this._emitSmoke(rand(2, 14));
    this.embers = new ParticlePool({ count: 320, drag: 0.6, buoyancy: 0.9, turbulence: 0.9, softness: 1.2 });
    this.sparks = new ParticlePool({ count: 500, gravity: -7, drag: 0.7, softness: 1.1 });
    s.add(this.dust.points, this.embers.points, this.sparks.points);
    this.boom = new Explosions(s, { lights: 1, low });
    this.waves = new Shockwaves(s, 3);
    this.cDust = new THREE.Color(0xc89a70);
    // (HDR colours: pushed past the bloom threshold so they flare while the metal does not)
    const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
    this.cEmber = [hdr(0xff7a2a, 3), hdr(0xffb04a, 3), hdr(0xff5a1a, 3)];
    this.cSpark = [hdr(0xffe0a0, 4), hdr(0xffb35a, 4), hdr(0xffffff, 4)];
    this.cCyan = [hdr(0xbff6ff, 4), hdr(0x7fe8ff, 4), hdr(0xffffff, 4)];
    this.cWeld = [hdr(0xfff4e0, 5), hdr(0xffc070, 4.5), hdr(0xbfe8ff, 4)];
    for (const c of [...this.boom.cFire, ...this.boom.cSpark]) c.multiplyScalar(2.2);
    this.cSmoke = [new THREE.Color(0x3a3029), new THREE.Color(0x4a3e34)];

    this.cine = new CineCam(this.camera);
    this._buildUI();
    this._reset(true);
  }

  _buildProps() {
    const s = this.scene, M = this.M;
    const props = new THREE.Group();
    s.add(props);
    const box = (w, hh, d, mat, x, y, z, ry = 0, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = true; m.receiveShadow = true;
      props.add(m); return m;
    };
    const cyl = (rt, rb, hh, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 16) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, hh, seg), mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = true; m.receiveShadow = true;
      props.add(m); return m;
    };
    // the workbench (left): a scarred plank top, legs, a vise and tools
    box(1.9, 0.08, 0.9, M.wood, -2.2, 0.86, 0.5, 0.18);
    for (const [dx, dz] of [[-0.85, -0.38], [0.85, -0.38], [-0.85, 0.38], [0.85, 0.38]]) {
      const c = Math.cos(0.18), sn = Math.sin(0.18);
      box(0.08, 0.84, 0.08, M.woodDark, -2.2 + dx * c + dz * sn, 0.42, 0.5 - dx * sn + dz * c, 0.18);
    }
    box(1.7, 0.04, 0.7, M.woodDark, -2.2, 0.28, 0.5, 0.18);
    box(0.22, 0.12, 0.14, M.iron, -2.75, 0.96, 0.45, 0.18); // vise
    box(0.06, 0.16, 0.16, M.iron, -2.62, 0.98, 0.43, 0.18);
    cyl(0.012, 0.012, 0.36, M.iron, -2.7, 0.95, 0.62, 0, 0, Math.PI / 2);
    // hammer, wrench, pliers, screwdrivers
    cyl(0.018, 0.018, 0.34, M.woodDark, -1.7, 0.915, 0.82, 0, 0.9, Math.PI / 2);
    box(0.14, 0.05, 0.05, M.iron, -1.6, 0.93, 0.7, 0.9);
    box(0.28, 0.02, 0.04, M.iron, -1.55, 0.91, 0.28, -0.4);
    for (let i = 0; i < 4; i++) cyl(0.01, 0.01, 0.2, i % 2 ? M.rust : M.iron, -2.9 + i * 0.07, 0.905, 0.72, 0, 0.2 * i, Math.PI / 2, 6);
    // coils of wire, a car battery, jars
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 16), M.rust); t.position.set(-1.45 + i * 0.03, 0.92 + i * 0.03, 0.2); t.rotation.x = Math.PI / 2; t.castShadow = true; props.add(t); }
    box(0.3, 0.2, 0.18, M.dark, -3.05, 1.0, 0.3, 0.3);
    for (let i = 0; i < 3; i++) cyl(0.04, 0.04, 0.1, M.iron, -1.4 - i * 0.1, 0.95, 0.72, 0, 0, 0, 10);
    // the forge table (right): a steel slab on a brick stand, an anvil beside it
    box(1.6, 0.1, 0.95, M.tread, 2.2, 0.8, 0.6, -0.2);
    box(1.4, 0.75, 0.8, M.rust, 2.2, 0.375, 0.6, -0.2);
    box(0.5, 0.14, 0.24, M.dark, 3.35, 0.72, 1.35, -0.6);
    box(0.34, 0.5, 0.2, M.dark, 3.35, 0.4, 1.35, -0.6);
    box(0.48, 0.1, 0.32, M.dark, 3.35, 0.1, 1.35, -0.6);
    // coal brazier glowing faintly
    cyl(0.32, 0.26, 0.4, M.iron, 3.2, 0.2, -0.2);
    // the frame the suit hangs in
    for (const x of [-0.78, 0.78]) { cyl(0.05, 0.06, 2.45, M.rust, x, 1.22, -0.25); box(0.3, 0.06, 0.4, M.iron, x, 0.03, -0.25); }
    cyl(0.05, 0.05, 1.7, M.rust, 0, 2.45, -0.25, 0, 0, Math.PI / 2);
    for (const x of [-0.32, 0.32]) cyl(0.01, 0.01, 0.55, M.iron, x, 2.17, -0.2, 0.15, 0, 0, 5);
    // crates, barrels, sacks and missile scrap along the walls
    const crate = [[-4.2, -1.2, 0.4], [-3.6, -2.4, 1.1], [-4.4, 2.2, -0.3], [3.9, -2.0, 0.7], [4.4, -0.8, -0.2], [3.4, 3.0, 0.5]];
    crate.forEach(([x, z, r], i) => {
      const sz = i % 2 ? 0.7 : 0.9;
      box(sz, sz, sz, M.wood, x, sz / 2, z, r);
      if (i < 3) box(sz * 0.8, sz * 0.8, sz * 0.8, M.woodDark, x + 0.1, sz + sz * 0.4, z + 0.05, r + 0.4);
    });
    [[-3.2, -3.2], [-2.6, -3.5], [4.3, 1.2], [-4.0, 3.4]].forEach(([x, z], i) => cyl(0.3, 0.3, 0.86, i % 2 ? M.olive : M.rust, x, 0.43, z, 0, i, 0, 18));
    [[1.4, -3.6, 0.4], [-0.9, -3.8, -0.3]].forEach(([x, z, r]) => {
      cyl(0.22, 0.22, 2.2, M.olive, x, 0.24, z, 0, r, Math.PI / 2, 20);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 20), M.olive);
      cone.position.set(x + Math.cos(r) * 1.35, 0.24, z - Math.sin(r) * 1.35); cone.rotation.set(0, r, -Math.PI / 2); cone.castShadow = true; props.add(cone);
    });
    for (let i = 0; i < 26; i++) { // scrap heap
      const a = rand(0, Math.PI * 2), r = rand(0, 0.9);
      const x = 3.0 + Math.cos(a) * r, z = -2.9 + Math.sin(a) * r * 0.6;
      if (i % 3) box(rand(0.1, 0.4), rand(0.02, 0.06), rand(0.1, 0.3), i % 2 ? M.iron : M.rust, x, 0.05 + rand(0, 0.3) * (1 - r), z, rand(0, 3), rand(-0.6, 0.6), rand(-0.6, 0.6));
      else cyl(0.03, 0.03, rand(0.3, 0.7), M.iron, x, 0.1, z, rand(0, 3), rand(0, 3), Math.PI / 2, 8);
    }
    for (let i = 0; i < 4; i++) { // sacks
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), M.cloth);
      m.scale.set(1.2, 0.6, 0.8); m.position.set(-4.3 + i * 0.35, 0.18 + (i === 2 ? 0.3 : 0), 0.9 + (i % 2) * 0.3); m.castShadow = true; props.add(m);
    }
    // boulders
    for (let i = 0; i < 9; i++) {
      const g = new THREE.IcosahedronGeometry(rand(0.35, 0.9), 2);
      rockify(g, new THREE.Vector3(), 0.5, 1.6, 0x1a120c, 0x4a3a2c);
      const m = new THREE.Mesh(g, M.stone);
      const side = i % 2 ? 1 : -1;
      m.position.set(side * rand(4.2, 5.4), rand(0, 0.3), rand(-4, 7));
      m.castShadow = true; m.receiveShadow = true;
      props.add(m);
    }
    // the lantern's brass base and cap (its flame and globe are added with the lights)
    cyl(0.06, 0.07, 0.08, M.dark, -3.55, 1.3, -2.35, 0, 0, 0, 14);
    cyl(0.03, 0.065, 0.06, M.dark, -3.55, 1.57, -2.35, 0, 0, 0, 14);
    mergeStatic(props);
    // a bed of glowing coals in the brazier (a lit texture: dark lumps, hot gaps)
    this.coalBase = new THREE.Color(1, 1, 1).multiplyScalar(2.2);
    this.coals = new THREE.Mesh(new THREE.CircleGeometry(0.29, 28), new THREE.MeshBasicMaterial({ map: coalTexture(), color: this.coalBase.clone(), toneMapped: false }));
    this.coals.rotation.x = -Math.PI / 2; this.coals.position.set(3.2, 0.385, -0.2);
    s.add(this.coals);

    // contact shadows: soft dark pools where things meet the ground (the lamp's shadow alone reads as floating)
    const blobs = [
      [-2.2, 0.5, 2.3, 1.3, 0.18], [2.2, 0.6, 1.8, 1.2, -0.2], [3.35, 1.35, 0.8, 0.5, -0.6], [3.2, -0.2, 0.9, 0.9, 0],
      [-0.78, -0.25, 0.6, 0.6, 0], [0.78, -0.25, 0.6, 0.6, 0],
      ...crate.map(([x, z, r], i) => [x, z, (i % 2 ? 0.7 : 0.9) * 1.6, (i % 2 ? 0.7 : 0.9) * 1.6, r]),
      [-3.2, -3.2, 0.9, 0.9, 0], [-2.6, -3.5, 0.9, 0.9, 0], [4.3, 1.2, 0.9, 0.9, 0], [-4.0, 3.4, 0.9, 0.9, 0],
      [1.4, -3.6, 2.8, 0.7, 0.4], [-0.9, -3.8, 2.8, 0.7, -0.3], [3.0, -2.9, 2.2, 1.3, 0], [-3.8, 1.05, 1.8, 0.9, 0],
    ];
    const blobMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }), blobs.length);
    const d = new THREE.Object3D();
    blobs.forEach(([x, z, sx, sz, r], i) => {
      d.position.set(x, floorHeight(x, z) + 0.03, z); d.rotation.set(0, r, 0); d.scale.set(sx, 1, sz); d.updateMatrix();
      blobMesh.setMatrixAt(i, d.matrix);
    });
    blobMesh.renderOrder = 1;
    s.add(blobMesh);
  }

  /** A puff of smoke off the brazier (or, with `spread`, one already drifting somewhere under the roof). */
  _emitSmoke(spread = 0) {
    const c = this.cSmokeHaze[(Math.random() * 2) | 0];
    if (spread) {
      this.smoke.emit({ x: rand(-4, 4), y: rand(1.6, 4.2), z: rand(-4, 6), vx: rand(-0.05, 0.05), vy: rand(0, 0.03), vz: rand(-0.05, 0.05), life: spread + rand(4, 10), size: rand(1.6, 3.2), grow: 0.4, color: c, alpha: 0.1 });
    } else {
      this.smoke.emit({ x: 3.2 + rand(-0.15, 0.15), y: 0.6, z: -0.2 + rand(-0.15, 0.15), vx: rand(-0.08, 0.02), vy: rand(0.25, 0.4), vz: rand(-0.02, 0.08), life: rand(9, 14), size: rand(0.5, 0.9), grow: 3, color: c, alpha: 0.14 });
    }
  }

  /** The reactor model's own glowing chamber takes the forge's colour: dark, then orange-hot, then cyan. */
  _syncChamber() {
    for (const mat of this.reactorChamber) { mat.emissive.copy(this.coreMat.color).multiplyScalar(0.6); mat.emissiveIntensity = 1; mat.color.set(0x1a1a1a); }
  }

  _buildReactor() {
    const g = this.benchReactor = new THREE.Group();
    g.position.set(-2.05, 1.02, 0.66);
    g.rotation.set(-0.35, 0.55, 0);
    this.scene.add(g);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x331a0a, toneMapped: false });
    // the real arc reactor model (its own materials, so its chamber can glow with the forge's heat)
    const model = new RealSuit('reactor', { uniqueMaterials: true, castShadow: !this.app.low });
    if (model.ok) {
      const k = 0.24 / model.height;
      model.root.scale.setScalar(k);
      model.root.position.set(0, -model.size.y * k / 2, -0.03);
      g.add(model.root);
      this.reactorChamber = [];
      for (const m of model.meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat.name === 'glow' && !this.reactorChamber.includes(mat)) this.reactorChamber.push(mat);
      // a thin disc of light just in front of the chamber, which the heat colours
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.045, 24), this.coreMat);
      core.position.z = 0.012;
      core.material.transparent = true; core.material.blending = THREE.AdditiveBlending; core.material.depthWrite = false;
      g.add(core);
    } else {
      // (the model is missing: a simple stand-in)
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.024, 10, 32), this.M.iron));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 24).rotateX(Math.PI / 2), this.coreMat));
      this.reactorChamber = [];
    }
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), this.M.dark);
    stand.position.set(0, -0.14, -0.02);
    g.add(stand);
    this.coreGlow = glowSprite(0xff8a3a, 0.4, 0.2);
    this.coreGlow.position.set(-2.05, 1.03, 0.7);
    this.scene.add(this.coreGlow);
    // a generous invisible target for the pointer
    this.coreHit = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.coreHit.position.copy(g.position);
    this.scene.add(this.coreHit);
    this.cCoreCold = new THREE.Color(0x2a1408); this.cCoreHot = new THREE.Color(0xff7a1a); this.cCoreLit = new THREE.Color(0x9ff3ff);
  }

  _buildPlates() {
    this.plates = [];
    const geo = new THREE.BoxGeometry(0.34, 0.035, 0.26, 2, 1, 2);
    // hot iron: an uneven glow under patches of dark oxide scale
    const scaleTex = drawTexture(128, 128, (x, w) => {
      const g = x.createRadialGradient(w / 2, w / 2, w * 0.1, w / 2, w / 2, w * 0.72);
      g.addColorStop(0, '#b0b0b0'); g.addColorStop(1, '#ffffff');
      x.fillStyle = g; x.fillRect(0, 0, w, w);
      for (let i = 0; i < 70; i++) {
        const px = rand(0, w), py = rand(0, w), r = rand(3, 14);
        x.fillStyle = `rgba(20,20,20,${rand(0.25, 0.7)})`;
        x.beginPath(); x.ellipse(px, py, r, r * rand(0.4, 1), rand(0, 3), 0, Math.PI * 2); x.fill();
      }
    });
    const spots = [[1.62, 0.28], [1.98, 0.42], [2.34, 0.56], [2.2, 0.9], [2.62, 0.72]];
    this.cGrey = new THREE.Color(0x505356); this.cHotBase = new THREE.Color(0xa0461a); this.cHotEm = new THREE.Color(0xff3a08);
    spots.forEach(([x, z], i) => {
      const mat = pbr('coast_sand_01', { repeat: 0.5, offset: [i * 0.17, i * 0.29], color: 0x505356, roughness: 0.9, metalness: 0.85, normalScale: 0.5, emissive: 0xff5a10, emissiveIntensity: 1, envMap: this.scene.environment, envMapIntensity: 0.3, fallback: 0x505356 });
      mat.map = null; mat.metalnessMap = null; // forged steel: the sand only lends it pitting and scale
      mat.emissiveMap = scaleTex; // the heat glows through dark flakes of scale, brighter at the edges
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 0.874, z);
      m.rotation.y = rand(-0.5, 0.5);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.index = i;
      this.scene.add(m);
      this.plates.push({ mesh: m, mat, hits: 0, heat: 1, shown: 1, bend: 0 });
    });
    this.plateMeshes = this.plates.map((q) => q.mesh);
    // the hammer (a pivot at the grip)
    this.hammer = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 8), this.M.woodDark);
    handle.rotation.z = Math.PI / 2; handle.position.x = 0.21;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.07), this.M.iron);
    head.position.set(0.42, -0.02, 0);
    head.castShadow = true;
    this.hammer.add(handle, head);
    this.hammer.visible = false;
    this.scene.add(this.hammer);
    this.hammerAnim = { t: 1, plate: null, hit: true };
  }

  _buildBarricade() {
    this.planks = [];
    const add = (geo, mat, x, y, z, rz) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.z = rz;
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      this.planks.push({ mesh: m, base: m.position.clone(), baseRot: m.rotation.clone(), v: new THREE.Vector3(), av: new THREE.Vector3(), live: false });
    };
    const plank = new THREE.BoxGeometry(0.34, 3.2, 0.1);
    for (let i = 0; i < 8; i++) add(plank, this.M.plank,-1.3 + i * 0.37, 1.55, 6.3 + (i % 2) * 0.06, rand(-0.05, 0.05));
    const beam = new THREE.BoxGeometry(3.4, 0.2, 0.14);
    add(beam, this.M.woodDark, 0, 0.7, 6.18, 0.04);
    add(beam, this.M.woodDark, 0, 2.3, 6.18, -0.06);
    const sheet = new THREE.BoxGeometry(1.3, 1.1, 0.04);
    add(sheet, this.M.rust, 0.5, 1.4, 6.12, 0.1);
    add(sheet, this.M.olive, -0.8, 2.2, 6.1, -0.14);
  }

  _buildDaylight() {
    // a ragged crack in the rock with daylight behind it: a hot core, soft falloff (the camera sees it
    // through smoke), drawn once
    const tex = drawTexture(256, 512, (x, w, hh) => {
      const pts = [];
      for (let y = 8; y <= hh - 8; y += 10) {
        const k = y / hh, open = Math.sin(k * Math.PI) ** 0.8 * (0.075 + 0.05 * Math.sin(k * 9.0 + 1) + 0.03 * Math.sin(k * 23.0));
        const mid = 0.5 + Math.sin(k * 5.3) * 0.06 + Math.sin(k * 17.0) * 0.015;
        pts.push([w * (mid + open + rand(-0.03, 0.03)), w * (mid - open + rand(-0.03, 0.03)), y]);
      }
      const crack = (grow) => {
        x.beginPath();
        pts.forEach(([r, , y], i) => (i ? x.lineTo(r + grow, y) : x.moveTo(r + grow, y)));
        for (let i = pts.length - 1; i >= 0; i--) x.lineTo(pts[i][1] - grow, pts[i][2]);
        x.closePath(); x.fill();
      };
      x.filter = 'blur(10px)'; x.fillStyle = 'rgba(255,236,205,0.2)'; crack(10);
      x.filter = 'blur(2px)'; x.fillStyle = 'rgba(255,244,228,0.75)'; crack(2);
      x.filter = 'none'; x.fillStyle = 'rgba(255,252,246,1)'; crack(-3);
      // fade the halo out well before the edges of the card, so it never shows as a rectangle
      x.globalCompositeOperation = 'destination-in';
      const gx = x.createLinearGradient(0, 0, w, 0);
      gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.22, 'rgba(0,0,0,1)'); gx.addColorStop(0.78, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gx; x.fillRect(0, 0, w, hh);
      x.globalCompositeOperation = 'source-over';
    });
    this.slitMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0xfff2dc).multiplyScalar(3.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.slit = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3.0), this.slitMat);
    this.slit.position.set(0.2, 2.1, 10.1);
    this.slit.rotation.y = Math.PI;
    this.scene.add(this.slit);
    this.rayMat = new THREE.MeshBasicMaterial({ color: 0xffe6c0, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.2, 7, 20, 1, true), this.rayMat);
    ray.position.set(0.1, 1.8, 7.2); ray.rotation.x = Math.PI / 2 + 0.2;
    this.scene.add(ray);
  }

  _buildUI() {
    this.intro({
      kicker: 'Chapter 02 · Origin',
      title: 'The <em>Cave</em>',
      jp: 'MARK I',
      desc: 'Held prisoner in a cave and told to build a weapon, he builds a way out instead: a reactor to keep his heart going, and a suit of armor hammered from scrap. Work through the build log, one step at a time.',
      extra: [
        this.gestures([['hold', '<b>Hold</b> to forge &amp; power up'], ['tap', '<b>Tap</b> hot plates to hammer'], ['move', '<b>Move</b> to look around']]),
        h('div.stats', {}, [['2008', 'Year'], ['Scrap', 'Materials'], ['Mark I', 'Armor']].map(([v, k]) => h('div.stat', {}, h('b', { text: v }), h('span', { text: k })))),
      ],
    });
    this.stepEls = STEPS.map((st, i) => h('li', {}, h('i', { text: String(i + 1) }), h('b', { text: st.name }), h('span', { text: st.hint })));
    this.progText = h('p.cv-prog');
    this.progFill = h('div');
    this.progBar = h('div.cv-bar', {}, this.progFill);
    this.card = h('div.card.cv-card.pe', {},
      h('span.card-jp', { text: 'Build log · Mark I' }),
      h('h3', { text: 'Escape plan' }),
      h('ul.cv-steps', {}, this.stepEls),
      this.progText, this.progBar);
    this.ui.append(this.card);
    this.btnAct = this.button('Forge', () => this._action(), 'btn-primary');
    this.btnReset = this.button('Rebuild', () => { this._reset(); this.app.sfx.powerDown(); });
    this.ui.append(h('div.controls', {}, this.btnAct, h('div.group', {}, this.btnReset)));
    this.banner = h('div.big-title', {}, h('b', { text: 'Mark I' }), h('span', { text: 'Forged in the dark · Flown into the light' }));
    this.ui.append(this.banner);
  }

  /* ================================================================ */
  later(sec, fn) { this.timers.push({ t: this.clock + sec, fn }); }

  _reset(silent = false) {
    this.timers.length = 0;
    if (this.cine.active) { this.cine.onEnd = null; this.cine.stop(); }
    this.app.cinema(false);
    this.step = 0;
    this.forge = 0; this.autoHold = 0; this.holdShown = 0;
    this.reactorLit = false;
    this.benchReactor.visible = true;
    this.coreGlow.visible = true;
    this.assembling = false; this.assembleT = 0; this.lastLanded = -1; this.lastClank = 0;
    this.powered = false;
    this.breakT = -1; this._lastStepNo = -1;
    this.hammerAnim.t = 1; this.hammerAnim.plate = null; this.hammer.visible = false;
    for (const p of this.plates) { p.hits = 0; p.heat = 1; p.bend = 0; p.mesh.scale.set(1, 1, 1); }
    for (const p of this.planks) { p.mesh.position.copy(p.base); p.mesh.rotation.copy(p.baseRot); p.v.set(0, 0, 0); p.live = false; }
    const suit = this.suit;
    this.clipPlane.constant = -0.05; // fully cut away: only the empty frame shows
    this.weldRing.visible = false; this.weldGlow.visible = false;
    suit.reactor = 0; suit.eyes = 0; suit.faceOpen = 0; suit.thrust = 0;
    suit.root.position.set(0, 0, 0); suit.root.rotation.set(0, 0, 0);
    suit.pose?.('stand', 1); // (the model is shown as authored: no posing)
    this.daylight = 0;
    this.banner.classList.remove('on');
    this.app.sfx.thrust(0);
    this._syncUI();
    if (!silent) this.app.toast('Back to the bench. <b>Hold</b> the core to forge a new reactor.', 2600);
  }

  _setStep(n) {
    this.step = n;
    this.autoHold = 0;
    this._syncUI();
  }

  _syncUI() {
    this.stepEls.forEach((el, i) => {
      el.classList.toggle('done', i < this.step);
      el.classList.toggle('cur', i === this.step);
      el.firstChild.textContent = i < this.step ? '✓' : String(i + 1);
    });
    const st = STEPS[this.step];
    this.btnAct.hidden = !st || this.breakT >= 0;
    if (st) this.btnAct.innerHTML = st.btn;
    this.btnAct.classList.toggle('btn-gold', this.step === 4);
    this.btnAct.classList.toggle('btn-primary', this.step !== 4);
    this._prog = -1;
    this._progMsg = '';
    this._syncProgress();
  }

  _syncProgress() {
    let msg, p, cyan = false;
    let done = 0;
    for (const q of this.plates) if (q.hits >= 3) done++;
    switch (this.step) {
      case 0: msg = this.forge > 0.02 ? `Core heat ${Math.round(this.forge * 100)}%` : 'Core cold'; p = this.forge; break;
      case 1: msg = `Plates forged ${done} / 5`; p = done / 5; break;
      case 2: msg = this.assembling ? `Welding ${Math.min(100, Math.round(this.assembleT / 4 * 100))}%` : 'Frame ready: tap to weld'; p = Math.min(1, this.assembleT / 4); break;
      case 3: p = this.powered ? 1 : this.holdShown; msg = this.powered ? 'Reactor online · sealing' : `Reactor ${Math.round(p * 100)}%`; cyan = true; break;
      case 4: msg = this.breakT >= 0 ? 'Breaking out…' : 'Suit online. Ready.'; p = 1; cyan = true; break;
      default: msg = 'Free'; p = 1; cyan = true;
    }
    const pr = Math.round(p * 100);
    if (pr !== this._prog) { this._prog = pr; this.progFill.style.width = `${pr}%`; }
    if (msg !== this._progMsg) { this._progMsg = msg; this.progText.textContent = msg; }
    if (cyan !== this._cyan) { this._cyan = cyan; this.progBar.classList.toggle('cyan', cyan); }
  }

  /** The primary button: performs the current step (an alternative to the gesture). */
  _action() {
    switch (this.step) {
      case 0: case 3: this.autoHold = 1; break;
      case 1: { const p = this.plates.find((q) => q.hits < 3); if (p) this._strike(p); break; }
      case 2: this._startAssembly(); break;
      case 4: this._breakout(); break;
      default: break;
    }
  }

  /* ---- step 1: forge ---- */
  _forged() {
    const sfx = this.app.sfx;
    this.reactorLit = true;
    sfx.powerUp();
    this.app.flash(0.3, 0x9ff3ff);
    this.sparks.burst(this.benchReactor.position, 60, { speed: 3.5, up: 1.5, life: [0.3, 0.9], size: [0.02, 0.05], colors: this.cCyan });
    this.waves.spawn(this.benchReactor.position, { radius: 1.2, life: 0.8, normal: this._v.set(0.4, 0.3, 1) });
    this.app.toast('The reactor lives. Now <b>tap</b> the glowing plates to hammer them into armor.', 3200);
    this._setStep(1);
  }

  /* ---- step 2: hammer ---- */
  _strike(plate) {
    if (plate.hits >= 3 || this.hammerAnim.t < 1) return;
    this.hammerAnim.t = 0; this.hammerAnim.plate = plate; this.hammerAnim.hit = false;
    this.hammer.visible = true;
  }

  _impact(plate) {
    const sfx = this.app.sfx;
    plate.hits++;
    plate.heat = 1 - plate.hits / 3;
    plate.bend = 0.12;
    sfx.hammer();
    if (Math.random() < 0.6) sfx.spark();
    const pos = this._v.copy(plate.mesh.position); pos.y += 0.03;
    this.boom.spark(pos, 18 + (3 - plate.hits) * 8, 3.5);
    this.sparks.burst(pos, 22, { speed: 3, up: 2, life: [0.2, 0.6], size: [0.015, 0.04], colors: this.cSpark });
    this.app.flash(0.06, 0xffa050);
    this.shake = 0.05;
    plate.mesh.scale.y = Math.max(0.55, 1 - plate.hits * 0.15);
    plate.mesh.scale.x = 1 + plate.hits * 0.04;
    if (plate.hits >= 3) {
      sfx.beep(2);
      if (this.plates.every((q) => q.hits >= 3)) this.later(0.6, () => {
        sfx.chime();
        this.app.toast('Plates ready. <b>Tap</b> the frame to weld the suit together.', 3000);
        this._setStep(2);
      });
    }
    this._syncProgress();
  }

  /* ---- step 3: assemble ---- */
  _startAssembly() {
    if (this.step !== 2 || this.assembling) return;
    this.assembling = true;
    this.assembleT = 0;
    this.lastClank = 0; this.lastHammer = 0;
    this.app.sfx.servo(0.6);
    this.app.sfx.spark();
    this.benchReactor.visible = false; // the reactor goes into the chest
    this.coreGlow.visible = false;
    this.weldRing.visible = true; this.weldGlow.visible = true;
  }

  /* ---- step 4: power ---- */
  _powered() {
    const sfx = this.app.sfx, suit = this.suit;
    this.powered = true;
    suit.reactor = 1;
    sfx.powerUp();
    this.app.flash(0.3, 0x9ff3ff);
    this.sparks.burst(suit.reactorWorld(this._v), 50, { speed: 2.5, life: [0.3, 0.8], size: [0.02, 0.05], colors: this.cCyan });
    this.later(0.5, () => { suit.eyes = 1; sfx.beep(4); sfx.servo(0.3); this.sparks.burst(suit.headWorld(this._v), 16, { speed: 1.2, life: [0.2, 0.5], size: [0.012, 0.03], colors: this.cCyan }); });
    this.later(1.0, () => { sfx.clank(); this.shake = 0.03; });
    this.later(1.5, () => {
      this._setStep(4);
      this.app.toast('Armor sealed. Press <b>Break out</b>.', 3000);
    });
  }

  /* ---- step 5: break out (cinematic) ---- */
  _breakout() {
    if (this.step !== 4 || this.breakT >= 0) return;
    this.breakT = 0;
    this._lastStepNo = -1;
    this._syncUI();
    const app = this.app, suit = this.suit;
    app.cinema(true);
    app.sfx.servo(0.5);
    const chest = () => this._shotLook.copy(suit.root.position).add(this._v2.set(0, 1.2, 0));
    const behind = () => this._shotPos.copy(suit.root.position).add(this._v2.set(0.9, 1.25, -3.3));
    const ahead = () => this._aheadV.copy(suit.root.position).add(this._v2.set(0, 1.4, 4));
    this._aheadV = this._aheadV || new THREE.Vector3();
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.cine.play([
      { t: 0.7, pos: V(3.3, 1.35, 2.4), look: chest, fov: 44 },
      { t: 2.45, pos: V(2.7, 1.15, 4.2), look: chest, fov: 44 },
      { t: 2.5, pos: V(-1.7, 0.55, 3.4), look: V(0, 1.4, 6.2), fov: 48, cut: true },
      { t: 3.55, pos: V(-1.45, 0.65, 3.2), look: V(0, 1.6, 6.2), fov: 50 },
      { t: 3.6, pos: behind, look: ahead, fov: 56, cut: true },
      { t: 7.2, pos: behind, look: ahead, fov: 60 },
    ], {
      onEnd: () => {
        app.cinema(false);
        this.camPos.copy(this.camera.position);
        this.look.copy(this._aheadV);
        this._setStep(5);
        this.later(1.2, () => { if (this.active) app.toast('Free. Next: <b>The Workshop</b>, where the real suits begin.', 3600); });
      },
    });
  }

  _impactBarricade() {
    const app = this.app, sfx = app.sfx;
    const c = this._v.set(0, 1.3, 6.2);
    this.boom.at(c, 1.3);
    this.boom.smoke.burst(c, 30, { speed: 2.5, spread: 3, up: 0.6, life: [2, 4], size: [1, 2.4], colors: this.cSmoke, grow: 1.2, alpha: 0.6 });
    this.waves.spawn(this._v2.set(0, 0.05, 6.1), { radius: 5, life: 1.1, color: 0xffb070 });
    sfx.boom(); sfx.thud();
    app.flash(0.6, 0xffc080);
    this.cine.shake = 0.5;
    for (const p of this.planks) {
      p.live = true;
      p.v.set(rand(-3, 3), rand(1.5, 5), rand(5, 11));
      p.av.set(rand(-6, 6), rand(-6, 6), rand(-6, 6));
    }
  }

  _updateBreakout(dt) {
    const suit = this.suit, sfx = this.app.sfx;
    const t0 = this.breakT;
    this.breakT += dt;
    const t = this.breakT;
    // the walk
    if (t < 2.6) {
      // a heavy, grinding advance: the static armor slides forward, rocking a little with each stride
      const k = clamp((t - 0.4) / 2.2, 0, 1);
      suit.root.position.z = easeInOut(k) * 4.0;
      const phase = k * 4 * Math.PI;
      suit.root.position.y = Math.abs(Math.sin(phase)) * 0.02;
      suit.root.rotation.z = Math.sin(phase) * 0.025;
      suit.root.rotation.x = Math.abs(Math.sin(phase)) * 0.03;
      const stepNo = Math.floor(k * 4);
      if (k > 0 && k < 1 && stepNo !== this._lastStepNo) {
        this._lastStepNo = stepNo;
        sfx.thud();
        this.cine.shake = Math.max(this.cine.shake, 0.06);
        this.boom.smoke.burst(this._v.set(suit.root.position.x, 0.05, suit.root.position.z), 4, { speed: 0.6, spread: 1, life: [1, 2], size: [0.3, 0.6], colors: this.cSmoke, grow: 1, alpha: 0.4 });
      }
    }
    // the punch: a lean back, then a lunge through the planks
    if (t >= 2.6 && t < 3.6) {
      const k = (t - 2.6) / 1.0;
      const lunge = k < 0.25 ? -0.15 * (k / 0.25) : k < 0.4 ? lerp(-0.15, 0.55, (k - 0.25) / 0.15) : 0.55 - (k - 0.4) * 0.25;
      suit.root.position.set(0, 0, 4.0 + Math.max(0, lunge) * 0.9);
      suit.root.rotation.set(lunge * 0.35, 0, 0);
    }
    if (t0 < 2.85 && t >= 2.85) this._impactBarricade();
    if (t0 < 3.6 && t >= 3.6) { suit.thrust = 1; sfx.whoosh(); }
    if (t >= 3.6) {
      const k = clamp((t - 3.6) / 3.6, 0, 1);
      const e = k * k * (3 - 2 * k);
      suit.root.position.set(0, e * 1.7, lerp(4.36, 9.3, e));
      suit.root.rotation.z = 0;
      suit.root.rotation.x = 0.14 + e * 0.11;
      this.daylight = Math.max(this.daylight, k);
      if (Math.random() < dt * 40) this.sparks.emit({ x: suit.root.position.x + rand(-0.15, 0.15), y: suit.root.position.y + 0.02, z: suit.root.position.z - 0.1, vx: rand(-1, 1), vy: rand(-3, -1), vz: rand(-1.5, 0), life: rand(0.3, 0.7), size: rand(0.02, 0.05), color: this.cEmber[1] });
    }
    if (t0 < 6.7 && t >= 6.7) { this.app.flash(0.7, 0xfff1d0); this.banner.classList.remove('on'); void this.banner.offsetWidth; this.banner.classList.add('on'); sfx.chime(); }
    // barricade debris
    for (const p of this.planks) {
      if (!p.live) continue;
      p.v.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.rotation.x += p.av.x * dt; p.mesh.rotation.y += p.av.y * dt; p.mesh.rotation.z += p.av.z * dt;
      if (p.mesh.position.y < 0.12) { p.mesh.position.y = 0.12; p.v.multiplyScalar(0.3); p.v.y = Math.abs(p.v.y) * 0.3; p.av.multiplyScalar(0.5); if (p.v.lengthSq() < 0.05) p.live = false; }
    }
  }

  /* ================================================================ */
  enter() {
    if (!this._seen) {
      this._seen = true;
      setTimeout(() => { if (this.active && this.step === 0) this.app.toast('<b>Hold</b> on the glowing core on the workbench to forge the reactor.', 3600); }, 900);
    }
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    if (this.breakT >= 0 && this.step < 5) this._reset(true);
    this.app.cinema(false);
  }

  pointerDown() {
    if (this.step === 0) {
      const hit = this.app.raycast([this.coreHit, this.benchReactor], true);
      this._holdOnCore = hit.length > 0 || this.app.isTouch; // phones: anywhere is fine
      if (!this._holdOnCore) this.app.toast('Hold on the <b>glowing core</b> on the workbench.', 1800);
    }
  }

  click() {
    if (this.step === 1) {
      const hit = this.app.raycast(this.plateMeshes, false);
      if (hit.length) this._strike(this.plates[hit[0].object.userData.index]);
    } else if (this.step === 2) this._startAssembly();
  }

  key(e) {
    if (e.key === ' ' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); this._action(); return true; }
    return false;
  }

  update(dt, t) {
    const app = this.app, sfx = app.sfx, suit = this.suit;
    this.clock += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].t <= this.clock) { const fn = this.timers[i].fn; this.timers.splice(i, 1); fn(); }

    /* ---- the hold steps (forge / power), by gesture or by the button ---- */
    const holdStep = this.step === 0 || this.step === 3;
    const canHold = holdStep && !(this.step === 3 && this.powered) && !(this.step === 0 && this.reactorLit);
    const hold = this.trackHold(1.6, canHold && (this.step !== 0 || this._holdOnCore));
    if (canHold && this.autoHold > 0) {
      this.autoHold += dt / 1.6;
      sfx.charge(Math.min(1, this.autoHold));
    }
    let prog = canHold ? Math.max(hold.progress, this.autoHold > 0 ? Math.min(1, this.autoHold) : 0) : 0;
    const fired = canHold && (hold.fired || this.autoHold >= 1);
    if (fired && this.autoHold >= 1) { this.autoHold = 0; sfx.charge(0); }
    this.holdShown = damp(this.holdShown, prog, 10, dt);

    // step 0: the bench core heats up, then lights cyan
    if (this.step === 0 && !this.reactorLit) {
      this.forge = this.holdShown;
      this.coreMat.color.copy(this.cCoreCold).lerp(this.cCoreHot, this.forge).multiplyScalar(0.6 + this.forge * 4.5);
      this._syncChamber();
      this.coreGlow.material.color.set(0xff8a3a).multiplyScalar(1 + this.forge * 2.5);
      this.coreGlow.material.opacity = 0.15 + this.forge * 0.6;
      this.coreGlow.scale.setScalar(0.3 + this.forge * 0.6);
      this.coreLight.color.set(0xff7a2a);
      this.coreLight.intensity = this.forge * 5;
      if (this.forge > 0.1 && Math.random() < dt * 60 * this.forge) {
        const o = this.benchReactor.position;
        this.sparks.emit({ x: o.x + rand(-0.08, 0.08), y: o.y + rand(-0.05, 0.08), z: o.z + 0.05, vx: rand(-1.5, 1.5), vy: rand(0.5, 2.5), vz: rand(0, 1.5), life: rand(0.2, 0.6), size: rand(0.015, 0.035), color: this.cSpark[Math.random() < 0.5 ? 0 : 1] });
      }
      if (fired) this._forged();
    } else if (this.reactorLit && this.benchReactor.visible) {
      const fl = 0.9 + Math.sin(t * 29) * 0.05 + Math.sin(t * 13) * 0.05;
      this.coreMat.color.copy(this.cCoreLit).multiplyScalar(4 * fl);
      this._syncChamber();
      this.coreGlow.material.color.set(0x7fe8ff).multiplyScalar(3);
      this.coreGlow.material.opacity = 0.65;
      this.coreGlow.scale.setScalar(0.75 + Math.sin(t * 3) * 0.04);
      this.coreLight.color.set(0x7fe8ff);
      this.coreLight.intensity = damp(this.coreLight.intensity, 4.5 * fl, 4, dt);
    } else if (!this.assembling) {
      this.coreLight.intensity = damp(this.coreLight.intensity, 0, 4, dt);
      if (this.coreLight.intensity < 0.02) this.coreLight.position.set(-2.0, 1.35, 0.95);
    }

    // step 3: power up
    if (this.step === 3 && !this.powered) {
      suit.reactor = 0.05 + this.holdShown * 0.95;
      suit.eyes = this.holdShown * 0.35;
      this.grade.tintAmt = 0.03 + this.holdShown * 0.04;
      if (this.holdShown > 0.2 && Math.random() < dt * 20 * this.holdShown) this.sparks.burst(suit.reactorWorld(this._v), 1, { speed: 1.5, life: [0.2, 0.5], size: [0.015, 0.03], colors: this.cCyan });
      if (fired) this._powered();
    }

    /* ---- plates: glow cools with each hit; the hammer swings ---- */
    let heatSum = 0;
    for (const p of this.plates) {
      p.shown = damp(p.shown, p.heat, 3, dt);
      const hh = p.shown;
      const pulse = 0.85 + Math.sin(t * 3 + p.mesh.userData.index) * 0.15;
      p.mat.color.copy(this.cGrey).lerp(this.cHotBase, hh);
      p.mat.emissive.copy(this.cHotEm).multiplyScalar(hh * hh * 2.4 * pulse);
      heatSum += hh;
      if (hh > 0.3 && Math.random() < dt * 3 * hh) {
        const o = p.mesh.position;
        this.embers.emit({ x: o.x + rand(-0.12, 0.12), y: o.y + 0.03, z: o.z + rand(-0.1, 0.1), vx: 0, vy: rand(0.2, 0.5), vz: 0, life: rand(1, 2), size: rand(0.015, 0.03), color: this.cEmber[0] });
      }
      p.bend = damp(p.bend, 0, 10, dt);
    }
    // fire flicker: a jittery random walk (real flames), shared by the brazier and the lantern
    this._fire = damp(this._fire || 1, rand(0.7, 1.15), 14, dt);
    this._fire2 = damp(this._fire2 || 1, rand(0.85, 1.08), 9, dt);
    this.forgeLight.intensity = (3.2 + heatSum * 1.3) * this._fire;
    const ha = this.hammerAnim;
    if (ha.t < 1 && ha.plate) {
      ha.t = Math.min(1, ha.t + dt / 0.32);
      const o = ha.plate.mesh.position;
      this.hammer.position.set(o.x - 0.42, o.y + 0.1, o.z + 0.02);
      // up, then a hard swing down, then a small bounce
      const a = ha.t < 0.45 ? lerp(0.2, 1.3, easeInOut(ha.t / 0.45)) : ha.t < 0.6 ? lerp(1.3, -0.05, (ha.t - 0.45) / 0.15) : lerp(-0.05, 0.5, (ha.t - 0.6) / 0.4);
      this.hammer.rotation.set(0, 0, a);
      if (!ha.hit && ha.t >= 0.6) { ha.hit = true; this._impact(ha.plate); }
      if (ha.t >= 1) this.later(0.6, () => { if (this.hammerAnim.t >= 1) this.hammer.visible = false; });
    }

    /* ---- assembly ---- */
    if (this.assembling) {
      // the weld: a clip plane climbs from the boots to the crown, a white-hot ring riding it
      this.assembleT += dt;
      const k = Math.min(1, this.assembleT / 4);
      const H = this.suitH;
      const y = lerp(-0.02, H + 0.06, k);
      this.clipPlane.constant = y;
      const f = y / H;
      const r = f < 0.47 ? 0.24 : f < 0.62 ? 0.3 : f < 0.8 ? 0.4 : f < 0.86 ? 0.2 : 0.15; // boots, hips, chest, neck, head
      this.weldR = damp(this.weldR, r, 10, dt);
      const fl = 0.8 + Math.random() * 0.4;
      this.weldRing.position.set(0, y, 0);
      this.weldRing.scale.set(this.weldR * 1.08, 1, this.weldR * 0.85);
      this.weldRing.material.opacity = fl * (k < 0.97 ? 1 : 0);
      this.weldGlow.position.set(0.1, y, this.weldR * 0.9);
      this.weldGlow.scale.setScalar(0.35 + Math.random() * 0.25);
      this.weldGlow.material.opacity = k < 0.97 ? 0.7 * fl : 0;
      this.coreLight.position.set(0, y, 0.9);
      this.coreLight.color.setRGB(1, 0.8, 0.6);
      this.coreLight.intensity = 5 * fl;
      if (Math.random() < dt * 90) {
        for (let n = 0; n < 2; n++) {
          const a = rand(0, Math.PI * 2);
          const px = Math.cos(a) * this.weldR * 1.08, pz = Math.sin(a) * this.weldR * 0.85;
          this.sparks.emit({ x: px, y, z: pz, vx: px * rand(4, 9), vy: rand(-0.5, 2), vz: pz * rand(4, 9), life: rand(0.25, 0.7), size: rand(0.012, 0.03), color: this.cWeld[(Math.random() * 3) | 0] });
        }
      }
      if (this.clock - this.lastClank > 0.09 + Math.random() * 0.1) { this.lastClank = this.clock; sfx.spark(); }
      if (this.clock - this.lastHammer > 0.55) { this.lastHammer = this.clock; sfx.hammer(); this.boom.spark(this._v.set(0, y, this.weldR), 10, 2.5); }
      if (k >= 1) {
        this.assembling = false;
        this.clipPlane.constant = 100; // fully revealed (the plane stays on the materials)
        this.weldRing.visible = false; this.weldGlow.visible = false;
        suit.reactor = 0.05;
        this.app.flash(0.15, 0xffc080);
        sfx.clank();
        sfx.servo(0.4);
        this.app.toast('Assembled. <b>Hold</b> to power up the chest reactor.', 3000);
        this._setStep(3);
      }
    }

    /* ---- break out ---- */
    if (this.breakT >= 0) this._updateBreakout(dt);
    if (this.step === 5) {
      suit.root.position.y = 1.7 + Math.sin(t * 1.5) * 0.06;
    }
    const thrustShown = suit._shown.thrust;
    sfx.thrust(this.active ? thrustShown * (this.step === 5 ? 0.35 : 0.8) : 0);
    suit.update(dt);
    if (!this.real) suit.reactorWorld(this.suitHalo.position);
    this.suitHalo.scale.setScalar(0.05 + suit._shown.reactor * 0.45);
    this.suitHalo.material.opacity = suit._shown.reactor * 0.7;

    /* ---- light & atmosphere ---- */
    this.lampPivot.rotation.z = Math.sin(t * 0.9) * 0.13 + Math.sin(t * 0.37) * 0.05;
    this.lampPivot.rotation.x = Math.sin(t * 0.71) * 0.07;
    const dip = Math.sin(t * 7.3) > 0.97 ? 0.35 : 1;
    const flicker = (0.9 + Math.sin(t * 23) * 0.04 + Math.sin(t * 57) * 0.03) * dip;
    this.lamp.intensity = 90 * flicker;
    this.bulbMat.color.setRGB(5 * flicker, 3.8 * flicker, 2.4 * flicker);
    this.lampGlow.material.opacity = 0.45 * flicker;
    this.coals.material.color.copy(this.coalBase).multiplyScalar((0.8 + Math.sin(t * 2.3) * 0.1 + Math.sin(t * 5.1) * 0.05) * (0.85 + this._fire * 0.15));
    this.lantern.intensity = 7 * this._fire2;
    this.lanternMat.color.setRGB(4 * this._fire2, 2.6 * this._fire2, 1.2 * this._fire2);
    this.lanternGlow.material.opacity = 0.3 * this._fire2;
    this.dayLight.intensity = 4 + this.daylight * 60;
    this.slitMat.opacity = 0.35 + this.daylight * 0.65;
    this.slit.scale.set(1 + this.daylight * 1.6, 1 + this.daylight * 0.3, 1);
    this.rayMat.opacity = this.daylight * 0.08;
    this.grade.tintAmt = this.step === 3 ? this.grade.tintAmt : damp(this.grade.tintAmt, 0.03 - this.daylight * 0.02, 2, dt);
    this.exposure = 1.5 + this.daylight * 0.15;

    // dust shows where the lamp catches it: motes drift inside its cone
    if (Math.random() < dt * 22) {
      const lp = this.lamp.getWorldPosition(this._v2);
      const y = rand(0.3, lp.y - 0.3), r = Math.sqrt(Math.random()) * (lp.y - y) * 0.62, a = rand(0, Math.PI * 2);
      // (never right at the lens, where a mote would be a big out-of-focus blob)
      if (this.camera.position.distanceToSquared(this._v.set(lp.x + Math.cos(a) * r, y, lp.z + Math.sin(a) * r)) > 2.5) this.dust.emit({ x: lp.x + Math.cos(a) * r, y, z: lp.z + Math.sin(a) * r, vx: rand(-0.04, 0.04), vy: rand(-0.02, 0.03), vz: rand(-0.04, 0.04), life: rand(3, 6), size: rand(0.008, 0.02), color: this.cDust, alpha: 0.2 });
    }
    if (Math.random() < dt * 1.2) this._emitSmoke();
    this.smoke.update(dt, t);
    if (Math.random() < dt * 5) this.embers.emit({ x: 3.2 + rand(-0.2, 0.2), y: 0.45, z: -0.2 + rand(-0.2, 0.2), vx: rand(-0.1, 0.1), vy: rand(0.5, 1.1), vz: rand(-0.1, 0.1), life: rand(1.5, 3), size: rand(0.015, 0.03), color: this.cEmber[(Math.random() * 3) | 0] });
    this.dust.update(dt, t); this.embers.update(dt, t); this.sparks.update(dt, t);
    this.boom.update(dt, t); this.waves.update(dt);

    this._syncProgress();

    /* ---- camera ---- */
    if (this.cine.update(dt)) { app.setHover(false); return; }
    const shot = SHOTS[Math.min(this.step, SHOTS.length - 1)];
    const portrait = app.width / app.height < 0.85;
    const pull = portrait ? 1.6 : 1;
    this._shotLook.set(shot[1][0], shot[1][1], shot[1][2]);
    this._shotPos.set(shot[0][0], shot[0][1], shot[0][2]).sub(this._shotLook).multiplyScalar(pull).add(this._shotLook);
    if (this.step === 5) this._shotLook.set(suit.root.position.x, suit.root.position.y + 1.2, suit.root.position.z);
    const g = app.gyro;
    const px = app.pointer.ndc.x + (g ? g.x * 0.8 : 0), py = app.pointer.ndc.y + (g ? g.y * 0.6 : 0);
    // handheld: slow drifting breath plus the pointer
    this._shotPos.x += px * 0.3 + Math.sin(t * 0.63) * 0.04 + Math.sin(t * 1.7) * 0.012;
    this._shotPos.y += py * 0.18 + Math.sin(t * 0.81 + 1) * 0.03 + Math.sin(t * 2.3) * 0.01;
    this._shotLook.x += Math.sin(t * 0.5) * 0.03;
    this.camPos.x = damp(this.camPos.x, this._shotPos.x, 1.8, dt);
    this.camPos.y = damp(this.camPos.y, this._shotPos.y, 1.8, dt);
    this.camPos.z = damp(this.camPos.z, this._shotPos.z, 1.8, dt);
    this.look.x = damp(this.look.x, this._shotLook.x, 2.2, dt);
    this.look.y = damp(this.look.y, this._shotLook.y, 2.2, dt);
    this.look.z = damp(this.look.z, this._shotLook.z, 2.2, dt);
    this.shake = damp(this.shake || 0, 0, 8, dt);
    const sh = this.shake || 0;
    this.camera.position.set(this.camPos.x + rand(-sh, sh), this.camPos.y + rand(-sh, sh), this.camPos.z);
    this.camera.lookAt(this.look);

    // hover feedback
    let hover = false;
    if (!app.isTouch && !app.pointer.down) {
      if (this.step === 1) hover = this.app.raycast(this.plateMeshes, false).some((hh) => this.plates[hh.object.userData.index].hits < 3);
      else if (this.step === 0) hover = this.app.raycast([this.coreHit], false).length > 0;
      else if (this.step === 2 && !this.assembling) hover = true;
    }
    app.setHover(hover);
  }
}
