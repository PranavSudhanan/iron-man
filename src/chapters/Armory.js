import * as THREE from 'three';
import './Armory.css';
import { Chapter } from '../core/Chapter.js';
import { suitEnvironment } from '../objects/Suit.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { Shockwaves, glowSprite } from '../objects/FX.js';
import { glossyFloor } from '../objects/GlossyFloor.js';
import { loadEnv, envMap, loadTextures, pbr, HDRIS } from '../core/Env.js';
import { rand, damp, clamp, lerp, TAU, h, drawTexture } from '../core/utils.js';
import { ARMORS } from '../data/content.js';

/*
 * The Hall of Armor: a long curved museum gallery (polished concrete, dark plaster, a ceiling light track)
 * of glass cases, each holding one of the real exhibits exactly as
 * it was modelled: suits in tall pods, the Hulkbuster in an oversized one, helmets and the arc reactor in
 * cases at head height. Glide along the hall with the arrows, a swipe, the wheel or the keys; inspect an
 * exhibit up close, power it on, or compare it with the last one you looked at. Nothing is posed: exhibits
 * only turn or rise as a whole.
 */

const N = ARMORS.length;
const R = 14;              // radius of the hall's curve
const STEP = 0.2;          // angle between cases
const MID = (N - 1) / 2;
const STATS = ['Power', 'Armor', 'Speed', 'Tech'];
/** Case sizes (radius scale, plinth height, glass height, floor-light scale) and the camera for each. */
const KIND = {
  suit: { r: 1, base: 0.22, glass: 2.3, pool: 1, cam: { dist: 4.5, y: 1.55, look: 1.15 } },
  big: { r: 1.55, base: 0.26, glass: 3.55, pool: 1.25, cam: { dist: 6.9, y: 2.05, look: 1.8 } },
  plinth: { r: 0.52, base: 1.3, glass: 0.74, pool: 0.7, cam: { dist: 2.9, y: 1.65, look: 1.52 } },
};
const kindOf = (i) => KIND[ARMORS[i].display] || KIND.suit;

const theta = (i) => (i - MID) * STEP;
/** A point on the hall's curve at index i (fractional allowed), at radius r from the curve's centre. */
const onCurve = (i, r, y, out = new THREE.Vector3()) => {
  const a = theta(i);
  return out.set(Math.sin(a) * r, y, R - Math.cos(a) * r);
};

/**
 * The cases' two light-emitting parts, as additive shaders on instanced meshes (one draw each): the linear
 * LED lens under each canopy, and the frosted light panel at the back of the case. aGlow (per case) sets
 * how lit each one is (the chosen case full, the rest dimmed, as a gallery does with its lighting scenes).
 */
function podMaterial(mode, color, side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    defines: { MODE: mode },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(color) } }]),
    vertexShader: /* glsl */ `
      attribute float aGlow;
      varying float vGlow; varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){
        vUv = uv; vGlow = aGlow;
        vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vGlow; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main(){
        float a; float hdr;
        #if MODE == 4
          // frosted acrylic lit from behind: brightest in a soft column behind the exhibit, falling off to
          // the frame, a little brighter at the top where the lamps sit
          vec2 q = vUv - vec2(0.5, 0.6);
          float column = exp(-q.x * q.x * 7.0) * (0.45 + 0.55 * smoothstep(0.0, 0.9, vUv.y));
          float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.96, vUv.y);
          a = column * edge * 0.2;
          hdr = 1.0;
        #else
          a = 1.0;
          hdr = 4.0;
        #endif
        gl_FragColor = vec4(uColor * hdr, a * vGlow);
        #include <fog_fragment>
      }`,
    fog: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side,
  });
}

export class Armory extends Chapter {
  constructor(app) {
    super(app, { id: 'armory', title: 'Hall of Armor', jp: 'ARMORY' });
    this.bloom = { strength: 0.55, radius: 0.5, threshold: 2.8 }; // lacquer glints stay crisp; lamps are HDR
    this.grade = { ...this.grade, grain: 0.022, vig: 0.45, ca: 0.002, sat: 1, tint: 0xffd8b0, tintAmt: 0 };
    this.mood = 'calm';
    this.shiftView = 0.1;
    this.trailColor = '120,220,255';
    this.sel = Math.min(2, N - 1); // start at the classic armor
    this.prevSel = null;
    this.camI = this.sel;
    this.fit = 1;
    this.inspect = false; this.insT = 0;
    this.spinYaw = 0; this.spinV = 0;
    this.compare = false;
    this.timers = []; this.clock = 0;
    this._wheelAcc = 0; this._wheelLock = 0; this._lastNav = 0;
    this._hinted = false;
  }

  load() {
    return Promise.all([loadModels([...new Set(ARMORS.map((a) => a.scheme))]), loadEnv(HDRIS.studio), loadTextures(['concrete_floor_worn_001'])]);
  }

