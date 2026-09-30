import * as THREE from 'three';
import './SuitUp.css';
import { Chapter } from '../core/Chapter.js';
import { CineCam } from '../core/CineCam.js';
import { Suit, suitEnvironment } from '../objects/Suit.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { Shockwaves, glowSprite } from '../objects/FX.js';
import { glossyFloor } from '../objects/GlossyFloor.js';
import { loadEnv, envMap, loadTextures, pbr, HDRIS } from '../core/Env.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeStatic } from '../core/mergeStatic.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, damp, clamp, TAU, h, drawTexture, shared, easeInOut } from '../core/utils.js';

/*
 * Suit up: an industrial assembly bay (sealed concrete, painted steel columns and trusses, clerestory
 * windows, high-bay lamps) with a tread-plate turntable under a steel gantry of painted robot arms. Pick an armor, press Suit up (or hold anywhere):
 * the Mark III's 212 plates fly in and lock on one by one while the arms fit them, the plated suits are
 * welded on from the boots up behind a glowing seam, and the nanotech suits flow out from the chest. Then the eyes and reactor light, the systems report
 * in, and the whole suit lifts off the platform on its boot jets. Reset takes it all off again.
 * The models are shown exactly as authored: nothing is posed, only moved.
 */

// Every armor is one of the supplied GLB models, shown as authored. mode: 'plates' flies its separate plates
// in, 'rise' reveals it from the boots up behind a welding seam, 'flow' grows it out of the chest (nanites).
// size: shown height in metres when it differs from the model's own (the Hulkbuster must fit the gantry).
const MARKS = [
  { key: 'mk1', name: 'Mark I', mode: 'rise', time: 5.4, warm: true, label: 'Welds' },
  { key: 'mk5', name: 'Mark V', mode: 'rise', time: 5.0, warm: true, label: 'Plating' },
  { key: 'mk5raw', name: 'Prototype', mode: 'rise', time: 5.0, warm: true, label: 'Plating' },
  { key: 'mk42', name: 'Mark XLII', mode: 'rise', time: 4.6, warm: true, label: 'Plating' },
  { key: 'tpose', name: 'Mark III', mode: 'plates', time: 6.5, label: 'Plates' },
  { key: 'classic', name: 'Classic', mode: 'rise', time: 5.0, warm: true, label: 'Plating' },
  { key: 'nano', name: 'Mark 50', mode: 'flow', time: 4.2, label: 'Nanites' },
  { key: 'mk85', name: 'Mark 85', mode: 'flow', time: 4.6, label: 'Nanites' },
  { key: 'heavy', name: 'Hulkbuster', mode: 'rise', time: 6.2, warm: true, label: 'Plating', size: 2.55, frame: false },
];
const SPEC = Object.fromEntries(MARKS.map((m) => [m.key, m]));
const SYSTEM_LINES = [['Power', 0.06], ['Hydraulics', 0.28], ['Flight', 0.5], ['Weapons', 0.72], ['HUD', 0.93]];
const REMOVE_TIME = 2.4;
const PLATFORM_Y = 0.14;
const ARM_ANGLES = [Math.PI / 6, Math.PI * 5 / 6, Math.PI * 7 / 6, Math.PI * 11 / 6];
const ARM_R = 2.0, MOUNT_Y = 3.1, MAST = 0.4, L1 = 1.3, L2 = 1.3;

export class SuitUp extends Chapter {
  constructor(app) {
    super(app, { id: 'suitup', title: 'Suit Up', jp: 'ASSEMBLY' });
    this.bloom = { strength: 0.6, radius: 0.5, threshold: 2.8 }; // painted metal glints must not bloom; the glows are HDR
    this.grade = { ...this.grade, grain: 0.025, vig: 0.42, ca: 0.002, sat: 1, tint: 0xffb060, tintAmt: 0 };
    this.mood = 'calm';
    this.shiftView = 0.1;
    this.trailColor = '255,200,120';
    this.state = 'idle';
    this.t = 0;
    this.mark = 'tpose';
    this.S = 1; // the shown armor's size against a 1.9 m suit (the camera keeps its distance by it)
    this.lift = 0; this.liftTarget = 0;
    this.landed = -2; this.nanoTicks = 0;
    this.fit = 1;
    this.orbit = { yaw: 0.35, pitch: 0.08, dist: 4.7 };
    this.orbitV = 0;
    this.shake = 0;
    this.timers = [];
    this.clock = 0;
    this._hinted = false;
    this._lastClank = 0; this._lastServo = 0;
  }

  load() {
    return Promise.all([loadModels(['tpose', 'mk85']), loadEnv(HDRIS.shop), loadTextures(['concrete_floor_worn_001', 'metal_plate'])]);
  }

  build() {
    const s = this.scene;
    // the far end of the bay dissolves into a grey haze of the same colour (no black void)
    const haze = 0x121416;
    s.background = new THREE.Color(haze);
    s.fog = new THREE.Fog(haze, 13, 38);
    // a photographed machine shop for reflections and ambient; the bay's own lamps dominate
    s.environment = envMap(HDRIS.shop) || suitEnvironment();
    s.environmentIntensity = 0.38;
    // surface grit shared by the painted and bare metals: the concrete set's roughness and normal detail
    const grit = pbr('concrete_floor_worn_001', { repeat: 2 });
    this._grit = { rough: grit.roughnessMap || null, nor: grit.normalMap || null };
    this.camera.fov = 40;
    this.camera.position.set(1.6, 1.6, 4.4);
    this.look = new THREE.Vector3(0, 1.1, 0);
    this.cine = new CineCam(this.camera);
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();

    this._buildLights();
    this._buildStage();
    this._buildArms();
    this._buildSuits();

    this.sparks = new ParticlePool({ count: 700, gravity: -7, drag: 0.7, softness: 1.1 });
    this.motes = new ParticlePool({ count: 220, drag: 0.3, turbulence: 0.2, softness: 2 });
    s.add(this.sparks.points, this.motes.points);
    // (HDR colours: past the bloom threshold, so sparks still flare)
    this.sparkColors = [new THREE.Color(0xffd28a).multiplyScalar(4), new THREE.Color(0xffffff).multiplyScalar(3.5), new THREE.Color(0xff9a40).multiplyScalar(4)];
    this.cyanColors = [new THREE.Color(0xbff6ff).multiplyScalar(3.5), new THREE.Color(0x7fe6ff).multiplyScalar(3.5)];
    this.moteColor = new THREE.Color(0xd8cdbd);
    this.waves = new Shockwaves(s, 4);

    this._buildUI();
    this._setGhost();
  }

  resize(w, hh) {
    this._resize(w, hh);
    if (this.floor?.resizeMirror) { const v = this.app.renderer.getDrawingBufferSize(new THREE.Vector2()); this.floor.resizeMirror(v.x, v.y); }
  }

  /** Painted steel: a colour coat with a slight orange peel and wear in its roughness (optionally clear-coated). */
  _paint(color, { roughness = 0.5, clearcoat = 0, normalScale = 0.08, metalness = 0 } = {}) {
    const g = this._grit;
    const o = { color, roughness, metalness, roughnessMap: g.rough, normalMap: g.nor, normalScale: new THREE.Vector2(normalScale, normalScale) };
    return clearcoat ? new THREE.MeshPhysicalMaterial({ ...o, clearcoat, clearcoatRoughness: 0.3 }) : new THREE.MeshStandardMaterial(o);
  }

  /* ---------------- scene ---------------- */

  _buildLights() {
    const s = this.scene;
    const low = this.app.low;
    RectAreaLightUniformsLib.init();
    // sky light from the clerestory windows, bounce off the concrete
    s.add(new THREE.HemisphereLight(0xc4ccd6, 0x2c2824, 0.14));
    // the high-bay lamp cluster straight over the platform: a big soft box
    const high = new THREE.RectAreaLight(0xfff1e0, 3.2, 3, 3);
    high.position.set(0, 7.9, 0); high.lookAt(0, 0, 0);
    s.add(high);
    // the key: a 4500 K work light on the gantry header, soft-edged, the one that casts the shadows
    const key = new THREE.SpotLight(0xfff0e0, 110, 20, 0.42, 0.8, 1.4);
    key.position.set(2.4, 6.8, 3.4);
    key.target.position.set(0, 1, 0);
    key.castShadow = !low;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    key.shadow.camera.near = 2; key.shadow.camera.far = 14;
    s.add(key, key.target);
    this.key = key;
    // cool daylight from the windows behind on one side, a warm fluorescent bank on the other: soft rims
    const day = new THREE.RectAreaLight(0xd8e4f4, 3.2, 6, 2.4);
    day.position.set(-4.6, 5.2, -6.2); day.lookAt(0, 1.3, 0);
    const bank = new THREE.RectAreaLight(0xffd9b0, 2.4, 0.5, 3.2);
    bank.position.set(4.2, 2.6, -3.4); bank.lookAt(0, 1.3, 0);
    if (!low) s.add(day, bank); // (phones: the soft box and the key only)
    // the reactor's spill on the deck in front (dim until it is lit)
    this.under = new THREE.PointLight(0xcfe8ff, 0.4, 4, 2); this.under.position.set(0, 0.4, 1.3); s.add(this.under);
  }

