import * as THREE from 'three';
import { Chapter } from '../core/Chapter.js';
import { Suit } from '../objects/Suit.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { Shockwaves, createCity, glowSprite } from '../objects/FX.js';
import { loadEnv, envMap, backdrop, HDRIS } from '../core/Env.js';
import { rand, damp, clamp, TAU, h, toScreen, drawTexture, makeCanvas } from '../core/utils.js';
import './Flight.css';

/*
 * First flight: a chase-camera flight over a coastal city at night, under a real photographed moonrise
 * (its light is also the armor's reflections, the moon its key light), the city's sodium glow lighting it from below. Point to steer, hold to boost, thread
 * ten rings against the clock (or just fly). Climb too high and the prototype ices up and stalls; clip a
 * roof and it bounces off. It is never game over.
 */

const CEILING = 600;          // icing altitude (m)
const CRUISE = 42, BOOST = 96; // world speed (m/s)
const KMH = 12.6;             // displayed km/h per world m/s (the city is a scale model; it keeps the numbers heroic)
const MACH = 1225;            // km/h
const BLOCK = 22, STREET = 8, CITY = 900, COAST = 455;
const RING_R = 10, PASS_R = 12.5;
const START = new THREE.Vector3(0, 110, 720);
const HDR = 4; // additive effects are pushed past 1 so they bloom above the armor's glints

// the course: over the coast, weaving through the towers, up above the clouds and back out to sea
const COURSE = [
  [0, 80, 380], [-110, 60, 210], [-200, 95, 10], [-120, 150, -190], [60, 210, -290],
  [230, 170, -140], [270, 110, 80], [130, 290, 230], [-60, 370, 330], [0, 130, 580],
];

