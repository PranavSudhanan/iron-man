import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Chapter } from '../core/Chapter.js';
import { mergeStatic } from '../core/mergeStatic.js';
import { Suit, suitEnvironment } from '../objects/Suit.js';
import { RealSuit, loadModels, hasModel } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { Beams, Shockwaves, glowSprite } from '../objects/FX.js';
import { glossyFloor } from '../objects/GlossyFloor.js';
import { loadEnv, envMap, loadTextures, pbr, HDRIS } from '../core/Env.js';
import { rand, damp, clamp, TAU, h, drawTexture, shuffle } from '../core/utils.js';
import { QUIZ } from '../data/content.js';
import './Trials.css';

/*
 * The Trials: a quiz in a test chamber. The suit stands on a circular platform inside turning hologram
 * rings. A right answer and it turns and puts a repulsor blast through one of the targets on the far
 * wall; a wrong one and it throws sparks and shakes its head. Three right in a row: a thruster combo.
 */

const NQ = QUIZ.length;
const RANKS = [
  [0, 'Intern', 'Everyone starts in the lab sweeping up bolts. Try again — the suit is patient.'],
  [4, 'Lab Technician', 'You know which end of the soldering iron to hold. The workshop could use you.'],
  [7, 'Engineer', 'Solid work. You could keep an armor flying — maybe not build one from scrap. Yet.'],
  [9, 'Genius', 'Sharp answers under pressure. J.A.R.V.I.S. has quietly flagged you as promising.'],
  [11, 'Armor Designer', 'You know these suits plate by plate. Welcome to the workshop.'],
  [12, 'Chief Armor Designer', 'A perfect run. Every target down — the chamber has nothing left to test.'],
];
// short extra facts, in our own words (from the profile and the suit's systems)
const FACTS = [
  ['First appearance', 'He first stepped onto the page in 1963, in issue 39 of Tales of Suspense — a character shaped by Stan Lee, Larry Lieber, Don Heck and Jack Kirby.'],
  ['The name behind the mask', 'Inside the armor is Anthony Edward Stark: inventor, industrialist and, in time, a founding Avenger.'],
  ['A hinged face', 'The faceplate swings up at the brow, and the helmet\'s display is run by J.A.R.V.I.S., the onboard AI that feeds him flight and targeting data.'],
  ['Weapons that steer', 'Repulsors are not only for fighting: aimed at the ground, the palm beams help hold the suit steady in flight.'],
  ['Why red and gold', 'The first grey flight suit iced up high in the sky. Switching to a gold-titanium alloy cured it — and gave the armor its colours.'],
  ['Hidden arsenal', 'Later suits tuck micro-missiles into the shoulders and lasers into the forearms, but the strongest shot comes straight from the chest reactor.'],
  ['Boots do the lifting', 'The main thrust comes from jets in the boot soles; the palms and small back flaps do the balancing.'],
];

export class Trials extends Chapter {
  constructor(app) {
    super(app, { id: 'trials', title: 'Trials', jp: 'QUIZ' });
    // real lacquered armor throws bright glints: only true light sources (HDR glows, beams) bloom
    this.bloom = { strength: 0.8, radius: 0.5, threshold: 2.8 };
    this.grade = { ...this.grade, grain: 0.025, vig: 0.42, ca: 0.002, sat: 1.0, tint: 0xff2a2a, tintAmt: 0 };
    this.mood = 'calm';
    this.shiftView = -0.07;
    this.trailColor = '120,220,255';
    this.queue = []; this.act = null;
    this.ringGood = 0; this.ringBad = 0;
    this.lift = 0; this.yaw = 0; this.yawGoal = 0; this.dragYaw = 0; this.headYaw = 0; this._head = 0;
    this.phone = false;
    this.started = false; this._hinted = false;
  }

  /** The detailed armor (shown as authored), fetched behind the veil (the procedural suit stands in if it is missing). */
  load() { return Promise.all([loadModels(['classic']), loadEnv(HDRIS.shop), loadTextures(['concrete_floor_worn_001', 'metal_plate'])]); }

