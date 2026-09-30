import * as THREE from 'three';
import './Repulsors.css';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Chapter } from '../core/Chapter.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Suit, POSES, suitEnvironment } from '../objects/Suit.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { Beams, Explosions, createDrone, glowSprite } from '../objects/FX.js';
import { glossyFloor } from '../objects/GlossyFloor.js';
import { mergeStatic } from '../core/mergeStatic.js';
import { loadEnv, envMap, loadTextures, pbr, HDRIS } from '../core/Env.js';
import { rand, damp, clamp, lerp, TAU, h, drawTexture, easeInOut } from '../core/utils.js';
import { SYSTEMS } from '../data/content.js';

/*
 * The Repulsor Range: a long indoor test range under the workshop, lit like the real thing: sealed concrete
 * that mirrors the work lights, board-formed concrete walls, bolted steel baffles, fluorescent fixtures under
 * the girders (area lights) and a light haze. The targets are painted steel plates on stands that ring,
 * spark and topple when hit; misses leave hot scorch marks on the concrete and steel that cool to soot.
 * The suit stands at the firing line, seen over its right shoulder, and fires where you point. Tap to fire,
 * hold and release for a heavy blast, Space (or the button) for the chest beam. A 45-second scored round,
 * or free fire.
 */

const ROUND = 45;
const UNI_CD = 10;
const LANES = [-6, -3, 0, 3, 6];
const RAILS = [-18, -32];
const RANKS = [[0, 'Calibration Run'], [2500, 'Test Pilot'], [6000, 'Range Regular'], [11000, 'Sharpshooter'], [17000, 'Arc Ace']];
const Z = new THREE.Vector3(0, 0, 1);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const backOut = (k) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const clonePose = (p) => { const o = {}; for (const k in p) o[k] = p[k].slice(); for (const k of ['spine', 'neck']) o[k] = o[k] || [0, 0, 0]; return o; };

export class Repulsors extends Chapter {
  constructor(app) {
    super(app, { id: 'repulsors', title: 'Repulsor Range', jp: 'RANGE' });
    this.bloom = { strength: 0.8, radius: 0.5, threshold: 2.8 };
    this.grade = { ...this.grade, grain: 0.025, vig: 0.42, ca: 0.0012, sat: 1, tint: 0xffc890, tintAmt: 0 };
    this.mood = 'calm';
    this.shiftView = 0.06;
    this.trail = false;
    this.state = 'free'; // free | count | play | over
    this.seen = false;
    this.best = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Build                                                                */
  /* ------------------------------------------------------------------ */

  load() {
    return Promise.all([loadModels(['classic']), loadEnv(HDRIS.shop), loadTextures(['concrete_floor_worn_001', 'metal_plate'])]);
  }

  build() {
    const s = this.scene;
    // the sculpted armor, shown exactly as authored (the procedural suit is only a silent fallback)
    const real = new RealSuit('classic', { castShadow: !this.app.low });
    this.real = real.ok;
    // real lacquered metal glints brightly: a high bloom threshold, and HDR colours for everything that should glow
    this.hdr = 3.5;
    this.bloomBase = 0.8;
    // a real photographed machine shop for the reflections (the range's own lights do the rest)
    s.environment = envMap(HDRIS.shop) || suitEnvironment();
    s.environmentIntensity = 0.4;
    // haze: the far end of a long room fades into lit air, not into black
    const haze = 0x16171a;
    s.background = new THREE.Color(haze);
    s.fog = new THREE.Fog(haze, 16, 80);
    this.camera.fov = 46;
    this.camera.far = 160;
    this.camera.position.set(0.85, 1.95, 2.25);
    this.camera.updateProjectionMatrix();
    this.look = new THREE.Vector3(-0.5, 1.45, -14);
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();

    // scratch
    this.ray = new THREE.Raycaster();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._n = new THREE.Vector3();
    this._end = new THREE.Vector3(); this._palm = new THREE.Vector3(); this._pdir = new THREE.Vector3(); this._o = new THREE.Vector3();
    this._m4 = new THREE.Matrix4(); this._dummy = new THREE.Object3D(); this._col = new THREE.Color();
    this._line = new THREE.Line3(); this._rayList = [];
    this.aimPoint = new THREE.Vector3(0, 1.5, -20);
    this.lookPoint = new THREE.Vector3(0, 1.5, -20);
    this._ndc = new THREE.Vector2();
    this.shot = { tg: null, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), surface: false };
    this.pending = { on: false, t: 0, side: 'r', power: 0, tg: null, point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: false };

    this._buildLights();
    this._buildHangar();
    this._buildTargets();

    // the suit, at the firing line, facing down range (-z)
    this.suit = this.real ? real : new Suit({ scheme: 'mk7', castShadow: !this.app.low });
    this.suit.root.rotation.order = 'YXZ';
    this.suit.root.rotation.y = Math.PI;
    if (!this.real) this.suit.pose('ready', 1);
    this.suit.reactor = 1; this.suit.eyes = 1; this.suit.faceOpen = 0;
    s.add(this.suit.root);
    this.poses = { ready: clonePose(POSES.ready), r: clonePose(POSES.blastR), l: clonePose(POSES.blastL), uni: clonePose(POSES.unibeam) };
    this.poseMode = '';
    this.side = 'r';
    this.rootYaw = Math.PI; this.rootYawT = Math.PI; this.rootPitch = 0; this.rootPitchT = 0;
    this.aimHold = 0; this.armUp = 0;
    this.palmT = { l: 0, r: 0 };

    // effects
    this.beams = new Beams(s, 10);
    this.boom = new Explosions(s, { lights: 2, low: this.app.low });
    // sparks: white-hot steel that falls and bounces off nothing (gravity, a little drag); smoke: grey, lit
    this.shards = new ParticlePool({ count: this.app.low ? 350 : 800, gravity: -9.8, drag: 0.5, softness: 0.9 });
    this.smoke = new ParticlePool({ count: this.app.low ? 120 : 260, blending: THREE.NormalBlending, drag: 1.6, buoyancy: 0.5, turbulence: 0.4, softness: 2.4 });
    this.dust = new ParticlePool({ count: 220, drag: 0.4, turbulence: 0.2, softness: 2 });
    s.add(this.shards.points, this.smoke.points, this.dust.points);
    this.cShard = [new THREE.Color(0xfff4e0), new THREE.Color(0xffc877), new THREE.Color(0xff9a3c)];
    this.cGold = [new THREE.Color(0xffe2b0), new THREE.Color(0xffb35c), new THREE.Color(0xff8a2c)];
    this.cSmoke = [new THREE.Color(0x4a4845), new THREE.Color(0x5b5854), new THREE.Color(0x3a3937)];
    this.cDust = new THREE.Color(0xb9b2a6);
    this.muzzle = glowSprite(0xdff6ff, 0.01, 1); s.add(this.muzzle);
    this.halo = glowSprite(0xbfeeff, 0.01, 0.9); s.add(this.halo);
    this.chestGlow = glowSprite(0xdff8ff, 0.01, 0.9); s.add(this.chestGlow);
    // the flash where a blast lands: white-hot at the centre, going orange (a hot spot on the steel)
    this.impacts = Array.from({ length: 4 }, () => { const g = glowSprite(0xffe6c4, 0.01, 0); s.add(g); return { g, t: 1, size: 1 }; });
    for (const sp of [this.muzzle, this.halo, this.chestGlow, ...this.impacts.map((i) => i.g)]) { sp.material.color.multiplyScalar(this.hdr); sp.material.toneMapped = false; }
    for (const c of [...this.cShard, ...this.cGold]) c.multiplyScalar(this.hdr * 1.1);
    for (const c of [...this.boom.cFire, ...this.boom.cSpark]) c.multiplyScalar(this.hdr * 0.8);
    this._ii = 0;
    this.muzzleT = 1;

    this.uni = { active: false, t: 0, cd: 0, beam: null, dir: 1, decalT: 0, boomT: 0 };
    this.shake = 0;
    this.charge = 0; this.chargeFull = false; this._skipClickUntil = 0;
    this._buildUI();
    this._resetRound(true);
  }

