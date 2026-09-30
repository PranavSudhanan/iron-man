import * as THREE from 'three';
import { Chapter } from '../core/Chapter.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RealSuit, loadModels } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { Beams, Shockwaves } from '../objects/FX.js';
import { glossyFloor } from '../objects/GlossyFloor.js';
import { loadEnv, envMap, loadTextures, pbr, HDRIS } from '../core/Env.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, damp, h } from '../core/utils.js';
import { PROFILE } from '../data/content.js';

/**
 * The prologue: the suit stands dormant on a turntable in a dark private hangar: sealed concrete that
 * mirrors it, bare concrete walls with recessed light bars, one soft light box above. Hold to bring it online — the reactor fills,
 * the eyes light, the faceplate seals, the boots ignite and it lifts off the pad. Drag to turn it.
 */
export class Prologue extends Chapter {
  constructor(app) {
    super(app, { id: 'prologue', title: 'Iron Man', jp: 'ARC-01' });
    this.bloom = { strength: 0.8, radius: 0.5, threshold: 3 }; // only true light sources bloom, not the gold's highlights
    this.grade = { ...this.grade, grain: 0.025, vig: 0.45, ca: 0.0015, tint: 0x5fe3ff, tintAmt: 0 };
    this.mood = 'calm';
    this.shiftView = 0.12;
    this.trailColor = '120,220,255';
    this.online = false;
    this.power = 0;
    this.yaw = 0; this.yawV = 0;
    this.lift = 0;
    this.aim = 0; this.aimUntil = 0;
  }

  load() {
    return Promise.all([loadModels(['classic']), loadEnv(HDRIS.studio), loadTextures(['concrete_floor_worn_001', 'metal_plate'])]);
  }