  build() {
    const s = this.scene, low = this.app.low;
    const bg = 0x0d0e10;
    s.background = new THREE.Color(bg);
    // a photographed machine shop in the armor's reflections; the bay's own lights do the lighting
    s.environment = envMap(HDRIS.shop) || suitEnvironment();
    s.environmentIntensity = 0.7;
    s.fog = new THREE.Fog(bg, 14, 40);
    this.camera.fov = 45;
    this.camera.updateProjectionMatrix();
    this.look = new THREE.Vector3(0, 1.15, 0);

    // light: a firing-range bay at night. A big soft panel above the test pad, a tungsten key from the
    // front-right (the one shadow), a cool daylight wash from the high windows' side, a warm practical
    // behind; the pad's own light strip and the flash of each hit are the only coloured light
    s.add(new THREE.HemisphereLight(0x3c434e, 0x17130f, low ? 0.6 : 0.35));
    const key = new THREE.SpotLight(0xffe2c2, 90, 18, 0.45, 0.8, 1.5);
    key.position.set(2.4, 6.2, 4);
    key.target.position.set(0, 1, 0);
    key.castShadow = !low;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    s.add(key, key.target);
    if (!low) {
      RectAreaLightUniformsLib.init();
      const panel = new THREE.RectAreaLight(0xf4f6ff, 4.5, 2.4, 2.4);
      panel.position.set(0, 5.8, 0.3); panel.lookAt(0, 0, 0.3);
      s.add(panel);
      // the targets' flood: a long soft bar along the top of the backstop
      const flood = new THREE.RectAreaLight(0xfff0dc, 3.5, 11, 0.3);
      flood.position.set(0, 4.9, -6.6); flood.lookAt(0, 1.5, -7.6);
      s.add(flood);
    }
    const rimR = new THREE.PointLight(0xffb070, 7, 10, 2); rimR.position.set(-3.2, 2.6, -2.4); s.add(rimR);
    this.rimC = new THREE.PointLight(0xcddcff, 5, 10, 2); this.rimC.position.set(3.0, 2.4, -2.2); s.add(this.rimC);
    this.padLight = new THREE.PointLight(0xffe6cc, 1, 5, 2); this.padLight.position.set(0, 0.5, 1.2); s.add(this.padLight);
    this.wallLight = new THREE.PointLight(0xdff4ff, 0, 6, 2); this.wallLight.position.set(0, 2, -6.4); s.add(this.wallLight);

    // the bay: sealed concrete floor (a real blurred mirror), concrete side walls, a steel backstop
    const floorMat = pbr('concrete_floor_worn_001', { repeat: 10, color: 0x8f8d89, roughness: 0.62, metalness: 0, normalScale: 0.8, fallback: 0x1a1c20 });
    this.floor = glossyFloor(new THREE.PlaneGeometry(30, 30), floorMat, { renderer: this.app.renderer, low, scale: 0.5, strength: 0.6, blur: 5 });
    this.floor.rotation.x = -Math.PI / 2;
    s.add(this.floor);
    const wallMat = pbr('concrete_floor_worn_001', { repeat: [6, 2], color: 0x6d6b67, roughness: 1, metalness: 0, normalScale: 1.1, fallback: 0x1e2024 });
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(24, 10), wallMat);
      side.position.set(sx * 12, 5, 4); side.rotation.y = -sx * Math.PI / 2; side.receiveShadow = true;
      s.add(side);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(26, 24), new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.9 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 8, 4);
    s.add(ceil);
    // the backstop: precast concrete blast panels, scorched and streaked round the targets
    const steel = pbr('concrete_floor_worn_001', { repeat: [7, 2.7], color: 0x77746e, roughness: 1, metalness: 0, normalScale: 1.3, fallback: 0x2a2d31 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(26, 10), steel);
    wall.position.set(0, 5, -7.6); wall.receiveShadow = true;
    s.add(wall);
    const scorch = drawTexture(1024, 512, (x, w, hh) => {
      x.clearRect(0, 0, w, hh);
      for (let k = 0; k < 28; k++) {
        const cx = Math.random() * w, cy = hh * (0.35 + Math.random() * 0.45), r = 20 + Math.random() * 70;
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(10,8,6,0.55)'); g.addColorStop(1, 'rgba(10,8,6,0)');
        x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      x.fillStyle = 'rgba(20,18,16,0.35)'; // rust and grime run down from the plate seams
      for (let k = 0; k < 90; k++) x.fillRect(Math.random() * w, Math.random() * hh * 0.6, 1 + Math.random() * 2, 20 + Math.random() * 120);
      // stencilled range markings
      x.font = '700 26px "Arial Narrow", Arial, sans-serif'; x.fillStyle = 'rgba(214,190,120,0.55)';
      x.fillText('BAY 07', 40, 60); x.fillText('REPULSOR CALIBRATION  ·  MAX 40 kJ', 40, 94);
    });
    const grime = new THREE.Mesh(new THREE.PlaneGeometry(26, 10), new THREE.MeshStandardMaterial({ map: scorch, transparent: true, roughness: 1, metalness: 0, depthWrite: false }));
    grime.position.set(0, 5, -7.58);
    s.add(grime);
    const d = new THREE.Object3D();
    const dark = pbr('metal_plate', { repeat: 1, color: 0x2e3135, roughness: 0.8, metalness: 0.9, fallback: 0x2e3135 });
    // the structure: plate seams, a steel ledge, I-beam columns and ceiling trusses, one merged mesh
    const bits = [];
    for (let x = -12; x <= 12; x += 3) bits.push(new THREE.BoxGeometry(0.06, 10, 0.05).translate(x, 5, -7.56));
    bits.push(new THREE.BoxGeometry(26, 0.06, 0.05).translate(0, 3.7, -7.56));
    bits.push(new THREE.BoxGeometry(26, 0.3, 0.6).translate(0, 0.15, -7.3));
    for (const x of [-11.6, -6, 6, 11.6]) bits.push(new THREE.BoxGeometry(0.3, 8, 0.3).translate(x, 4, -7.35));
    for (let z = -6; z <= 8; z += 3.5) bits.push(new THREE.BoxGeometry(24, 0.45, 0.2).translate(0, 7.6, z));
    for (let z = -6; z <= 8; z += 3.5) for (const x of [-6, 0, 6]) bits.push(new THREE.BoxGeometry(0.05, 1.3, 0.05).translate(x, 6.9, z)); // fixture hangers
    s.add(new THREE.Mesh(mergeGeometries(bits), dark));
    // linear LED fixtures hung under the trusses (the bright things in the ceiling), and their housings
    const fixMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e6).multiplyScalar(3.2), toneMapped: false });
    const fixtures = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.03, 0.12), fixMat, 15);
    const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.08, 0.2), dark, 15);
    let fi = 0;
    for (let z = -6; z <= 8; z += 3.5) for (const x of [-6, 0, 6]) {
      d.position.set(x, 6.22, z); d.updateMatrix(); fixtures.setMatrixAt(fi, d.matrix);
      d.position.y = 6.28; d.updateMatrix(); housings.setMatrixAt(fi, d.matrix);
      fi++;
    }
    s.add(fixtures, housings);
    // painted floor: a yellow safety line round the test area, a firing line toward the backstop
    const paintTex = drawTexture(1024, 1024, (x, w) => {
      const c = w / 2;
      x.clearRect(0, 0, w, w);
      x.strokeStyle = 'rgba(176,142,46,0.75)'; x.lineWidth = 14;
      x.beginPath(); x.arc(c, c, c * 0.9, 0, TAU); x.stroke();
      for (let k = 0; k < 60; k++) { // wear: scuffs through the paint
        x.globalCompositeOperation = 'destination-out';
        x.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.6})`;
        const a = Math.random() * TAU; x.fillRect(c + Math.cos(a) * c * 0.9 - 8, c + Math.sin(a) * c * 0.9 - 8, 4 + Math.random() * 20, 3 + Math.random() * 12);
      }
      x.globalCompositeOperation = 'source-over';
    });
    const paint = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 7.4), new THREE.MeshStandardMaterial({ map: paintTex, transparent: true, roughness: 0.55, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    paint.rotation.x = -Math.PI / 2; paint.position.y = 0.004;
    s.add(paint);
    // kit round the edges of the bay: a rolling tool chest, cable reels, a crate, a steel bench
    const kit = new THREE.Group(); s.add(kit);
    const red = pbr('metal_plate', { repeat: 0.6, color: 0x7a1712, roughness: 0.7, metalness: 0.3, fallback: 0x7a1712 });
    const grey = pbr('metal_plate', { repeat: 0.6, color: 0x5c605a, roughness: 0.9, metalness: 0.25, fallback: 0x5c605a });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.75 });
    const kb = (w, hh, dd, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, dd), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; kit.add(m); };
    kb(1.2, 1.1, 0.6, red, -6.2, 0.62, -5.4, 0.3);
    kb(2.4, 0.06, 0.8, grey, 6.4, 0.92, -5.6, -0.2);
    for (const [x, z] of [[5.3, -5.1], [7.5, -5.5], [5.4, -5.9], [7.4, -6.2]]) kb(0.06, 0.9, 0.06, grey, x, 0.45, z);
    kb(0.5, 0.35, 0.4, grey, 6.0, 1.12, -5.7, -0.1);
    kb(0.9, 0.7, 0.9, grey, -8.2, 0.35, -3.2, 0.5);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 24).rotateX(Math.PI / 2), rubber); reel.position.set(8.4, 0.45, -2.2); reel.rotation.y = 0.6; reel.castShadow = true; kit.add(reel);
    mergeStatic(kit);
    this._blobs = [[-6.2, -5.4, 1.8, 1.1], [6.4, -5.6, 3.2, 1.4], [-8.2, -3.2, 1.5, 1.5], [8.4, -2.2, 1.2, 1.0], [0, 0, 5.2, 5.2]];

    // the test platform: a heavy steel turntable with a thin light strip round its lip
    const platMatSteel = pbr('metal_plate', { repeat: 2.5, color: 0x8c9198, roughness: 0.75, metalness: 1, fallback: 0x151a21 });
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.05, 0.2, 64), platMatSteel);
    plat.position.y = 0.1; plat.receiveShadow = true; plat.castShadow = !low;
    s.add(plat);
    const platTex = drawTexture(512, 512, (x, w) => {
      const c = w / 2;
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 3;
      x.beginPath();
      for (const r of [0.93, 0.7]) { x.moveTo(c + r * c, c); x.arc(c, c, r * c, 0, TAU); }
      for (let k = 0; k < 36; k++) { const a = (k / 36) * TAU; x.moveTo(c + Math.cos(a) * c * 0.72, c + Math.sin(a) * c * 0.72); x.lineTo(c + Math.cos(a) * c * (k % 3 ? 0.8 : 0.9), c + Math.sin(a) * c * (k % 3 ? 0.8 : 0.9)); }
      x.stroke();
      x.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 400; k++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.7})`; x.fillRect(Math.random() * w, Math.random() * w, 2 + Math.random() * 6, 1 + Math.random() * 3); }
    });
    // engraved and paint-filled degree marks (not light): they only change with the light that falls on them
    this.platMat = new THREE.MeshStandardMaterial({ map: platTex, color: 0xb8b09a, transparent: true, opacity: 0.35, roughness: 0.6, metalness: 0, depthWrite: false });
    const platTop = new THREE.Mesh(new THREE.CircleGeometry(1.85, 64), this.platMat);
    platTop.rotation.x = -Math.PI / 2; platTop.position.y = 0.203;
    s.add(platTop);
    this.edgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(2.062, 2.062, 0.018, 96, 1, true), this.edgeMat);
    edge.position.y = 0.17;
    s.add(edge);

    // (the old floating hologram rings are gone; their colour still drives the pad's light strip)
    this.ringMat = { uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 } } };
    this.rings = [];
    this.ticks = new THREE.Object3D();
    this._colBase = new THREE.Color(0xfff0dc).multiplyScalar(1.1); this._colGood = new THREE.Color(0xd8fbff).multiplyScalar(4.5); this._colBad = new THREE.Color(0xff2a1a).multiplyScalar(4.5);
    this._lBase = new THREE.Color(0xffe6cc); this._lGood = new THREE.Color(0xd8f0ff); this._lBad = new THREE.Color(0xff3a22); this._lc = new THREE.Color();

    // the suit
    // the armor exactly as modelled: it never changes pose; it turns, fires and lifts as a whole
    const real = hasModel('classic') ? new RealSuit('classic', { castShadow: !this.app.low }) : null;
    this.real = !!real?.ok;
    this.suit = this.real ? real : new Suit({ scheme: 'classic', castShadow: !this.app.low });
    this._pose('stand', 1);
    this.suit.root.position.y = 0.2;
    s.add(this.suit.root);
    this.reactorGlow = glowSprite(new THREE.Color(0x9ff3ff).multiplyScalar(3), 0.3, 0.6);
    this.reactorGlow.visible = !this.real; // the real armor has its own reactor glow
    s.add(this.reactorGlow);

    // targets bolted to the backstop: painted steel plates on dark steel backers, one per question
    const tTex = drawTexture(512, 512, (x) => {
      for (const [r, c] of [[250, '#d9d4c7'], [236, '#1b1b1c'], [214, '#d9d4c7'], [168, '#1b1b1c'], [146, '#d9d4c7'], [100, '#1b1b1c'], [78, '#d9d4c7'], [40, '#9c1f18']]) { x.fillStyle = c; x.beginPath(); x.arc(256, 256, r, 0, TAU); x.fill(); }
      for (let k = 0; k < 30; k++) { // old hits: dents and bare metal, runs of rust
        const a = Math.random() * TAU, r = Math.random() * 230, px = 256 + Math.cos(a) * r, py = 256 + Math.sin(a) * r;
        x.fillStyle = 'rgba(70,72,74,0.9)'; x.beginPath(); x.arc(px, py, 2 + Math.random() * 5, 0, TAU); x.fill();
        x.fillStyle = 'rgba(110,60,30,0.25)'; x.fillRect(px - 1, py, 2, 10 + Math.random() * 40);
      }
      const g = x.createRadialGradient(256, 256, 120, 256, 256, 256);
      g.addColorStop(0, 'rgba(40,30,20,0)'); g.addColorStop(1, 'rgba(40,30,20,0.35)');
      x.fillStyle = g; x.beginPath(); x.arc(256, 256, 250, 0, TAU); x.fill();
    });
    this.targets = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 48), new THREE.MeshStandardMaterial({ map: tTex, roughness: 0.75, metalness: 0.1 }), NQ);
    this.targets.frustumCulled = false;
    this.targets.receiveShadow = true;
    s.add(this.targets);
    this.backers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1.0, 0.06), pbr('metal_plate', { repeat: 0.5, color: 0x3b3e42, roughness: 0.8, metalness: 1, fallback: 0x2b2e32 }), NQ);
    this.backers.frustumCulled = false;
    s.add(this.backers);
    // the lane lamp: a small amber bulb on the backer of the next target to fall
    this.laneLamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(4), toneMapped: false }));
    this.laneGlow = glowSprite(0xffa040, 0.45, 0.4);
    this.laneGlow.material.color.multiplyScalar(1.6);
    s.add(this.laneLamp, this.laneGlow);
    this.tPos = Array.from({ length: NQ }, () => new THREE.Vector3());
    this.tDown = new Array(NQ).fill(false);
    this._tc = new THREE.Color();

    // shatter shards (a pool), sparks, beams, rings of light
    this.shardN = 60;
    // fragments of painted steel: they tumble, bounce and catch the light (they are not light themselves)
    this.shards = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.07), new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.6, metalness: 0.5 }), this.shardN);
    this.shardData = Array.from({ length: this.shardN }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), sp: new THREE.Vector3(), life: 0, age: 1 }));
    this._shardI = 0; this._shardsLive = false;
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < this.shardN; k++) this.shards.setMatrixAt(k, this._zero);
    this.shards.frustumCulled = false;
    s.add(this.shards);
    this.sparks = new ParticlePool({ count: 500, gravity: -7, drag: 0.8, softness: 1.2 });
    this.dust = new ParticlePool({ count: 220, drag: 0.4, turbulence: 0.25, softness: 2 });
    s.add(this.sparks.points, this.dust.points);
    this.cCyan = [0xe6f7ff, 0xffffff, 0xcfeeff].map((c) => new THREE.Color(c).multiplyScalar(3));
    this.cFire = [0xffd28a, 0xff8a3a, 0xffffff].map((c) => new THREE.Color(c).multiplyScalar(3));
    this.cDust = new THREE.Color(0xb8b0a4);
    this.beams = new Beams(s, 6);
    this.waves = new Shockwaves(s, 6);
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._sc = new THREE.Vector3(); this._n = new THREE.Vector3(0, 0, 1); this._up = new THREE.Vector3(0, 1, 0);

    this._buildContactShadows();
    this._buildUI();
    this._layout();
    this.camera.position.set(this.camDist * 0.2, this.camY, this.camDist);
    this.camera.lookAt(this.look);
  }

  /** Soft contact shadows on the floor (one instanced draw) so the kit and the pad sit on it. */
  _buildContactShadows() {
    const tex = drawTexture(128, 128, (x) => {
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.5, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    });
    const list = this._blobs;
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.7 }), list.length);
    const d = new THREE.Object3D();
    list.forEach(([x, z, sx, sz], i) => { d.position.set(x, 0.006, z); d.scale.set(sx, 1, sz); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
    m.renderOrder = 1;
    this.scene.add(m);
  }

  /* ---------------- UI ---------------- */

  _buildUI() {
    this.intro({
      kicker: 'Final test',
      title: 'The <em>Trials</em>',
      jp: 'QUIZ',
      desc: 'Twelve questions in the test chamber. Every right answer and the armor fires on a target; every wrong one and it lets you know.',
      extra: [this.gestures([['key', '<b>1–4</b> to answer, <b>Enter</b> for next'], ['tap', '<b>Tap</b> an answer'], ['drag', '<b>Drag</b> to turn the suit']])],
    });

    // the question view
    this.qCount = h('span.q-count');
    this.dots = Array.from({ length: NQ }, () => h('i'));
    this.qTitle = h('h3', { id: 'trials-q' });
    this.optBtns = [0, 1, 2, 3].map((k) => {
      const b = h('button.option', { type: 'button' }, h('kbd', { text: String(k + 1) }), h('span'));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.answer(k); });
      return b;
    });
    this.explainEl = h('p.explain');
    this.scoreEl = h('span.q-score');
    this.btnNext = this.button('Next', () => this.next(), 'btn-primary btn-sm');
    this.qView = h('div.q-view', {},
      h('div.quiz-top', {}, this.qCount, h('div.quiz-dots', { 'aria-hidden': 'true' }, this.dots)),
      this.qTitle,
      h('div.options', { role: 'group', 'aria-labelledby': 'trials-q' }, this.optBtns),
      this.explainEl,
      h('div.quiz-foot', {}, this.scoreEl, this.btnNext));

    // the result view
    this.rScore = h('div.result-score');
    this.rRank = h('div.result-rank');
    this.rLine = h('p.r-line');
    this.reviewEl = h('ol.review');
    this.btnReview = this.button('Review answers', () => {
      const open = this.reviewEl.classList.toggle('open');
      this.btnReview.setAttribute('aria-expanded', String(open));
      this.btnReview.textContent = open ? 'Hide review' : 'Review answers';
    }, 'btn-sm');
    this.btnReview.setAttribute('aria-expanded', 'false');
    this.triviaEl = h('div.trivia-row');
    this.rView = h('div.r-view', {},
      h('span.kicker', { text: 'Evaluation complete' }),
      h('div.r-head', {}, this.rScore, h('div', {}, this.rRank, this.rLine)),
      h('div.quiz-foot', {}, this.button('Retry', () => this.start(), 'btn-primary btn-sm'), this.btnReview),
      this.reviewEl,
      h('div.trivia', {}, h('span.trivia-label', { text: 'Did you know · tap to flip' }), this.triviaEl));

    this.quizEl = h('div.quiz.pe', { role: 'region', 'aria-label': 'Quiz', 'aria-live': 'polite' }, this.qView, this.rView);
    this.ui.append(this.quizEl);
    this.comboEl = h('div.combo', { 'aria-hidden': 'true' });
    this.ui.append(this.comboEl);
  }

  _hint() {
    if (this._hinted) return;
    this._hinted = true;
    this.app.toast('Answer with a <b>tap</b> or keys <b>1–4</b>. Three in a row for a combo.', 3600);
  }

  onEnter() { this._hint(); }

  enter() {
    if (!this.started) this.start(true);
    if (document.getElementById('loader')?.classList.contains('done')) this._hint();
  }

  exit() {
    this.app.sfx.thrust(0);
    this.app.sfx.charge(0);
    this.comboEl.classList.remove('on');
  }

  /* ---------------- the quiz ---------------- */

  start(silent = false) {
    this.started = true;
    // shuffle the questions and each question's options, keeping track of the right one
    this.order = shuffle(QUIZ.map((q, qi) => {
      const idx = shuffle([0, 1, 2, 3]);
      return { qi, q: q.q, options: idx.map((k) => q.options[k]), a: idx.indexOf(q.a), explain: q.explain };
    }));
    this.answers = [];
    this.cur = 0; this.score = 0; this.streak = 0; this.hits = 0;
    this.answered = false;
    this.tDown.fill(false);
    this.tOrder = shuffle([...Array(NQ).keys()]);
    this._layout();
    this.queue.length = 0; this.act = null;
    this._pose('stand'); this.suit.thrust = 0; this.suit.reactor = 1; this.suit.eyes = 1; this.suit.faceOpen = 0;
    this.yawGoal = 0;
    this.comboEl.classList.remove('on');
    this.reviewEl.classList.remove('open');
    this.btnReview.textContent = 'Review answers';
    this.btnReview.setAttribute('aria-expanded', 'false');
    this.rView.style.display = 'none';
    this.qView.style.display = '';
    this.quizEl.classList.remove('done');
    if (!silent) { this.app.sfx.powerUp(); this.app.flash(0.2, 0x9ff3ff); this._wave(this._v.set(0, 0.22, 0), { radius: 3, life: 0.9 }); }
    this._showQ();
  }

  _showQ() {
    const Q = this.order[this.cur];
    this.answered = false;
    this.qCount.textContent = `Question ${this.cur + 1} / ${NQ}`;
    this.qTitle.textContent = Q.q;
    this.optBtns.forEach((b, k) => {
      b.lastChild.textContent = Q.options[k];
      b.className = 'option';
      b.disabled = false;
    });
    this.explainEl.style.display = 'none';
    this.btnNext.disabled = true;
    this.btnNext.textContent = this.cur === NQ - 1 ? 'See result' : 'Next';
    this._syncDots();
    this.scoreEl.textContent = `Score ${this.score}`;
    this.quizEl.scrollTop = 0;
  }

  _syncDots() {
    this.dots.forEach((d, k) => {
      const a = this.answers[k];
      d.className = a ? (a.ok ? 'ok' : 'bad') : k === this.cur ? 'cur' : '';
    });
  }

  answer(k) {
    if (this.answered || !this.order || this.cur >= NQ) return;
    this.answered = true;
    const Q = this.order[this.cur];
    const ok = k === Q.a;
    this.answers[this.cur] = { ok, choice: k };
    this.optBtns.forEach((b, j) => {
      b.disabled = true;
      if (j === Q.a) b.classList.add('correct');
      else if (j === k) b.classList.add('wrong');
    });
    this.explainEl.textContent = (ok ? 'Correct. ' : 'Not quite. ') + Q.explain;
    this.explainEl.style.display = '';
    this.btnNext.disabled = false;
    if (ok) {
      this.score++; this.streak++;
      this.app.sfx.chime();
      this.queue.push({ kind: 'shoot', target: this.tOrder[this.hits++] });
      if (this.streak % 3 === 0) this.queue.push({ kind: 'combo', n: this.streak });
    } else {
      this.streak = 0;
      this.app.sfx.wrong();
      this.queue.push({ kind: 'miss' });
    }
    this.scoreEl.textContent = `Score ${this.score}`;
    this._syncDots();
    try { this.btnNext.focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
  }

  next() {
    if (!this.answered) return;
    if (this.cur < NQ - 1) { this.cur++; this.app.sfx.swoosh(); this._showQ(); return; }
    this._result();
  }

  _result() {
    this.cur = NQ;
    const sc = this.score;
    let rank = RANKS[0];
    for (const r of RANKS) if (sc >= r[0]) rank = r;
    this.rScore.textContent = `${sc}/${NQ}`;
    this.rRank.textContent = rank[1];
    this.rLine.textContent = rank[2];
    this.reviewEl.replaceChildren(...this.order.map((Q, k) => {
      const a = this.answers[k];
      return h(`li.${a.ok ? 'ok' : 'bad'}`, {},
        h('b', { text: Q.q }),
        a.ok ? h('span', { text: `✓ ${Q.options[Q.a]}` })
          : h('span', {}, h('s', { text: `✗ ${Q.options[a.choice]}` }), h('em', { text: ` → ${Q.options[Q.a]}` })));
    }));
    const facts = shuffle(FACTS.slice()).slice(0, 3);
    this.triviaEl.replaceChildren(...facts.map(([title, text], k) => {
      const b = h('button.trivia-card', { type: 'button', 'aria-pressed': 'false', 'aria-label': `${title}: flip for the fact` },
        h('span.tc-inner', {},
          h('span.tc-front', {}, h('i', { text: String(k + 1).padStart(2, '0') }), h('b', { text: title }), h('small', { text: 'Tap to flip' })),
          h('span.tc-back', { text: text })));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const on = b.classList.toggle('flipped');
        b.setAttribute('aria-pressed', String(on));
        this.app.sfx.hologram();
      });
      return b;
    }));
    this.qView.style.display = 'none';
    this.rView.style.display = '';
    this.quizEl.classList.add('done');
    this.quizEl.scrollTop = 0;
    this.app.sfx.powerUp();
    this.queue.push({ kind: 'finale', big: sc >= 9 });
    this.app.toast(`Evaluation: <b>${rank[1]}</b>`, 2600);
  }

  key(e) {
    if (this.cur >= NQ) {
      if (e.key === 'r' || e.key === 'R') { this.app.sfx.click(); this.start(); return true; }
      return false;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 4) { if (!this.answered) { this.app.sfx.click(); this.answer(n - 1); } return true; }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'n' || e.key === 'N') {
      // a focused button handles Enter/Space itself
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button')) return false;
      if (this.answered) { this.app.sfx.click(); this.next(); }
      return true;
    }
    return false;
  }

  pointerMove(p) {
    if (p.down) this.dragYaw = clamp(this.dragYaw + p.dx * 0.008, -1.2, 1.2);
  }

  /* ---------------- layout ---------------- */

  resize(w, hh) {
    this.camera.aspect = w / hh;
    this.phone = w <= 760;
    if (this.floor?.resizeMirror) { const v = this.app.renderer.getDrawingBufferSize(new THREE.Vector2()); this.floor.resizeMirror(v.x, v.y); }
    // phones: the quiz sits at the bottom, so the suit is framed in the space above it
    if (this.phone) this.camera.setViewOffset(w, hh, 0, hh * 0.18, w, hh);
    else if (w / hh > 1.1) this.camera.setViewOffset(w, hh, -w * this.shiftView, 0, w, hh);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.built) this._layout();
  }

  _layout() {
    const w = this.app.width, hh = this.app.height, aspect = w / hh;
    this.phone = w <= 760;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camDist = clamp(Math.max(5.6, 3.3 / (2 * t * aspect)), 5.6, 10.5);
    this.camY = this.phone ? 1.95 : 1.75;
    // targets: a 4 × 3 wall either side of the suit on wide screens, two rows of six above it on phones
    for (let k = 0; k < NQ; k++) {
      if (this.phone || aspect < 0.9) this.tPos[k].set(-2.5 + (k % 6), 3.35 + Math.floor(k / 6) * 0.95, -7.5);
      else {
        const col = k % 4, row = Math.floor(k / 4);
        this.tPos[k].set([-4.3, -2.95, 2.95, 4.3][col], 1.3 + row * 1.1, -7.5);
      }
    }
    this._placeTargets();
  }

  _placeTargets() {
    for (let k = 0; k < NQ; k++) {
      this._m.makeTranslation(this.tPos[k].x, this.tPos[k].y, this.tPos[k].z - 0.03);
      this.backers.setMatrixAt(k, this._m);
      if (this.tDown[k]) this.targets.setMatrixAt(k, this._zero);
      else { this._m.makeTranslation(this.tPos[k].x, this.tPos[k].y, this.tPos[k].z + 0.005); this.targets.setMatrixAt(k, this._m); }
    }
    this.targets.instanceMatrix.needsUpdate = true;
    this.backers.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- 3D reactions ---------------- */

  _shatter(k, quiet = false) {
    if (this.tDown[k]) return;
    this.tDown[k] = true;
    this._placeTargets();
    const p = this.tPos[k];
    for (let n = 0; n < 16; n++) {
      const S = this.shardData[this._shardI];
      this._shardI = (this._shardI + 1) % this.shardN;
      S.p.copy(p);
      S.v.set(rand(-3, 3), rand(-1, 3.5), rand(1, 4.5));
      S.sp.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      S.r.set(rand(0, TAU), rand(0, TAU), 0);
      S.age = 0; S.life = rand(0.8, 1.5);
    }
    this._shardsLive = true;
    this.sparks.burst(p, quiet ? 18 : 40, { speed: 5, spread: 1.5, up: 1, life: [0.3, 0.9], size: [0.03, 0.08], colors: this.cCyan });
    this._wave(this._v.copy(p).setZ(p.z + 0.05), { radius: 1.8, life: 0.6, normal: this._n });
    this.wallLight.position.set(p.x, p.y, p.z + 1.2);
    this.wallLight.intensity = 14;
    if (quiet) return;
    this.app.sfx.zap();
    this.app.sfx.spark();
  }

  /** A blast's push: no graphic ring, just dust thrown outward (off the floor, or off the backstop). */
  _wave(pos, { radius = 2 } = {}) {
    const onWall = pos.z < -7;
    const n = Math.round(radius * 10);
    for (let k = 0; k < n; k++) {
      const a = rand(0, TAU), sp = rand(0.4, 1.1) * radius * 0.6;
      if (onWall) this.dust.emit({ x: pos.x, y: pos.y, z: pos.z + 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(0.2, 0.8), life: rand(1, 2.2), size: rand(0.04, 0.09), color: this.cDust, alpha: 0.5 });
      else this.dust.emit({ x: pos.x + Math.cos(a) * 1.9, y: 0.05, z: pos.z + Math.sin(a) * 1.9, vx: Math.cos(a) * sp, vy: rand(0.05, 0.3), vz: Math.sin(a) * sp, life: rand(1.2, 2.5), size: rand(0.05, 0.1), color: this.cDust, alpha: 0.4 });
    }
  }

  /** A beam, pushed into HDR so it flares past the high bloom threshold. */
  _beam(from, to, opts) {
    const b = this.beams.fire(from, to, opts);
    b.m.material.uniforms.uColor.value.multiplyScalar(4);
    return b;
  }

  /** Poses exist only on the procedural stand-in; the real armor is shown as authored. */
  _pose(name, snap = 0) { if (!this.real) this.suit.pose(name, snap); }

  _fireAt(pos, side = 'r', width = 0.2) {
    const { pos: from } = this.suit.palmWorld(side, this._v2);
    this._beam(from, pos, { width, life: 0.45 });
    this.sparks.burst(from, 14, { speed: 2.5, life: [0.2, 0.5], size: [0.03, 0.06], colors: this.cCyan });
    this.app.sfx.repulsor(1);
    this.app.flash(0.12, 0x9ff3ff);
  }

  /** Runs the current reaction: a small timeline driven by act.t. */
  _runAct(dt) {
    if (!this.act) {
      this.act = this.queue.shift() || null;
      if (!this.act) return;
      this.act.t = 0; this.act.step = 0;
    }
    const A = this.act, s = this.suit, sfx = this.app.sfx;
    const at = (time) => A.t >= time && A.step < time + 1e-6 && (A.step = time + 1e-6, true);
    A.t += dt;
    if (A.kind === 'shoot') {
      const tp = this.tPos[A.target];
      if (at(0)) { this.yawGoal = Math.atan2(tp.x, tp.z - 0.0); this._pose('ready'); sfx.servo(0.3); }
      // alternate hands: right, left, right...
      if (at(0.4)) { A.side = this.hits % 2 ? 'r' : 'l'; this._pose(A.side === 'r' ? 'blastR' : 'blastL'); s.palm[A.side] = 1; }
      if (at(0.78)) { this._fireAt(tp, A.side); this._shatter(A.target); this.ringGood = 1; }
      if (at(1.35)) { s.palm[A.side] = 0; this._pose('stand'); this.yawGoal = 0; }
      if (A.t > 1.8) this.act = null;
    } else if (A.kind === 'miss') {
      if (at(0)) {
        this.ringBad = 1;
        this.app.flash(0.16, 0xff2a2a);
        sfx.spark();
        s.eyes = 0.25;
        s.reactorWorld(this._v).y += 0.35;
        this.sparks.burst(this._v, 46, { speed: 4, spread: 1.2, up: 1.5, life: [0.3, 0.8], size: [0.025, 0.06], colors: this.cFire });
        this._pose('ready'); // arms up a little: a shrug
      }
      if (at(0.25)) s.eyes = 1;
      if (at(0.6)) this._pose('stand');
      // the head shake: a quick neck yaw, back and forth, settling
      this.headYaw = A.t < 0.9 ? Math.sin(A.t * TAU * 3.2) * 0.5 * (1 - A.t / 0.9) : 0;
      if (A.t > 1.0) { this.headYaw = 0; this.act = null; }
    } else if (A.kind === 'combo') {
      if (at(0)) {
        this.comboEl.textContent = `Combo ×${A.n}`;
        this.comboEl.classList.remove('on'); void this.comboEl.offsetWidth; this.comboEl.classList.add('on');
        this._pose('hover'); s.thrust = 1; this.ringGood = 1.4;
        this._wave(this._v.set(0, 0.22, 0), { radius: 4, life: 1 });
        this.sparks.burst(this._v.set(0, 0.25, 0), 70, { speed: 4, spread: 2, up: 1, life: [0.4, 1], size: [0.03, 0.08], colors: this.cCyan });
        this.app.flash(0.2, 0xbff6ff);
        sfx.whoosh();
      }
      if (at(1.9)) { s.thrust = 0.25; this._pose('stand'); }
      if (at(2.5)) { s.thrust = 0; sfx.thud(); this._wave(this._v.set(0, 0.22, 0), { radius: 2.2, life: 0.6 }); }
      if (A.t > 2.8) { this.comboEl.classList.remove('on'); this.act = null; }
    } else if (A.kind === 'finale') {
      if (A.big) {
        if (at(0)) { this.yawGoal = Math.PI * 0.999; this._pose('ready'); sfx.servo(0.4); }
        if (at(0.55)) { this._pose('unibeam'); s.reactor = 1.6; }
        if (at(1.1)) {
          sfx.unibeam();
          const from = s.reactorWorld(this._v2);
          this._beam(from, this._v.set(0, 2.6, -7.5), { width: 0.55, life: 1.2 });
          this.app.flash(0.3, 0xdff9ff);
        }
        if (at(1.5)) { for (let k = 0; k < NQ; k++) this._shatter(k, true); this.app.sfx.boom(); }
        if (at(2.6)) { s.reactor = 1; this._pose('stand'); this.yawGoal = 0; }
        if (A.t > 3.2) this.act = null;
      } else {
        // a slow look along the targets still standing, then back to you
        if (at(0)) { this._pose('crossed'); this.yawGoal = 0.7; sfx.servo(0.4); }
        if (at(1.2)) { this.yawGoal = -0.7; sfx.servo(0.4); }
        if (at(2.2)) { this._pose('stand'); this.yawGoal = 0; }
        if (A.t > 2.6) this.act = null;
      }
    }
  }

  update(dt, t) {
    const app = this.app, s = this.suit;
    this._runAct(dt);

    // the suit: turn toward its goal (or wherever it is dragged), rise with thrust, head follows the pointer
    const acting = !!this.act;
    if (!app.pointer.down) this.dragYaw = damp(this.dragYaw, 0, acting ? 6 : 0.8, dt);
    this.yaw = damp(this.yaw, this.yawGoal + (acting ? 0 : this.dragYaw), acting ? 7 : 4, dt);
    // a miss turns the whole body side to side (the real armor's head doesn't move on its own)
    s.root.rotation.y = this.yaw + 0.12 + (acting ? this._head * 0.45 : 0);
    this.lift = damp(this.lift, s.thrust > 0.5 ? 0.75 + Math.sin(t * 2.2) * 0.06 : 0, s.thrust > 0.5 ? 2.2 : 3.5, dt);
    s.root.position.y = 0.2 + this.lift;
    app.sfx.thrust(this.active ? s._shown.thrust * 0.75 : 0);
    s.update(dt);
    const lookYaw = acting ? this.headYaw : clamp(app.pointer.ndc.x * 0.5, -0.5, 0.5);
    this._head = damp(this._head || 0, lookYaw, acting ? 30 : 4, dt);
    if (s.j) s.j.neck.rotation.y = this._head; // the procedural stand-in can also turn its head
    if (s._shown.thrust > 0.3 && Math.random() < dt * 40) {
      this.sparks.emit({ x: rand(-0.2, 0.2), y: 0.25 + this.lift * 0.3, z: rand(-0.2, 0.2), vx: rand(-2, 2), vy: rand(0.3, 1.2), vz: rand(-2, 2), life: rand(0.3, 0.7), size: rand(0.02, 0.05), color: this.cCyan[0] });
    }
    s.reactorWorld(this.reactorGlow.position);
    this.reactorGlow.material.opacity = 0.35 + s._shown.reactor * 0.35;

    // rings: turning, flashing cyan on a hit and red on a miss
    this.ringGood = damp(this.ringGood, 0, 3, dt);
    this.ringBad = damp(this.ringBad, 0, 2.6, dt);
    const u = this.ringMat.uniforms;
    u.uColor.value.copy(this._colBase).lerp(this._colGood, Math.min(1, this.ringGood)).lerp(this._colBad, Math.min(1, this.ringBad));
    u.uOpacity.value = 0.6 + this.ringGood * 0.9 + this.ringBad * 0.6;
    const spin = 1 + this.ringGood * 3;
    for (const r of this.rings) {
      r.rotation.z += r.userData.sp * dt * spin;
      r.position.y = r.userData.y + this.lift * 0.6 + Math.sin(t * 1.2 + r.userData.sp * 5) * 0.03;
    }
    this.ticks.rotation.y -= dt * 0.15 * spin;
    this.edgeMat.color.copy(u.uColor.value);
    this.padLight.color.copy(this._lc.copy(this._lBase).lerp(this._lGood, Math.min(1, this.ringGood)).lerp(this._lBad, Math.min(1, this.ringBad)));
    this.padLight.intensity = 1 + this.ringGood * 6 + this.ringBad * 5 + s._shown.thrust * 4;
    this.grade.tintAmt = this.ringBad * 0.06;

    // targets: the next one to fall pulses gold
    // the next target to fall: its lane lamp blinks amber
    const nextT = this.hits < NQ && this.tOrder ? this.tOrder[this.hits] : -1;
    const lampOn = nextT >= 0 && !this.tDown[nextT];
    this.laneLamp.visible = this.laneGlow.visible = lampOn;
    if (lampOn) {
      const tp = this.tPos[nextT];
      this.laneLamp.position.set(tp.x + 0.38, tp.y + 0.38, tp.z + 0.05);
      this.laneGlow.position.copy(this.laneLamp.position);
      const blink = Math.sin(t * 5) > 0 ? 1 : 0.15;
      this.laneLamp.material.color.setRGB(4 * blink, 2.3 * blink, 0.6 * blink);
      this.laneGlow.material.opacity = 0.45 * blink;
    }
    this.wallLight.intensity = damp(this.wallLight.intensity, 0, 5, dt);

    // shards
    if (this._shardsLive) {
      let live = false;
      for (let k = 0; k < this.shardN; k++) {
        const S = this.shardData[k];
        if (S.age >= S.life) continue;
        S.age += dt;
        if (S.age >= S.life) { this.shards.setMatrixAt(k, this._zero); continue; }
        live = true;
        S.v.y -= 9 * dt;
        S.p.addScaledVector(S.v, dt);
        if (S.p.y < 0.05) { S.p.y = 0.05; S.v.y *= -0.35; S.v.x *= 0.7; S.v.z *= 0.7; }
        S.r.x += S.sp.x * dt; S.r.y += S.sp.y * dt;
        this._q.setFromEuler(S.r);
        this._sc.setScalar(1 - (S.age / S.life) ** 3);
        this._m.compose(S.p, this._q, this._sc);
        this.shards.setMatrixAt(k, this._m);
      }
      this.shards.instanceMatrix.needsUpdate = true;
      this._shardsLive = live;
    }

    if (Math.random() < dt * 14) this.dust.emit({ x: rand(-5, 5), y: rand(0, 4), z: rand(-6, 3), vx: rand(-0.05, 0.05), vy: rand(-0.02, 0.05), life: rand(3, 6), size: rand(0.02, 0.05), color: this.cDust, alpha: 0.45 });
    this.sparks.update(dt, t);
    this.dust.update(dt, t);
    this.beams.update(dt, this.camera);
    this.waves.update(dt);

    // camera: a three-quarter view, a little parallax with the pointer (or the phone's tilt)
    const gy = app.gyro;
    const px = gy ? gy.x : app.pointer.ndc.x, py = gy ? gy.y : app.pointer.ndc.y;
    const cam = this.camera;
    const d = this.camDist;
    cam.position.x = damp(cam.position.x, d * 0.2 + px * 0.4, 2, dt);
    cam.position.y = damp(cam.position.y, this.camY + py * 0.2 + this.lift * 0.3, 2, dt);
    cam.position.z = damp(cam.position.z, d, 3, dt);
    this.look.y = damp(this.look.y, (this.phone ? 1.25 : 1.15) + this.lift * 0.5, 2, dt);
    cam.lookAt(this.look);
  }
}