  _buildLights() {
    const s = this.scene, low = this.app.low;
    // the room's bounce: warm off the concrete floor, neutral from the ceiling
    s.add(new THREE.HemisphereLight(0x9aa0a8, 0x2a2420, 0.32));
    // the work light over the firing line: the only shadow caster (the suit, the bollards, the console)
    const key = new THREE.SpotLight(0xfff0de, 90, 26, 0.6, 0.65, 1.4);
    key.position.set(2.6, 8.4, 3.8);
    key.target.position.set(-0.2, 0.8, -2.4);
    key.castShadow = !low;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1; key.shadow.camera.far = 22;
    key.shadow.bias = -0.0003; key.shadow.normalBias = 0.03; key.shadow.radius = 3;
    s.add(key, key.target);
    // the two rows of fluorescent fixtures down the range: long area lights (soft, even, like the real tubes);
    // on weak GPUs, two plain point lights instead
    if (!low) {
      RectAreaLightUniformsLib.init();
      for (const x of [-4.5, 4.5]) {
        const r = new THREE.RectAreaLight(0xf3f1ea, 5.5, 0.5, 54);
        r.position.set(x, 7.66, -24);
        r.rotation.set(-Math.PI / 2, 0, 0); // facing straight down, long along the range
        s.add(r);
      }
    } else {
      for (const z of [-12, -34]) { const l = new THREE.PointLight(0xf3f1ea, 55, 38, 1.4); l.position.set(0, 7.4, z); s.add(l); }
    }
    // warning beacon light (pulses during a round) and a warm sodium work lamp on the left wall
    this.warn = new THREE.PointLight(0xff8a20, 0, 30, 1.5); this.warn.position.set(0, 6.8, -22); s.add(this.warn);
    const lamp = new THREE.PointLight(0xffc27a, 7, 12, 2); lamp.position.set(-6.8, 3.4, -1.2); s.add(lamp);
    // a flood on the backstop, so the far wall reads as steel and not as a hole
    const wash = new THREE.SpotLight(0xf1ede4, 70, 30, 0.75, 0.8, 1.2);
    wash.position.set(0, 8.2, -38); wash.target.position.set(0, 2.5, -54);
    s.add(wash, wash.target);
    // the light a blast throws on the steel and concrete around where it lands
    this.hitLight = new THREE.PointLight(0xffb070, 0, 14, 2);
    s.add(this.hitLight);
    this.hitE = 0;
  }