  build() {
    const s = this.scene;
    const low = this.app.low;
    const bg = 0x050608;
    s.background = new THREE.Color(bg);
    s.fog = new THREE.Fog(bg, 9, 30);
    // a real photographed studio for the reflections, turned down: the room's own lights do the rest
    s.environment = envMap(HDRIS.studio);
    s.environmentIntensity = 0.45;
    this.camera.fov = 38;
    this.camera.position.set(0, 1.35, 5.2);
    this.look = new THREE.Vector3(0, 1.1, 0);

    // light: a soft box straight above (area light), a daylight key with the shadow, the light bars behind
    // as rims (area lights too), and the reactor's own cyan spill in front once it is lit
    RectAreaLightUniformsLib.init();
    s.add(new THREE.HemisphereLight(0x2a3038, 0x0a0806, 0.35));
    const box = new THREE.RectAreaLight(0xfff3e6, 7, 2.6, 1.3);
    box.position.set(0, 4.6, 0.4); box.lookAt(0, 0, 0.4);
    s.add(box);
    const key = new THREE.SpotLight(0xfff1e2, 60, 16, 0.42, 0.75, 1.5);
    key.position.set(2.6, 5.4, 4.2);
    key.target.position.set(0, 1, 0);
    key.castShadow = !low;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
    s.add(key, key.target);
    for (const sx of [-1, 1]) {
      const rim = new THREE.RectAreaLight(0xffe2c4, 9, 0.25, 3.4);
      rim.position.set(sx * 2.3, 1.9, -2.6); rim.lookAt(0, 1.3, 0.3);
      s.add(rim);
    }
    // a large, dim soft box beside the camera: the gentle front light a photographer would add
    const front = new THREE.RectAreaLight(0xfff6ee, 2.2, 3.2, 2.2);
    front.position.set(-2.2, 2.2, 4.6); front.lookAt(0, 1.2, 0);
    s.add(front);
    this.fill = new THREE.PointLight(0x7fe6ff, 0, 5, 2); this.fill.position.set(0, 1.2, 1.2); s.add(this.fill);

    // the room: sealed concrete floor (a real blurred mirror), concrete walls, a ceiling of dark beams
    const floorMat = pbr('concrete_floor_worn_001', { repeat: 9, color: 0x9a9da3, roughness: 0.62, metalness: 0, normalScale: 0.7, fallback: 0x1a1c20 });
    this.floor = glossyFloor(new THREE.PlaneGeometry(40, 40), floorMat, { renderer: this.app.renderer, low, scale: 0.5, strength: 0.75, blur: 5 });
    this.floor.rotation.x = -Math.PI / 2;
    s.add(this.floor);
    const wallMat = pbr('concrete_floor_worn_001', { repeat: [5, 2], color: 0x5c6068, roughness: 1, metalness: 0, fallback: 0x15171b });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(24, 9), wallMat);
    back.position.set(0, 4.5, -5); back.receiveShadow = true;
    s.add(back);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(22, 9), wallMat);
      side.position.set(sx * 9, 4.5, 4); side.rotation.y = -sx * Math.PI / 2;
      s.add(side);
    }
    // wall panel seams and a steel skirting (thin dark boxes), merged into one mesh
    const seamMat = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.9 });
    const seams = [];
    for (let x = -10; x <= 10; x += 2.5) seams.push(new THREE.BoxGeometry(0.03, 9, 0.04).translate(x, 4.5, -4.98));
    seams.push(new THREE.BoxGeometry(24, 0.03, 0.04).translate(0, 3.2, -4.98));
    seams.push(new THREE.BoxGeometry(24, 0.18, 0.08).translate(0, 0.09, -4.96));
    const seamGeo = mergeAll(seams);
    s.add(new THREE.Mesh(seamGeo, seamMat));
    // recessed light bars in the back wall: warm white, the only bright thing in the room
    const barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe7cc).multiplyScalar(5), toneMapped: false });
    const recessMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.5, metalness: 0.6 });
    const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 3.6, 0.02), barMat, 6);
    const recesses = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 3.8, 0.1), recessMat, 6);
    const d = new THREE.Object3D();
    [-8.75, -6.25, -1.25, 1.25, 6.25, 8.75].forEach((x, k) => {
      d.position.set(x, 2.1, -4.95); d.updateMatrix(); recesses.setMatrixAt(k, d.matrix);
      d.position.z = -4.89; d.updateMatrix(); bars.setMatrixAt(k, d.matrix);
    });
    s.add(bars, recesses);
    // the ceiling: a dark slab with steel beams, and the soft box's glowing face
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.55, metalness: 0.7 });
    const beams = [];
    for (let z = -4; z <= 6; z += 2.5) beams.push(new THREE.BoxGeometry(20, 0.35, 0.18).translate(0, 6.2, z));
    s.add(new THREE.Mesh(mergeAll(beams), beamMat));
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.9 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 6.4, 1);
    s.add(ceil);
    const boxFace = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff3e6).multiplyScalar(2.2), toneMapped: false }));
    boxFace.rotation.x = Math.PI / 2; boxFace.position.set(0, 4.62, 0.4);
    const boxFrame = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 1.5), beamMat);
    boxFrame.position.set(0, 4.7, 0.4);
    s.add(boxFace, boxFrame);

    // the turntable the suit stands on: a brushed steel plate with a bevelled edge and a thin light ring
    const plate = pbr('metal_plate', { repeat: 2, color: 0x9aa0a8, roughness: 0.8, metalness: 1, fallback: 0x55595f });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.2, 0.06, 96), plate);
    table.position.y = 0.03; table.receiveShadow = true; table.castShadow = !low;
    s.add(table);
    this.padRing = new THREE.Mesh(new THREE.TorusGeometry(1.205, 0.006, 6, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdff4ff).multiplyScalar(3), toneMapped: false, transparent: true, opacity: 0.3 }));
    this.padRing.rotation.x = -Math.PI / 2; this.padRing.position.y = 0.035;
    s.add(this.padRing);
    this.table = table;

    // a faint shaft of light from the soft box, with dust drifting through it
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.9, 4.6, 48, 1, true), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xfff1e0) }, uAlpha: { value: 0.05 } },
      vertexShader: /* glsl */ `
        varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); gl_FragColor = vec4(uColor, uAlpha * f * smoothstep(0.0, 0.6, vY) * (0.4 + 0.6 * vY)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.shaft.position.set(0, 2.3, 0.4);
    s.add(this.shaft);

    // the suit
    this.suit = new RealSuit('classic', { castShadow: !low, light: true });
    this.suit.reactor = 0.15; this.suit.eyes = 0;
    this.suit.root.position.y = 0.06;
    s.add(this.suit.root);

    // dust in the light, sparks when it lifts
    this.dust = new ParticlePool({ count: 300, drag: 0.4, turbulence: 0.25, softness: 2 });
    this.sparks = new ParticlePool({ count: 400, gravity: -6, drag: 0.8, softness: 1.2 });
    s.add(this.dust.points, this.sparks.points);
    this.dustColor = new THREE.Color(0xd8cbb8);
    this.sparkColors = [new THREE.Color(0xbff6ff).multiplyScalar(3), new THREE.Color(0xffffff).multiplyScalar(3), new THREE.Color(0xffd28a).multiplyScalar(3)];
    this.beams = new Beams(s, 6);
    this.waves = new Shockwaves(s, 4);

    this._buildUI();
  }

  resize(w, hh) {
    super.resize(w, hh);
    const r = this.app.renderer;
    if (this.floor?.resizeMirror) { const v = r.getDrawingBufferSize(new THREE.Vector2()); this.floor.resizeMirror(v.x, v.y); }
  }

  _buildUI() {
    this.intro({
      kicker: 'A fan tribute',
      title: 'Iron <em>Man</em>',
      jp: 'ARC-01',
      desc: 'An engineer, a weapons maker, a man who built his way out of a cave — and then built a better self. Bring the armor online and step into the story of the suit, one system at a time.',
      extra: [
        this.gestures([['hold', '<b>Hold</b> to power up'], ['drag', '<b>Drag</b> to turn the suit']]),
        h('div.stats', {}, PROFILE.slice(0, 3).map(([k, v]) => h('div.stat', {}, h('b', { text: v }), h('span', { text: k })))),
      ],
    });
    this.btnPower = this.button('Power up', () => (this.online ? this._powerDown() : this._powerUp()), 'btn-primary');
    this.btnFace = this.button('Inspect', () => { this.inspect = !this.inspect; this.btnFace.classList.toggle('active', this.inspect); this.app.sfx.hologram(); });
    this.btnBlast = this.button('Chest beam', () => this._blast());
    this.ui.append(h('div.controls', {}, this.btnPower, h('div.group', {}, this.btnFace, this.btnBlast)));
    this.banner = h('div.big-title', {}, h('b', { text: 'Systems online' }), h('span', { text: 'All flight systems nominal' }));
    this.ui.append(this.banner);
  }

  onEnter() {
    this.app.toast('<b>Hold</b> anywhere to bring the armor online.', 3200);
  }

  enter() {
    this.yawV = 0.4;
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
  }

  _powerUp() {
    if (this.online) return;
    this.online = true;
    this.btnPower.textContent = 'Power down';
    const sfx = this.app.sfx;
    sfx.powerUp();
    this.app.flash(0.35, 0x9ff3ff);
    this.suit.reactor = 1;
    setTimeout(() => sfx.visor(), 350);
    setTimeout(() => { this.suit.eyes = 1; sfx.beep(3); }, 950);
    setTimeout(() => {
      this.suit.thrust = 0.9;
      this.waves.spawn(new THREE.Vector3(0, 0.02, 0), { radius: 4, life: 1.1 });
      this.sparks.burst(new THREE.Vector3(0, 0.05, 0), 80, { speed: 4, spread: 2, up: 1, life: [0.4, 1], size: [0.03, 0.08], colors: this.sparkColors });
      sfx.boom();
      this.app.flash(0.25, 0xbff6ff);
      this.banner.classList.remove('on'); void this.banner.offsetWidth; this.banner.classList.add('on');
    }, 1300);
    setTimeout(() => { if (this.active && this.online) this.app.toast('Online. Try the <b>Chest beam</b> — then on to <b>The Cave</b>, where it began.', 3600); }, 4600);
  }

  _powerDown() {
    this.online = false;
    this.btnPower.textContent = 'Power up';
    this.app.sfx.powerDown();
    this.suit.thrust = 0;
    this.suit.eyes = 0;
    this.suit.reactor = 0.15;
  }

  /** The chest beam: the suit turns side-on (so it crosses the frame) and fires from the reactor. */
  _blast() {
    if (!this.online) { this._powerUp(); return; }
    const dirSign = Math.random() < 0.5 ? -1 : 1;
    this.aim = dirSign * 1.3;
    this.aimUntil = performance.now() + 2000;
    this.app.sfx.charge(0.8);
    this.suit.reactor = 1.6;
    setTimeout(() => {
      this.app.sfx.charge(0);
      this.app.sfx.unibeam();
      const pos = this.suit.reactorWorld();
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.suit.root.quaternion);
      this.beams.fire(pos, pos.clone().addScaledVector(dir, 16), { width: 0.34, life: 0.9, color: 0xbff6ff });
      this.sparks.burst(pos, 30, { speed: 3, life: [0.2, 0.6], size: [0.03, 0.07], colors: this.sparkColors });
      this.app.flash(0.2, 0x9ff3ff);
    }, 650);
    setTimeout(() => { this.suit.reactor = 1; }, 1600);
  }

  pointerMove(p) {
    if (p.down) this.yawV = p.dx * 0.01;
  }

  update(dt, t) {
    const app = this.app;
    // hold to power up
    const hold = this.trackHold(1.4, !this.online);
    this.power = damp(this.power, hold.progress, 8, dt);
    if (!this.online) {
      this.suit.reactor = 0.15 + this.power * 0.85;
      this.fill.intensity = this.power * 6;
      this.grade.tintAmt = this.power * 0.15;
    } else {
      this.fill.intensity = damp(this.fill.intensity, 2, 3, dt);
      this.grade.tintAmt = damp(this.grade.tintAmt, 0, 2, dt);
    }
    if (hold.fired) this._powerUp();

    // turning: drag, with inertia; a slow idle turn otherwise
    if (performance.now() < this.aimUntil) {
      this.yawV = 0;
      this.yaw = damp(this.yaw, this.aim, 9, dt);
    } else {
      if (!app.pointer.down) this.yawV = damp(this.yawV, 0.12 * dt * 2, 1.5, dt);
      this.yaw += this.yawV;
      this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
      if (!app.pointer.down && Math.abs(this.yaw) > 0.9) this.yaw = damp(this.yaw, Math.sign(this.yaw) * 0.9, 2, dt);
    }
    this.suit.root.rotation.y = this.yaw;

    // lift-off and hover bob
    this.lift = damp(this.lift, this.online ? 0.55 + Math.sin(t * 1.6) * 0.05 : 0, this.online ? 1.8 : 3, dt);
    this.suit.root.position.y = 0.06 + this.lift;
    app.sfx.thrust(this.active ? this.suit._shown.thrust * 0.7 : 0);
    this.suit.update(dt);
    this.padRing.material.opacity = 0.25 + this.suit._shown.reactor * 0.35 + this.suit._shown.thrust * 0.4;
    this.shaft.material.uniforms.uAlpha.value = 0.045 + this.power * 0.02;

    // sparks and heat shimmer at the boots while hovering
    if (this.suit._shown.thrust > 0.3 && Math.random() < dt * 30) {
      this.sparks.emit({ x: rand(-0.2, 0.2), y: 0.07, z: rand(-0.2, 0.2), vx: rand(-2, 2), vy: rand(0.5, 1.5), vz: rand(-2, 2), life: rand(0.3, 0.7), size: rand(0.02, 0.05), color: this.sparkColors[0] });
    }
    if (Math.random() < dt * 20) this.dust.emit({ x: rand(-4, 4), y: rand(0, 3.5), z: rand(-3, 2), vx: rand(-0.05, 0.05), vy: rand(-0.02, 0.05), life: rand(3, 6), size: rand(0.02, 0.05), color: this.dustColor, alpha: 0.5 });
    this.dust.update(dt, t);
    this.sparks.update(dt, t);
    this.beams.update(dt, this.camera);
    this.waves.update(dt);


    // camera: a gentle parallax with the pointer
    const px = app.pointer.ndc.x, py = app.pointer.ndc.y;
    const cam = this.camera;
    const near = this.inspect ? 1 : 0;
    this.zoom = damp(this.zoom || 0, near, 2.5, dt);
    const z = this.zoom;
    cam.position.x = damp(cam.position.x, px * (0.5 - z * 0.3), 2, dt);
    cam.position.y = damp(cam.position.y, 1.35 + py * 0.25 + this.lift * 0.4 + z * 0.25, 2, dt);
    cam.position.z = damp(cam.position.z, 5.2 - z * 3.1, 2.5, dt);
    this.look.y = damp(this.look.y, 1.1 + this.lift * 0.7 + z * 0.38, 2, dt);
    cam.lookAt(this.look);
    app.setHover(false);
  }
}


function mergeAll(geos) {
  const g = mergeGeometries(geos);
  geos.forEach((x) => x.dispose());
  return g;
}