  build() {
    const s = this.scene;
    const bg = 0x0c0c0d; // the dark end of the gallery, not a void: the fog fades the hall into it
    s.background = new THREE.Color(bg);
    s.fog = new THREE.Fog(bg, 9, 28);
    // a photographed studio (soft boxes) for the reflections in the armor and the glass
    // (the room itself takes only a trace of it: the studio's soft boxes would light the dark gallery grey;
    // the exhibits and the glass get their own, stronger copy below)
    s.environment = envMap(HDRIS.studio) || suitEnvironment();
    s.environmentIntensity = 0.12;
    this._glassEnv = s.environment;
    this._grit = pbr('concrete_floor_worn_001', { repeat: 3 }).roughnessMap || null;
    this.camera.fov = 40;
    this.look = new THREE.Vector3();
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this.pods = ARMORS.map((a, i) => {
      const k = kindOf(i);
      return { pos: onCurve(i, R, 0), rot: -theta(i), toC: new THREE.Vector3(-Math.sin(theta(i)), 0, Math.cos(theta(i))), k, top: k.base + k.glass + 0.2 };
    });

    this._buildLights();
    this._buildHall();
    this._buildPods();
    this._buildExhibits();
    this._buildLabels();

    this.dust = new ParticlePool({ count: 240, drag: 0.3, turbulence: 0.15, softness: 2 });
    this.sparks = new ParticlePool({ count: 300, gravity: -5, drag: 0.8, softness: 1.2 });
    s.add(this.dust.points, this.sparks.points);
    this.dustColor = new THREE.Color(0xe6d8c4);
    this.sparkColors = [new THREE.Color(0xbff6ff).multiplyScalar(3.5), new THREE.Color(0xffffff).multiplyScalar(3), new THREE.Color(0xffd28a).multiplyScalar(3.5)];
    this.waves = new Shockwaves(s, 3);

    this._buildUI();
    this._fillCard();
    this._updateVisibility();
    this._placeCamera(1);
  }

  /* ---------------- scene ---------------- */

  _buildLights() {
    const s = this.scene;
    const low = this.app.low;
    // a dim, warm spill off the walls and floor; the gallery spots do the real work
    s.add(new THREE.HemisphereLight(0xe0d8cc, 0x1a1714, 0.3));
    // three 3000 K gallery spots on the ceiling track follow the visit: the chosen exhibit (soft shadow)
    // and its two neighbours, each throwing a soft-edged pool of light on its case
    this.spots = (low ? [0] : [-1, 0, 1]).map((j) => { // (phones: the chosen exhibit's only)
      const sp = new THREE.SpotLight(0xffe4c4, j ? 34 : 70, 14, j ? 0.3 : 0.32, 0.65, 1.3);
      sp.userData.j = j;
      if (!j && !low) {
        sp.castShadow = true;
        sp.shadow.mapSize.set(2048, 2048);
        sp.shadow.bias = -0.0002; sp.shadow.normalBias = 0.02; sp.shadow.radius = 5;
        sp.shadow.camera.near = 1; sp.shadow.camera.far = 10;
      }
      const i = clamp(this.sel + j, 0, N - 1);
      this._spotTarget(i, sp.position, sp.target.position);
      s.add(sp, sp.target);
      return sp;
    });
    this.spot = this.spots.find((sp) => sp.userData.j === 0);
    // two wall washers high up behind the row (they travel with the camera): soft scallops of light on the
    // plaster behind the cases, and a faint rim on the exhibits through the frosted backs
    this.rimC = new THREE.PointLight(0xe6e8ee, 12, 9, 1.8);
    this.rimW = new THREE.PointLight(0xffdcb8, 12, 9, 1.8);
    s.add(this.rimC, this.rimW);
  }

  _spotTarget(i, pos, target) {
    const p = this.pods[i];
    const h = Math.max(4.6, p.top + 1.3);
    pos.copy(p.pos).addScaledVector(p.toC, p.k === KIND.big ? 2.2 : 1.3).setY(h);
    target.copy(p.pos).setY(p.k === KIND.plinth ? p.k.base + 0.2 : p.k === KIND.big ? 1.6 : 1.1);
  }

  _buildHall() {
    const s = this.scene;
    const low = this.app.low;
    // polished concrete (a real blurred mirror), dark mineral-plaster walls, a black ceiling with a light track
    const floorMat = pbr('concrete_floor_worn_001', { repeat: 16, color: 0x77746f, roughness: 0.28, metalness: 0, normalScale: 0.4, fallback: 0x1c1d20 });
    this.floor = glossyFloor(new THREE.PlaneGeometry(60, 60), floorMat, { renderer: this.app.renderer, low, scale: 0.4, strength: 0.85, blur: 4 });
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, 0, R * 0.6);
    s.add(this.floor);