  /** Worn paint: a noisy mask (white where the paint is intact), stretched along a line it reads as wear. */
  _wear(w = 256, hh = 256, keep = 0.8) {
    return drawTexture(w, hh, (x) => {
      const img = x.createImageData(w, hh), d = img.data;
      for (let i = 0; i < w * hh; i++) {
        const v = Math.random() < keep ? 200 + Math.random() * 55 : 40 + Math.random() * 60;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      x.globalCompositeOperation = 'multiply';
      for (let k = 0; k < 40; k++) {
        const cx = rand(0, w), cy = rand(0, hh), r = rand(6, 40);
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(60,60,60,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }, false);
  }

  _buildHangar() {
    const s = this.scene, low = this.app.low;
    // sealed concrete that mirrors the fixtures (a real blurred reflection), board-formed concrete walls,
    // bolted steel baffles, a dark slab ceiling
    const floorMat = pbr('concrete_floor_worn_001', { repeat: [4, 14], color: 0x9a9ca0, roughness: 0.72, metalness: 0, normalScale: 0.8, fallback: 0x55585c });
    const wallMat = pbr('concrete_floor_worn_001', { repeat: [14, 2], color: 0x7b7d80, roughness: 1, metalness: 0, fallback: 0x44474b });
    const wallMatEnd = pbr('concrete_floor_worn_001', { repeat: [4, 2], color: 0x7b7d80, roughness: 1, metalness: 0, fallback: 0x44474b });
    const panelMat = pbr('metal_plate', { repeat: [1, 1], color: 0x80858c, roughness: 0.95, metalness: 0.9, fallback: 0x3c4148 });
    const plateMat = pbr('metal_plate', { repeat: [1, 1], color: 0x6e7278, roughness: 0.9, metalness: 0.95, fallback: 0x2a2f36 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3b3e43, metalness: 0.85, roughness: 0.42 });
    const steelDark = new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.8, roughness: 0.55 });
    this.steel = steel;

    const floor = glossyFloor(new THREE.PlaneGeometry(18, 64), floorMat, { renderer: this.app.renderer, low, scale: 0.5, strength: 0.55, blur: 5 });
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -24); floor.receiveShadow = true;
    this.floor = floor;
    const wallL = new THREE.Mesh(new THREE.PlaneGeometry(64, 9), wallMat);
    wallL.rotation.y = Math.PI / 2; wallL.position.set(-9, 4.5, -24);
    const wallR = new THREE.Mesh(new THREE.PlaneGeometry(64, 9), wallMat);
    wallR.rotation.y = -Math.PI / 2; wallR.position.set(9, 4.5, -24);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(18, 64), pbr('concrete_floor_worn_001', { repeat: [3, 10], color: 0x3a3b3e, roughness: 1, metalness: 0, fallback: 0x101114 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 9, -24);
    const far = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 1), wallMatEnd);
    far.position.set(0, 4.5, -54.5);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), wallMatEnd);
    back.rotation.y = Math.PI; back.position.set(0, 4.5, 8);
    for (const m of [wallL, wallR, far, back]) m.receiveShadow = true;
    s.add(floor, wallL, wallR, ceil, far, back);

    const dummy = this._dummy;
    const inst = (geo, mat, list, shadow = false) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([p, sc, r], i) => {
        dummy.position.set(p[0], p[1], p[2]);
        dummy.rotation.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
        dummy.scale.set(sc[0], sc[1], sc[2]);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.receiveShadow = true;
      m.castShadow = shadow && !low;
      m.computeBoundingSphere();
      s.add(m);
      return m;
    };
    const box = new THREE.BoxGeometry(1, 1, 1);

    // the armoured far wall: a grid of bolted steel plates with gaps between (they take the scorch marks)
    const plates = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) plates.push([[-7.5 + c * 3, 1.5 + r * 2.9, -53.85], [2.9, 2.82, 0.35], [0, 0, rand(-0.004, 0.004)]]);
    const farPanels = inst(box, plateMat, plates);
    // bolt heads around every plate (one instanced mesh)
    const bolts = [];
    for (const [p] of plates) for (const bx of [-1.3, -0.45, 0.45, 1.3]) for (const by of [-1.28, 1.28]) bolts.push([[p[0] + bx, p[1] + by, -53.66], [1, 1, 1], [Math.PI / 2, 0, 0]]);
    inst(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8), steel, bolts);

    // leaning steel baffles along both walls (they stop ricochets)
    const slabs = [];
    for (let z = 2; z >= -50; z -= 4) for (const sx of [-1, 1]) slabs.push([[sx * 8.35, 1.6, z], [0.12, 3.2, 3.85], [0, 0, sx * 0.09]]);
    const blast = inst(box, panelMat, slabs, true);
    // their frames: heavy angle-iron posts
    const posts = [];
    for (let z = 2; z >= -50; z -= 4) for (const sx of [-1, 1]) for (const dz of [-1.95, 1.95]) posts.push([[sx * 8.28, 1.6, z + dz], [0.14, 3.3, 0.14], [0, 0, sx * 0.09]]);
    inst(box, steelDark, posts);

    // the steel overhead: cross beams, three long girders, wall pillars
    const girders = [];
    for (let z = 6; z >= -54; z -= 4) girders.push([[0, 8.45, z], [18, 0.5, 0.32]]);
    for (const x of [-4.5, 0, 4.5]) girders.push([[x, 8.0, -24], [0.28, 0.4, 64]]);
    for (let z = 4; z >= -52; z -= 8) for (const sx of [-1, 1]) girders.push([[sx * 8.7, 4.5, z], [0.55, 9, 0.55]]);
    inst(box, steelDark, girders);

    // fluorescent fixtures hung under the girders: a steel housing, a bright diffuser (HDR, so only it blooms)
    const strips = [], housings = [];
    for (let z = 2; z >= -50; z -= 4) for (const x of [-4.5, 4.5]) {
      strips.push([[x, 7.69, z], [0.2, 0.02, 3.2]]);
      housings.push([[x, 7.76, z], [0.34, 0.12, 3.4]]);
    }
    inst(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff7ec).multiplyScalar(4.2), toneMapped: false }), strips);
    inst(box, steelDark, housings);

    // everything a shot can land on
    this.rangeMeshes = [floor, wallL, wallR, ceil, far, back, farPanels, blast];

    // painted lane lines and distance bars: worn traffic paint, lit like the floor (not glowing)
    const flat = (w, d, x, z) => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, 0.006, z); return g; };
    const lines = [];
    for (const x of [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]) lines.push(flat(0.08, 50, x, -27));
    for (const z of [-10, -20, -30, -40, -50]) lines.push(flat(15, 0.08, 0, z));
    for (const z of RAILS) lines.push(flat(15, 0.05, 0, z - 0.2), flat(15, 0.05, 0, z + 0.2));
    const wear = this._wear(64, 512, 0.82);
    this.laneMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.78, metalness: 0, alphaMap: wear, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const laneMesh = new THREE.Mesh(mergeGeometries(lines), this.laneMat);
    laneMesh.receiveShadow = true;
    s.add(laneMesh);

    // distance markings stencilled on the floor at the right-hand side
    const labelTex = drawTexture(512, 128, (x, w, hh) => {
      x.fillStyle = '#ffffff'; x.font = '700 64px "Arial Narrow", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      ['10 M', '20 M', '30 M', '40 M'].forEach((t, i) => x.fillText(t, (i + 0.5) * (w / 4), hh / 2));
      // worn patches
      x.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 260; k++) { x.fillStyle = `rgba(0,0,0,${rand(0.2, 0.8)})`; x.fillRect(rand(0, w), rand(0, hh), rand(2, 9), rand(2, 7)); }
    });
    const labels = [-10, -20, -30, -40].map((z, i) => {
      const g = new THREE.PlaneGeometry(2.2, 0.7);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 4);
      g.rotateX(-Math.PI / 2); g.translate(6.1, 0.008, z + 0.8);
      return g;
    });
    s.add(new THREE.Mesh(mergeGeometries(labels), new THREE.MeshStandardMaterial({ map: labelTex, color: 0xd9ceb0, roughness: 0.8, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })));

    // hazard stripes at the firing line and before the far wall (worn paint)
    const stripe = drawTexture(512, 64, (x, w, hh) => {
      x.fillStyle = '#c89417'; x.fillRect(0, 0, w, hh);
      x.fillStyle = '#18181a'; x.beginPath();
      for (let k = -2; k < 17; k++) { x.moveTo(k * 32, hh); x.lineTo(k * 32 + 16, hh); x.lineTo(k * 32 + 16 + hh / 2, 0); x.lineTo(k * 32 + hh / 2, 0); }
      x.fill();
      for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(${rand(90, 130) | 0},${rand(90, 125) | 0},${rand(90, 120) | 0},${rand(0.3, 0.9)})`; x.fillRect(rand(0, w), rand(0, hh), rand(1, 7), rand(1, 4)); }
    });
    stripe.wrapS = THREE.RepeatWrapping; stripe.repeat.set(4, 1);
    const stripeMat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const z of [-1.7, -52.4]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(17.2, 0.4), stripeMat);
      m.rotation.x = -Math.PI / 2; m.position.set(0, 0.007, z); m.receiveShadow = true;
      s.add(m);
    }

    // soft contact shadows (ambient occlusion) under everything standing on the floor
    const blobTex = drawTexture(128, 128, (x) => {
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(0.45, 'rgba(255,255,255,0.42)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    }, false);
    this.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });

    // static props (merged per material): ammo crates, drums, bollards, beacons, the rails, a range console
    const props = new THREE.Group();
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x3f4438, metalness: 0.45, roughness: 0.62 });
    const drumMat = new THREE.MeshStandardMaterial({ color: 0x7a2418, metalness: 0.35, roughness: 0.55 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xd19a1c, metalness: 0.1, roughness: 0.5 });
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0x552a08, toneMapped: false });
    const screenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fc2d8).multiplyScalar(0.55) });
    const blobs = [];
    const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = !low; m.receiveShadow = true; props.add(m); return m; };
    for (const [x, z, sz] of [[-7.2, 3.5, 1.1], [-7.3, 2.2, 0.9], [-6.9, 2.9, 0.7], [7.3, 5.2, 1.0], [7.2, -24, 1.2], [-7.2, -26, 1.0], [-7.1, -27.3, 0.8]]) {
      add(new THREE.BoxGeometry(sz, sz, sz), crateMat, x, sz / 2 + (sz < 0.8 ? 1.1 : 0), z, rand(-0.3, 0.3));
      if (sz >= 0.8) blobs.push([x, z, sz * 1.7, sz * 1.7]);
    }
    for (const [x, z] of [[-7.6, 5.4], [-6.9, 5.8], [7.6, -22.4]]) { add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), drumMat, x, 0.45, z); blobs.push([x, z, 0.95, 0.95]); }
    for (const x of [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]) {
      add(new THREE.CylinderGeometry(0.07, 0.09, 0.5, 10), crateMat, x, 0.25, -2.1);
      add(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 10), capMat, x, 0.52, -2.1);
      blobs.push([x, -2.1, 0.55, 0.55]);
    }
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8b8e92, metalness: 0.75, roughness: 0.45 });
    for (const z of RAILS) { add(new THREE.BoxGeometry(15.4, 0.1, 0.24), railMat, 0, 0.05, z); blobs.push([0, z, 16, 0.42]); }
    for (const [x, z] of [[-8.75, -6], [8.75, -6], [-8.75, -34], [8.75, -34]]) {
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.18, 12).rotateZ(Math.PI / 2), steelDark, x, 6.3, z);
      add(new THREE.SphereGeometry(0.16, 12, 8), this.beaconMat, x - Math.sign(x) * 0.12, 6.3, z);
    }
    // the range console on the right, near the camera
    add(new THREE.BoxGeometry(1.4, 1.0, 0.7), crateMat, 5.8, 0.5, 2.6, -0.3);
    const scr = add(new THREE.PlaneGeometry(1.2, 0.5), screenMat, 5.75, 1.18, 2.52, -0.3);
    scr.rotation.x = -0.6; scr.castShadow = false;
    blobs.push([5.8, 2.6, 2.2, 1.4]);
    const bg = blobs.map(([x, z, w, d]) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, 0.009, z));
    const blobMesh = new THREE.Mesh(mergeGeometries(bg), this.blobMat);
    blobMesh.renderOrder = 1;
    mergeStatic(props);
    s.add(props, blobMesh);

    // scorch marks: one instanced mesh; fresh ones glow white-hot, go orange, then cool to soot
    const scorchTex = drawTexture(256, 256, (x) => {
      // a ragged soot stain: overlapping blotches, streaks thrown outward, a dense burnt core
      for (let k = 0; k < 26; k++) {
        const a = rand(0, TAU), d = rand(0, 46), cx = 128 + Math.cos(a) * d, cy = 128 + Math.sin(a) * d, r = rand(16, 60);
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${rand(0.2, 0.45)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 256, 256);
      }
      x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineCap = 'round';
      for (let k = 0; k < 40; k++) { const a = rand(0, TAU), r0 = rand(20, 40), r1 = r0 + rand(30, 90); x.lineWidth = rand(1, 4); x.beginPath(); x.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0); x.lineTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1); x.stroke(); }
      const core = x.createRadialGradient(128, 128, 0, 128, 128, 34);
      core.addColorStop(0, 'rgba(255,255,255,0.95)'); core.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = core; x.fillRect(0, 0, 256, 256);
    });
    const N = 48;
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }), N);
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(0.0001); dummy.updateMatrix();
    for (let i = 0; i < N; i++) { this.decals.setMatrixAt(i, dummy.matrix); this.decals.setColorAt(i, this._col.setRGB(0.02, 0.018, 0.016)); }
    this.decalAge = new Float32Array(N).fill(99);
    this.decalI = 0;
    s.add(this.decals);

    // haze: faint shafts of light under the fixtures nearest the firing line
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xfff4e6) }, uAlpha: { value: 0.03 } },
      vertexShader: /* glsl */ `
        varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); gl_FragColor = vec4(uColor, uAlpha * f * smoothstep(0.0, 0.7, vY) * (0.3 + 0.7 * vY)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const shaftGeo = new THREE.CylinderGeometry(0.3, 1.9, 7.6, 24, 1, true);
    shaftGeo.scale(1, 1, 1.5);
    const shafts = [];
    for (const z of [-2, -6, -10, -14]) for (const x of [-4.5, 4.5]) shafts.push(shaftGeo.clone().translate(x, 3.8, z));
    s.add(new THREE.Mesh(mergeGeometries(shafts), shaftMat));
  }

  _buildTargets() {
    const s = this.scene, low = this.app.low;
    // painted steel plates: a bullseye in range paint over primer, chipped and pocked by earlier rounds
    const plateTex = (base, ring, dot) => drawTexture(512, 512, (x, w) => {
      const c = w / 2;
      x.fillStyle = base; x.fillRect(0, 0, w, w);
      x.strokeStyle = ring; x.lineWidth = 26;
      for (const r of [205, 140]) { x.beginPath(); x.arc(c, c, r, 0, TAU); x.stroke(); }
      x.fillStyle = dot; x.beginPath(); x.arc(c, c, 62, 0, TAU); x.fill();
      // paint chips (bare grey steel) and dark pock marks
      for (let k = 0; k < 90; k++) {
        const a = rand(0, TAU), d = Math.sqrt(Math.random()) * 240, px = c + Math.cos(a) * d, py = c + Math.sin(a) * d;
        x.fillStyle = `rgba(${rand(70, 110) | 0},${rand(70, 108) | 0},${rand(70, 105) | 0},${rand(0.5, 0.95)})`;
        x.beginPath(); x.ellipse(px, py, rand(2, 11), rand(2, 8), rand(0, TAU), 0, TAU); x.fill();
      }
      for (let k = 0; k < 30; k++) {
        const a = rand(0, TAU), d = Math.sqrt(Math.random()) * 160, px = c + Math.cos(a) * d, py = c + Math.sin(a) * d;
        const g = x.createRadialGradient(px, py, 0, px, py, 14);
        g.addColorStop(0, 'rgba(30,26,22,0.8)'); g.addColorStop(1, 'rgba(30,26,22,0)');
        x.fillStyle = g; x.fillRect(px - 14, py - 14, 28, 28);
      }
      // grime toward the bottom edge
      const gr = x.createLinearGradient(0, 0, 0, w);
      gr.addColorStop(0.6, 'rgba(40,36,30,0)'); gr.addColorStop(1, 'rgba(40,36,30,0.45)');
      x.fillStyle = gr; x.fillRect(0, 0, w, w);
    });
    const face = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0.15 });
    this.holoMat = face(plateTex('#d8d4c8', '#a41c1a', '#a41c1a'));
    this.goldMat = face(plateTex('#d8741c', '#1c1b1a', '#1c1b1a'));
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x55585d, metalness: 0.9, roughness: 0.38 });
    const standGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.035, 0.045, 1.25, 8).translate(0, 0.625, 0),
      new THREE.BoxGeometry(0.7, 0.1, 0.45).translate(0, 0.05, 0),
      new THREE.BoxGeometry(0.9, 0.05, 0.05).translate(0, 1.22, 0),
      // two hanger straps from the crossbar up to the plate
      new THREE.BoxGeometry(0.05, 0.36, 0.02).translate(-0.3, 1.38, -0.04),
      new THREE.BoxGeometry(0.05, 0.36, 0.02).translate(0.3, 1.38, -0.04),
    ]);
    // the plate: a steel disc 3 cm thick (edge, painted face, bare back)
    const discGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.03, 48).rotateX(Math.PI / 2);
    const blobGeo = new THREE.PlaneGeometry(1.3, 0.9).rotateX(-Math.PI / 2).translate(0, 0.012, 0);

    this.targets = [];
    const plateTarget = (kind, mat) => {
      const g = new THREE.Group();
      const stand = new THREE.Mesh(standGeo, this.steel);
      stand.castShadow = !low; stand.receiveShadow = true;
      const disc = new THREE.Mesh(discGeo, [edgeMat, mat, edgeMat]);
      disc.position.set(0, 1.78, 0);
      disc.castShadow = !low; disc.receiveShadow = true;
      const blob = new THREE.Mesh(blobGeo, this.blobMat);
      blob.renderOrder = 1;
      g.add(stand, disc, blob);
      g.visible = false;
      s.add(g);
      const tg = { kind, g, hit: disc, alive: false, state: 'off', t: 0, age: 0, life: 6, speed: 0, phase: 0, rail: 0, vx: 0, y0: 0, fallT: 0.45, ring: 0 };
      disc.userData.tg = tg;
      this.targets.push(tg);
    };
    for (let i = 0; i < 10; i++) plateTarget('disc', this.holoMat);
    for (let i = 0; i < 2; i++) plateTarget('slider', this.goldMat);

    // drones: shared materials (one shader, and batched state)
    const droneMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.8, roughness: 0.38 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a2a).multiplyScalar(this.hdr), toneMapped: false });
    const eyeGeo = new THREE.SphereGeometry(0.1, 12, 10);
    for (let i = 0; i < 4; i++) {
      const g = createDrone();
      const { body, eye } = g.userData;
      body.material.dispose(); body.material = droneMat; body.castShadow = !low;
      eye.material.dispose(); eye.material = eyeMat;
      eye.geometry.dispose(); eye.geometry = eyeGeo;
      g.scale.setScalar(0.85);
      g.visible = false;
      s.add(g);
      const tg = { kind: 'drone', g, hit: body, alive: false, state: 'off', t: 0, age: 0, life: 99, speed: 0, phase: 0, rail: 0, vx: 0, y0: 0 };
      body.userData.tg = tg;
      this.targets.push(tg);
    }
  }

  _buildUI() {
    const sys = SYSTEMS.find((x) => x.key === 'repulsors');
    this.intro({
      kicker: 'Weapons test',
      title: 'Repulsor <em>Range</em>',
      jp: 'RANGE',
      desc: 'Sixty metres of concrete and blast walls under the workshop. Holographic targets pop up down the lanes, sliders ride the rails and drones strafe across the hangar. Point, fire, and see how the palms hold up in a 45-second round.',
      extra: [
        this.gestures([['tap', '<b>Tap</b> to fire a repulsor'], ['hold', '<b>Hold</b> &amp; release: heavy blast'], ['key', '<b>Space</b>: chest beam']]),
        h('dl.spec', {}, sys.specs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
      ],
    });
    this.btnStart = this.button('Start round', () => this._startRound(), 'btn-primary');
    this.btnUni = this.button('<span>Unibeam</span><kbd>Space</kbd><i class="rp-cd"></i>', () => this._unibeam(), 'rp-uni');
    this.cdEl = this.btnUni.querySelector('.rp-cd');
    this.ui.append(h('div.controls', {}, this.btnStart, h('div.group', {}, this.btnUni)));

    const pill = (label, cls = '') => { const b = h('b', { text: '—' }); const el = h(`div.pill${cls}`, {}, label, b); return { el, b, last: '' }; };
    this.hud = { time: pill('Time'), score: pill('Score'), combo: pill('Combo'), acc: pill('Accuracy', '.opt'), hits: pill('Hits', '.opt') };
    this.uniLbl = h('span', { text: 'Ready' });
    this.uniFill = h('div.meter-fill.gold');
    this.ui.append(h('div.hud-corner', {}, ...Object.values(this.hud).map((p) => p.el),
      h('div.meter', {}, h('div.meter-label', {}, h('span', { text: 'Chest beam' }), this.uniLbl), h('div.meter-track', {}, this.uniFill))));

    this.countEl = h('div.rp-count');
    this.comboEl = h('div.combo');
    this.pops = Array.from({ length: 6 }, () => h('div.rp-pop'));
    this._pi = 0;
    this.cardRank = h('h3');
    this.cardBest = h('p.rp-best');
    this.cardScore = h('div.big');
    this.cardStats = h('div.rp-report');
    this.card = h('div.game-card.hidden', { role: 'dialog', 'aria-label': 'Range report' },
      h('span.rp-kicker', { text: 'Range report' }), this.cardRank, this.cardBest, this.cardScore, this.cardStats,
      h('div.rp-card-btns', {}, this.button('Retry', () => this._startRound(), 'btn-primary'), this.button('Free fire', () => this._closeCard())));
    this.ui.append(this.countEl, this.comboEl, ...this.pops, this.card);
    this._lastCd = -1;
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                            */
  /* ------------------------------------------------------------------ */

  enter() {
    if (!this.seen) {
      this.seen = true;
      this.app.toast('<b>Tap</b> to fire, <b>hold</b> for a heavy blast — then press <b>Start round</b>.', 3800);
    }
    this.spawnT = 0.4;
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    if (this.state === 'count' || this.state === 'play') this._resetRound(true);
    this.chargeFull = false;
    this.charge = 0;
  }

  resize(w, hgt) {
    const portrait = w / hgt < 0.85;
    this.camera.fov = portrait ? 60 : 46;
    super.resize(w, hgt);
    if (this.floor?.resizeMirror) { const v = this.app.renderer.getDrawingBufferSize(new THREE.Vector2()); this.floor.resizeMirror(v.x, v.y); }
  }

  /* ------------------------------------------------------------------ */
  /* The round                                                            */
  /* ------------------------------------------------------------------ */

  _resetRound(toFree) {
    this.score = 0; this.hits = 0; this.shots = 0; this.hitShots = 0; this.combo = 0; this.bestCombo = 0;
    this.timeLeft = ROUND; this.comboT = 0;
    if (toFree) {
      this.state = 'free';
      this.countEl.classList.remove('on', 'go');
      this.btnStart.textContent = 'Start round';
    }
    this.comboEl.classList.remove('on');
  }

  _startRound() {
    this.card.classList.add('hidden');
    this._resetRound(false);
    this.state = 'count';
    this.countT = 3.2;
    this._lastCount = -1;
    this.btnStart.textContent = 'Restart';
    for (const tg of this.targets) if (tg.state !== 'off') this._retire(tg);
    this.app.sfx.alarm();
    this.app.sfx.setMood('battle', ROUND + 6);
  }

  _endRound() {
    this.state = 'over';
    for (const tg of this.targets) if (tg.alive) this._retire(tg);
    const acc = this.shots ? Math.round((this.hitShots / this.shots) * 100) : 0;
    let rank = RANKS[0][1];
    for (const [min, name] of RANKS) if (this.score >= min) rank = name;
    const best = this.score > this.best;
    if (best) this.best = this.score;
    this.cardRank.textContent = rank;
    this.cardBest.textContent = best && this.score > 0 ? 'New personal best' : `Best ${this.best.toLocaleString()}`;
    this.cardScore.textContent = this.score.toLocaleString();
    this.cardStats.replaceChildren(...[[this.hits, 'Hits'], [`${acc}%`, 'Accuracy'], [`×${this.bestCombo}`, 'Best combo'], [this.shots, 'Shots']]
      .map(([v, k]) => h('div', {}, h('b', { text: String(v) }), h('span', { text: k }))));
    this.card.classList.remove('hidden');
    this.btnStart.textContent = 'Start round';
    this.comboEl.classList.remove('on');
    this.app.sfx.chime();
    this.app.flash(0.2, 0xffd27a);
  }

  _closeCard() {
    this.card.classList.add('hidden');
    this.state = 'free';
  }

  /* ------------------------------------------------------------------ */
  /* Targets                                                              */
  /* ------------------------------------------------------------------ */

  _spawn(kind) {
    const tg = this.targets.find((t) => t.kind === kind && t.state === 'off');
    if (!tg) return false;
    const g = tg.g;
    const play = this.state === 'play';
    tg.t = 0; tg.age = 0; tg.alive = true; tg.state = 'up';
    g.rotation.set(0, 0, 0);
    g.visible = true;
    if (kind === 'disc') {
      let z = 0;
      for (let k = 0; k < 6; k++) { z = rand(-8, -48); if (RAILS.every((r) => Math.abs(z - r) > 1.6)) break; }
      g.position.set(LANES[Math.floor(Math.random() * LANES.length)] + rand(-0.5, 0.5), 0, z);
      tg.life = play ? rand(3.8, 6.5) : rand(9, 14);
      g.scale.set(1, 0.01, 1);
    } else if (kind === 'slider') {
      const used = this.targets.filter((t) => t.kind === 'slider' && t !== tg && t.state !== 'off').map((t) => t.rail);
      tg.rail = RAILS.find((r) => !used.includes(r)) ?? RAILS[0];
      tg.phase = rand(0, TAU); tg.speed = rand(0.7, 1.2) * (Math.random() < 0.5 ? -1 : 1);
      g.position.set(Math.sin(tg.phase) * 6.5, 0.1, tg.rail);
      tg.life = play ? rand(7, 10) : 16;
      g.scale.set(1, 0.01, 1);
    } else {
      const dir = Math.random() < 0.5 ? 1 : -1;
      tg.vx = dir * rand(2.6, 5);
      tg.y0 = rand(2.6, 5.6);
      tg.phase = rand(0, TAU);
      g.position.set(-dir * 8.4, tg.y0, rand(-14, -42));
      g.scale.setScalar(0.01);
    }
    if (kind !== 'drone' && Math.random() < 0.6) this.app.sfx.hologram();
    return true;
  }

  /** Folds a target away without a hit (timeout, round over). */
  _retire(tg) {
    tg.alive = false;
    tg.state = tg.kind === 'drone' ? 'leave' : 'down';
    tg.t = 0;
  }

  _center(tg, out) {
    if (tg.kind === 'drone') return out.copy(tg.g.position);
    return tg.hit.getWorldPosition(out);
  }

  _value(tg) {
    if (tg.kind === 'drone') return 350;
    if (tg.kind === 'slider') return 250;
    return 100 + Math.round(Math.abs(tg.g.position.z) * 4);
  }

  _hitTarget(tg, heavy, bonus = 1) {
    if (!tg.alive) return false;
    tg.alive = false;
    const c = this._center(tg, this._v2);
    // effects
    if (tg.kind === 'drone') {
      this.boom.at(c, 0.9);
      this.app.sfx.boom();
      tg.state = 'off'; tg.g.visible = false;
      this.shake = Math.max(this.shake, 0.12);
    } else {
      // the plate rings and the whole stand topples backwards (a heavy blast throws it harder)
      this._knock(tg, c, heavy);
    }
    this.app.sfx.beep(4);
    // scoring
    if (this.state === 'play') {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.comboT = 2.4;
      const mult = Math.min(5, 1 + Math.floor(this.combo / 3));
      const pts = Math.round(this._value(tg) * mult * bonus);
      this.score += pts;
      this.hits++;
      this._pop(c, `+${pts}`, tg.kind === 'slider');
      if (this.combo >= 3) {
        this.comboEl.textContent = `×${mult} · ${this.combo} combo`;
        this.comboEl.classList.remove('on'); void this.comboEl.offsetWidth; this.comboEl.classList.add('on');
      }
    } else {
      this._pop(c, tg.kind === 'drone' ? 'Drone down' : 'Hit', tg.kind !== 'slider');
    }
    return true;
  }

  /** A hit on a steel plate: white-hot sparks off the face, a puff of smoke, the stand tips over. */
  _knock(tg, c, heavy) {
    const gold = tg.kind === 'slider';
    this.shards.burst(c, heavy ? 60 : 36, { speed: heavy ? 7 : 5.5, spread: 0.4, up: 1.6, life: [0.35, 1.1], size: [0.03, 0.075], colors: gold ? this.cGold : this.cShard });
    this._smoke(c, heavy ? 10 : 5, heavy ? 0.9 : 0.55);
    this._light(c, heavy ? 26 : 12);
    this.app.sfx.spark();
    tg.state = 'fall'; tg.t = 0;
    tg.fallT = heavy ? 0.42 : 0.55;
    tg.ring = 1;
  }

  /** Smoke from a hit: grey, lit by the room, drifting up and spreading. */
  _smoke(p, n, size) {
    this.smoke.burst(p, n, { speed: 0.9, spread: 0.6, up: 0.4, life: [1.2, 2.6], size: [size * 0.5, size], colors: this.cSmoke, grow: 1.6, alpha: 0.42 });
  }

  /** The flash of light a blast throws on the surroundings (one pooled light). */
  _light(p, e) {
    this.hitLight.position.copy(p);
    this.hitE = Math.max(this.hitE, e);
  }

  _pop(pos, text, cyan) {
    const v = this._v.copy(pos).project(this.camera);
    if (v.z > 1) return;
    const el = this.pops[this._pi];
    this._pi = (this._pi + 1) % this.pops.length;
    el.textContent = text;
    el.classList.toggle('cyan', !!cyan);
    el.style.transform = `translate(${((v.x * 0.5 + 0.5) * this.app.width).toFixed(0)}px, ${((-v.y * 0.5 + 0.5) * this.app.height - 30).toFixed(0)}px)`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }

  _updateTargets(dt, t) {
    for (const tg of this.targets) {
      if (tg.state === 'off') continue;
      const g = tg.g;
      tg.t += dt; tg.age += dt;
      if (tg.kind === 'slider' && tg.state !== 'fall') g.position.x = Math.sin(tg.phase + tg.age * tg.speed) * 6.5;
      if (tg.kind === 'drone') {
        const k = Math.min(1, tg.age / 0.35);
        const leaving = tg.state === 'leave';
        g.position.x += tg.vx * dt * (leaving ? 2.2 : 1);
        g.position.y = tg.y0 + Math.sin(tg.age * 2.2 + tg.phase) * 0.45 + (leaving ? tg.t * 3 : 0);
        g.scale.setScalar(0.85 * (leaving ? Math.max(0.01, 1 - tg.t * 1.5) : k));
        g.lookAt(0, 1.6, 0);
        g.rotateZ(-tg.vx * 0.06);
        if (Math.abs(g.position.x) > 9 || (leaving && tg.t > 0.66)) { tg.state = 'off'; tg.alive = false; g.visible = false; }
        continue;
      }
      if (tg.state === 'up') {
        g.scale.y = Math.max(0.01, backOut(Math.min(1, tg.t / 0.4)));
        if (tg.age > tg.life) this._retire(tg);
      } else if (tg.state === 'down') {
        g.scale.y = Math.max(0.01, 1 - tg.t / 0.3);
        if (tg.t >= 0.3) { tg.state = 'off'; g.visible = false; }
      } else if (tg.state === 'fall') {
        // tips over backwards about its base, the plate still swinging from the hit, then a thud of dust
        const k = Math.min(1, tg.t / tg.fallT);
        g.rotation.x = -(Math.PI / 2) * k * k;
        tg.ring *= Math.exp(-5 * dt);
        g.rotation.z = Math.sin(tg.t * 38) * 0.05 * tg.ring;
        if (k >= 1) {
          this._v2.set(g.position.x, 0.15, g.position.z - 1.2);
          this.smoke.burst(this._v2, 8, { speed: 1.4, spread: 1.4, up: 0.2, life: [0.8, 1.8], size: [0.4, 0.9], colors: this.cSmoke, grow: 1.4, alpha: 0.22 });
          this.boom.spark(this._v2, 8, 3);
          tg.state = 'off'; g.visible = false; g.rotation.set(0, 0, 0);
        }
      }
    }
  }

  _spawnTick(dt) {
    this.spawnT -= dt;
    if (this.spawnT > 0 || this.state === 'count' || this.state === 'over') return;
    let active = 0;
    for (const tg of this.targets) if (tg.alive) active++;
    const play = this.state === 'play';
    const want = play ? Math.min(7, 3 + Math.floor((ROUND - this.timeLeft) / 8)) : 3;
    if (active >= want) { this.spawnT = 0.25; return; }
    const r = Math.random();
    const allowDrone = !play || ROUND - this.timeLeft > 5;
    const ok = (allowDrone && r < 0.26 && this._spawn('drone')) || (r < 0.46 && this._spawn('slider')) || this._spawn('disc');
    this.spawnT = ok ? (play ? rand(0.3, 0.65) : rand(0.9, 1.6)) : 0.3;
  }

  /* ------------------------------------------------------------------ */
  /* Aiming and firing                                                    */
  /* ------------------------------------------------------------------ */

  /** What a ray through the screen point hits: a target (with a little aim assist), else the range. */
  _pick(ndc, targets = true, out = this.shot) {
    out.tg = null; out.surface = false;
    this.ray.setFromCamera(ndc, this.camera);
    if (targets) {
      const list = this._rayList;
      list.length = 0;
      for (const tg of this.targets) if (tg.alive) list.push(tg.hit);
      const hits = list.length ? this.ray.intersectObjects(list, false) : [];
      if (hits.length) { out.tg = hits[0].object.userData.tg; out.point.copy(hits[0].point); return out; }
      // aim assist: the target nearest the tap on screen
      const W = this.app.width, H = this.app.height;
      const px = (ndc.x * 0.5 + 0.5) * W, py = (-ndc.y * 0.5 + 0.5) * H;
      let best = this.app.isTouch ? 62 : 38, bestTg = null;
      for (const tg of this.targets) {
        if (!tg.alive) continue;
        const v = this._center(tg, this._v).project(this.camera);
        if (v.z > 1) continue;
        const d = Math.hypot((v.x * 0.5 + 0.5) * W - px, (-v.y * 0.5 + 0.5) * H - py);
        if (d < best) { best = d; bestTg = tg; }
      }
      if (bestTg) { out.tg = bestTg; this._center(bestTg, out.point); return out; }
    }
    const hits = this.ray.intersectObjects(this.rangeMeshes, false);
    if (hits.length) {
      const hit = hits[0];
      out.point.copy(hit.point);
      out.normal.copy(hit.face.normal);
      if (hit.instanceId != null) { hit.object.getMatrixAt(hit.instanceId, this._m4); out.normal.transformDirection(this._m4); }
      out.normal.transformDirection(hit.object.matrixWorld);
      out.surface = true;
    } else out.point.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, 60);
    return out;
  }

  _shoot(ndc, power) {
    if (this.uni.active || this.state === 'count') return;
    const sh = this._pick(ndc, true);
    const ps = this.pending;
    // a new shot while one is pending: fire that one now
    if (ps.on) this._fire(ps);
    const side = this.side;
    this.side = side === 'r' ? 'l' : 'r';
    ps.on = true; ps.side = side; ps.power = power; ps.tg = sh.tg; ps.surface = sh.surface;
    ps.point.copy(sh.point); ps.normal.copy(sh.normal);
    // the arm needs a moment to come up if it was down (or it's the other arm)
    ps.t = this.poseMode === side && this.armUp > 0.12 ? 0.03 : 0.14;
    this.aimPoint.copy(sh.point);
    this.aimSide = side;
    this.aimHold = 1.3;
    if (this.state === 'play') this.shots++;
  }

  _fire(ps) {
    ps.on = false;
    const app = this.app, heavy = ps.power > 0;
    // a shot leaves the hand; a heavy one (real armor) is driven from the chest reactor
    const pos = this.real && heavy ? this.suit.reactorWorld(this._palm) : this.suit.palmWorld(ps.side, this._palm, this._pdir).pos;
    if (ps.tg && ps.tg.alive) this._center(ps.tg, ps.point);
    const w = heavy ? 0.2 + ps.power * 0.26 : 0.12;
    this._hdrBeam(this.beams.fire(pos, ps.point, { width: w, life: heavy ? 0.55 : 0.3, color: heavy ? 0xcff8ff : 0x9ff3ff }));
    app.sfx.repulsor(heavy ? 0.55 : rand(0.9, 1.1));
    app.flash(heavy ? 0.16 : 0.04, 0xe6f4ff);
    this.suit.palm[ps.side] = 1;
    this.palmT[ps.side] = heavy ? 0.4 : 0.22;
    this.muzzle.position.copy(pos);
    this.muzzleT = 0;
    this.recoil = heavy ? 1 : 0.35;
    // impact
    const imp = this.impacts[this._ii];
    this._ii = (this._ii + 1) % this.impacts.length;
    imp.g.position.copy(ps.point); imp.t = 0; imp.size = heavy ? 2.2 : 0.9;
    this.boom.spark(ps.point, heavy ? 40 : 14, heavy ? 8 : 5);
    let any = false;
    if (ps.tg) any = this._hitTarget(ps.tg, heavy);
    if (!ps.tg && ps.surface) {
      this._decal(ps.point, ps.normal, heavy ? rand(1.6, 2.2) : rand(0.55, 0.85));
      // chips of concrete and hot grit thrown off the surface, a puff of dust and smoke, a flash on the walls
      const o = this._v.copy(ps.point).addScaledVector(ps.normal, 0.08);
      this.shards.burst(o, heavy ? 36 : 18, { speed: heavy ? 6 : 4, spread: 0.3, up: 1.2, life: [0.3, 0.9], size: [0.025, 0.06], colors: this.cShard });
      this._smoke(o, heavy ? 12 : 5, heavy ? 1.1 : 0.6);
      this._light(o, heavy ? 30 : 10);
    }
    if (heavy) {
      // the heavy blast knocks over everything near the impact
      const R = 1.6 + ps.power * 2.6;
      for (const tg of this.targets) if (tg.alive && this._center(tg, this._v).distanceTo(ps.point) < R) any = this._hitTarget(tg, true) || any;
      this.shake = Math.max(this.shake, 0.22 * ps.power + 0.08);
      this.bloomKick = 0.5;
      this.boom.at(ps.point, 0.45 * ps.power);
    }
    if (this.state === 'play') {
      if (any) this.hitShots++;
      else { this.combo = 0; this.comboEl.classList.remove('on'); }
    }
  }

  /** Pushes a beam's colour past 1 so it still flares under the high bloom threshold. */
  _hdrBeam(b) { b.m.material.uniforms.uColor.value.multiplyScalar(this.hdr); return b; }

  _decal(point, normal, size) {
    const i = this.decalI;
    this.decalI = (this.decalI + 1) % this.decalAge.length;
    const d = this._dummy;
    d.position.copy(point).addScaledVector(normal, 0.02);
    d.quaternion.setFromUnitVectors(Z, normal);
    d.rotateZ(rand(0, TAU));
    d.scale.setScalar(size);
    d.updateMatrix();
    this.decals.setMatrixAt(i, d.matrix);
    this.decals.instanceMatrix.needsUpdate = true;
    this.decalAge[i] = 0;
  }

  _updateDecals(dt) {
    let dirty = false;
    const ages = this.decalAge;
    for (let i = 0; i < ages.length; i++) {
      if (ages[i] > 4) continue;
      ages[i] += dt;
      // black-body cooling: white-hot for an instant, then orange, dull red, and soot
      const e = Math.pow(1 - Math.min(1, ages[i] / 4), 3);
      const hk = this.hdr;
      this.decals.setColorAt(i, this._col.setRGB(lerp(0.02, 4.2 * hk, e), lerp(0.018, 1.5 * hk, e * e), lerp(0.016, 0.45 * hk, e * e * e)));
      dirty = true;
    }
    if (dirty) this.decals.instanceColor.needsUpdate = true;
  }

  _unibeam() {
    const u = this.uni;
    if (u.active || this.state === 'count') return;
    if (u.cd > 0) { this.app.sfx.wrong(); return; }
    u.active = true; u.t = 0; u.cd = UNI_CD; u.beam = null; u.decalT = 0; u.boomT = 0;
    u.dir = Math.random() < 0.5 ? 1 : -1;
    this.pending.on = false;
    this.aimHold = 0;
    this.app.sfx.unibeam();
    this.app.sfx.servo(0.3);
    this.app.flash(0.1, 0xe6f4ff);
  }

  _updateUnibeam(dt) {
    const u = this.uni, suit = this.suit;
    if (!u.active) return;
    u.t += dt;
    const WIND = 0.35, DUR = 1.5;
    const o = suit.reactorWorld(this._o);
    this.chestGlow.position.copy(o);
    if (u.t < WIND) {
      this.chestGlow.scale.setScalar(0.2 + (u.t / WIND) * 0.7);
      this.chestGlow.material.opacity = u.t / WIND;
      this.shake = Math.max(this.shake, 0.03);
      return;
    }
    const k = (u.t - WIND) / DUR;
    if (k >= 1) {
      u.active = false;
      this.chestGlow.material.opacity = 0;
      this.app.sfx.powerDown();
      return;
    }
    // the sweep across the range, left to right (or back)
    const e = easeInOut(k);
    const aim = this._v2.set(u.dir * lerp(-7.8, 7.8, e), 0.8 + Math.sin(k * Math.PI) * 1.6, -50);
    this.aimPoint.copy(aim);
    const dir = this._n.subVectors(aim, o).normalize();
    this.ray.set(o, dir);
    const hits = this.ray.intersectObjects(this.rangeMeshes, false);
    const end = hits.length ? this._end.copy(hits[0].point) : this._end.copy(o).addScaledVector(dir, 60);
    if (!u.beam) u.beam = this._hdrBeam(this.beams.fire(o, end, { width: 0.6, life: 0.6, color: 0xcff8ff }));
    else this.beams.hold(u.beam, o, end);
    this.chestGlow.scale.setScalar(0.85 + Math.random() * 0.15);
    this.chestGlow.material.opacity = 1;
    this.shake = Math.max(this.shake, 0.14);
    this.bloomKick = 0.5;
    this.app.flash(0.03, 0xe6f4ff);
    // everything the beam touches goes
    this._line.set(o, end);
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      const c = this._center(tg, this._palm);
      const cp = this._line.closestPointToPoint(c, true, this._pdir);
      if (cp.distanceTo(c) < (tg.kind === 'drone' ? 1.7 : 1.3)) this._hitTarget(tg, false, 1.5);
    }
    // a molten trail on the far wall and floor
    u.decalT -= dt; u.boomT -= dt;
    if (hits.length && u.decalT <= 0) {
      u.decalT = 0.045;
      const hit = hits[0];
      const n = this._palm.copy(hit.face.normal);
      if (hit.instanceId != null) { hit.object.getMatrixAt(hit.instanceId, this._m4); n.transformDirection(this._m4); }
      n.transformDirection(hit.object.matrixWorld);
      this._decal(end, n, rand(1.0, 1.5));
      this.boom.spark(end, 8, 7);
    }
    if (u.boomT <= 0) { u.boomT = 0.16; this.boom.at(end, 0.4); this._light(end, 30); }
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                                */
  /* ------------------------------------------------------------------ */

  click(p) {
    if (performance.now() < this._skipClickUntil) return;
    this._shoot(p.ndc, 0);
  }

  pointerMove() { this._lookDirty = true; }

  pointerUp(p) {
    if (this.charge >= 0.25 && !this.uni.active && this.state !== 'count') {
      this._skipClickUntil = performance.now() + 60;
      this._shoot(p.ndc, Math.min(1, this.charge));
    }
    this.chargeFull = false;
    this.charge = 0;
    this.app.sfx.charge(0);
  }

  key(e) {
    if (e.code === 'Space') { e.preventDefault(); this._unibeam(); return true; }
    if (e.key === 'Enter' && (this.state === 'free' || this.state === 'over')) { this._startRound(); return true; }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Frame                                                                */
  /* ------------------------------------------------------------------ */

  _updateSuit(dt) {
    const suit = this.suit, u = this.uni;
    let mode;
    if (u.active) mode = 'uni';
    else if (this.aimHold > 0 || this.pending.on || this.charge > 0) mode = this.aimSide || 'r';
    else mode = 'ready';
    if (mode !== this.poseMode) { if (!this.real) suit.pose(this.poses[mode]); this.poseMode = mode; this.armUp = 0; }
    this.armUp += dt;
    this.aimHold = Math.max(0, this.aimHold - dt);

    const target = mode === 'ready' ? this.lookPoint : this.aimPoint;
    const rel = wrap(Math.atan2(target.x, target.z) - Math.PI);
    this.rootPitchT = 0;
    if (this.real) {
      // the sculpted armor doesn't move its arms: the whole body turns to the target, and leans a little for height
      if (mode === 'ready') this.rootYawT = Math.PI + clamp(rel * 0.35, -0.4, 0.4);
      else if (mode === 'uni') this.rootYawT = Math.PI + clamp(rel * 0.8, -0.7, 0.7);
      else {
        this.rootYawT = Math.PI + clamp(rel, -1.2, 1.2);
        const pitch = Math.atan2(target.y - 1.55, Math.hypot(target.x, target.z));
        this.rootPitchT = clamp(-pitch * 0.6, -0.22, 0.14);
      }
    } else if (mode === 'ready') {
      const P = this.poses.ready;
      this.rootYawT = Math.PI + clamp(rel * 0.25, -0.3, 0.3);
      P.spine[1] = clamp(rel * 0.4, -0.45, 0.45);
      P.neck[1] = clamp(rel * 0.35, -0.4, 0.4);
    } else if (mode === 'uni') {
      const P = this.poses.uni;
      this.rootYawT = Math.PI + clamp(rel * 0.6, -0.55, 0.55);
      P.spine[1] = clamp(rel * 0.4, -0.35, 0.35);
    } else {
      const P = this.poses[mode];
      this.rootYawT = Math.PI + clamp(rel * 0.5, -0.6, 0.6);
      const spineY = clamp(rel - (this.rootYawT - Math.PI), -0.85, 0.85);
      P.spine[1] = spineY;
      P.neck[1] = -spineY * 0.2;
      const pitch = Math.atan2(target.y - 1.45, Math.hypot(target.x, target.z));
      P[mode === 'r' ? 'shoulderR' : 'shoulderL'][0] = clamp(-1.52 - pitch, -2.7, -0.7);
    }
    this.rootYaw = damp(this.rootYaw, this.rootYawT, 9, dt);
    suit.root.rotation.y = this.rootYaw;
    this.rootPitch = damp(this.rootPitch, this.rootPitchT, 9, dt);
    suit.root.rotation.x = this.rootPitch;

    // palms: glow while charging, flare on a shot
    for (const s of ['l', 'r']) {
      this.palmT[s] = Math.max(0, this.palmT[s] - dt);
      suit.palm[s] = this.palmT[s] > 0 ? 1 : (this.charge > 0 && this.aimSide === s ? this.charge : 0);
    }
    suit.reactor = u.active ? 1.6 : 1;
    suit.update(dt);
  }

  _updateHud(dt) {
    const H = this.hud;
    const set = (p, text, cls) => { if (p.last !== text) { p.last = text; p.b.textContent = text; } if (cls !== undefined) { p.el.classList.toggle('hot', cls === 'hot'); p.el.classList.toggle('warn', cls === 'warn'); } };
    const live = this.state === 'play' || this.state === 'count' || this.state === 'over';
    set(H.time, this.state === 'free' ? 'Free' : `${Math.ceil(this.timeLeft)}s`, this.state === 'play' && this.timeLeft < 10 ? 'warn' : '');
    set(H.score, live ? this.score.toLocaleString() : '—');
    const mult = Math.min(5, 1 + Math.floor(this.combo / 3));
    set(H.combo, live ? `×${mult} (${this.combo})` : '—', this.combo >= 3 ? 'hot' : '');
    set(H.acc, live && this.shots ? `${Math.round((this.hitShots / this.shots) * 100)}%` : '—');
    set(H.hits, live ? String(this.hits) : '—');
    // chest beam cooldown
    const cdK = this.uni.cd > 0 ? 1 - this.uni.cd / UNI_CD : 1;
    const q = Math.round(cdK * 50);
    if (q !== this._lastCd) {
      this._lastCd = q;
      const ready = q >= 50;
      this.uniFill.style.width = `${q * 2}%`;
      this.cdEl.style.transform = `scaleX(${cdK.toFixed(3)})`;
      this.uniLbl.textContent = ready ? 'Ready' : `${Math.ceil(this.uni.cd)}s`;
      this.btnUni.classList.toggle('cooling', !ready);
      this.btnUni.classList.toggle('ready', ready);
    }
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.comboEl.classList.remove('on'); if (this.state === 'play') this.combo = 0; } }
  }

  update(dt, t) {
    const app = this.app, p = app.pointer;

    // the round
    if (this.state === 'count') {
      this.countT -= dt;
      const n = Math.ceil(this.countT - 0.2);
      if (n !== this._lastCount) {
        this._lastCount = n;
        const el = this.countEl;
        el.textContent = n > 0 ? String(n) : 'Fire';
        el.classList.toggle('go', n <= 0);
        el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
        if (n > 0) app.sfx.beep(n); else { app.sfx.lock(); app.flash(0.15, 0xffd27a); }
      }
      if (this.countT <= 0) { this.state = 'play'; this.spawnT = 0; }
    } else if (this.state === 'play') {
      const before = Math.ceil(this.timeLeft);
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      const now = Math.ceil(this.timeLeft);
      if (now !== before && now <= 5 && now > 0) app.sfx.beep(1);
      if (this.timeLeft <= 0) this._endRound();
    }
    this._spawnTick(dt);

    // hold to charge a heavy blast
    const canCharge = !this.uni.active && this.state !== 'count';
    const hold = this.trackHold(1.0, canCharge && !this.chargeFull, 0.2);
    if (hold.fired) { this.chargeFull = true; app.sfx.lock(); }
    if (this.chargeFull && p.down && canCharge) { this.charge = 1; app.setCharge(1); app.sfx.charge(1); }
    else this.charge = p.down ? hold.progress : 0;
    if (this.charge > 0) {
      this._pick(p.ndc, true, this.shot);
      this.aimPoint.copy(this.shot.point);
      this.aimSide = this.side;
      this.aimHold = Math.max(this.aimHold, 0.3);
    }

    // where the pointer rests: the suit's head and torso follow it; hovering a target shows the hand cursor
    if (this._lookDirty) {
      this._lookDirty = false;
      const sh = this._pick(p.ndc, true, this._lookShot || (this._lookShot = { tg: null, point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: false }));
      this.lookPoint.copy(sh.point);
      app.setHover(!!sh.tg);
    }

    // a pending shot leaves the palm once the arm is up
    const ps = this.pending;
    if (ps.on) { ps.t -= dt; if (ps.t <= 0) this._fire(ps); }

    this.uni.cd = Math.max(0, this.uni.cd - dt);
    this._updateUnibeam(dt);
    this._updateSuit(dt);
    this._updateTargets(dt, t);
    this._updateDecals(dt);
    this._updateHud(dt);

    // glows
    this.muzzleT += dt;
    const mk = Math.max(0, 1 - this.muzzleT / 0.18);
    this.muzzle.scale.setScalar(0.01 + mk * (this.real ? 1.5 : 0.9));
    this.muzzle.material.opacity = mk;
    for (const imp of this.impacts) {
      imp.t += dt;
      const k = Math.max(0, 1 - imp.t / 0.3);
      imp.g.scale.setScalar(0.01 + imp.size * (1.2 - k * 0.2) * (k > 0 ? 1 : 0));
      imp.g.material.opacity = k;
    }
    if (this.charge > 0) {
      const pos = this.real ? this.suit.reactorWorld(this._palm) : this.suit.palmWorld(this.aimSide || 'r', this._palm, this._pdir).pos;
      this.halo.position.copy(pos);
      this.halo.scale.setScalar(0.15 + this.charge * 0.8 + Math.sin(t * 40) * 0.04 * this.charge);
      this.halo.material.opacity = 0.4 + this.charge * 0.6;
    } else this.halo.material.opacity = damp(this.halo.material.opacity, 0, 12, dt);
    if (!this.uni.active) this.chestGlow.material.opacity = damp(this.chestGlow.material.opacity, 0, 8, dt);

    // warning beacons pulse through a round
    const alert = this.state === 'count' || this.state === 'play' || this.uni.active;
    const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * 7), 2);
    this.warn.intensity = damp(this.warn.intensity, alert ? 10 + pulse * 30 : 0, 6, dt);
    this.beaconMat.color.setRGB(1, 0.45, 0.08).multiplyScalar((alert ? 0.4 + pulse * 3 : 0.25) * this.hdr);

    // dust drifting in the light
    if (Math.random() < dt * 14) this.dust.emit({ x: rand(-5, 5), y: rand(0.3, 6), z: rand(-12, 3), vx: rand(-0.05, 0.05), vy: rand(-0.02, 0.04), life: rand(3, 6), size: rand(0.015, 0.035), color: this.cDust, alpha: 0.3 });
    this.dust.update(dt, t);
    this.shards.update(dt, t);
    this.boom.update(dt, t);
    this.smoke.update(dt, t);
    this.beams.update(dt, this.camera);
    this.hitE *= Math.exp(-9 * dt);
    this.hitLight.intensity = this.hitE;

    // bloom and grade
    this.bloomKick = Math.max(0, (this.bloomKick || 0) - dt * 1.5);
    this.bloom.strength = this.bloomBase + this.bloomKick * 0.5;
    this.grade.tintAmt = this.uni.active ? 0.03 : 0;

    // camera: over the right shoulder, drifting with the pointer, recoil and shake
    const portrait = app.width / app.height < 0.85;
    const cam = this.camera;
    const nx = p.ndc.x, ny = p.ndc.y;
    this._camPos.set(portrait ? 1.1 : 0.85, portrait ? 2.45 : 1.95, portrait ? 4.8 : 2.25);
    this._camPos.x += nx * 0.2; this._camPos.y += ny * 0.1;
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 4);
    this._camPos.z += this.recoil * 0.12;
    this._camLook.set((portrait ? -0.2 : -0.5) + nx * 1.4, 1.45 + ny * 0.7, -14);
    cam.position.x = damp(cam.position.x, this._camPos.x, 4, dt);
    cam.position.y = damp(cam.position.y, this._camPos.y, 4, dt);
    cam.position.z = damp(cam.position.z, this._camPos.z, 6, dt);
    this.look.lerp(this._camLook, 1 - Math.exp(-3 * dt));
    this.shake *= Math.exp(-6 * dt);
    const s = this.shake;
    cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s;
    cam.lookAt(this.look);
  }
}