const OCEAN_VS = /* glsl */ `
  varying vec3 vW;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const OCEAN_FS = /* glsl */ `
  uniform float uTime; uniform vec3 uDeep; uniform sampler2D uSkyMap; uniform float uSkyGain; uniform vec3 uCityCol; uniform float uCoast;
  uniform vec3 uMoonDir; uniform vec3 uMoonCol; uniform vec3 uFogColor; uniform float uFogDensity;
  varying vec3 vW;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // value noise with its gradient (for ripple normals)
  vec3 vnd(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
    float a = h(i), b = h(i + vec2(1, 0)), c = h(i + vec2(0, 1)), d = h(i + vec2(1, 1));
    return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
                du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
  }
  vec2 swell(vec2 p, vec2 d, float f, float s, float a){ return d * cos(dot(p, d) * f + uTime * s) * a * f; }
  vec2 equirect(vec3 d){ return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5); }
  void main(){
    vec2 p = vW.xz;
    vec3 v = normalize(cameraPosition - vW);
    float dist = distance(vW, cameraPosition);
    // long swells, then choppy ripples from noise; the fine ones fade out with distance (they'd alias)
    float fine = 1.0 - smoothstep(150.0, 900.0, dist);
    vec2 g = swell(p, vec2(0.958, 0.287), 0.035, 0.9, 0.5) + swell(p, vec2(-0.371, 0.928), 0.061, 1.3, 0.3);
    vec2 q = p * 0.12 + vec2(uTime * 0.05, uTime * 0.03);
    g += vnd(q).yz * 0.12 * 0.35 * mix(0.4, 1.0, fine);
    g += vnd(q * 2.7 - uTime * 0.08).yz * 0.12 * 2.7 * 0.12 * fine;
    g += vnd(q * 7.3 + uTime * 0.11).yz * 0.12 * 7.3 * 0.05 * fine;
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 r = reflect(-v, n);
    r.y = abs(r.y) + 0.02;
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 sky = texture2D(uSkyMap, equirect(normalize(r))).rgb * uSkyGain;
    vec3 c = uDeep + sky * fres;
    // the moon's glitter path
    float m = max(dot(normalize(r), uMoonDir), 0.0);
    c += uMoonCol * (pow(m, 900.0) * 30.0 + pow(m, 60.0) * 0.25) * (0.4 + fres);
    // the city's lights stretched into glittering columns near the shore
    float shore = exp(-max(vW.z - uCoast, 0.0) / 90.0);
    vec3 hn = vnd(vec2(p.x * 0.35, p.y * 0.06 + uTime * 0.3));
    c += uCityCol * shore * (0.012 + pow(hn.x, 10.0) * 0.35 * fine) * (0.3 + fres);
    // far out the sea melts into the photographed horizon (the sky just above it, in this direction)
    float fog = clamp(1.0 - exp(-uFogDensity * uFogDensity * dist * dist), 0.0, 1.0);
    vec3 hz = -v; hz.y = 0.015;
    vec3 horizon = texture2D(uSkyMap, equirect(normalize(hz))).rgb * uSkyGain;
    c = mix(c, uFogColor, fog * 0.6);
    c = mix(c, horizon, smoothstep(1800.0, 4600.0, dist));
    gl_FragColor = vec4(c, 1.0);
  }`;

// The land around the city: dark fields and hills, the lights of suburbs and roads thinning out with
// distance from the city, clustered into towns by noise. (One draw.)
const LAND_FS = /* glsl */ `
  uniform float uCity; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uCoast;
  varying vec3 vW;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main(){
    vec2 p = vW.xz;
    float fromCity = max(abs(p.x), abs(p.y)) - uCity;
    float towns = smoothstep(0.45, 0.8, vn(p / 380.0) * 0.7 + vn(p / 120.0) * 0.3);
    float density = mix(0.9, 0.05, smoothstep(0.0, 1400.0, fromCity)) * (0.25 + 0.75 * towns);
    // a loose grid of streets; lamps along them, some houses lit between
    vec2 cellSize = vec2(34.0, 26.0);
    vec2 g = p / cellSize;
    vec2 cell = floor(g), f = fract(g);
    vec2 fw = fwidth(g);
    float detail = 1.0 - smoothstep(0.35, 1.2, max(fw.x, fw.y));
    float onRoad = step(0.5, h(cell * 0.37));
    vec2 lampPos = vec2(h(cell), h(cell + 3.1));
    float d = length((f - lampPos) * cellSize);
    float spot = exp(-d * d * 0.35) * step(1.0 - density, h(cell + 7.7));
    vec3 lampCol = mix(vec3(1.0, 0.55, 0.2), vec3(1.0, 0.85, 0.65), h(cell + 1.3));
    vec3 lights = lampCol * mix(density * 0.08, spot * 2.4, detail);
    float coastFade = smoothstep(uCoast + 5.0, uCoast - 25.0, vW.z);
    vec3 c = vec3(0.006, 0.007, 0.008) + lights * coastFade;
    float dist2 = dot(vW - cameraPosition, vW - cameraPosition);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist2);
    gl_FragColor = vec4(mix(c, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
  }`;

const CLOUD_VS = /* glsl */ `
  uniform float uFogDensity;
  varying vec2 vUv; varying float vA; varying float vSeed;
  void main(){
    vUv = uv;
    vSeed = fract(instanceMatrix[3].x * 0.0131 + instanceMatrix[3].z * 0.0077);
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    c.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
    float d = -c.z;
    vA = smoothstep(15.0, 160.0, d) * exp(-uFogDensity * uFogDensity * d * d * 0.25);
    gl_Position = projectionMatrix * c;
  }`;
const CLOUD_FS = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uBottom; uniform float uOpacity; uniform float uTime;
  varying vec2 vUv; varying float vA; varying float vSeed;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
  void main(){
    vec2 q = vUv - 0.5;
    vec2 p = vUv * vec2(3.2, 1.6) + vSeed * 40.0 + vec2(uTime * 0.004, 0.0);
    float n = fbm(p);
    float n2 = fbm(p * 2.7 + 5.3);
    // a soft, torn bank of cloud: an elliptical envelope eaten away by two scales of noise
    float shape = 1.0 - smoothstep(0.0, 0.5, length(q * vec2(1.0, 2.2)));
    float dens = smoothstep(0.55, 0.95, n * 1.05 + n2 * 0.45 - (1.0 - shape) * 0.75) * smoothstep(0.0, 0.25, shape);
    // moonlit above, the city's warm glow underneath, denser cores darker
    float lift = smoothstep(-0.25, 0.3, q.y + (n2 - 0.5) * 0.3);
    vec3 col = mix(uBottom, uTop, lift) * (0.7 + 0.45 * (1.0 - dens));
    gl_FragColor = vec4(col, dens * uOpacity * vA);
  }`;

export class Flight extends Chapter {
  constructor(app) {
    super(app, { id: 'flight', title: 'First Flight', jp: 'MACH 1' });
    // the lacquered model throws bright glints: only real light sources (HDR effects, flames) bloom
    this.bloom = { strength: 0.9, radius: 0.55, threshold: 2.6 };
    this.grade = { ...this.grade, grain: 0.025, vig: 0.4, ca: 0.0015, sat: 1, tint: 0xbfe4ff, tintAmt: 0 };
    this.mood = 'calm';
    this.shiftView = 0.08;
    this.trail = false;
    this.trailColor = '160,220,255';
    this.pos = START.clone();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.yaw = Math.PI; this.pitch = 0; this.roll = 0; this.yawRate = 0;
    this.speed = CRUISE;
    this.camYaw = Math.PI; this.camPitch = 0;
    this.boostLvl = 0; this.energy = 1; this.boostLock = false;
    this.ice = 0; this.stalled = false; this._iceTold = false; this._alarmT = 0;
    this.shake = 0; this._hitCD = 0;
    this.sx = 0; this.sy = 0; this._idle = 0;
    this.keys = { up: 0, down: 0, left: 0, right: 0, boost: false };
    this.btnBoost = false;
    this.mode = 'course'; // 'course' | 'free'
    this.state = 'count'; // 'count' | 'race' | 'done'
    this.countT = 0; this.time = 0; this.score = 0; this.next = 0;
    this._mach = false; this._boundsTold = false;
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._look = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  load() { return Promise.all([loadModels(['mk5raw']), loadEnv(HDRIS.moonrise, { backdrop: true })]); }

  /* ------------------------------------------------------------------ */
  /* build                                                               */
  /* ------------------------------------------------------------------ */

  build() {
    const s = this.scene;
    const app = this.app;
    // a real night sky (photographed): the backdrop, and the light the armor reflects
    const FOG = 0x151c27;
    s.background = backdrop(HDRIS.moonrise) || new THREE.Color(0x03060c);
    s.backgroundIntensity = 1;
    s.fog = new THREE.FogExp2(FOG, 0.0011);
    if (envMap(HDRIS.moonrise)) { s.environment = envMap(HDRIS.moonrise); s.environmentIntensity = 0.35; }
    this.camera.fov = 62;
    this.camera.near = 0.3;
    this.camera.far = 6000;
    this.camera.updateProjectionMatrix();
    s.add(this.camera); // the speed streaks ride on the camera
    this.moonDir = new THREE.Vector3(0.25, 0.3, 1).normalize();

    // the far hills, dark against the sky
    this.moonDir = new THREE.Vector3(0.785, 0.24, 0.571).normalize(); // where the moon is in the photographed sky
    s.add(this._mountains(2500, -1.95, 1.95, 90, 330, 0x0b0f16, 11));
    s.add(this._mountains(2200, -1.7, 1.7, 40, 190, 0x06080c, 29));

    // the city on the coast, the land behind it, the sea in front
    this.city = createCity({ size: CITY, block: BLOCK, street: STREET, fogColor: FOG, fogDensity: 0.0014, maxH: 200, win: 0xffc98a, base: 0x2a2d33, sky: 0x1a2130, groundSize: CITY });
    this.cityN = Math.floor(CITY / BLOCK);
    s.add(this.city.group);
    // the land beyond the city: dark, with the faint scatter of suburbs' lights
    const land = new THREE.Mesh(new THREE.PlaneGeometry(8000, 4000 + COAST), new THREE.ShaderMaterial({
      uniforms: { uCity: { value: CITY / 2 }, uCoast: { value: COAST }, uFogColor: { value: new THREE.Color(FOG) }, uFogDensity: { value: 0.0011 } },
      vertexShader: OCEAN_VS, fragmentShader: LAND_FS,
    }));
    land.rotation.x = -Math.PI / 2;
    land.position.set(0, -0.3, (COAST - 4000) / 2);
    s.add(land);
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(8000, 5000), new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x010204) },
        uSkyMap: { value: backdrop(HDRIS.moonrise) || new THREE.Texture() }, uSkyGain: { value: 1.0 },
        uCityCol: { value: new THREE.Color(1, 0.6, 0.3).multiplyScalar(1.4) }, uCoast: { value: COAST },
        uMoonDir: { value: this.moonDir }, uMoonCol: { value: new THREE.Color(0xfff4e0) },
        uFogColor: { value: new THREE.Color(FOG) }, uFogDensity: { value: 0.0009 },
      },
      vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS,
    }));
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.set(0, 0, COAST + 2500);
    s.add(this.ocean);
    // the promenade lights along the shore and a few boats out at sea (one draw)
    const lp = [];
    for (let x = -600; x <= 600; x += 7) lp.push(x + rand(-1, 1), 4, COAST - 3);
    for (let k = 0; k < 40; k++) lp.push(rand(-1800, 1800), 1.5, COAST + rand(120, 2200));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    s.add(new THREE.Points(lg, new THREE.PointsMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(1.6), size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false })));

    // clouds: camera-facing billboards in one instanced draw, shaped and shaded by noise in the shader
    const nClouds = app.low ? 26 : 44;
    this.clouds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color(0x4a5466) }, uBottom: { value: new THREE.Color(0x3c3029) }, uOpacity: { value: 0.75 }, uFogDensity: { value: 0.0009 }, uTime: { value: 0 } },
      vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false,
    }), nClouds);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let k = 0; k < nClouds; k++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 1500;
      const w = rand(180, 380);
      m4.compose(v.set(Math.cos(a) * r, rand(250, 400), Math.sin(a) * r + 150), q, sc.set(w, w * rand(0.42, 0.55), 1));
      this.clouds.setMatrixAt(k, m4);
    }
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 2;
    s.add(this.clouds);

    // light: moonlight, the city's warm glow from below, a cold rim, the boots' own light
    s.add(new THREE.HemisphereLight(0x3a4660, 0x5a3418, 0.9)); // the night sky above, the lit city below
    this.rig = new THREE.Group();
    this.rig.rotation.order = 'YXZ';
    s.add(this.rig);
    this.moonLight = new THREE.DirectionalLight(0xdfe6ff, 2.4);
    this.moonLight.target = this.rig;
    this.cityLight = new THREE.DirectionalLight(0xff9a50, 2.2);
    this.cityLight.target = this.rig;
    this.rimLight = new THREE.DirectionalLight(0xc0d0ee, 0.9);
    this.rimLight.target = this.rig;
    s.add(this.moonLight, this.cityLight, this.rimLight);
    this.bootLight = new THREE.PointLight(0x9fe8ff, 0, 10, 2);
    this.bootLight.position.set(0, 0, -1.4);
    this.rig.add(this.bootLight);

    // the suit exactly as sculpted (arms at its sides), laid flat as one piece: head (+y) along the flight
    // direction (the rig's +z), belly down; it moves only as a whole
    // the unpainted prototype: bare steel all over (its paint came later, after the icing)
    this.suit = new RealSuit('mk5raw', { castShadow: false });
    if (!this.suit.ok) { this.suit = new Suit({ scheme: 'classic', castShadow: false }); this.suit.pose('fly', 1); } // silent fallback
    this.suit.reactor = 1; this.suit.eyes = 1; this.suit.faceOpen = 0;
    this.body = new THREE.Group();
    this.body.rotation.x = 1.38;
    this.suit.root.position.y = -1.0;
    this.body.add(this.suit.root);
    this.rig.add(this.body);

    // the course
    this.rings = [];
    const torus = new THREE.TorusGeometry(RING_R, 0.55, 10, 56);
    const inner = new THREE.TorusGeometry(RING_R * 0.82, 0.12, 6, 56);
    COURSE.forEach(([x, y, z], i) => {
      const clear = this._maxAround(x, z, 16) + RING_R + 6;
      const p = new THREE.Vector3(x, Math.max(y, clear), z);
      const mat = new THREE.MeshBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
      const g = new THREE.Group();
      g.position.copy(p);
      const a = new THREE.Mesh(torus, mat), b = new THREE.Mesh(inner, mat);
      g.add(a, b);
      const glow = glowSprite(0x5fe3ff, 34, 0.25);
      glow.material.fog = false; glow.material.toneMapped = false;
      g.add(glow);
      s.add(g);
      this.rings.push({ g, a, b, mat, glow, pos: p, dir: new THREE.Vector3(0, 0, 1), i });
    });
    // each ring faces along the course
    this.rings.forEach((r, i) => {
      const prev = i ? this.rings[i - 1].pos : START;
      const nxt = this.rings[i + 1] ? this.rings[i + 1].pos : r.pos.clone().add(r.pos.clone().sub(prev));
      r.dir.subVectors(nxt, prev).normalize();
      r.g.lookAt(this._v.copy(r.pos).add(r.dir));
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1, 12, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc25a).multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    s.add(this.beacon);

    // effects: a contrail from the boots, sparks, shock rings, speed streaks by the camera
    this.contrail = new ParticlePool({ count: app.low ? 500 : 900, drag: 1.4, turbulence: 0.6, softness: 2 });
    this.sparks = new ParticlePool({ count: 500, gravity: -12, drag: 0.6, softness: 1.2 });
    s.add(this.contrail.points, this.sparks.points);
    this.trailColor3 = new THREE.Color(0xa8dcff).multiplyScalar(1.6);
    this.iceColor = new THREE.Color(0xe8f6ff).multiplyScalar(1.6);
    this.sparkColors = [new THREE.Color(0xffe0a0), new THREE.Color(0xffffff), new THREE.Color(0xffc25a)].map((c) => c.multiplyScalar(HDR));
    this.ringColors = [new THREE.Color(0xffd27a), new THREE.Color(0x9ff3ff), new THREE.Color(0xffffff)].map((c) => c.multiplyScalar(HDR));
    this.palmColor = new THREE.Color(0x9ff3ff).multiplyScalar(HDR);
    this._palm = new THREE.Vector3(); this._palmDir = new THREE.Vector3();
    this.waves = new Shockwaves(s, 5);
    const nStreak = app.low ? 26 : 44;
    this.streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.02, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe8ff).multiplyScalar(2.5), toneMapped: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), nStreak);
    this.streaks.frustumCulled = false;
    this.streakData = Array.from({ length: nStreak }, () => ({ a: rand(0, TAU), r: rand(2.2, 8), z: rand(-70, 0) }));
    this.camera.add(this.streaks);
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._sc = new THREE.Vector3(1, 1, 1);

    this._buildUI();
    this._reset();
  }

  /** A ridge of mountains: a strip of triangles on an arc (land side, -z). */
  _mountains(radius, a0, a1, lo, hi, color, seed) {
    const seg = 180, pos = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      const n = 0.5 + 0.5 * (Math.sin(a * 5 + seed) * 0.45 + Math.sin(a * 13 + seed * 2) * 0.3 + Math.sin(a * 37 + seed * 3) * 0.15 + Math.sin(a * 83) * 0.1);
      const edge = Math.min(1, (a - a0) / 0.4, (a1 - a) / 0.4); // taper to the sea at both ends
      const hgt = (lo + (hi - lo) * n) * Math.max(0.15, edge) * rand(0.94, 1.06);
      const x = Math.sin(a) * radius, z = -Math.cos(a) * radius;
      pos.push(x, -60, z, x, hgt, z);
      if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -7;
    return m;
  }

  /** Tallest block within r of (x, z). */
  _maxAround(x, z, r) {
    let m = 0;
    for (let dx = -r; dx <= r; dx += BLOCK / 2) for (let dz = -r; dz <= r; dz += BLOCK / 2) m = Math.max(m, this.city.heightAt(x + dx, z + dz));
    return m;
  }

  /** The roof under (x, z), or 0 over a street, the land or the sea. */
  _floorAt(x, z) {
    const n = this.cityN, half = n / 2;
    const cx = Math.floor(x / BLOCK + half), cz = Math.floor(z / BLOCK + half);
    if (cx < 0 || cz < 0 || cx >= n || cz >= n) return 0;
    const lx = x - (cx - half) * BLOCK, lz = z - (cz - half) * BLOCK;
    const m = STREET / 2 - 0.5;
    if (lx < m || lx > BLOCK - m || lz < m || lz > BLOCK - m) return 0;
    return this.city.heightAt(x, z);
  }

  _buildUI() {
    const touch = this.app.isTouch;
    this.intro({
      kicker: 'Chapter 05 · The prototype',
      title: 'First <em>Flight</em>',
      jp: 'MACH 1',
      desc: 'The first test flight of the prototype armor, at night, over the coast. Thread the rings, dive to break the sound barrier — and remember what happened when it climbed too high: the suit iced up and fell out of the sky.',
      extra: [
        this.gestures(touch
          ? [['move', '<b>Tilt</b> or <b>touch</b> to steer'], ['hold', '<b>Boost</b> button to boost'], ['tap', 'Fly through the <b>rings</b>']]
          : [['move', '<b>Point</b> to steer'], ['hold', '<b>Hold</b> or <b>Space</b> to boost'], ['key', '<b>W / S</b> climb · dive']]),
        h('div.stats', {}, [['10', 'Rings'], ['600 m', 'Icing ceiling'], ['Mach 1', 'In a dive']].map(([b, sp]) => h('div.stat', {}, h('b', { text: b }), h('span', { text: sp })))),
      ],
    });

    // frost creeping in from the edges (drawn once to a canvas)
    const [fc, fx] = makeCanvas(512, 512);
    fx.strokeStyle = 'rgba(235,248,255,0.55)';
    fx.lineWidth = 1;
    fx.beginPath();
    const branch = (x, y, a, len, depth) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      fx.moveTo(x, y); fx.lineTo(x2, y2);
      if (depth > 0) { branch(x2, y2, a + rand(0.3, 0.8), len * 0.62, depth - 1); branch(x2, y2, a - rand(0.3, 0.8), len * 0.62, depth - 1); }
    };
    for (let k = 0; k < 70; k++) {
      const edge = k % 4, t = Math.random() * 512;
      const [x, y] = edge === 0 ? [t, 0] : edge === 1 ? [512, t] : edge === 2 ? [t, 512] : [0, t];
      const a = Math.atan2(256 - y, 256 - x) + rand(-0.6, 0.6);
      branch(x, y, a, rand(30, 80), 3);
    }
    fx.stroke();
    fx.fillStyle = 'rgba(240,250,255,0.35)';
    fx.beginPath();
    for (let k = 0; k < 900; k++) { const x = Math.random() * 512, y = Math.random() * 512; fx.rect(x, y, 1.5, 1.5); }
    fx.fill();
    this.frost = h('div.fl-frost');
    this.frost.style.backgroundImage = `url(${fc.toDataURL()})`;
    this.ui.prepend(this.frost);

    // instruments
    this.compassCanvas = h('canvas', { width: 600, height: 64 });
    this.compassCtx = this.compassCanvas.getContext('2d');
    this.headingEl = h('b.fl-heading', { text: '000°' });
    this.speedVal = h('b', { text: '0' });
    this.machVal = h('span.fl-mach', { text: 'MACH 0.00' });
    this.altVal = h('b', { text: '0' });
    this.altFill = h('i');
    this.altBox = h('div.fl-inst.fl-alt.hud-panel', {}, h('span.fl-lbl', { text: 'ALT' }), h('div', {}, this.altVal, h('small', { text: ' m' })), h('div.fl-ceil', { title: 'Icing ceiling' }, this.altFill));
    this.energyFill = h('div.meter-fill');
    this.energyPct = h('span', { text: '100%' });
    this.timeVal = h('b', { text: '0:00.0' });
    this.ringVal = h('b', { text: '0/10' });
    this.scoreVal = h('b', { text: '0' });
    this.pills = h('div.fl-pills', {}, h('div.pill', {}, 'Time', this.timeVal), h('div.pill', {}, 'Rings', this.ringVal), h('div.pill', {}, 'Score', this.scoreVal));
    this.dock = h('div.fl-dock', {},
      this.pills,
      h('div.fl-compass', {}, this.compassCanvas, this.headingEl),
      h('div.fl-row', {},
        h('div.fl-inst.fl-speed.hud-panel', {}, h('span.fl-lbl', { text: 'SPD' }), h('div', {}, this.speedVal, h('small', { text: ' km/h' })), this.machVal),
        h('div.meter.fl-energy', {}, h('div.meter-label', {}, h('span', { text: 'Boost' }), this.energyPct), h('div.meter-track', {}, this.energyFill)),
        this.altBox,
      ),
    );
    this.ui.append(this.dock);

    // the next ring: a marker on it when on screen, an arrow at the edge when not
    this.marker = h('div.fl-marker', {}, h('span'));
    this.arrow = h('div.fl-arrow', {}, h('i'), h('span'));
    this.stallEl = h('div.fl-stall', {}, h('b', { text: 'Icing — stall' }), h('span', { text: 'Dive below 600 m to thaw' }));
    this.combo = h('div.combo');
    this.banner = h('div.big-title', {}, h('b', { text: 'Mach 1' }), h('span', { text: 'Sound barrier broken' }));
    this.ui.append(this.marker, this.arrow, this.stallEl, this.combo, this.banner);

    // course complete
    this.cardTime = h('div.big', { text: '0:00.0' });
    this.cardText = h('p');
    this.cardRank = h('div.card-jp', { text: 'Course complete' });
    this.card = h('div.game-card.hidden.pe', {},
      this.cardRank, h('h3', { text: 'First flight logged' }), this.cardTime, this.cardText,
      h('div.fl-card-btns', {}, this.button('Retry', () => this._reset(), 'btn-primary'), this.button('Free flight', () => this._setMode('free'))));
    this.ui.append(this.card);

    // controls: boost is a press-and-hold button
    this.boostBtn = h('button.btn.btn-gold.pe.fl-boost', { type: 'button', text: 'Boost' });
    const on = (e) => { e.preventDefault(); e.stopPropagation(); this.btnBoost = true; this.app.sfx.unlock(); this.boostBtn.classList.add('active'); };
    const off = () => { this.btnBoost = false; this.boostBtn.classList.remove('active'); };
    this.boostBtn.addEventListener('pointerdown', on);
    this.boostBtn.addEventListener('pointerup', off);
    this.boostBtn.addEventListener('pointercancel', off);
    this.boostBtn.addEventListener('pointerleave', off);
    this.boostBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    this.modeBtn = this.button('Free flight', () => this._setMode(this.mode === 'course' ? 'free' : 'course'));
    this.retryBtn = this.button('Restart', () => this._reset());
    this.ui.append(h('div.controls', {}, this.boostBtn, h('div.group', {}, this.modeBtn, this.retryBtn)));
  }

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */

  _reset() {
    this.pos.copy(START);
    this.yaw = this.camYaw = Math.PI;
    this.pitch = this.camPitch = 0; this.roll = 0; this.yawRate = 0;
    this.speed = CRUISE; this.energy = 1; this.boostLock = false;
    this.ice = 0; this.stalled = false;
    this.time = 0; this.score = 0; this.next = 0; this._mach = false;
    this.card.classList.add('hidden');
    this.rings.forEach((r) => { r.done = false; });
    if (this.mode === 'course') { this.state = 'count'; this.countT = 0; this._countShown = -1; } else this.state = 'free';
    this._syncRings();
  }

  _setMode(m) {
    this.mode = m;
    this.modeBtn.textContent = m === 'course' ? 'Free flight' : 'Ring course';
    this.modeBtn.classList.toggle('active', m === 'free');
    this.ui.classList.toggle('fl-free', m === 'free');
    this.card.classList.add('hidden');
    if (m === 'free') {
      this.state = 'free';
      this.app.toast('Free flight: no rings, no clock. Find the ceiling — carefully.', 2800);
    } else {
      this._reset();
    }
    this._syncRings();
  }

  _syncRings() {
    const course = this.mode === 'course';
    for (const r of this.rings) {
      r.g.visible = course;
      const isNext = course && r.i === this.next && this.state !== 'done';
      r.mat.color.set(r.done ? 0x2a6a88 : isNext ? 0xffc25a : 0x5fe3ff).multiplyScalar(r.done ? 1 : isNext ? HDR : 1.6);
      r.mat.opacity = r.done ? 0.18 : isNext ? 0.95 : 0.4;
      r.glow.material.color.set(isNext ? 0xffb040 : 0x5fe3ff).multiplyScalar(isNext ? 2.5 : 1);
      r.glow.material.opacity = r.done ? 0 : isNext ? 0.45 : 0.15;
    }
    const nr = this.rings[this.next];
    this.beacon.visible = course && !!nr && this.state !== 'done';
    if (nr) { this.beacon.position.set(nr.pos.x, 0, nr.pos.z); this.beacon.scale.set(1, Math.max(1, nr.pos.y - RING_R), 1); }
    this._txt(this.ringVal, `${this.next}/${this.rings.length}`);
  }

  _passRing(r) {
    const app = this.app;
    r.done = true;
    const kmh = this.speed * KMH;
    const pts = 100 + Math.round(kmh / 10);
    this.score += pts;
    this.time = Math.max(0, this.time - 1);
    this.next++;
    app.sfx.chime();
    app.flash(0.14, 0xffd27a);
    this._wave(r.pos, { radius: 22, life: 0.8, color: 0xffc25a, normal: r.dir });
    // a burst of sparks round the ring's rim
    const up = this._v2.set(0, 1, 0);
    if (Math.abs(r.dir.y) > 0.9) up.set(1, 0, 0);
    const side = this._v.crossVectors(r.dir, up).normalize();
    up.crossVectors(side, r.dir).normalize();
    for (let k = 0; k < 70; k++) {
      const a = (k / 70) * TAU;
      const c = Math.cos(a) * RING_R, sn = Math.sin(a) * RING_R;
      const x = r.pos.x + side.x * c + up.x * sn, y = r.pos.y + side.y * c + up.y * sn, z = r.pos.z + side.z * c + up.z * sn;
      this.sparks.emit({ x, y, z, vx: (side.x * c + up.x * sn) * 0.6 + rand(-2, 2), vy: (side.y * c + up.y * sn) * 0.6 + rand(0, 3), vz: (side.z * c + up.z * sn) * 0.6 + rand(-2, 2), life: rand(0.5, 1.1), size: rand(0.25, 0.6), color: this.ringColors[k % 3] });
    }
    this._combo(`+${pts} · −1.0 s`);
    if (this.next >= this.rings.length) this._finish();
    this._syncRings();
  }

  /** A shock ring, pushed into HDR so it blooms. */
  _wave(pos, opts) {
    this.waves.spawn(pos, opts);
    const w = this.waves.items[(this.waves._i + this.waves.items.length - 1) % this.waves.items.length];
    w.m.material.color.multiplyScalar(3);
  }

  _finish() {
    const app = this.app;
    this.state = 'done';
    let best = null;
    try {
      best = parseFloat(localStorage.getItem('im-flight-best'));
      if (!(best > 0) || this.time < best) { localStorage.setItem('im-flight-best', String(this.time)); best = this.time; }
    } catch (_) { best = null; }
    const rank = this.time < 50 ? 'Ace pilot' : this.time < 75 ? 'Test pilot' : 'Cleared for flight';
    this.cardRank.textContent = `Course complete · ${rank}`;
    this.cardTime.textContent = this._fmt(this.time);
    this.cardText.innerHTML = `Score <b>${this.score}</b> · all ten rings${best ? ` · best <b>${this._fmt(best)}</b>` : ''}.<br>Keep flying, or go again.`;
    this.card.classList.remove('hidden');
    app.sfx.powerUp();
    app.flash(0.3, 0xffe2a0);
    this._bigTitle('Course complete', rank);
  }

  _combo(text) {
    this.combo.textContent = text;
    this.combo.classList.remove('on'); void this.combo.offsetWidth; this.combo.classList.add('on');
    clearTimeout(this._comboT);
    this._comboT = setTimeout(() => this.combo.classList.remove('on'), 1100);
  }

  _bigTitle(a, b) {
    this.banner.children[0].textContent = a;
    this.banner.children[1].textContent = b;
    this.banner.classList.remove('on'); void this.banner.offsetWidth; this.banner.classList.add('on');
  }

  _fmt(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }

  _txt(el, v) { if (el._v !== v) { el._v = v; el.textContent = v; } }
  _tf(el, v) { if (el._t !== v) { el._t = v; el.style.transform = v; } }

  /* ------------------------------------------------------------------ */
  /* lifecycle & input                                                   */
  /* ------------------------------------------------------------------ */

  onEnter() {
    this.app.toast(this.app.isTouch
      ? '<b>Tilt</b> (or touch) to steer, hold <b>Boost</b>. Fly through the gold rings.'
      : '<b>Point</b> to steer, <b>hold</b> or <b>Space</b> to boost. Fly through the gold rings.', 3600);
  }

  enter() {
    this._reset();
    if (!this._seen) { this._seen = true; setTimeout(() => { if (this.active) this.onEnter(); }, 700); }
    this._compassDeg = null;
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    this.keys.up = this.keys.down = this.keys.left = this.keys.right = 0;
    this.keys.boost = false;
    this.btnBoost = false;
    this.boostBtn.classList.remove('active');
  }

  resize(w, hh) {
    super.resize(w, hh);
    this.portrait = w / hh < 0.9;
    this.cx = w / hh > 1.1 ? w * (0.5 + this.shiftView) : w / 2;
  }

  pointerMove() { this._idle = 0; }
  pointerDown() { this._idle = 0; }

  key(e) {
    const k = e.key;
    const down = e.type !== 'keyup';
    if (k === ' ') { this.keys.boost = down; e.preventDefault?.(); this._idle = 0; return true; }
    if (k === 'w' || k === 'W' || k === 'ArrowUp') { this.keys.up = down ? 1 : 0; this._idle = 0; e.preventDefault?.(); return true; }
    if (k === 's' || k === 'S' || k === 'ArrowDown') { this.keys.down = down ? 1 : 0; this._idle = 0; e.preventDefault?.(); return true; }
    if (k === 'a' || k === 'A') { this.keys.left = down ? 1 : 0; this._idle = 0; return true; }
    if (k === 'd' || k === 'D') { this.keys.right = down ? 1 : 0; this._idle = 0; return true; }
    if (down && (k === 'r' || k === 'R')) { this._reset(); return true; }
    if (down && (k === 'f' || k === 'F')) { this._setMode(this.mode === 'course' ? 'free' : 'course'); return true; }
    return false;
  }

  keyUp(e) { if (this.active) this.key(e); }

  /* ------------------------------------------------------------------ */
  /* frame                                                               */
  /* ------------------------------------------------------------------ */

  update(dt, t) {
    const app = this.app, p = app.pointer, suit = this.suit;
    this._idle += dt;
    this._hitCD -= dt;

    // ---- steering input: tilt, touch, or the mouse's place on the screen ----
    let sx = 0, sy = 0;
    const gyro = app.gyro;
    if (gyro) { sx = gyro.x * 1.25; sy = gyro.y * 1.1; } else if (!app.isTouch || p.down) {
      const nx = (p.x - this.cx) / (app.width * 0.42), ny = -(p.y - app.height * 0.5) / (app.height * 0.42);
      sx = Math.abs(nx) < 0.06 ? 0 : nx; sy = Math.abs(ny) < 0.06 ? 0 : ny;
      if (!app.isTouch && this._idle > 4 && !p.down) { sx = 0; sy = 0; } // idle: level out
    }
    sx += (this.keys.right - this.keys.left) * 0.8;
    sy += (this.keys.up - this.keys.down) * 0.9;
    this.sx = damp(this.sx, clamp(sx, -1, 1), 5, dt);
    this.sy = damp(this.sy, clamp(sy, -1, 1), 5, dt);

    // ---- icing above the ceiling ----
    const above = this.pos.y > CEILING;
    this.ice = clamp(this.ice + (above ? dt * 0.3 : -dt * (this.stalled ? 0.25 : 0.45)), 0, 1);
    if (above && this.ice > 0.25) {
      this._alarmT -= dt;
      if (this._alarmT <= 0) { this._alarmT = 1.6; app.sfx.alarm(); }
      if (!this._iceTold) { this._iceTold = true; app.toast('<b>Ice on the flaps.</b> The prototype\'s alloy freezes above 600 m — its first flight ended this way. Dive to thaw.', 5200); }
    }
    if (!this.stalled && this.ice >= 1) { this.stalled = true; app.sfx.powerDown(); app.flash(0.2, 0xe8f6ff); this.shake = 0.6; }
    if (this.stalled && this.pos.y < CEILING - 70) { this.stalled = false; this.ice = Math.min(this.ice, 0.5); app.sfx.powerUp(); this._combo('Systems restored'); }
    const control = this.stalled ? 0.12 : 1 - this.ice * 0.7;

    // ---- boost & energy ----
    const wantBoost = (this.keys.boost || this.btnBoost || (p.down && (!app.isTouch || gyro))) && !this.stalled && this.state !== 'count';
    if (this.energy < 0.02) this.boostLock = true;
    if (this.boostLock && this.energy > 0.3) this.boostLock = false;
    const boosting = wantBoost && !this.boostLock;
    this.energy = clamp(this.energy + (boosting ? -0.2 : 0.11) * dt, 0, 1);
    this.boostLvl = damp(this.boostLvl, boosting ? 1 : 0, boosting ? 3 : 2, dt);

    // ---- attitude ----
    let yawTarget = -this.sx * 1.15 * control;
    // out of bounds: a gentle hand back toward the city
    const r = Math.hypot(this.pos.x, this.pos.z - 200);
    if (r > 1500) {
      const want = Math.atan2(-this.pos.x, 200 - this.pos.z);
      let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      yawTarget = clamp(d * 1.2, -1, 1);
      if (!this._boundsTold) { this._boundsTold = true; app.toast('Leaving the test area — turning back.', 2200); }
    } else if (r < 1300) this._boundsTold = false;
    this.yawRate = damp(this.yawRate, yawTarget, 3 * Math.max(control, 0.3), dt);
    this.yaw += this.yawRate * dt;
    const pitchTarget = this.stalled ? -0.95 : clamp(this.sy * 0.8, -0.85, 0.85);
    this.pitch = damp(this.pitch, pitchTarget, this.stalled ? 1.2 : 2.6 * control, dt);
    const tumble = this.stalled ? Math.sin(t * 5.3) * 0.5 + Math.sin(t * 8.1) * 0.25 : 0;
    this.roll = damp(this.roll, clamp(-this.yawRate * 0.75, -1.1, 1.1) + tumble, 4, dt);

    // ---- speed ----
    const dive = -Math.sin(this.pitch);
    let target = (boosting ? BOOST : CRUISE) + dive * 32;
    if (this.stalled) target = 30;
    this.speed = damp(this.speed, Math.max(18, target), boosting ? 1.3 : 0.7, dt);
    const cp = Math.cos(this.pitch);
    this.fwd.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.pos.addScaledVector(this.fwd, this.speed * dt);
    if (this.stalled) this.pos.y -= 22 * dt;

    // ---- crash avoidance: roofs, streets, the sea ----
    const floor = this._floorAt(this.pos.x, this.pos.z);
    if (this.pos.y < floor + 1.5) {
      this.pos.y = floor + 2.2;
      if (this._hitCD <= 0) {
        this._hitCD = 0.7;
        this.pitch = 0.55;
        this.speed *= 0.55;
        this.shake = 1;
        app.sfx.thud();
        app.bleed();
        app.flash(0.25, 0xff3030);
        this.sparks.burst(this.pos, 40, { speed: 9, spread: 1, up: 4, life: [0.3, 0.9], size: [0.12, 0.3], colors: this.sparkColors });
        this._combo(floor > 0 ? 'Rooftop! Pull up' : this.pos.z > COAST ? 'Splash! Pull up' : 'Pull up');
      }
    }
    this.pos.y = Math.min(this.pos.y, CEILING + 180);

    // ---- the rig & the suit ----
    const rig = this.rig;
    rig.position.copy(this.pos);
    rig.rotation.set(-this.pitch, this.yaw, this.roll);
    this.body.rotation.x = 1.38 + this.boostLvl * 0.12;
    const sputter = this.ice > 0.3 && Math.random() < this.ice * 0.45;
    suit.thrust = this.stalled ? (Math.random() < 0.3 ? 0.35 : 0.05) : sputter ? 0.15 : 0.6 + this.boostLvl * 0.4;
    const palm = Math.abs(this.yawRate) > 0.45 ? clamp(Math.abs(this.yawRate) * 0.8, 0, 1) : this.stalled ? 0.4 : 0;
    suit.palmThrust = palm; // (only the procedural fallback shows palm flames)
    suit.update(dt);
    // the palms steer with short bursts: the one on the outside of the turn fires
    if (palm > 0 && Math.random() < palm * dt * 40) {
      const side = this.yawRate > 0 ? 'r' : 'l';
      suit.palmWorld(side, this._palm);
      const out = this._palmDir.set(side === 'l' ? 1 : -1, 0, 0).applyQuaternion(rig.quaternion); // out to that side
      this.sparks.emit({ x: this._palm.x, y: this._palm.y, z: this._palm.z, vx: out.x * 6 - this.fwd.x * 4, vy: out.y * 6 - this.fwd.y * 4, vz: out.z * 6 - this.fwd.z * 4, life: rand(0.12, 0.25), size: rand(0.12, 0.22), color: this.palmColor });
    }
    this.bootLight.intensity = suit._shown.thrust * 6;
    app.sfx.thrust(this.active ? clamp(suit._shown.thrust * 0.55 + this.boostLvl * 0.35, 0, 1) : 0);

    // lights follow him
    this.moonLight.position.copy(this.pos).addScaledVector(this.moonDir, 60);
    this.cityLight.position.set(this.pos.x, this.pos.y - 60, this.pos.z - 20);
    this.rimLight.position.copy(this.pos).addScaledVector(this.fwd, 40).y += 20;

    // contrail from both boots (white with ice)
    const back = this._v.copy(this.fwd).multiplyScalar(-1.25).add(this.pos);
    const col = this.ice > 0.4 ? this.iceColor : this.trailColor3;
    const n = app.low ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 0.14 : -0.14;
      this.contrail.emit({ x: back.x + Math.cos(this.yaw) * side + rand(-0.05, 0.05), y: back.y + rand(-0.05, 0.05), z: back.z - Math.sin(this.yaw) * side + rand(-0.05, 0.05), vx: -this.fwd.x * 3, vy: -this.fwd.y * 3 + 0.3, vz: -this.fwd.z * 3, life: rand(0.5, 0.9) + this.boostLvl * 0.5, size: rand(0.18, 0.3) + this.boostLvl * 0.15, color: col, alpha: 0.35 + this.boostLvl * 0.25, grow: 2 });
    }

    // ---- the course ----
    if (this.mode === 'course') this._course(dt, t);

    // ---- Mach 1 ----
    const kmh = this.speed * KMH;
    if (!this._mach && kmh >= MACH) {
      this._mach = true;
      app.sfx.boom();
      app.flash(0.35, 0xdff4ff);
      this.shake = 1;
      this._wave(this._v2.copy(this.pos).addScaledVector(this.fwd, -3), { radius: 16, life: 0.9, color: 0xdff4ff, normal: this.fwd });
      this._wave(this._v2.copy(this.pos).addScaledVector(this.fwd, -8), { radius: 26, life: 1.2, color: 0x9fd8ff, normal: this.fwd });
      this._bigTitle('Mach 1', 'Sound barrier broken');
    }

    // ---- camera: chase from behind and above, lagging into turns ----
    this.camYaw = damp(this.camYaw, this.yaw, 3.2, dt);
    this.camPitch = damp(this.camPitch, this.pitch * 0.6, 3, dt);
    const dist = (6.2 + this.boostLvl * 2.2) * (this.portrait ? 1.35 : 1);
    const cc = Math.cos(this.camPitch);
    const cam = this.camera;
    cam.position.set(
      this.pos.x - Math.sin(this.camYaw) * cc * dist,
      this.pos.y - Math.sin(this.camPitch) * dist + 1.6 + (this.portrait ? 0.6 : 0),
      this.pos.z - Math.cos(this.camYaw) * cc * dist,
    );
    this._look.copy(this.pos).addScaledVector(this.fwd, 12).y += 0.8;
    cam.lookAt(this._look);
    cam.rotateZ(-this.roll * 0.35);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const sh = this.shake * 0.35 + this.boostLvl * 0.04 + (this.stalled ? 0.08 : 0);
    if (sh > 0.001) { cam.position.x += rand(-sh, sh); cam.position.y += rand(-sh, sh); }
    const fov = (this.portrait ? 70 : 60) + this.boostLvl * 16 + clamp((this.speed - CRUISE) / 60, 0, 1) * 4;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = damp(cam.fov, fov, 4, dt); cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(); // the ring marker is projected this frame

    this.clouds.material.uniforms.uTime.value = t;
    this.ocean.material.uniforms.uTime.value = t;

    // speed streaks by the camera
    const sOp = this.boostLvl * 0.55 + clamp((kmh - 900) / 600, 0, 1) * 0.3;
    this.streaks.material.opacity = sOp;
    this.streaks.visible = sOp > 0.01;
    if (this.streaks.visible) {
      const move = this.speed * dt * 1.4;
      this.streakData.forEach((d, i) => {
        d.z += move;
        if (d.z > 2) { d.z = rand(-80, -50); d.a = rand(0, TAU); d.r = rand(2.2, 8); }
        this._m4.compose(this._v.set(Math.cos(d.a) * d.r, Math.sin(d.a) * d.r, d.z), this._q, this._sc);
        this.streaks.setMatrixAt(i, this._m4);
      });
      this.streaks.instanceMatrix.needsUpdate = true;
    }

    // look
    this.bloom.strength = 0.9 + this.boostLvl * 0.5;
    this.grade.tintAmt = this.ice * 0.35;
    this.grade.sat = 1 - this.ice * 0.4;
    this.grade.ca = 0.0015 + this.boostLvl * 0.003;
    this.contrail.update(dt, t);
    this.sparks.update(dt, t);
    this.waves.update(dt);

    this._hud(kmh);
    app.setHover(false);
  }

  _course(dt, t) {
    const app = this.app;
    if (this.state === 'count') {
      this.countT += dt;
      const k = Math.floor(this.countT);
      if (k !== this._countShown) {
        this._countShown = k;
        if (k < 3) { this._combo(String(3 - k)); app.sfx.beep(k); } else { this._combo('Go!'); app.sfx.beep(5); this.state = 'race'; }
      }
    } else if (this.state === 'race') {
      this.time += dt;
      const r = this.rings[this.next];
      if (r && r.pos.distanceTo(this.pos) < PASS_R) this._passRing(r);
    }
    // the next ring breathes; the rest turn slowly
    for (const r of this.rings) {
      r.a.rotation.z += dt * 0.3;
      r.b.rotation.z -= dt * 0.6;
      const isNext = r.i === this.next && this.state !== 'done';
      r.g.scale.setScalar(isNext ? 1 + Math.sin(t * 4) * 0.05 : 1);
    }
    this.beacon.material.opacity = 0.1 + Math.sin(t * 3) * 0.04;
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                 */
  /* ------------------------------------------------------------------ */

  _hud(kmh) {
    const app = this.app;
    this._txt(this.speedVal, String(Math.round(kmh)));
    this._txt(this.machVal, `MACH ${(kmh / MACH).toFixed(2)}`);
    const alt = Math.max(0, Math.round(this.pos.y));
    this._txt(this.altVal, String(alt));
    this._tf(this.altFill, `scaleY(${clamp(alt / CEILING, 0, 1).toFixed(2)})`);
    const warn = alt > CEILING - 60;
    if (this.altBox._warn !== warn) { this.altBox._warn = warn; this.altBox.classList.toggle('warn', warn); }
    const e = Math.round(this.energy * 100);
    if (this._e !== e) {
      this._e = e;
      this.energyFill.style.width = `${e}%`;
      this.energyPct.textContent = `${e}%`;
      this.energyFill.classList.toggle('red', this.boostLock || e < 20);
    }
    this._txt(this.timeVal, this.mode === 'free' ? 'Free' : this._fmt(this.time));
    this._txt(this.scoreVal, String(this.score));

    // heading: 0 = north (inland, -z), the sea to the south
    const deg = Math.round(((Math.atan2(this.fwd.x, -this.fwd.z) * 180) / Math.PI + 360) % 360);
    if (deg !== this._compassDeg) { this._compassDeg = deg; this._drawCompass(deg); this.headingEl.textContent = `${String(deg).padStart(3, '0')}°`; }

    // frost & stall
    const ice = Math.round(this.ice * 50) / 50;
    if (this._ice !== ice) { this._ice = ice; this.frost.style.opacity = String(Math.min(1, ice * 1.4)); this.frost.style.setProperty('--ice', String(ice)); }
    if (this._stallShown !== this.stalled) { this._stallShown = this.stalled; this.stallEl.classList.toggle('on', this.stalled); }

    // the next ring: a marker on it, or an arrow at the edge pointing to it
    const r = this.mode === 'course' && this.state !== 'done' ? this.rings[this.next] : null;
    let showM = false, showA = false;
    if (r) {
      const w = app.width, hh = app.height;
      const s = toScreen(r.pos, this.camera, w, hh);
      const dist = Math.round(r.pos.distanceTo(this.pos));
      const onScreen = !s.behind && s.x > 40 && s.x < w - 40 && s.y > 60 && s.y < hh - 60;
      if (onScreen) {
        showM = true;
        this._tf(this.marker, `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`);
        this._txt(this.marker.firstChild, `${dist} m`);
      } else {
        showA = true;
        let dx = s.x - this.cx, dy = s.y - hh / 2;
        if (s.behind) { dx = -dx; dy = -dy; if (Math.abs(dx) + Math.abs(dy) < 1) dy = 1; }
        const hw = Math.min(this.cx, w - this.cx) - 50, hy = hh / 2 - 110;
        const k = Math.min(Math.abs(hw / (dx || 1e-3)), Math.abs(hy / (dy || 1e-3)));
        const ang = Math.atan2(dy, dx);
        this._tf(this.arrow, `translate(${Math.round(this.cx + dx * k)}px, ${Math.round(hh / 2 + dy * k)}px)`);
        this._tf(this.arrow.firstChild, `rotate(${Math.round((ang * 180) / Math.PI)}deg)`);
        this._txt(this.arrow.lastChild, `${dist} m`);
      }
    }
    if (this.marker._on !== showM) { this.marker._on = showM; this.marker.classList.toggle('on', showM); }
    if (this.arrow._on !== showA) { this.arrow._on = showA; this.arrow.classList.toggle('on', showA); }
  }

  _drawCompass(deg) {
    const x = this.compassCtx, W = 600, H = 64, span = 110, ppd = W / span;
    x.clearRect(0, 0, W, H);
    x.strokeStyle = 'rgba(95,227,255,0.85)';
    x.lineWidth = 2;
    x.beginPath();
    const start = Math.ceil((deg - span / 2) / 5) * 5;
    for (let d = start; d <= deg + span / 2; d += 5) {
      const px = W / 2 + (d - deg) * ppd;
      const big = ((d % 30) + 30) % 30 === 0;
      x.moveTo(px, H - 4); x.lineTo(px, big ? H - 24 : ((d % 10) + 10) % 10 === 0 ? H - 16 : H - 10);
    }
    x.stroke();
    x.fillStyle = '#bff6ff';
    x.font = '700 20px Rajdhani, sans-serif';
    x.textAlign = 'center';
    for (let d = Math.ceil((deg - span / 2) / 30) * 30; d <= deg + span / 2; d += 30) {
      const n = ((d % 360) + 360) % 360;
      const label = n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : String(n / 10).padStart(2, '0');
      x.fillText(label, W / 2 + (d - deg) * ppd, 22);
    }
    x.fillStyle = '#ffc25a';
    x.beginPath(); x.moveTo(W / 2 - 8, H); x.lineTo(W / 2 + 8, H); x.lineTo(W / 2, H - 12); x.fill();
  }
}