    const arc = STEP * (N + 3);
    const wallR = R + 2.8;
    const wallMat = pbr('concrete_floor_worn_001', { repeat: [16, 3], color: 0x3c3a38, roughness: 1, metalness: 0, normalScale: 0.6, fallback: 0x1a1a1c, side: THREE.BackSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(wallR, wallR, 7, 160, 1, true, Math.PI - arc / 2, arc), wallMat);
    wall.position.set(0, 3.5, R);
    wall.receiveShadow = true;
    s.add(wall);
    // a bronze skirting, and a warm cove light washing down the wall from under the ceiling
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(wallR - 0.03, wallR - 0.03, 0.12, 160, 1, true, Math.PI - arc / 2, arc),
      new THREE.MeshStandardMaterial({ color: 0x2a241e, metalness: 1, roughness: 0.4, side: THREE.BackSide }));
    skirt.position.set(0, 0.06, R);
    const cove = new THREE.Mesh(new THREE.CylinderGeometry(wallR - 0.12, wallR - 0.12, 0.05, 160, 1, true, Math.PI - arc / 2, arc),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2c0).multiplyScalar(1.6), toneMapped: false, side: THREE.DoubleSide }));
    cove.position.set(0, 5.62, R);
    s.add(skirt, cove);
    this.coveWash = new THREE.Mesh(new THREE.CylinderGeometry(wallR - 0.02, wallR - 0.02, 2.4, 160, 1, true, Math.PI - arc / 2, arc), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffd9b0) } },
      vertexShader: /* glsl */ 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ 'uniform vec3 uColor; varying float vY; void main(){ gl_FragColor = vec4(uColor, pow(vY, 3.0) * 0.1); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    }));
    this.coveWash.position.set(0, 4.4, R);
    s.add(this.coveWash);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.95 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 6, R * 0.5);
    s.add(ceil);
    const dark = new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.8, roughness: 0.45 });
    // the lighting track along the hall, hung under the ceiling on rods, and a fixture above each case
    const trackR = R - 1.3;
    const pts = [];
    for (let k = 0; k <= 64; k++) pts.push(onCurve(-2 + (N + 3) * (k / 64), trackR, 5.2));
    const track = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 128, 0.025, 6, false), dark);
    s.add(track);
    const housing = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.09, 0.26, 20).rotateX(Math.PI / 2), dark, N);
    const lens = new THREE.InstancedMesh(new THREE.CircleGeometry(0.066, 20).translate(0, 0, 0.131), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe8cc).multiplyScalar(5), toneMapped: false }), N);
    const rods = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6), dark, N);
    const d = new THREE.Object3D(), p = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      this._spotTarget(i, p, q);
      d.position.copy(p); d.scale.set(1, 1, 1); d.lookAt(q); d.updateMatrix();
      housing.setMatrixAt(i, d.matrix); lens.setMatrixAt(i, d.matrix);
      d.rotation.set(0, 0, 0); d.position.set(p.x, (p.y + 6) / 2, p.z); d.scale.set(1, 6 - p.y, 1); d.updateMatrix();
      rods.setMatrixAt(i, d.matrix);
    }
    s.add(housing, lens, rods);

    // cast-concrete columns between the cases (instanced: one draw)
    const colMat = pbr('concrete_floor_worn_001', { repeat: [1, 3], color: 0x8d8983, roughness: 0.95, metalness: 0, fallback: 0x55524e });
    const cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.2, 6, 24), colMat, N + 1);
    cols.receiveShadow = true;
    for (let k = 0; k <= N; k++) {
      const i = k - 0.5;
      onCurve(i, R + 1.3, 3, d.position); d.rotation.set(0, -theta(i), 0); d.scale.set(1, 1, 1); d.updateMatrix();
      cols.setMatrixAt(k, d.matrix);
    }
    s.add(cols);
  }

  /**
   * Each exhibit stands in a museum case: a cast-stone plinth on a shadow gap with a brushed steel top plate,
   * a dark bronze frame (back, side fins, canopy with a linear LED lens), a frosted light panel at the back,
   * and a front pane of low-iron glass that shows nothing but reflections. All instanced: a draw per part.
   */
  _buildPods() {
    const s = this.scene;
    this.glow = new Float32Array(N).fill(0.3);
    this.glowAttr = new THREE.InstancedBufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage);
    const bronze = new THREE.MeshStandardMaterial({ color: 0x1a1816, metalness: 0, roughness: 0.62, roughnessMap: this._grit }); // dark bronze powder coat
    const steel = new THREE.MeshStandardMaterial({ color: 0x9a9ea4, metalness: 1, roughness: 0.38, roughnessMap: this._grit, envMap: this._glassEnv, envMapIntensity: 0.5 });
    const gap = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
    const stone = pbr('concrete_floor_worn_001', { repeat: 0.8, color: 0xbab4aa, roughness: 0.85, metalness: 0, normalScale: 0.5, fallback: 0x8a857e });
    const d = new THREE.Object3D();
    const off = new THREE.Vector3();
    // place(k) -> [x, y, z (in the case's own frame: +z faces the hall's centre), sx, sy, sz]
    const inst = (geo, mat, place, { glowing = false, receive = true } = {}) => {
      if (glowing) geo.setAttribute('aGlow', this.glowAttr);
      const m = new THREE.InstancedMesh(geo, mat, N);
      for (let i = 0; i < N; i++) {
        const p = this.pods[i];
        const [x, y, z, sx, sy, sz] = place(p.k);
        off.set(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
        d.position.copy(p.pos).add(off); d.position.y = y;
        d.rotation.set(0, p.rot, 0);
        d.scale.set(sx, sy, sz);
        d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
      }
      m.computeBoundingSphere();
      m.receiveShadow = receive;
      s.add(m);
      return m;
    };
    const H = (k) => k.base + k.glass;        // the canopy's underside
    const W = (k) => 1.5 * k.r;               // case width
    // the plinth: a stone block floating on a dark shadow gap, a steel top plate for the exhibit to stand on
    this.bases = inst(new THREE.BoxGeometry(1, 1, 1), stone, (k) => [0, (k.base + 0.03) / 2, 0.05 * k.r, W(k) * 0.92, k.base - 0.03, 1.3 * k.r]);
    inst(new THREE.BoxGeometry(1, 1, 1), gap, (k) => [0, 0.02, 0.05 * k.r, W(k) * 0.9, 0.04, 1.28 * k.r]);
    inst(new THREE.BoxGeometry(1, 1, 1), steel, (k) => [0, k.base - 0.004, 0, 0.9 * k.r, 0.012, 0.9 * k.r]);
    // the frosted light panel at the back, and the bronze frame round it
    this.panels = inst(new THREE.PlaneGeometry(1, 1), podMaterial(4, 0xf4ebdf), (k) => [0, k.base + (H(k) - k.base) / 2 + 0.05, -0.78 * k.r, W(k) * 0.92, H(k) - k.base + 0.1, 1], { glowing: true, receive: false });
    inst(new THREE.BoxGeometry(1, 1, 0.08), bronze, (k) => [0, H(k) / 2 + 0.07, -0.84 * k.r - 0.05, W(k) + 0.3, H(k) + 0.14, 1]);
    for (const sx of [-1, 1]) inst(new THREE.BoxGeometry(1, 1, 1), bronze, (k) => [sx * (W(k) / 2 + 0.06), H(k) / 2 + 0.07, -0.1 * k.r, 0.1, H(k) + 0.14, 1.45 * k.r]);
    // the canopy with its linear LED lens
    inst(new THREE.BoxGeometry(1, 1, 1), bronze, (k) => [0, H(k) + 0.12, -0.1 * k.r, W(k) + 0.32, 0.16, 1.5 * k.r]);
    inst(new THREE.BoxGeometry(1, 1, 1), podMaterial(3, 0xfff0dc), (k) => [0, H(k) + 0.037, 0.2 * k.r, W(k) * 0.7, 0.012, 0.04], { glowing: true, receive: false });
    // the front pane of glass: black, additive, so it adds only what it reflects (the studio's soft boxes,
    // the spots, the hall) with the fresnel rise at grazing angles, the way low-iron glass does
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.14, metalness: 0, envMap: this._glassEnv, envMapIntensity: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.glass = inst(new THREE.PlaneGeometry(1, 1), glassMat, (k) => [0, H(k) / 2 + 0.07, 0.62 * k.r, W(k) + 0.1, H(k) + 0.1, 1], { receive: false });
    // the glass's green edges where the panes meet the fins and the canopy
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x3f5a4e, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55 });
    for (const sx of [-1, 1]) inst(new THREE.BoxGeometry(1, 1, 1), edgeMat, (k) => [sx * (W(k) / 2 + 0.045), H(k) / 2 + 0.07, 0.62 * k.r, 0.012, H(k) + 0.1, 0.012], { receive: false });
    this.podTargets = [this.panels, this.bases, this.glass];
  }

  /** The exhibits themselves: the real models, merged (few draws each), no lights of their own. */
  _buildExhibits() {
    const r = this.app.renderer;
    const low = this.app.low;
    this.items = ARMORS.map((armor, i) => {
      const p = this.pods[i];
      const model = new RealSuit(armor.scheme, { castShadow: !low, uniqueMaterials: true });
      // the studio reflections at their own strength (the room around them is dimmer)
      for (const m of model.meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (mat.isMeshStandardMaterial) { mat.envMap = this._glassEnv; mat.envMapIntensity = 0.8; }
      }
      model.root.position.copy(p.pos).setY(p.k.base);
      model.root.rotation.y = p.rot;
      model.reactor = 0.25; model.eyes = 0.1;
      this.scene.add(model.root);
      // upload the textures now: exhibits are hidden until the camera comes near, and a first upload then would hitch
      for (const m of model.meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const v of Object.values(mat)) if (v && v.isTexture) r.initTexture(v);
      const canFly = model.ok && model.flames.length > 0;
      const canPower = model.ok && (canFly || model.eyeSprites.length > 0 || model.eyeGlows?.length > 0 || armor.scheme === 'reactor');
      return { model, canFly, canPower, powered: false, lift: 0, liftTarget: 0, turn: 0 };
    });
    // the arc reactor exhibit has no glow of its own: give it one (HDR, so it blooms when powered)
    const reactorItem = this.items.find((it, i) => ARMORS[i].scheme === 'reactor');
    if (reactorItem) {
      reactorItem.glow = glowSprite(new THREE.Color(0xbff6ff).multiplyScalar(4), 0.5, 0);
      reactorItem.glow.material.toneMapped = false;
      reactorItem.glow.position.set(0, (reactorItem.model.size?.y || 0.3) / 2, 0.06);
      reactorItem.model.root.add(reactorItem.glow);
    }
  }

  /** A museum label beside each case: a black anodised plate on a slanted steel stand, lit by the room. */
  _buildLabels() {
    const s = this.scene;
    const standMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 1, roughness: 0.35, roughnessMap: this._grit });
    const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, 0.05), standMat, N);
    const d = new THREE.Object3D(), off = new THREE.Vector3();
    const plateGeo = new THREE.BoxGeometry(0.44, 0.28, 0.012);
    const edge = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, metalness: 0.8, roughness: 0.4 });
    this.labels = ARMORS.map((armor, i) => {
      const p = this.pods[i];
      const tex = drawTexture(512, 320, (x, w, hh) => {
        x.fillStyle = '#141416'; x.fillRect(0, 0, w, hh);
        x.fillStyle = 'rgba(236,230,220,0.92)';
        x.font = '600 20px Rajdhani, "Helvetica Neue", Arial, sans-serif';
        x.fillText(`${String(i + 1).padStart(2, '0')}`, 32, 50);
        x.font = '700 44px "Helvetica Neue", Arial, sans-serif';
        x.fillText(armor.name, 32, 110);
        x.fillStyle = 'rgba(200,170,120,0.95)';
        x.font = '500 24px "Helvetica Neue", Arial, sans-serif';
        x.fillText(armor.year, 32, 150);
        x.fillStyle = 'rgba(236,230,220,0.55)';
        x.fillRect(32, 176, 80, 2);
        x.font = '400 19px "Helvetica Neue", Arial, sans-serif';
        const words = armor.text.split(' ');
        let line = '', y = 214;
        for (const wd of words) {
          if (x.measureText(line + wd).width > w - 64) { x.fillText(line, 32, y); line = ''; y += 26; if (y > 300) break; }
          line += wd + ' ';
        }
        if (y <= 300) x.fillText(line, 32, y);
      });
      tex.anisotropy = 4;
      // (lit by its own small label light: a touch of emission keeps it readable outside the spot's pool)
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.45 });
      const plate = new THREE.Mesh(plateGeo, [edge, edge, edge, edge, face, edge]);
      // front right of the case, at reading height, facing the visitor, tilted back
      const k = p.k, x0 = 0.75 * k.r + 0.25, z0 = 0.62 * k.r + 0.45;
      const hgt = 1.05;
      off.set(x0, 0, z0).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
      plate.position.copy(p.pos).add(off).setY(hgt);
      plate.rotation.set(0, p.rot, 0, 'YXZ');
      plate.rotation.x = -0.6;
      s.add(plate);
      d.position.copy(p.pos).add(off).setY((hgt - 0.08) / 2); d.rotation.set(0, p.rot, 0); d.scale.set(1, hgt - 0.08, 1); d.updateMatrix();
      post.setMatrixAt(i, d.matrix);
      return plate;
    });
    post.computeBoundingSphere();
    s.add(post);
  }

  /* ---------------- UI ---------------- */

  _buildUI() {
    this.intro({
      kicker: 'The collection',
      title: 'Hall of <em>Armor</em>',
      jp: 'ARMORY',
      desc: 'Every exhibit told a chapter of the story: from scrap in a cave to nanites in a chest plate. Walk the gallery, power one up, and set any two side by side.',
      extra: [this.gestures([['swipe', '<b>Swipe</b>, scroll or use <kbd>←</kbd> <kbd>→</kbd>'], ['tap', '<b>Tap</b> a case to go to it'], ['drag', '<b>Drag</b> to turn it while inspecting']])],
    });

    this.cardYear = h('span.card-jp');
    this.cardCount = h('span.am-count');
    this.cardName = h('h3');
    this.cardText = h('p');
    this.legCur = h('b'); this.legPrev = h('b');
    this.legend = h('div.am-legend', {}, h('span.cur', {}, h('i'), this.legCur), h('span.prev', {}, h('i'), this.legPrev));
    this.meters = STATS.map((name) => {
      const val = h('span.am-val');
      const fill = h('div.meter-fill');
      const pfill = h('div.meter-fill.gold');
      const el = h('div.meter.am-meter', {}, h('div.meter-label', {}, h('span', { text: name }), val), h('div.meter-track', {}, fill), h('div.meter-track.am-prev', {}, pfill));
      return { name, el, val, fill, pfill };
    });
    this.card = h('div.card.am-card.pe', { 'aria-live': 'polite' },
      h('div.am-top', {}, this.cardYear, this.cardCount),
      this.cardName, this.cardText, this.legend,
      h('div.am-stats', {}, this.meters.map((m) => m.el)));
    this.ui.append(this.card);

    this.btnPrev = this.button('‹', () => this._go(this.sel - 1), 'am-arrow');
    this.btnNext = this.button('›', () => this._go(this.sel + 1), 'am-arrow');
    this.btnPrev.setAttribute('aria-label', 'Previous exhibit');
    this.btnNext.setAttribute('aria-label', 'Next exhibit');
    this.btnInspect = this.button('Inspect', () => this._setInspect(!this.inspect));
    this.btnPower = this.button('Power on', () => this._power(), 'btn-primary');
    this.btnCompare = this.button('Compare', () => this._toggleCompare());
    this.btnInspect.setAttribute('aria-pressed', 'false');
    this.btnCompare.setAttribute('aria-pressed', 'false');
    this.ui.append(h('div.controls', {}, this.btnPrev, h('div.group', {}, this.btnInspect, this.btnPower, this.btnCompare), this.btnNext));
  }

  _fillCard() {
    const a = ARMORS[this.sel];
    this.cardYear.textContent = a.year;
    this.cardCount.textContent = `${String(this.sel + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
    this.cardName.textContent = a.name;
    this.cardText.textContent = a.text;
    const prev = this.prevSel !== null ? ARMORS[this.prevSel] : null;
    const cmp = this.compare && prev;
    this.card.classList.toggle('comparing', !!cmp);
    this.legCur.textContent = a.name;
    this.legPrev.textContent = prev ? prev.name : '';
    const val = (arm, name) => (arm.stats.find(([k]) => k === name) || [name, 0])[1];
    for (const m of this.meters) {
      const v = val(a, m.name);
      m.fill.style.width = `${v}%`;
      if (cmp) {
        const pv = val(prev, m.name);
        m.pfill.style.width = `${pv}%`;
        const diff = v - pv;
        m.val.innerHTML = `<b>${v}</b> · <em>${pv}</em> <small class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${diff}</small>`;
      } else {
        m.pfill.style.width = '0%';
        m.val.innerHTML = `<b>${v}</b>`;
      }
    }
    const it = this.items[this.sel];
    this.btnPrev.disabled = this.sel === 0;
    this.btnNext.disabled = this.sel === N - 1;
    this.btnPower.disabled = !it.canPower;
    this.btnPower.textContent = !it.canPower ? 'No power core' : it.powered ? 'Power down' : 'Power on';
    this.btnCompare.setAttribute('aria-pressed', String(!!cmp));
  }

  onEnter() { this._hint(); }

  enter() {
    this._lastNav = performance.now();
    if (!this._hinted) setTimeout(() => this._hint(), 900);
  }

  _hint() {
    if (!this.active || this._hinted) return;
    this._hinted = true;
    this.app.toast('<b>Swipe</b> or use the arrows to walk the hall — <b>tap</b> a case to visit it.', 3600);
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
  }

  /* ---------------- actions ---------------- */

  _after(sec, fn) { this.timers.push({ at: this.clock + sec, fn }); }

  _go(i) {
    i = clamp(i, 0, N - 1);
    if (i === this.sel) return false;
    this.prevSel = this.sel;
    this.sel = i;
    this._lastNav = performance.now();
    if (this.inspect) this._setInspect(false, true);
    this._fillCard();
    this.app.sfx.swoosh();
    this.app.sfx.beep(i % 6);
    return true;
  }

  _setInspect(on, silent = false) {
    this.inspect = on;
    this.btnInspect.setAttribute('aria-pressed', String(on));
    this.card.classList.toggle('inspecting', on);
    if (!silent) { this.app.sfx.whoosh(); if (on) this.app.sfx.scan(); }
    this.spinV = on ? 0.4 : 0;
  }

  _power() {
    const i = this.sel;
    const it = this.items[i];
    if (!it.canPower) return;
    const m = it.model;
    const sfx = this.app.sfx;
    if (it.powered) {
      it.powered = false;
      m.reactor = 0.25; m.eyes = 0.1; m.thrust = 0;
      it.liftTarget = 0;
      sfx.powerDown();
      this._fillCard();
      return;
    }
    it.powered = true;
    this._fillCard();
    sfx.powerUp();
    this.app.flash(0.2, 0x9ff3ff);
    m.reactor = 1;
    this._after(0.6, () => { if (it.powered) { m.eyes = 1; sfx.beep(4); sfx.lock(); } });
    const p = this.pods[i];
    if (it.canFly) {
      // the whole suit rises on its boot jets for a moment
      this._after(1.1, () => {
        if (!it.powered) return;
        m.thrust = 0.85;
        it.liftTarget = p.k === KIND.big ? 0.25 : 0.3;
        this.waves.spawn(this._v1.set(p.pos.x, p.k.base + 0.01, p.pos.z), { radius: 1.6 * p.k.r, life: 0.9 });
        this.sparks.burst(this._v1.set(p.pos.x, p.k.base + 0.05, p.pos.z), 50, { speed: 3, spread: 1.5, up: 0.8, life: [0.3, 0.8], size: [0.02, 0.05], colors: this.sparkColors });
        sfx.boom();
        this.app.flash(0.2, 0xbff6ff);
      });
      this._after(4.0, () => { m.thrust = 0; it.liftTarget = 0; if (it.powered) sfx.thud(); });
    } else {
      // helmets and the reactor float up off the plinth and glow
      this._after(0.4, () => { if (it.powered) { it.liftTarget = 0.1; sfx.hologram(); } });
      this._after(3.2, () => { it.liftTarget = 0; });
    }
  }

  _toggleCompare() {
    if (this.prevSel === null) {
      this.app.toast('Visit another exhibit first — then <b>Compare</b> sets the two side by side.', 3000);
      this.app.sfx.wrong();
      return;
    }
    this.compare = !this.compare;
    this.app.sfx.hologram();
    this._fillCard();
  }

  /* ---------------- input ---------------- */

  _podAt(ndc) {
    const hit = this.app.raycast(this.podTargets, false, ndc)[0];
    return hit && hit.instanceId !== undefined ? hit.instanceId : -1;
  }

  pointerMove(p) {
    if (p.down) {
      if (this.inspect) { this.spinYaw += p.dx * 0.01; this.spinV = p.dx * 0.6; }
      return;
    }
    const i = this._podAt(p.ndc);
    this._hoverPod = i >= 0 && i !== this.sel;
  }

  click(p) {
    const i = this._podAt(p.ndc);
    if (i < 0) return;
    if (i === this.sel) this._setInspect(!this.inspect);
    else this._go(i);
  }

  swipe(s) {
    if (this.inspect) return true;
    if (Math.abs(s.dx) > Math.abs(s.dy) * 1.2) { this._go(this.sel + (s.dx < 0 ? 1 : -1)); return true; }
    return false;
  }

  /** At either end of the hall the wheel and the arrow keys pass through, so the site can move on. */
  _atEnd(dir) {
    return ((dir < 0 && this.sel === 0) || (dir > 0 && this.sel === N - 1)) && performance.now() - this._lastNav > 900;
  }

  wheel(e) {
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const dir = Math.sign(d);
    if (!dir) return true;
    if (this._atEnd(dir)) return false;
    const now = performance.now();
    this._wheelAcc += d;
    clearTimeout(this._wheelT);
    this._wheelT = setTimeout(() => { this._wheelAcc = 0; }, 220);
    if (now > this._wheelLock && Math.abs(this._wheelAcc) > 45) {
      this._wheelLock = now + 360;
      this._wheelAcc = 0;
      this._go(this.sel + dir);
    }
    return true;
  }

  key(e) {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (this._atEnd(dir)) return false;
      this._go(this.sel + dir);
      return true;
    }
    const l = k.toLowerCase();
    if (l === 'i') { this._setInspect(!this.inspect); return true; }
    if (l === 'p') { this._power(); return true; }
    if (l === 'c') { this._toggleCompare(); return true; }
    if (k === 'Escape' && this.inspect) { this._setInspect(false); return true; }
    if (k === 'Home') { this._go(0); return true; }
    if (k === 'End') { this._go(N - 1); return true; }
    return false;
  }

  resize(w, hh) {
    super.resize(w, hh);
    if (this.floor?.resizeMirror) { const v = this.app.renderer.getDrawingBufferSize(new THREE.Vector2()); this.floor.resizeMirror(v.x, v.y); }
    const aspect = w / hh;
    this.fit = aspect < 1 ? clamp(0.95 / aspect * 0.62, 1, 1.75) : 1;
    // portrait: the card covers the lower part of the screen, so raise the exhibits into the top part
    if (aspect < 0.8) {
      this.camera.setViewOffset(w, hh, 0, hh * 0.15, w, hh);
      this.camera.updateProjectionMatrix();
    }
  }

  /* ---------------- frame ---------------- */

  /** Exhibits near the camera are drawn, the rest hidden (they carry no lights, so this costs nothing). */
  _updateVisibility() {
    for (let i = 0; i < N; i++) {
      const on = Math.abs(i - this.camI) <= 1.6;
      const root = this.items[i].model.root;
      if (root.visible !== on) root.visible = on;
    }
  }

  /** The camera framing blends between the cases' own framings as it glides. */
  _view(out) {
    const i0 = clamp(Math.floor(this.camI), 0, N - 1), i1 = Math.min(N - 1, i0 + 1), f = this.camI - i0;
    const a = kindOf(i0).cam, b = kindOf(i1).cam;
    out.dist = lerp(a.dist, b.dist, f); out.y = lerp(a.y, b.y, f); out.look = lerp(a.look, b.look, f);
    return out;
  }

  _placeCamera(k) {
    const v = this._view(this._viewTmp || (this._viewTmp = {}));
    const dist = v.dist * (1 - this.insT * 0.45) * this.fit;
    const app = this.app;
    const g = app.gyro;
    const px = g ? g.x : app.pointer.ndc.x, py = g ? g.y : app.pointer.ndc.y;
    const i = this.camI + px * 0.05 * (1 - this.insT);
    onCurve(i, R - dist, v.y - this.insT * 0.08 + py * 0.12, this._v1);
    const cam = this.camera;
    cam.position.lerp(this._v1, k);
    onCurve(this.camI, R, v.look + this.items[this.sel].lift * 0.5, this._v2);
    this.look.lerp(this._v2, k);
    cam.lookAt(this.look);
    // the rims follow along behind the row
    onCurve(this.camI - 0.5, R + 2.3, 4.9, this.rimC.position);
    onCurve(this.camI + 0.5, R + 2.3, 4.9, this.rimW.position);
  }

  update(dt, t) {
    const app = this.app;
    this.clock += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].at <= this.clock) { const fn = this.timers[i].fn; this.timers.splice(i, 1); fn(); }
    }

    // glide along the hall
    this.camI = damp(this.camI, this.sel, 2.8, dt);
    if (Math.abs(this.camI - this.sel) < 1e-4) this.camI = this.sel;
    this._updateVisibility();
    this.insT = damp(this.insT, this.inspect ? 1 : 0, 3, dt);

    // cases: the chosen one lit, the rest dim
    let dirty = false;
    for (let i = 0; i < N; i++) {
      const target = i === this.sel ? 1 : Math.abs(i - this.camI) < 1.6 ? 0.42 : 0.28;
      const v = damp(this.glow[i], target, 4, dt);
      if (Math.abs(v - this.glow[i]) > 1e-4) { this.glow[i] = v; dirty = true; }
    }
    if (dirty) this.glowAttr.needsUpdate = true;

    // the gallery spots follow the visit: the chosen exhibit and its neighbours (none past the ends)
    for (const sp of this.spots) {
      const j = sp.userData.j, i = this.sel + j;
      const on = i >= 0 && i < N;
      if (on) {
        this._spotTarget(i, this._v3, this._v2);
        sp.position.lerp(this._v3, 1 - Math.exp(-3 * dt));
        sp.target.position.lerp(this._v2, 1 - Math.exp(-3 * dt));
      }
      sp.intensity = damp(sp.intensity, on ? (j ? 34 : 70) * (this.pods[clamp(i, 0, N - 1)].k === KIND.big ? 1.1 : 1) : 0, 3, dt);
    }

    // exhibits: turn (plinth pieces on a slow turntable, the chosen one while inspected), rise when powered
    if (!app.pointer.down) {
      this.spinV = damp(this.spinV, this.inspect ? 0.35 : 0, 1.5, dt);
      this.spinYaw += this.spinV * dt;
    }
    if (!this.inspect) {
      this.spinYaw = Math.atan2(Math.sin(this.spinYaw), Math.cos(this.spinYaw));
      this.spinYaw = damp(this.spinYaw, 0, 3, dt);
    }
    let thrust = 0;
    for (let i = 0; i < N; i++) {
      const it = this.items[i];
      const m = it.model;
      if (!m.ok || !m.root.visible) continue; // (a missing model leaves its case empty)
      const p = this.pods[i];
      const plinth = p.k === KIND.plinth;
      it.lift = damp(it.lift, it.liftTarget + (it.liftTarget > 0 ? Math.sin(t * 2) * (plinth ? 0.01 : 0.03) : 0), 2.5, dt);
      m.root.position.y = p.k.base + it.lift;
      if (plinth) it.turn += dt * 0.25;
      m.root.rotation.y = p.rot + (plinth ? Math.sin(it.turn) * 0.6 : 0) + (i === this.sel ? this.spinYaw : 0);
      m.update(dt);
      if (it.glow) {
        const r = m._shown.reactor;
        it.glow.material.opacity = Math.max(0, r - 0.2) * 0.9;
        it.glow.scale.setScalar(0.25 + r * 0.35);
      }
      thrust = Math.max(thrust, m._shown.thrust);
      if (m._shown.thrust > 0.3 && Math.random() < dt * 25) {
        this.sparks.emit({ x: p.pos.x + rand(-0.15, 0.15), y: p.k.base + 0.03, z: p.pos.z + rand(-0.15, 0.15), vx: rand(-1.5, 1.5), vy: rand(0.3, 1.2), vz: rand(-1.5, 1.5), life: rand(0.3, 0.6), size: rand(0.015, 0.04), color: this.sparkColors[0] });
      }
    }
    app.sfx.thrust(this.active ? thrust * 0.5 : 0);

    // dust drifting in the chosen case's light
    const pod = this.pods[this.sel];
    if (Math.random() < dt * 16) {
      const a = rand(0, TAU), r = rand(0, 0.6 * pod.k.r);
      this.dust.emit({ x: pod.pos.x + Math.cos(a) * r, y: rand(pod.k.base + 0.1, pod.top - 0.1), z: pod.pos.z + Math.sin(a) * r, vx: rand(-0.02, 0.02), vy: rand(-0.03, 0.03), vz: rand(-0.02, 0.02), life: rand(3, 6), size: rand(0.01, 0.028), color: this.dustColor, alpha: 0.55 });
    }
    this.dust.update(dt, t);
    this.sparks.update(dt, t);
    this.waves.update(dt);

    this._placeCamera(1 - Math.exp(-4 * dt));
    app.setHover(!app.pointer.down && !!this._hoverPod);
  }
}