  _buildStage() {
    const s = this.scene;
    const low = this.app.low;
    const W = 11, H = 10; // the bay: 22 x 22 m, 10 m to the roof

    /* -- materials -- */
    const M = {
      steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a7, metalness: 1, roughness: 0.42, roughnessMap: this._grit.rough }),
      gantry: this._paint(0x4a535c, { roughness: 0.55 }),          // blue-grey painted structural steel
      column: this._paint(0x3a3f45, { roughness: 0.6 }),
      dark: this._paint(0x1c1e21, { roughness: 0.7 }),
      yellow: this._paint(0xc99a12, { roughness: 0.6 }),            // safety paint
      cabinet: this._paint(0x7a1712, { roughness: 0.38, clearcoat: 0.4 }),
      lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1dc).multiplyScalar(4), toneMapped: false }),
      strip: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff3e4).multiplyScalar(3.2), toneMapped: false }),
      window: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd4dfec).multiplyScalar(1.5), toneMapped: false }),
    };
    this.M = M;

    /* -- the floor: sealed concrete with a soft mirror sheen, saw-cut joints, painted lines -- */
    // (its own, dimmer copy of the shop light: the bright HDRI would wash the whole floor at grazing angles)
    const floorMat = pbr('concrete_floor_worn_001', { repeat: 11, color: 0x85888c, roughness: 0.48, metalness: 0, normalScale: 0.6, fallback: 0x2c2e31, envMap: s.environment, envMapIntensity: 0.18 });
    this.floor = glossyFloor(new THREE.PlaneGeometry(2 * W, 2 * W), floorMat, { renderer: this.app.renderer, low, scale: 0.5, strength: 0.9, blur: 5 });
    this.floor.rotation.x = -Math.PI / 2;
    s.add(this.floor);
    const flat = (w, d, x, z, ry = 0) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(ry).translate(x, 0, z);
    const joints = [];
    for (let v = -W + 4; v < W; v += 4) { joints.push(flat(2 * W, 0.012, 0, v), flat(0.012, 2 * W, v, 0)); }
    const decal = (mat, geos, y) => {
      const m = new THREE.Mesh(mergeAll(geos), mat);
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
      m.position.y = y; m.receiveShadow = true;
      s.add(m);
      return m;
    };
    decal(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }), joints, 0.001);
    // the work cell: a yellow walkway line round it, and a keep-out hatch at the gantry feet
    const lines = [];
    const C = 3.35, lw = 0.1;
    lines.push(flat(2 * C + lw, lw, 0, -C), flat(2 * C + lw, lw, 0, C), flat(lw, 2 * C, -C, 0), flat(lw, 2 * C, C, 0));
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2, px = Math.cos(a) * 3.4, pz = Math.sin(a) * 3.4;
      for (let j = -2; j <= 2; j++) lines.push(flat(0.55, 0.07, px + j * 0.09, pz - j * 0.09, Math.PI / 4));
    }
    const lineMat = this._paint(0xb88c16, { roughness: 0.65 });
    decal(lineMat, lines, 0.002);

    /* -- the walls: board-marked concrete, steel columns, clerestory windows -- */
    const wallMat = pbr('concrete_floor_worn_001', { repeat: [7, 3.2], color: 0x4c4f55, roughness: 1, metalness: 0, fallback: 0x3a3c40 });
    const room = new THREE.Group();
    const cols = [], panes = [], mullions = [], rails = [];
    const wallT = new THREE.Object3D();
    const onWall = (g, k) => { const a = k * Math.PI / 2; wallT.position.set(-Math.sin(a) * W, 0, -Math.cos(a) * W); wallT.rotation.set(0, a, 0); wallT.updateMatrix(); return g.applyMatrix4(wallT.matrix); };
    const iShape = (fw, d, tf = 0.025, tw = 0.016) => {
      const sh = new THREE.Shape();
      sh.moveTo(-fw / 2, -d / 2); sh.lineTo(fw / 2, -d / 2); sh.lineTo(fw / 2, -d / 2 + tf); sh.lineTo(tw / 2, -d / 2 + tf); sh.lineTo(tw / 2, d / 2 - tf);
      sh.lineTo(fw / 2, d / 2 - tf); sh.lineTo(fw / 2, d / 2); sh.lineTo(-fw / 2, d / 2); sh.lineTo(-fw / 2, d / 2 - tf); sh.lineTo(-tw / 2, d / 2 - tf);
      sh.lineTo(-tw / 2, -d / 2 + tf); sh.lineTo(-fw / 2, -d / 2 + tf); sh.closePath();
      return sh;
    };
    // an I-beam of length len along +y (a column), in its own space
    const iBeam = (fw, d, len) => new THREE.ExtrudeGeometry(iShape(fw, d), { depth: len, bevelEnabled: false }).rotateX(-Math.PI / 2);
    for (let k = 0; k < 4; k++) {
      const wall = new THREE.Mesh(onWall(new THREE.PlaneGeometry(2 * W, H).translate(0, H / 2, 0), k), wallMat);
      wall.receiveShadow = true;
      room.add(wall);
      for (let x = -W + 2.75; x < W; x += 5.5) cols.push(onWall(iBeam(0.34, 0.36, H).translate(x, 0, 0.2), k));
      // a row of high windows between the columns: a pane and its mullions
      for (const wx of [-9.6, -6.9, -4.1, -1.4, 1.4, 4.1, 6.9, 9.6]) {
        panes.push(onWall(new THREE.PlaneGeometry(2.3, 1.5).translate(wx, 7.9, 0.03), k));
        mullions.push(onWall(new THREE.BoxGeometry(2.42, 0.08, 0.1).translate(wx, 7.15, 0.05), k));
        mullions.push(onWall(new THREE.BoxGeometry(2.42, 0.08, 0.1).translate(wx, 8.65, 0.05), k));
        mullions.push(onWall(new THREE.BoxGeometry(0.05, 1.5, 0.06).translate(wx, 7.9, 0.05), k));
        mullions.push(onWall(new THREE.BoxGeometry(2.3, 0.035, 0.05).translate(wx, 7.9, 0.05), k));
      }
      // a crane runway beam along the columns
      rails.push(onWall(new THREE.BoxGeometry(2 * W, 0.5, 0.3).translate(0, 6.4, 0.45), k));
    }
    const addMerged = (geos, mat, { cast = false, parent = room } = {}) => {
      const m = new THREE.Mesh(mergeAll(geos), mat);
      m.receiveShadow = true; m.castShadow = cast && !low;
      parent.add(m);
      return m;
    };
    addMerged([...cols, ...rails], M.column);
    addMerged(panes, M.window);
    addMerged(mullions, M.dark);

    // the roof: a dark deck, steel trusses across, and a grid of high-bay lamps
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 2 * W).rotateX(Math.PI / 2).translate(0, H, 0), this._paint(0x202226, { roughness: 0.85 }));
    room.add(roof);
    const truss = [];
    for (let z = -W + 2.75; z < W; z += 5.5) {
      truss.push(new THREE.BoxGeometry(2 * W, 0.12, 0.14).translate(0, H - 0.2, z));
      truss.push(new THREE.BoxGeometry(2 * W, 0.12, 0.14).translate(0, H - 1.3, z));
      for (let x = -W; x < W; x += 1.1) {
        const g = new THREE.BoxGeometry(0.06, 1.35, 0.06).rotateZ(((Math.round((x + W) / 1.1)) % 2 ? 1 : -1) * 0.7).translate(x + 0.55, H - 0.75, z);
        truss.push(g);
      }
    }
    for (let x = -W + 2.2; x < W; x += 4.4) truss.push(new THREE.BoxGeometry(0.1, 0.18, 2 * W).translate(x, H - 0.12, 0));
    addMerged(truss, M.column);
    const lampGeo = new THREE.CylinderGeometry(0.3, 0.46, 0.34, 24).translate(0, 0.17, 0);
    const lensGeo = new THREE.CircleGeometry(0.44, 24).rotateX(Math.PI / 2);
    const housings = new THREE.InstancedMesh(lampGeo, M.dark, 12);
    const lenses = new THREE.InstancedMesh(lensGeo, M.lamp, 12);
    const d = new THREE.Object3D();
    let n = 0;
    for (const x of [-7.2, -2.4, 2.4, 7.2]) for (const z of [-5.5, 0, 5.5]) {
      d.position.set(x, 7.9, z); d.updateMatrix();
      housings.setMatrixAt(n, d.matrix); lenses.setMatrixAt(n, d.matrix); n++;
    }
    room.add(housings, lenses);
    // along one wall: a bank of tool cabinets and a steel rack with parts crates
    const cab = [], rack = [], crates = [];
    for (let i = 0; i < 6; i++) cab.push(onWall(new RoundedBoxGeometry(0.95, 1.1, 0.6, 2, 0.02).translate(-6.5 + i * 1, 0.55, 0.62), 0));
    for (let i = 0; i < 6; i++) cab.push(onWall(new RoundedBoxGeometry(0.95, 0.9, 0.5, 2, 0.02).translate(-6.5 + i * 1, 1.65, 0.55), 0));
    for (const x of [2, 4.4, 6.8]) for (const z of [0.35, 1.25]) rack.push(onWall(new THREE.BoxGeometry(0.08, 3.2, 0.08).translate(x, 1.6, z), 0));
    for (const y of [0.15, 1.2, 2.25, 3.15]) for (const x0 of [2, 4.4]) {
      rack.push(onWall(new THREE.BoxGeometry(2.4, 0.06, 0.9).translate(x0 + 1.2, y, 0.8), 0));
      if (y < 3 && Math.sin(x0 * 7 + y * 3) > -0.4) crates.push(onWall(new THREE.BoxGeometry(1.1, 0.55, 0.75).translate(x0 + 0.7 + Math.sin(y * 5) * 0.2, y + 0.3, 0.8), 0));
    }
    // drawer fronts: seams and pull handles painted into the colour map
    const drawers = drawTexture(256, 256, (x, w) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, w);
      x.fillStyle = 'rgba(30,20,20,0.9)';
      for (const y of [0.22, 0.44, 0.66, 0.84]) x.fillRect(0, y * w, w, 3);
      x.fillRect(0, 0, 4, w); x.fillRect(w - 4, 0, 4, w); x.fillRect(0, 0, w, 4); x.fillRect(0, w - 4, w, 4);
      x.fillStyle = '#d6d6d6';
      for (const y of [0.1, 0.32, 0.54, 0.75, 0.92]) x.fillRect(w * 0.3, y * w, w * 0.4, 5);
    });
    M.cabinet.map = drawers;
    addMerged(cab, M.cabinet);
    // a stencilled bay number on the back wall
    const sign = drawTexture(1024, 256, (x, w, hh) => {
      x.clearRect(0, 0, w, hh);
      x.fillStyle = 'rgba(214,206,190,0.85)';
      x.font = '700 150px "Arial Narrow", Impact, sans-serif';
      x.textBaseline = 'middle';
      x.fillText('ASSEMBLY  BAY  03', 20, hh / 2 + 6);
      x.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.7})`; x.fillRect(Math.random() * w, Math.random() * hh, Math.random() * 5, Math.random() * 3); }
    });
    const signMesh = new THREE.Mesh(onWall(new THREE.PlaneGeometry(6, 1.5).translate(-4.4, 4.3, 0.03), 0), new THREE.MeshStandardMaterial({ map: sign, transparent: true, roughness: 0.9, depthWrite: false }));
    room.add(signMesh);
    addMerged(rack, M.yellow);
    addMerged(crates, this._paint(0x2d3a2c, { roughness: 0.7 }));
    s.add(room);

    /* -- the turntable: a concrete plinth, a tread-plate deck, a hazard-striped edge -- */
    const st = new THREE.Group();
    const add = (geo, mat, x, y, z, { rx = 0, ry = 0, rz = 0, cast = true } = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = cast && !low; m.receiveShadow = true;
      st.add(m);
      return m;
    };
    const tread = pbr('metal_plate', { repeat: 2.2, color: 0x5c6065, roughness: 1, metalness: 1, normalScale: 0.9, fallback: 0x55595f });
    tread.map = null; // the steel colour only: the set's rust is for another story
    const hazard = drawTexture(128, 128, (x, w) => {
      x.fillStyle = '#d0a018'; x.fillRect(0, 0, w, w);
      x.fillStyle = '#16161a';
      for (let k = -2; k < 3; k++) { x.beginPath(); x.moveTo(k * w, 0); x.lineTo(k * w + w / 2, 0); x.lineTo(k * w + w / 2 + w, w); x.lineTo(k * w + w, w); x.closePath(); x.fill(); }
      // wear on the paint
      for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(90,86,80,${Math.random() * 0.35})`; x.fillRect(Math.random() * w, Math.random() * w, Math.random() * 6, Math.random() * 2); }
    });
    hazard.wrapS = hazard.wrapT = THREE.RepeatWrapping;
    hazard.repeat.set(70, 1);
    const hazardMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6, roughnessMap: this._grit.rough, metalness: 0 });
    const plinthMat = pbr('concrete_floor_worn_001', { repeat: 1.5, color: 0x6c6e72, roughness: 0.9, metalness: 0, fallback: 0x333539 });
    add(new THREE.CylinderGeometry(1.62, 1.7, 0.05, 72), plinthMat, 0, 0.025, 0, { cast: false });
    add(new THREE.CylinderGeometry(1.4, 1.4, 0.09, 96, 1, true), hazardMat, 0, 0.095, 0);
    add(new THREE.CircleGeometry(1.4, 96).rotateX(-Math.PI / 2), tread, 0, PLATFORM_Y, 0, { cast: false });
    add(new THREE.TorusGeometry(1.4, 0.012, 6, 120), M.steel, 0, PLATFORM_Y, 0, { rx: Math.PI / 2, cast: false });

    /* -- the gantry: four I-beam columns, a header frame, a box-section ring the arms ride on -- */
    const lathe = (r0, r1, y0, y1) => new THREE.LatheGeometry([[r0, y0], [r1, y0], [r1, y1], [r0, y1], [r0, y0]].map(([r, y]) => new THREE.Vector2(r, y)), 96);
    add(lathe(ARM_R - 0.11, ARM_R + 0.11, -0.1, 0.1), M.gantry, 0, MOUNT_Y, 0);
    add(lathe(ARM_R - 0.03, ARM_R + 0.03, -0.13, -0.1), M.steel, 0, MOUNT_Y, 0, { cast: false });
    const pill = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, px = Math.cos(a) * 3.4, pz = Math.sin(a) * 3.4;
      add(iBeam(0.26, 0.28, 5.2), M.gantry, px, 0, pz, { ry: -a + Math.PI / 2 });
      add(new THREE.BoxGeometry(0.5, 0.03, 0.5), M.steel, px, 0.015, pz, { ry: -a, cast: false });
      // a beam from the column to the ring, and a header beam to the next column
      const bx = Math.cos(a) * (ARM_R + 3.4) / 2, bz = Math.sin(a) * (ARM_R + 3.4) / 2;
      add(iBeam(0.16, 0.2, 3.4 - ARM_R + 0.1).rotateZ(Math.PI / 2).translate((3.4 - ARM_R + 0.1) / 2, 0, 0), M.gantry, bx, MOUNT_Y + 0.02, bz, { ry: -a });
      const a2 = a + Math.PI / 2, qx = Math.cos(a2) * 3.4, qz = Math.sin(a2) * 3.4;
      const hl = Math.hypot(qx - px, qz - pz);
      const hb = add(iBeam(0.2, 0.26, hl).rotateZ(Math.PI / 2).translate(hl / 2, 0, 0), M.gantry, (px + qx) / 2, 5.07, (pz + qz) / 2);
      hb.rotation.y = -Math.atan2(qz - pz, qx - px);
      // a work light on the column: a housing and its diffuser, facing in
      add(new THREE.BoxGeometry(0.09, 0.95, 0.07), M.dark, px - Math.cos(a) * 0.19, 2.3, pz - Math.sin(a) * 0.19, { ry: -a, cast: false });
      pill.push(new THREE.BoxGeometry(0.035, 0.85, 0.02).rotateY(-a).translate(px - Math.cos(a) * 0.23, 2.3, pz - Math.sin(a) * 0.23));
    }
    const strips = new THREE.Mesh(mergeAll(pill), M.strip);
    s.add(strips);
    // compact downlights under the ring
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      add(new THREE.CylinderGeometry(0.07, 0.08, 0.08, 16), M.dark, Math.cos(a) * (ARM_R - 0.02), MOUNT_Y - 0.17, Math.sin(a) * (ARM_R - 0.02), { cast: false });
      add(new THREE.CircleGeometry(0.06, 16).rotateX(Math.PI / 2), M.lamp, Math.cos(a) * (ARM_R - 0.02), MOUNT_Y - 0.212, Math.sin(a) * (ARM_R - 0.02), { cast: false });
    }

    // the standing frame the armor is built on: a post, a shoulder yoke and ankle clamps
    this.frame = new THREE.Group();
    const fr = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = !low; m.receiveShadow = true; this.frame.add(m); return m; };
    fr(new THREE.BoxGeometry(0.1, 1.95, 0.1), M.gantry, 0, PLATFORM_Y + 0.98, -0.34);
    fr(new THREE.TorusGeometry(0.3, 0.025, 8, 28, Math.PI), M.steel, 0, PLATFORM_Y + 1.5, -0.3, 0, 0);
    fr(new THREE.BoxGeometry(0.66, 0.05, 0.08), M.dark, 0, PLATFORM_Y + 1.5, -0.3);
    fr(new THREE.BoxGeometry(0.36, 0.05, 0.16), M.dark, 0, PLATFORM_Y + 0.95, -0.28);
    for (const sx of [-1, 1]) fr(new THREE.BoxGeometry(0.08, 0.1, 0.18), M.yellow, sx * 0.1, PLATFORM_Y + 0.12, -0.2);
    this.frameLamp = fr(new THREE.BoxGeometry(0.03, 1.2, 0.02), M.strip, 0, PLATFORM_Y + 1.1, -0.285);
    this.frameLamp.castShadow = false;
    s.add(this.frame);

    s.add(st);
    mergeStatic(st);

    // a thin LED inlay round the deck (it answers the hold), and a faint shaft of light from the lamps
    this.padMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe4f1ff).multiplyScalar(2.4), toneMapped: false, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
    this.padRing = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.315, 128), this.padMat);
    this.padRing.rotation.x = -Math.PI / 2; this.padRing.position.y = PLATFORM_Y + 0.003;
    s.add(this.padRing);
    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uAlpha: { value: 0.05 }, uColor: { value: new THREE.Color(0xfff0dc) } },
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform float uAlpha; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ float body = pow(abs(dot(normalize(vN), vV)), 2.0); float fade = smoothstep(0.0, 0.35, vUv.y) * (0.35 + 0.65 * vUv.y);
          float dust = 0.85 + 0.15 * sin(vUv.x * 60.0 + uTime * 0.3) * sin(vUv.y * 14.0 - uTime * 0.2);
          gl_FragColor = vec4(uColor, body * fade * dust * uAlpha); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.7, 7.6, 48, 1, true), this.shaftMat);
    shaft.position.y = 3.8;
    s.add(shaft);
    this.reactorGlow = glowSprite(new THREE.Color(0x9ff3ff).multiplyScalar(3), 0.3, 0);
    this.reactorGlow.material.toneMapped = false;
    s.add(this.reactorGlow);
  }

  /**
   * Four industrial robot arms hanging from the gantry: a carriage riding the ring on rollers, a telescoping
   * mast, a turntable, motor hubs at the shoulder and elbow, tapered lacquered links with amber service
   * covers, hydraulic rams with chrome rods, cable runs and LED strips, a wrist roll unit and a gripper.
   * (Same joints as before: mount, yaw, shoulder (sh), elbow (el), tool, driven by _ik.)
   */
  _buildArms() {
    const low = this.app.low;
    // real industrial-robot finishes: a graphite and an amber 2K paint (satin clear coat, worn roughness),
    // black anodised joints, hard-chromed rods, rubber, and small unlit indicator lenses
    const M = {
      shell: this._paint(0x2e3236, { roughness: 0.42, clearcoat: 0.5, normalScale: 0.05 }),
      cover: this._paint(0xd0801a, { roughness: 0.4, clearcoat: 0.55, normalScale: 0.05 }),
      joint: new THREE.MeshStandardMaterial({ color: 0x1a1c1f, metalness: 0.7, roughness: 0.45, roughnessMap: this._grit.rough }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.14 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x121315, metalness: 0, roughness: 0.85 }),
      led: new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.15, emissive: 0xbfd2e6, emissiveIntensity: 0.18 }),
    };
    // the fitting tip: a dull nozzle at rest, white-hot while it works
    this.tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3a322c), toneMapped: false });
    this.tipBase = new THREE.Color(0x3a322c);
    this.tipHot = new THREE.Color(0xffe0a0).multiplyScalar(6);
    const rbox = (w, hh, d, r) => new RoundedBoxGeometry(w, hh, d, 3, Math.min(r, w / 2.2, hh / 2.2, d / 2.2));
    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast && !low; m.receiveShadow = true; parent.add(m); return m; };
    // a link: an oval shell turned from a profile, running down -y from its joint
    const link = (len, r0, r1) => {
      const pts = [[0.001, 0], [r0 * 0.8, -0.01], [r0, -0.06], [(r0 + r1) / 2 * 1.04, -len * 0.5], [r1, -len + 0.06], [r1 * 0.8, -len + 0.01], [0.001, -len]].map(([r, y]) => new THREE.Vector2(r, y)).reverse();
      const g = new THREE.LatheGeometry(pts, 28);
      g.scale(1, 1, 1.35); // deeper than wide, like a cast arm
      g.computeVertexNormals();
      return g;
    };
    // a motor hub across the joint (along x): body, amber end caps, a ring of bolts
    const hub = (parent, r, w) => {
      mesh(new THREE.CylinderGeometry(r, r, w, 32).rotateZ(Math.PI / 2), M.joint, parent);
      for (const sx of [-1, 1]) {
        mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.82, 0.03, 32).rotateZ(Math.PI / 2), M.cover, parent, sx * (w / 2 + 0.012), 0, 0);
        const bolts = [];
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          const b = new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6).rotateZ(Math.PI / 2);
          b.translate(sx * (w / 2 + 0.03), Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
          bolts.push(b);
        }
        mesh(mergeGeometries(bolts), M.chrome, parent, 0, 0, 0, false);
      }
    };
    // a hydraulic ram between two points in a group's space: sleeve, chrome rod, clevis ends
    const ram = (parent, from, to, r = 0.022) => {
      const d = to.clone().sub(from), len = d.length();
      const g = new THREE.Group(); g.position.copy(from); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); parent.add(g);
      mesh(new THREE.CylinderGeometry(r, r, len * 0.55, 14).translate(0, len * 0.275, 0), M.joint, g);
      mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, len * 0.5, 12).translate(0, len * 0.72, 0), M.chrome, g);
      mesh(rbox(r * 2.6, r * 2.2, r * 2.6, 0.006), M.joint, g, 0, 0, 0, false);
      mesh(rbox(r * 2.2, r * 2, r * 2.2, 0.006), M.joint, g, 0, len, 0, false);
    };
    // a cable along a link (a tube through a few points)
    const cable = (parent, pts) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.011, 6, false), M.rubber, parent, 0, 0, 0, false);

    this.arms = ARM_ANGLES.map((a, k) => {
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const mount = new THREE.Group();
      mount.position.set(out.x * ARM_R, MOUNT_Y, out.z * ARM_R);
      this.scene.add(mount);
      // the carriage on the ring: a housing, rollers, a status LED (turned to run along the ring)
      const carriage = new THREE.Group(); carriage.rotation.y = -a + Math.PI / 2; mount.add(carriage);
      mesh(rbox(0.46, 0.16, 0.26, 0.03), M.shell, carriage, 0, 0.02, 0);
      mesh(rbox(0.3, 0.05, 0.27, 0.015), M.cover, carriage, 0, 0.11, 0);
      for (const sx of [-0.15, 0.15]) for (const sz of [-0.14, 0.14]) mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 16).rotateX(Math.PI / 2), M.rubber, carriage, sx, 0.1, sz, false);
      mesh(new THREE.BoxGeometry(0.2, 0.015, 0.01), M.led, carriage, 0, 0.02, 0.131, false);
      // the telescoping mast
      mesh(rbox(0.13, MAST * 0.62, 0.13, 0.02), M.shell, mount, 0, -MAST * 0.31, 0);
      mesh(new THREE.CylinderGeometry(0.045, 0.045, MAST * 0.5, 16), M.chrome, mount, 0, -MAST * 0.72, 0);
      // the turntable
      const yaw = new THREE.Group(); yaw.position.y = -MAST; mount.add(yaw);
      mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.07, 32), M.joint, yaw, 0, 0.02, 0);
      mesh(new THREE.TorusGeometry(0.145, 0.008, 6, 40).rotateX(Math.PI / 2), M.led, yaw, 0, 0.02, 0, false);
      mesh(rbox(0.24, 0.14, 0.2, 0.03), M.shell, yaw, 0, -0.06, 0);
      mesh(rbox(0.1, 0.12, 0.16, 0.02), M.cover, yaw, 0.14, -0.06, 0); // the yaw motor on the side
      // the shoulder: the big hub, the upper link, its ram, a cable, a cover panel, an LED strip
      const sh = new THREE.Group(); sh.position.y = -0.12; yaw.add(sh);
      hub(sh, 0.1, 0.24);
      mesh(link(L1, 0.085, 0.065), M.shell, sh);
      mesh(rbox(0.012, L1 * 0.5, 0.1, 0.005), M.cover, sh, 0.085, -L1 * 0.42, 0);
      mesh(new THREE.BoxGeometry(0.01, L1 * 0.36, 0.012), M.led, sh, -0.086, -L1 * 0.42, 0.03, false);
      ram(sh, new THREE.Vector3(0, -0.12, 0.13), new THREE.Vector3(0, -L1 * 0.62, 0.1));
      cable(sh, [new THREE.Vector3(-0.1, 0.04, -0.06), new THREE.Vector3(-0.12, -L1 * 0.3, -0.1), new THREE.Vector3(-0.1, -L1 * 0.7, -0.09), new THREE.Vector3(-0.08, -L1 + 0.05, -0.05)]);
      // the elbow and forearm
      const el = new THREE.Group(); el.position.y = -L1; sh.add(el);
      hub(el, 0.075, 0.2);
      mesh(link(L2, 0.062, 0.048), M.shell, el);
      mesh(rbox(0.1, 0.16, 0.12, 0.02), M.cover, el, 0, -L2 * 0.2, 0);
      mesh(new THREE.BoxGeometry(0.01, L2 * 0.4, 0.012), M.led, el, 0.066, -L2 * 0.55, 0.02, false);
      cable(el, [new THREE.Vector3(-0.08, 0.03, -0.05), new THREE.Vector3(-0.07, -L2 * 0.4, -0.07), new THREE.Vector3(-0.05, -L2 + 0.08, -0.04)]);
      // the wrist and tool: a roll unit, a flange with a glowing ring, a two-finger gripper, the work tip
      const tool = new THREE.Group(); tool.position.y = -L2; el.add(tool);
      mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 24), M.joint, tool, 0, -0.03, 0);
      mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.02, 28), M.cover, tool, 0, -0.075, 0);
      mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 32).rotateX(Math.PI / 2), this.tipMat, tool, 0, -0.088, 0, false);
      mesh(new THREE.SphereGeometry(0.018, 10, 8), this.tipMat, tool, 0, -0.17, 0, false);
      const claws = [-1, 1].map((sx) => {
        const g = new THREE.Group(); g.position.set(sx * 0.035, -0.09, 0); tool.add(g);
        mesh(rbox(0.018, 0.1, 0.045, 0.006).translate(0, -0.05, 0), M.shell, g);
        mesh(rbox(0.022, 0.03, 0.05, 0.006).translate(-sx * 0.004, -0.105, 0), M.rubber, g, 0, 0, 0, false);
        return g;
      });
      // fewer draw calls: what shares a material and moves together is merged
      for (const grp of [carriage, mount, yaw, sh, el, tool]) mergeStatic(grp, grp.children.filter((c) => c.isMesh && c.material !== this.tipMat));
      mount.updateMatrixWorld(true);
      const base = sh.getWorldPosition(new THREE.Vector3());
      const rest = base.clone().addScaledVector(out, -0.3).add(new THREE.Vector3(0, -1.2, 0));
      return { k, out, mount, yaw, sh, el, tool, claws, base, rest, cur: rest.clone(), target: rest.clone(), active: 0, phase: k * 1.3 };
    });
  }

  _buildSuits() {
    // two clip planes reveal the welded and nanotech suits: one keeps y <= constant, one y >= -constant
    this.app.renderer.localClippingEnabled = true;
    this.clipUp = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.clipDown = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    // the shimmer riding the reveal edge, drawn on a copy of the suit (one material, shared by every copy)
    this.edgeColor = { cool: new THREE.Color(0x7fe6ff).multiplyScalar(1.4), warm: new THREE.Color(0xffb060).multiplyScalar(1.1) };
    this.edgeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime, uColor: { value: this.edgeColor.cool.clone() },
        uChest: { value: 1.5 }, uD: { value: 0 }, uW: { value: 0.07 }, uEdge: { value: 0 }, uFull: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec3 vN; varying vec3 vV;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uChest; uniform float uD; uniform float uW; uniform float uEdge; uniform float uFull;
        varying vec3 vW; varying vec3 vN; varying vec3 vV;
        void main(){
          float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
          float scan = 0.6 + 0.4 * sin(vW.y * 140.0 - uTime * 12.0);
          float dy = abs(vW.y - uChest);
          float edge = exp(-pow((dy - uD) / uW, 2.0)) * uEdge;
          float a = edge * (0.45 + f) * scan * 1.4 + uFull * (0.06 + f * 0.8) * (0.7 + 0.3 * scan);
          gl_FragColor = vec4(uColor * (0.8 + edge * 3.5), a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.suits = {};
    this.ghosts = {};
    this.failed = new Set();
    this._loading = null;
    // the first two are loaded with the chapter; the rest when picked
    for (const key of ['tpose', 'mk85']) if (!this._makeSuit(key)) this.failed.add(key);
    this._show();
  }

  /** Builds one armor (and, for the revealed ones, its shimmer copy), hidden until chosen. */
  _makeSuit(key) {
    const low = this.app.low;
    const spec = SPEC[key];
    let suit;
    if (spec.mode === 'plates') {
      // every plate separate, so they can fly on one by one
      suit = new RealSuit(key, { pieces: true, castShadow: !low });
      if (!suit.ok) {
        // silent fallback when the model file is missing: the procedural armor has the same assembly API
        suit = new Suit({ scheme: 'mk3', castShadow: !low });
        suit.ok = true;
        suit.height = 1.9;
      }
      suit.setHologram(true); // makes its hologram material now (the waiting look)
    } else {
      suit = new RealSuit(key, { uniqueMaterials: true, castShadow: !low });
      if (!suit.ok) return null;
      const mats = new Set();
      for (const m of suit.meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mat);
      for (const mat of mats) { mat.clippingPlanes = [this.clipUp, this.clipDown]; mat.clipShadows = true; }
      const ghost = new RealSuit(key, { castShadow: false });
      ghost.reactor = 0; ghost.eyes = 0;
      for (const m of ghost.meshes) { m.material = this.edgeMat; m.castShadow = false; }
      ghost.root.visible = false;
      this.ghosts[key] = ghost;
    }
    const k = spec.size && suit.height ? spec.size / suit.height : 1;
    const shownH = (suit.height || 1.9) * k;
    suit.S = shownH / 1.9;
    for (const x of [suit, this.ghosts[key]]) {
      if (!x) continue;
      x.root.scale.setScalar(k);
      x.root.position.y = PLATFORM_Y;
      x.root.visible = false;
      this.scene.add(x.root);
    }
    suit.reactor = 0; suit.eyes = 0;
    suit.root.updateMatrixWorld(true);
    suit._top = PLATFORM_Y + shownH;
    suit._chest = suit.reactorWorld ? suit.reactorWorld(new THREE.Vector3()).y : PLATFORM_Y + shownH * 0.72;
    suit._width = suit.size ? Math.min(suit.size.x * k, shownH * 0.5) : 0.9;
    // the reveal starts at the chest (nanites) or at the floor (welded on from the boots up)
    suit._origin = spec.mode === 'flow' ? suit._chest : PLATFORM_Y;
    suit._revealMax = spec.mode === 'flow'
      ? Math.max(suit._chest - PLATFORM_Y, suit._top - suit._chest) + 0.12
      : shownH + 0.12;

    // upload every texture now: the painted suits are hidden at first, and a first upload later would hitch
    const r = this.app.renderer;
    for (const m of suit.meshes) {
      const mats = suit._originalMats?.get(m) || m.material;
      for (const mat of Array.isArray(mats) ? mats : [mats]) for (const v of Object.values(mat)) if (v && v.isTexture) r.initTexture(v);
    }
    this.suits[key] = suit;
    return suit;
  }

  get spec() { return SPEC[this.mark]; }
  get ghost() { return this.ghosts[this.mark]; }

  /** Only the chosen armor (and its shimmer) is shown; real suits carry no lights, so this is free. */
  _show() {
    for (const [k, suit] of Object.entries(this.suits)) suit.root.visible = k === this.mark;
    for (const [k, g] of Object.entries(this.ghosts)) g.root.visible = k === this.mark;
    // the standing frame is for suits a person steps into; the Hulkbuster stands on its own
    this.frame.visible = this.spec.frame !== false;
    const suit = this.suit;
    if (suit && this.spec.mode !== 'plates') {
      this.edgeMat.uniforms.uChest.value = suit._origin;
      this.edgeMat.uniforms.uColor.value.copy(this.spec.warm ? this.edgeColor.warm : this.edgeColor.cool);
      this.edgeMat.uniforms.uW.value = this.spec.warm ? 0.045 : 0.07;
    }
  }

  _reveal(d) {
    const suit = this.suit;
    this.clipUp.constant = suit._origin + d;
    // nanites flow both ways from the chest; a weld only climbs
    this.clipDown.constant = this.spec.mode === 'flow' ? -(suit._origin - d) : 100;
    this.edgeMat.uniforms.uD.value = d;
  }

  /* ---------------- UI ---------------- */

  _buildUI() {
    this.intro({
      kicker: 'Assembly bay',
      title: 'Suit <em>Up</em>',
      jp: 'ASSEMBLY',
      desc: 'Six armors, from the cave-built Mark I to the Hulkbuster. The gantry arms fit the Mark III plate by plate, weld the plated suits on from the boots up, and watch the nanotech suits flow out of their reactors. J.A.R.V.I.S. checks every system in.',
      extra: [this.gestures([['hold', '<b>Hold</b> anywhere to suit up'], ['drag', '<b>Drag</b> to orbit the platform'], ['tap', '<b>Pick</b> an armor below (or keys 1–6)']])],
    });

    this.statusName = h('b', { text: this.spec.name });
    this.statusState = h('span.su-state', { text: 'Standby' });
    this.lines = SYSTEM_LINES.map(([name]) => {
      const st = h('b', { text: 'Standby' });
      const el = h('div.su-line', {}, h('i'), h('span', { text: name }), st);
      return { el, st, on: false };
    });
    this.plateFill = h('div.meter-fill.gold');
    this.plateText = h('span', { text: '0%' });
    this.plateLabel = h('span', { text: 'Plates' });
    this.status = h('div.hud-panel.su-status', { 'aria-live': 'polite' },
      h('div.su-head', {}, h('span.hud-text', { text: 'J.A.R.V.I.S. · status' }), this.statusName),
      h('div.su-lines', {}, this.lines.map((l) => l.el)),
      h('div.meter.su-meter', {}, h('div.meter-label', {}, this.plateLabel, this.plateText), h('div.meter-track', {}, this.plateFill)),
      this.statusState);
    this.ui.append(this.status);
    this.plateFill.style.width = '0%';

    this.markBtns = {};
    const marks = h('div.group.su-marks', { role: 'group', 'aria-label': 'Choose the armor' },
      MARKS.map(({ key, name }) => {
        const b = this.button(name, () => this._choose(key), 'btn-sm');
        b.setAttribute('aria-pressed', String(key === this.mark));
        this.markBtns[key] = b;
        return b;
      }));
    this.btnGo = this.button('Suit up', () => this._start(), 'btn-primary');
    this.btnReset = this.button('Reset', () => this._reset());
    this.btnReset.disabled = true;
    this._setButtons();
    this.ui.append(h('div.controls', {}, marks, h('div.group', {}, this.btnGo, this.btnReset)));

    this.banner = h('div.big-title', {}, h('b', { text: 'Suit up complete' }), h('span', { text: 'All systems online' }));
    this.ui.append(this.banner);
  }

  onEnter() { this._hint(); }

  enter() {
    if (!this._hinted) setTimeout(() => this._hint(), 900);
  }

  _hint() {
    if (!this.active || this._hinted) return;
    this._hinted = true;
    this.app.toast('Pick an <b>armor</b> below, then <b>hold</b> anywhere (or press <b>Suit up</b>).', 3600);
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    this.app.cinema(false);
    if (this.cine.active) { this.cine.onEnd = null; this.cine.stop(); }
    // finish whatever was running, so coming back finds a clean state
    this.timers.length = 0;
    if (this.state === 'assembling' || this.state === 'sealing') this._finishInstant();
    if (this.state === 'removing') this._toIdle();
    if (this.state === 'done') { this.suit.thrust = 0; this.liftTarget = 0; }
  }

  /* ---------------- state ---------------- */

  get suit() { return this.suits[this.mark]; }

  _after(sec, fn) { this.timers.push({ at: this.clock + sec, fn }); }

  _setButtons() {
    const busy = this.state === 'assembling' || this.state === 'sealing' || this.state === 'removing' || !!this._loading;
    if (!this.btnGo) return;
    this.btnGo.disabled = busy || this.state === 'done';
    this.btnReset.disabled = busy || this.state !== 'done';
    for (const [k, b] of Object.entries(this.markBtns)) b.disabled = busy || this.failed.has(k);
  }

  /** A hologram casts no shadow; the armor does (a mesh flag only: no shader changes). */
  _shadows(suit, on) { for (const m of suit.meshes) m.castShadow = on && !this.app.low; }

  /** The waiting look: the whole armor as a faint hologram on the frame. */
  _setGhost() {
    if (this.spec.mode === 'plates') {
      const s = this.suit;
      s.assemble(1);
      s.setHologram(true);
      this._shadows(s, false);
      if (s._holo) s._holo.uniforms.uOpacity.value = 0.3;
      s.reactor = 0; s.eyes = 0; s.thrust = 0;
    } else {
      this._reveal(-0.05);
      this.edgeMat.uniforms.uEdge.value = 0;
      this.edgeMat.uniforms.uFull.value = 0.32;
      this.ghost.root.visible = true;
      this.suit.reactor = 0; this.suit.eyes = 0;
    }
  }

  async _choose(key) {
    if (key === this.mark || this._loading || this.failed.has(key) || this.state === 'assembling' || this.state === 'sealing' || this.state === 'removing') return;
    if (!this.suits[key]) {
      // first pick: load the model (usually already downloaded in the background), build it, compile it
      this._loading = key;
      this._setButtons();
      this.statusState.textContent = 'Loading armor';
      await loadModels([SPEC[key].key]);
      const made = this._makeSuit(key);
      if (made) await this.app._compileScene(this.scene, this.camera);
      else this.failed.add(key);
      this._loading = null;
      this.statusState.textContent = 'Standby';
      this._setButtons();
      if (!made || this.state === 'assembling' || this.state === 'sealing' || this.state === 'removing') return;
    }
    // leave the previous armor clean (a finished suit is taken off at once)
    if (this.state === 'done') { this.suit.thrust = 0; this.liftTarget = 0; this.lift = 0; this.suit.root.position.y = PLATFORM_Y; }
    this.mark = key;
    this._show();
    this.state = 'idle';
    this._setGhost();
    this._resetStatus();
    this._setButtons();
    for (const [k, b] of Object.entries(this.markBtns)) b.setAttribute('aria-pressed', String(k === key));
    this.statusName.textContent = this.spec.name;
    this.plateLabel.textContent = this.spec.label;
    this.plateFill.style.width = '0%'; this.plateText.textContent = '0%';
    this.app.sfx.hologram();
    this.app.flash(0.12, 0x9ff3ff);
    this._v1.set(0, 1.0 * this.suit.S, 0);
    this.sparks.burst(this._v1, 40, { speed: 1.4, spread: 4, up: 0.6, life: [0.4, 1], size: [0.02, 0.05], colors: this.cyanColors });
  }

  _resetStatus() {
    for (const l of this.lines) { l.on = false; l.st.textContent = 'Standby'; l.el.classList.remove('on', 'pending'); }
    this.statusState.textContent = 'Standby';
    this.statusState.classList.remove('ok');
    this.status.classList.remove('done');
    this._plate = -1;
  }

  _start() {
    if (this.state !== 'idle') return;
    const suit = this.suit;
    this.state = 'assembling';
    this.t = 0;
    this.landed = -2;
    this.nanoTicks = 0;
    suit.reactor = 0; suit.eyes = 0; suit.thrust = 0;
    if (this.spec.mode === 'plates') {
      suit.setHologram(false);
      this._shadows(suit, true);
      suit.assemble(0);
    } else {
      this._reveal(-0.05);
      this.edgeMat.uniforms.uEdge.value = 1;
    }
    this._resetStatus();
    this.statusState.textContent = this.spec.mode === 'flow' ? 'Deploying nanites' : this.spec.mode === 'rise' ? 'Welding' : 'Assembling';
    this._setButtons();
    this.app.cinema(true);
    this.app.sfx.powerUp();
    this.app.sfx.servo(0.6);
    this.app.flash(0.15, 0xffe0b0);
    this.waves.spawn(this._v1.set(0, PLATFORM_Y + 0.01, 0), { radius: 2.2, life: 0.9, color: 0x2e2b28 }); // a faint ring of dust kicked off the deck
    this._playCine();
  }

  _playCine() {
    const F = this.fit, S = this.suit.S;
    const R = S > 1.05 ? S * 1.25 : 1; // a bulky suit is wider and deeper too: the close shots stand further off
    const P = (x, y, z) => new THREE.Vector3(x * F * R, y * S, z * F * R);
    const L = (x, y, z) => new THREE.Vector3(x * S, y * S, z * S);
    const T = this.duration;
    // Follows the build from the front and sides only (the standing frame is behind the suit): a low wide
    // push-in, the boots up close as the first plates land, a side crane up the legs and torso, wide on the
    // arms, round to the chest, the helmet close as the eyes light, then low as it lifts off and a pull back.
    this.cine.play([
      { t: 0.8, pos: P(2.6, 0.55, 3.4), look: L(0, 0.6, 0), fov: 34 },
      { t: T * 0.28, pos: P(1.05, 0.32, 1.45), look: L(0, 0.35, 0), fov: 34 },
      { t: T * 0.5, pos: P(-1.35, 0.95, 1.45), look: L(0, 0.95, 0), fov: 36 },
      { t: T * 0.72, pos: P(-1.6, 1.25, 2.9), look: L(-0.45, 1.5, 0), fov: 40 },
      { t: T * 0.9, pos: P(1.25, 1.8, 1.55), look: L(0, 1.55, 0), fov: 36 },
      { t: T + 0.5, pos: P(0.3, 1.92, 1.05), look: L(0, 1.84, 0), fov: 28 },
      { t: T + 1.9, pos: P(0.22, 1.9, 1.18), look: L(0, 1.83, 0), fov: 28 },
      { t: T + 2.6, pos: P(0.6, 0.35, 2.4), look: L(0, 1.6, 0), fov: 46 },
      { t: T + 4.6, pos: P(1.4, 1.35, 4.8), look: L(0, 1.25, 0), fov: 40 },
    ], {
      onEnd: () => {
        this.app.cinema(false);
        const c = this.camera.position;
        this.orbit.yaw = Math.atan2(c.x, c.z);
        this.orbit.dist = 4.7;
      },
    });
  }

  get duration() { return this.spec.time; }

  /** A part locks on at a world point: sparks, a clank (not too often), a small shake, an arm fits it. */
  _fitAt(pos, nano = false) {
    this.sparks.burst(pos, this.app.low ? 3 : 6, { speed: 2.2, spread: 0.3, up: 0.8, life: [0.2, 0.6], size: [0.015, 0.04], colors: nano ? this.cyanColors : this.sparkColors });
    const now = this.clock;
    if (now - this._lastClank > (nano ? 0.16 : 0.09)) { this._lastClank = now; nano ? this.app.sfx.spark() : this.app.sfx.clank(); }
    if (this.cine.active) this.cine.shake = Math.max(this.cine.shake, nano ? 0.012 : 0.022); else this.shake = Math.max(this.shake, 0.022);
    this._v2.set(pos.x, 0, pos.z);
    if (this._v2.lengthSq() < 0.0025) this._v2.set(0, 0, 1);
    this._v2.normalize();
    // the free arm facing that side; failing that, the nearest one (never one reaching through the body)
    let best = null, bd = 0;
    for (const a of this.arms) { const d = a.out.dot(this._v2); if (d > bd && a.active < 0.2) { bd = d; best = a; } }
    if (!best) best = this.arms.reduce((m, a) => (a.out.dot(this._v2) > m.out.dot(this._v2) ? a : m));
    best.target.copy(pos).addScaledVector(this._v2, 0.34);
    best.target.y += 0.08;
    if (best.active <= 0 && now - this._lastServo > 0.25) { this._lastServo = now; this.app.sfx.servo(0.3); }
    best.active = 0.5;
  }

  _complete() {
    const suit = this.suit;
    const classic = this.spec.mode === 'plates';
    this.state = 'sealing';
    this.statusState.textContent = 'Sealing';
    if (!classic) { this.edgeMat.uniforms.uEdge.value = 0; this._reveal(suit._revealMax + 0.2); this.ghost.root.visible = false; }
    this._after(0.3, () => { this.app.sfx.servo(0.5); if (classic) this.app.sfx.clank(); });
    this._after(1.45, () => {
      suit.eyes = 1; suit.reactor = 1;
      this.app.sfx.powerUp();
      this.app.flash(0.2, 0x9ff3ff);
      const last = this.lines[this.lines.length - 1].el;
      last.classList.remove('pending');
      last.classList.add('on');
    });
    this._after(2.1, () => {
      // lift-off: the whole suit rises a little on its boot jets
      suit.thrust = 0.9;
      this.liftTarget = 0.32;
      this.app.sfx.boom();
      this.app.sfx.chime();
      this.app.flash(0.5, 0xffffff);
      this.waves.spawn(this._v1.set(0, PLATFORM_Y + 0.02, 0), { radius: 5, life: 1.2, color: 0x4a4540 });
      this.waves.spawn(this._v1.set(0, 1.2 * suit.S, 0), { radius: 3, life: 0.8, color: 0x1e2428, normal: this._v3.set(0, 0, 1) });
      this.sparks.burst(this._v1.set(0, PLATFORM_Y + 0.05, 0), this.app.low ? 60 : 120, { speed: 5, spread: 3, up: 1, life: [0.4, 1.1], size: [0.02, 0.06], colors: this.sparkColors });
      if (this.cine.active) this.cine.shake = 0.08; else this.shake = 0.08;
      this.banner.classList.remove('on'); void this.banner.offsetWidth; this.banner.classList.add('on');
      this.state = 'done';
      this.statusState.textContent = 'All systems online';
      this.statusState.classList.add('ok');
      this.status.classList.add('done');
      this._setButtons();
    });
    this._after(5.4, () => { suit.thrust = 0; this.liftTarget = 0; });
    this._after(6.3, () => { if (this.state === 'done') { this.app.sfx.thud(); this.shake = Math.max(this.shake, 0.03); } });
    this._after(4.2, () => { if (this.active && this.state === 'done') this.app.toast('Suited up. <b>Drag</b> to look around, or <b>Reset</b> to take it off.', 3200); });
  }

  /** Jump straight to the finished state (leaving mid-sequence). */
  _finishInstant() {
    const suit = this.suit;
    if (this.spec.mode === 'plates') {
      suit.assemble(1);
      suit.setHologram(false);
      this._shadows(suit, true);
    } else {
      this.edgeMat.uniforms.uEdge.value = 0;
      this._reveal(suit._revealMax + 0.2);
      this.ghost.root.visible = false;
    }
    suit.eyes = 1; suit.reactor = 1; suit.thrust = 0;
    this.liftTarget = 0;
    for (const l of this.lines) { l.on = true; l.st.textContent = 'Online'; l.el.classList.remove('pending'); l.el.classList.add('on'); }
    this.plateFill.style.width = '100%'; this.plateText.textContent = '100%';
    this.statusState.textContent = 'All systems online';
    this.statusState.classList.add('ok');
    this.state = 'done';
    this._setButtons();
  }

  _reset() {
    if (this.state !== 'done') return;
    const suit = this.suit;
    this.state = 'removing';
    this.t = 1;
    this.landed = -2;
    suit.eyes = 0; suit.reactor = 0.1; suit.thrust = 0;
    this.liftTarget = 0;
    if (this.spec.mode !== 'plates') { this.ghost.root.visible = true; this.edgeMat.uniforms.uEdge.value = 1; this.edgeMat.uniforms.uFull.value = 0; }
    this.statusState.textContent = 'Disengaging';
    this.statusState.classList.remove('ok');
    this.status.classList.remove('done');
    for (const l of this.lines) { l.on = false; l.st.textContent = 'Offline'; l.el.classList.remove('on'); }
    this._setButtons();
    this.app.sfx.powerDown();
    this.app.sfx.servo(0.6);
  }

  _toIdle() {
    this.state = 'idle';
    this._setGhost();
    this._resetStatus();
    this.plateFill.style.width = '0%'; this.plateText.textContent = '0%';
    this._setButtons();
  }

  /* ---------------- input ---------------- */

  pointerMove(p) {
    if (p.down && !this.cine.active) {
      this.orbit.yaw -= p.dx * 0.007;
      this.orbit.pitch = clamp(this.orbit.pitch + p.dy * 0.004, -0.15, 0.7);
      this.orbitV = -p.dx * 0.007;
    }
  }

  pointerUp() { this.orbitV = clamp(this.orbitV, -0.05, 0.05); }

  key(e) {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') { if (this.state === 'idle') this._start(); else if (this.state === 'done') this._reset(); return true; }
    if (k === 'r' && this.state === 'done') { this._reset(); return true; }
    const n = Number(k);
    if (n >= 1 && n <= MARKS.length) { this._choose(MARKS[n - 1].key); return true; }
    return false;
  }

  _resize(w, hh) {
    super.resize(w, hh);
    const aspect = w / hh;
    this.fit = aspect < 1 ? clamp(0.95 / aspect * 0.62, 1, 1.75) : 1;
    if (aspect < 0.8) {
      this.camera.setViewOffset(w, hh, 0, hh * 0.05, w, hh);
      this.camera.updateProjectionMatrix();
    }
  }

  /* ---------------- frame ---------------- */

  _ik(arm, T) {
    const B = arm.base;
    const dx = T.x - B.x, dy = T.y - B.y, dz = T.z - B.z;
    arm.yaw.rotation.y = Math.atan2(-dx, -dz);
    const hz = Math.hypot(dx, dz);
    const D = clamp(Math.hypot(hz, dy), 0.25, L1 + L2 - 0.02);
    const alpha = Math.atan2(hz, -dy);
    const a1 = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    const a2 = Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
    arm.sh.rotation.x = alpha + a1;
    arm.el.rotation.x = -(Math.PI - a2);
    // keep the fitting head pointing at the work
    arm.tool.rotation.x = -(alpha + a1 - (Math.PI - a2)) + alpha * 0.9;
  }

  /** Advances the plate assembly, or the weld / nanite reveal (clip planes), to this.t. */
  _stepSequence(dir) {
    const spec = this.spec;
    if (spec.mode === 'plates') {
      const suit = this.suit;
      const landed = suit.ok ? suit.assemble(this.t) : Math.floor(this.t * 60) - 1;
      if (landed !== this.landed) {
        if (dir > 0 && suit.ok) {
          for (let i = Math.max(0, this.landed + 1); i <= landed; i++) {
            suit.pieces[i].mesh.getWorldPosition(this._v1);
            this._fitAt(this._v1);
          }
        } else if (dir < 0 && this.landed >= 0 && landed < this.landed && suit.ok) {
          const now = this.clock;
          if (now - this._lastClank > 0.12) { this._lastClank = now; this.app.sfx.servo(0.15); }
          suit.pieces[this.landed].mesh.getWorldPosition(this._v1);
          this.sparks.burst(this._v1, 3, { speed: 1.5, spread: 0.3, life: [0.2, 0.5], size: [0.015, 0.035], colors: this.cyanColors });
        }
        this.landed = landed;
      }
      return;
    }
    // a band flowing out from the chest (up to the helmet and down to the boots), or a weld seam climbing
    const suit = this.suit, S = suit.S, flow = spec.mode === 'flow';
    const o = suit._origin, top = suit._top, chest = suit._chest, W = suit._width;
    const d = easeInOut(this.t) * suit._revealMax - 0.05;
    this._reveal(d);
    if (dir > 0) {
      // the arms follow the edge, fitting as it goes
      const ticks = Math.floor(this.t * (flow ? 34 : 40));
      while (this.nanoTicks < ticks) {
        this.nanoTicks++;
        const up = !flow || this.nanoTicks % 2 === 0;
        const y = clamp(o + (up ? d : -d), PLATFORM_Y + 0.05, top - 0.05);
        const wide = y > chest - 0.5 * S && y < chest + 0.25 * S ? W * 0.5 : W * 0.2;
        this._v1.set(rand(-wide, wide), y, rand(-0.05, 0.12) * S);
        this._fitAt(this._v1, !spec.warm);
      }
      // nanites (or weld sparks) stream around the leading edges
      const n = this.app.low ? 2 : 4;
      const colors = spec.warm ? this.sparkColors : this.cyanColors;
      for (let k = 0; k < n; k++) {
        if (Math.random() > dt60(this._dt)) continue;
        const up = !flow || Math.random() < 0.5;
        const y = o + (up ? d : -d);
        if (y < PLATFORM_Y || y > top) continue;
        const a = rand(0, TAU), r = rand(0.1, 0.24) * S;
        this.sparks.emit({ x: Math.cos(a) * r, y, z: Math.sin(a) * r * 0.7, vx: Math.cos(a) * 0.3, vy: flow ? (up ? rand(0.1, 0.5) : rand(-0.5, -0.1)) : rand(-0.4, 0.6), vz: Math.sin(a) * 0.3, life: rand(0.2, 0.5), size: rand(0.01, 0.025), color: colors[k % colors.length] });
      }
    }
  }

  update(dt, t) {
    const app = this.app;
    this.clock += dt;
    this._dt = dt;
    // scheduled steps
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].at <= this.clock) { const fn = this.timers[i].fn; this.timers.splice(i, 1); fn(); }
    }

    const suit = this.suit;

    // hold anywhere to start
    const hold = this.trackHold(1.0, this.state === 'idle');
    if (hold.fired) this._start();
    this.padMat.opacity = 0.18 + hold.progress * 0.6 + (this.state === 'done' ? 0.3 : 0);

    // the sequence
    if (this.state === 'assembling' || this.state === 'removing') {
      const dir = this.state === 'assembling' ? 1 : -1;
      this.t = clamp(this.t + dir * dt / (dir > 0 ? this.duration : REMOVE_TIME), 0, 1);
      this._stepSequence(dir);
      const pct = Math.round(this.t * 100);
      if (pct !== this._plate) { this._plate = pct; this.plateFill.style.width = `${pct}%`; this.plateText.textContent = `${pct}%`; }
      if (dir > 0) {
        this.lines.forEach((l, i) => {
          if (l.on || this.t < SYSTEM_LINES[i][1]) return;
          l.on = true; l.st.textContent = 'Online';
          if (i < this.lines.length - 1) l.el.classList.add('on'); else l.el.classList.add('pending');
          app.sfx.beep(i * 2);
        });
        if (this.t > 0.1) suit.reactor = Math.max(suit.reactor, this.t * 0.35);
        if (this.spec.mode !== 'plates') this.edgeMat.uniforms.uFull.value = damp(this.edgeMat.uniforms.uFull.value, 0, 3, dt);
        if (this.t >= 1) this._complete();
      } else if (this.t <= 0) {
        this._toIdle();
      }
    }

    // the frame eases back once the armor stands on its own
    const frameBack = this.state === 'done' ? -0.25 : 0;
    this.frame.position.z = damp(this.frame.position.z, frameBack, 2, dt);

    // arms: reach while fitting, otherwise fold back and sway
    for (const a of this.arms) {
      a.active = Math.max(0, a.active - dt);
      const working = a.active > 0;
      if (!working) {
        const busy = this.state === 'assembling' ? 0.35 : 0;
        a.target.copy(a.rest);
        a.target.x += Math.sin(t * 0.7 + a.phase) * 0.06 - a.out.x * busy;
        a.target.z += Math.cos(t * 0.6 + a.phase) * 0.06 - a.out.z * busy;
        a.target.y += Math.sin(t * 0.9 + a.phase) * 0.05 - busy * 0.4;
      }
      a.cur.lerp(a.target, 1 - Math.exp(-(working ? 9 : 2.5) * dt));
      this._ik(a, a.cur);
      const open = working ? 0.1 : 0.35;
      for (const c of a.claws) c.rotation.z = damp(c.rotation.z, (c.position.x > 0 ? 1 : -1) * open, 8, dt);
      if (working && Math.random() < dt * 25) {
        a.tool.getWorldPosition(this._v3);
        this._v3.y -= 0.14;
        this.sparks.emit({ x: this._v3.x, y: this._v3.y, z: this._v3.z, vx: rand(-1.5, 1.5), vy: rand(0, 1.5), vz: rand(-1.5, 1.5), life: rand(0.2, 0.5), size: rand(0.012, 0.03), color: this.sparkColors[0] });
      }
    }
    const anyWork = this.arms.some((a) => a.active > 0);
    this.tipMat.color.copy(this.tipBase).lerp(this.tipHot, anyWork ? 0.5 + Math.random() * 0.5 : 0);

    // suits and glows (the whole model rises on its jets at the end: nothing is posed)
    this.lift = damp(this.lift, this.liftTarget + (this.liftTarget > 0 ? Math.sin(t * 2.2) * 0.02 : 0), 2.2, dt);
    suit.root.position.y = PLATFORM_Y + this.lift;
    if (this.ghost) this.ghost.root.position.y = suit.root.position.y;
    app.sfx.thrust(this.active ? suit._shown.thrust * 0.6 : 0);
    if (suit._shown.thrust > 0.3 && Math.random() < dt * 30) {
      this.sparks.emit({ x: rand(-0.2, 0.2), y: PLATFORM_Y + 0.02, z: rand(-0.2, 0.2), vx: rand(-2, 2), vy: rand(0.4, 1.4), vz: rand(-2, 2), life: rand(0.3, 0.7), size: rand(0.02, 0.05), color: this.cyanColors[0] });
    }
    suit.update(dt);
    if (this.ghost) this.ghost.update(dt);
    const lit = suit._shown.reactor;
    if (suit.ok) suit.reactorWorld(this.reactorGlow.position);
    this.reactorGlow.material.opacity = this.state === 'idle' || suit.reactorGlows?.length ? 0 : lit * 0.45;
    this.reactorGlow.scale.setScalar((0.05 + lit * 0.07) * suit.S);
    this.under.intensity = damp(this.under.intensity, 0.4 + lit * 1.6 + hold.progress * 1.2, 3, dt);
    this.shaftMat.uniforms.uAlpha.value = 0.045 + (this.state === 'assembling' ? 0.02 : 0) + hold.progress * 0.03;
    this.grade.tintAmt = damp(this.grade.tintAmt, this.state === 'assembling' ? 0.025 : 0, 2, dt);
    if (this.spec.mode === 'plates' && suit.hologram && suit._holo) suit._holo.uniforms.uOpacity.value = 0.3 + Math.sin(t * 2) * 0.04 + hold.progress * 0.4;
    if (this.spec.mode !== 'plates' && this.state === 'idle') this.edgeMat.uniforms.uFull.value = 0.32 + Math.sin(t * 2) * 0.04 + hold.progress * 0.4;

    // dust in the shaft of light
    if (Math.random() < dt * 14) {
      const a = rand(0, TAU), r = rand(0, 1.2);
      this.motes.emit({ x: Math.cos(a) * r, y: rand(0.2, 3), z: Math.sin(a) * r, vx: rand(-0.03, 0.03), vy: rand(-0.02, 0.04), vz: rand(-0.03, 0.03), life: rand(4, 7), size: rand(0.012, 0.035), color: this.moteColor, alpha: 0.5 });
    }
    this.sparks.update(dt, t);
    this.motes.update(dt, t);
    this.waves.update(dt);

    // camera: the cinematic while it plays, then a free orbit
    this.S = damp(this.S, suit.S || 1, 3, dt);
    if (!this.cine.update(dt)) {
      if (!app.pointer.down) {
        this.orbitV *= Math.exp(-2.5 * dt);
        this.orbit.yaw += this.orbitV + (this.state === 'done' ? 0.05 : 0.08) * dt;
      }
      const o = this.orbit, d = o.dist * this.fit * this.S;
      const g = app.gyro;
      const gx = g ? g.x * 0.2 : 0;
      this._v1.set(Math.sin(o.yaw + gx) * Math.cos(o.pitch) * d, 1.15 * this.S + Math.sin(o.pitch) * d, Math.cos(o.yaw + gx) * Math.cos(o.pitch) * d);
      const cam = this.camera;
      cam.position.lerp(this._v1, 1 - Math.exp(-4 * dt));
      this.shake *= Math.exp(-10 * dt);
      if (this.shake > 0.001) cam.position.add(this._v2.set(rand(-1, 1) * this.shake, rand(-1, 1) * this.shake, rand(-1, 1) * this.shake));
      this.look.set(0, 1.1 * this.S, 0);
      cam.lookAt(this.look);
    }
    app.setHover(false);
  }
}

/** Per-frame chance equivalent to ~60 events a second. */
function dt60(dt = 1 / 60) { return Math.min(1, dt * 60); }

function mergeAll(geos) {
  const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)));
  geos.forEach((x) => x.dispose());
  return g;
}
