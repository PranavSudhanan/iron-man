import { Tilt, ripple, enableHaptics } from './Mobile.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { createCinematicPass } from './CinematicPass.js';
import { sfx } from './Audio.js';
import { shared, damp, h } from './utils.js';
import { suitEnvironment } from '../objects/Suit.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 60); });
const HOLD_SLOP = 14; // px of movement allowed while "holding"

export class App {
  constructor() {
    this.canvas = document.getElementById('webgl');
    this.hud = document.getElementById('hud');
    this.sfx = sfx;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.isMobile = this.isTouch || Math.min(innerWidth, innerHeight) < 600;
    this.low = this.isMobile;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.phoneLayout = matchMedia('(max-width: 760px), (max-height: 560px) and (orientation: landscape)');
    // phones: tilt that each scene maps to its own motion, a ripple under every touch, haptics on the big moments
    this.tilt = new Tilt();
    if (this.isTouch) enableHaptics(sfx);
    // the mobile HUD sits above each chapter's control bar, whatever its height
    this._ctrlObserver = new ResizeObserver((entries) => {
      for (const e of entries) this._measureControls(e.target.closest('.chapter-ui'));
    });
    this.width = innerWidth;
    this.height = innerHeight;

    // Antialiasing on the default framebuffer is wasted with post-processing; MSAA lives on the composer target instead.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.maxDpr = Math.min(devicePixelRatio, this.low ? 1.25 : 1.5);
    this.minDpr = this.low ? 0.6 : 0.75;
    this.dpr = this.maxDpr;
    // checking each new shader for errors makes the page wait for the GPU to finish compiling it; in a
    // production build the shaders are known good, so compilation can run in the background instead
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(0x07030a, 1);
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // No MSAA: on a floating-point target it multiplies the cost of drawing the scene (measured 3–6x on
    // integrated GPUs), for edges a cheap FXAA pass at the end smooths almost as well
    this.msaa = 0;
    const rt = new THREE.WebGLRenderTarget(this.width * this.dpr, this.height * this.dpr, {
      type: THREE.HalfFloatType,
      samples: this.msaa,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.9, 0.5, 0.75);
    // bloom is a blur — run it at half the composer's resolution (quarter the pixels)
    const bloomSetSize = this.bloomPass.setSize.bind(this.bloomPass);
    this.bloomPass.setSize = (w, hh) => bloomSetSize(Math.max(2, Math.round(w * 0.5)), Math.max(2, Math.round(hh * 0.5)));
    // Bloom takes only the light *above* the threshold, capped: a very bright source (an HDR beam, a reactor)
    // gets a strong but bounded glow instead of washing out the screen, and ordinary highlights none at all.
    this.bloomPass.materialHighPassFilter.fragmentShader = /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec3 defaultColor; uniform float defaultOpacity;
      uniform float luminosityThreshold; uniform float smoothWidth;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D( tDiffuse, vUv );
        float v = luminance( texel.xyz );
        float excess = min( max( v - luminosityThreshold, 0.0 ), 1.6 );
        float k = smoothstep( 0.0, smoothWidth, v - luminosityThreshold );
        gl_FragColor = vec4( texel.rgb * ( excess / max( v, 1e-4 ) ) * k, 1.0 );
      }`;
    this.bloomPass.materialHighPassFilter.needsUpdate = true;
    this.perf = { acc: 0, frames: 0, cooldown: 2, bad: 0, good: 0, ceiling: this.maxDpr, ceilingUntil: 0 };
    this.cinePass = createCinematicPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.cinePass);
    this.composer.addPass(new OutputPass());
    if (!this.msaa) this.composer.addPass(new FXAAPass()); // runs on the final, tone-mapped image
    this.passesCompiled = this._warmPasses();
    this.flashAmt = 0;
    this._tint = new THREE.Color();

    this.chapters = [];
    this.index = -1;
    this.busy = false;
    this.raycaster = new THREE.Raycaster();
    this.pointer = {
      ndc: new THREE.Vector2(), x: this.width / 2, y: this.height / 2,
      down: false, dx: 0, dy: 0, moved: 0, startTime: 0, id: null, type: 'mouse',
      holdTime: 0, path: [], startX: 0, startY: 0,
    };
    this.hovering = false;

    this.cursor = document.getElementById('cursor');
    this.toastEl = document.getElementById('toast');
    // cinematic letterbox bars
    const lb = document.createElement('div');
    lb.id = 'letterbox';
    document.body.append(lb);
    this.overlay = document.getElementById('transition');
    this.navEl = document.getElementById('nav');
    this.countEl = document.getElementById('chapter-count');

    // chakra trail overlay + charge ring
    this.trailCanvas = document.getElementById('trail');
    this.trailCtx = this.trailCanvas.getContext('2d');
    this.trail = [];
    this.chargeEl = document.getElementById('charge');
    this.chargeFg = this.chargeEl.querySelector('.fg');
    this._chargeSet = false;

    if (!this.isTouch && !this.reducedMotion) document.body.classList.add('has-cursor');
    this._bindEvents();
    this._bindAudioUI();
    this._resizeTrail();
    this._updatePointScale();
  }

  get current() {
    return this.chapters[this.index];
  }

  add(chapter) {
    this.chapters.push(chapter);
    this.hud.append(chapter.ui);
    return chapter;
  }

  /* ---------------- navigation ---------------- */

  buildNav() {
    this.navEl.innerHTML = '';
    this.navItems = this.chapters.map((c, i) => {
      const b = h('button.nav-item', { type: 'button', 'aria-label': `Chapter ${i + 1}: ${c.title}` },
        h('span.nav-num', { text: String(i + 1).padStart(2, '0') }),
        h('span.nav-label', { text: c.title }),
        h('span.nav-dot'),
      );
      b.addEventListener('click', () => { this.sfx.click(); this.goTo(i); });
      this.navEl.append(b);
      return b;
    });
    document.getElementById('prev-btn').addEventListener('click', () => this.prev());
    document.getElementById('next-btn').addEventListener('click', () => this.next());
    document.querySelectorAll('[data-goto]').forEach((el) =>
      el.addEventListener('click', () => this.goTo(+el.dataset.goto)));
  }

  _syncNav() {
    this.navItems.forEach((b, i) => {
      b.classList.toggle('active', i === this.index);
      if (i === this.index) {
        b.setAttribute('aria-current', 'step');
        if (this.isMobile) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      } else b.removeAttribute('aria-current');
    });
    this.countEl.textContent = `${String(this.index + 1).padStart(2, '0')} / ${String(this.chapters.length).padStart(2, '0')}`;
    const id = this.current.id;
    if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
  }

  /** Fetches whatever the chapter needs before it can build (models); resolves at once when there is nothing. */
  prepare(ch) {
    if (ch.built) return Promise.resolve();
    if (!ch._loading) ch._loading = Promise.resolve(ch.load()).catch(() => null);
    return ch._loading;
  }

  ensureBuilt(ch) {
    if (ch.built) return;
    ch.build();
    ch.built = true;
    // every scene is lit by a real environment: its own HDRI, or the default studio
    if (!ch.scene.environment) ch.scene.environment = suitEnvironment();
    this._dockCards(ch);
    this._minimizers(ch);
    this._tuneShadows(ch.scene);
    ch.resize(this.width, this.height);
    this._precompile(ch);
  }

  /**
   * Info cards live in the chapter's text column (under its title, where the intro is), never over the
   * scene: each scene is framed to the right of that column, so the 3D stays free to touch. While a card
   * is open, the intro's description steps aside for it.
   */
  _dockCards(ch) {
    const intro = ch.ui.querySelector(':scope > .intro');
    if (!intro) return;
    ch.ui.querySelectorAll(':scope > .card, :scope > .timeline-card').forEach((card) => {
      card.classList.add('docked');
      intro.append(card);
    });
  }

  /** Every info card gets a small button that folds it down to its title (so it never has to cover the scene). */
  _minimizers(ch) {
    // a panel remembers being minimised (per chapter and panel); on smaller screens they start minimised
    const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { /* private mode */ } return null; };
    const small = innerWidth < 1100 || innerHeight < 700;
    ch.ui.querySelectorAll('.card, .timeline-card').forEach((card, i) => {
      if (card.querySelector(':scope > .card-min')) return;
      const key = `im-min:${ch.id}:${i}`;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card-min';
      const set = (min) => {
        card.classList.toggle('min', min);
        b.textContent = min ? '+' : '–';
        b.setAttribute('aria-label', min ? 'Expand this panel' : 'Minimise this panel');
      };
      const saved = store(key);
      set(saved !== null ? saved === '1' : small && !this.phoneLayout.matches);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const min = !card.classList.contains('min');
        set(min);
        store(key, min ? '1' : '0');
        this.sfx.click();
      });
      card.prepend(b);
    });
  }

  /**
   * One standard for every shadow in the app: soft penumbrae (PCF with a blur radius) instead of hard,
   * aliased edges; a small depth bias and a normal bias so surfaces don't speckle with self-shadowing
   * ("acne") and shadows stay attached to what casts them; and sharper maps where the device can afford it.
   * A chapter's own explicit settings win.
   */
  _tuneShadows(scene) {
    scene.traverse((o) => {
      if (!o.isLight || !o.castShadow || !o.shadow) return;
      const sh = o.shadow;
      if (!this.low && sh.mapSize.x < 2048) sh.mapSize.set(2048, 2048);
      if (!sh.bias) sh.bias = o.isDirectionalLight ? -0.0004 : -0.0006;
      if (!sh.normalBias) sh.normalBias = o.isDirectionalLight ? 0.035 : 0.02;
      if (sh.radius <= 1) sh.radius = o.isDirectionalLight ? 3.5 : 4;
      sh.blurSamples = 12;
      sh.map?.dispose();
      sh.map = null; // rebuilt at the new size
    });
  }

  /**
   * Compiles every shader a chapter will ever need — including hidden effects (blasts, explosions,
   * the suit before it appears) — so nothing stalls the first time it shows up.
   * Uses the non-blocking compileAsync (KHR_parallel_shader_compile) when available.
   * A chapter whose set of lights changes as you use it (a room with its own lamps) lists those lighting
   * states in `lightStates` (functions that apply a state and return its undo), and each is compiled too.
   */
  _precompile(ch) {
    const jobs = [];
    for (const state of [null, ...(ch.lightStates || [])]) {
      const undo = state?.();
      try { jobs.push(this._compileScene(ch.scene, ch.camera)); } finally { undo?.(); }
    }
    // until they are ready the chapter is not drawn: drawing would wait on the compiler and freeze the page
    ch.compiling = true;
    ch._compiled = Promise.all(jobs).then(() => {
      // shadow shaders are only made when a shadow is first drawn: draw each extra lighting state once
      // now (behind the veil), so its lamps' shadows are ready too
      for (const state of ch.lightStates || []) {
        const undo = state();
        const prev = this.renderer.getRenderTarget();
        try {
          this.renderer.setRenderTarget(this.composer.readBuffer);
          this.renderer.render(ch.scene, ch.camera);
        } catch (_) { /* drawn on first use instead */ } finally {
          this.renderer.setRenderTarget(prev);
          undo();
        }
      }
      ch.compiling = false;
    });
  }

  _compileScene(scene, camera) {
    // Lights are left as they are: the number of lights is compiled into every shader, so an extra light
    // shown here would build variants the scene never uses. Lights inside hidden groups stay off too.
    const lit = new Set();
    scene.traverseVisible((o) => { if (o.isLight) lit.add(o); });
    const hidden = [], darkened = [];
    scene.traverse((o) => { if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; } });
    scene.traverse((o) => { if (o.isLight && o.visible && !lit.has(o)) { darkened.push(o); o.visible = false; } });
    // Shader variants depend on where they draw: the scene draws into the composer's buffer (linear, no
    // tone mapping), not to the screen, so compile with that buffer bound or the wrong variants get built
    // and the real ones compile, blocking, on the first frame.
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.readBuffer);
    try {
      if (this.renderer.compileAsync) return this.renderer.compileAsync(scene, camera).catch(() => {});
      this.renderer.compile(scene, camera);
    } catch (_) { /* compiled on first use instead */ } finally {
      // the programs are already queued; visibility can go back at once
      this.renderer.setRenderTarget(prevTarget);
      hidden.forEach((o) => { o.visible = false; });
      darkened.forEach((o) => { o.visible = true; });
    }
    return Promise.resolve();
  }

  /**
   * Compiles the post-processing shaders (bloom, grade, output, edge smoothing) in parallel up front,
   * instead of one after another, blocking, on the first frames. Each is built for both kinds of target
   * (an off-screen buffer and the screen), since passes draw to either.
   */
  _warmPasses() {
    if (!this.renderer.compileAsync) return Promise.resolve();
    // the output pass picks its tone-mapping and colour-space defines on its first render: let it, without drawing
    for (const pass of this.composer.passes) {
      const quad = pass._fsQuad;
      if (!(pass instanceof OutputPass) || !quad) continue;
      const draw = quad.render;
      quad.render = () => {};
      try { pass.render(this.renderer, this.composer.writeBuffer, this.composer.readBuffer); } finally { quad.render = draw; }
    }
    const mats = new Set();
    const collect = (v) => {
      if (!v) return;
      if (v.isMaterial) mats.add(v);
      else if (Array.isArray(v)) v.forEach(collect);
    };
    for (const pass of this.composer.passes) {
      for (const v of Object.values(pass)) collect(v);
      collect(pass.fsQuad?.material);
    }
    // the same attributes as the passes' full-screen triangle (no normals: they are part of the shader variant)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    for (const m of mats) { const q = new THREE.Mesh(geo, m); q.frustumCulled = false; scene.add(q); }
    const prev = this.renderer.getRenderTarget();
    const jobs = [];
    try {
      for (const target of [this.composer.readBuffer, null]) {
        this.renderer.setRenderTarget(target);
        jobs.push(this.renderer.compileAsync(scene, cam).catch(() => {}));
      }
    } catch (_) { /* compiled on first use instead */ }
    this.renderer.setRenderTarget(prev);
    return Promise.all(jobs).then(() => geo.dispose());
  }

  /** Draws a built chapter once off-screen, so its textures and shadow maps are on the GPU before it shows. */
  warm(ch) {
    if (!ch.built || ch.compiling) return;
    const prev = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(this.composer.readBuffer);
      this.renderer.render(ch.scene, ch.camera);
    } catch (_) { /* drawn on first use instead */ } finally {
      this.renderer.setRenderTarget(prev);
    }
  }

  /** Publishes the height of a chapter's control bar (the tallest one showing) as --ctrl-h. */
  _measureControls(ui) {
    if (!ui) return;
    let hgt = 0;
    ui.querySelectorAll('.controls').forEach((c) => { hgt = Math.max(hgt, c.offsetHeight); });
    ui.style.setProperty('--ctrl-h', `${Math.round(hgt)}px`);
  }

  /** Phones: each chapter's guides show on arrival, then tuck away (a "Guide" pill brings them back). */
  _guides(ch) {
    const intro = ch.ui.querySelector('.intro');
    if (!intro) return;
    clearTimeout(this._tuckT);
    intro.classList.remove('tucked', 'show-guide');
    if (this.phoneLayout.matches) this._tuckT = setTimeout(() => intro.classList.add('tucked'), 9000);
  }

  _tuck() {
    if (!this.phoneLayout.matches) return;
    const intro = this.current?.ui.querySelector('.intro');
    if (!intro || intro.classList.contains('tucked')) return;
    clearTimeout(this._tuckT);
    this._tuckT = setTimeout(() => intro.classList.add('tucked'), 900);
  }

  _activate(i) {
    const ch = this.chapters[i];
    this.ensureBuilt(ch);
    this.index = i;
    ch.resize(this.width, this.height);
    ch.active = true;
    ch.enter();
    ch.ui.classList.add('active');
    ch.ui.querySelectorAll('.controls').forEach((c) => this._ctrlObserver.observe(c));
    this._measureControls(ch.ui);
    this._guides(ch);
    this.renderPass.scene = ch.scene;
    this.renderPass.camera = ch.camera;
    this.bloomPass.strength = ch.bloom.strength;
    this.bloomPass.radius = ch.bloom.radius;
    this.bloomPass.threshold = ch.bloom.threshold;
    this.setHover(false);
    this.sfx.setScene(ch.id, ch.mood);
    this._syncNav();
    // a new scene has its own cost: measure afresh before changing the resolution
    Object.assign(this.perf, { acc: 0, frames: 0, cooldown: 2, bad: 0, good: 0, ceilingUntil: 0 });
  }

  start(i = 0) {
    this._activate(i);
    this._last = performance.now();
    this._t = 0;
    requestAnimationFrame(this._tick);
  }

  /** The veil between chapters shows where you are going: its number, name and kanji. */
  _titleCard(ch, i) {
    if (!this._tc) {
      this._tc = h('div.t-card', {}, h('span.t-num'), h('b.t-title'), h('span.t-jp'));
      this.overlay.append(this._tc);
    }
    const [num, title, jp] = this._tc.children;
    num.textContent = `${String(i + 1).padStart(2, '0')} / ${String(this.chapters.length).padStart(2, '0')}`;
    title.textContent = ch.title;
    jp.textContent = ch.jp || '';
  }

  async goTo(i, dir = 0) {
    const n = this.chapters.length;
    const raw = i;
    i = ((i % n) + n) % n;
    if (i === this.index || this.busy) return;
    this.busy = true;
    dir = dir || Math.sign(raw - this.index) || 1;
    this.sfx.whoosh();
    // a hint belongs to the page it was shown on
    clearTimeout(this._toastT); this.toastEl.classList.remove('show'); document.body.classList.remove('toasting'); this._clearUnderToast();
    if (this.isTouch) try { navigator.vibrate?.(8); } catch (_) { /* not allowed */ }
    this._titleCard(this.chapters[i], i);
    const ov = this.overlay;
    // a film cut: the lens racks out of focus as the picture dips to black (opacity and a filter only:
    // compositor work, smooth even while the next chapter builds), the next title shows, and the new scene
    // fades up from black while the focus pulls back in
    if (!this.reducedMotion) this.canvas.classList.add('defocus');
    ov.classList.add('show');
    // the next chapter's models download while the picture fades
    const ready = this.prepare(this.chapters[i]);
    await wait(this.reducedMotion ? 50 : 620);
    await ready;
    const old = this.current;
    old.active = false;
    old.exit();
    old.ui.classList.remove('active');
    document.getElementById('blood').classList.remove('on');
    this.canvas.classList.remove('blurred');
    this.sfx.charge(0);
    this.trail.length = 0;
    this._activate(i);
    // hold the veil until the new scene's shaders are ready, so it doesn't stutter as it is revealed
    if (this.current.compiling) await Promise.race([this.current._compiled, wait(5000)]);
    await frame();
    await frame();
    ov.classList.remove('show');
    this.canvas.classList.remove('defocus');
    await wait(this.reducedMotion ? 50 : 700);
    this.busy = false;
  }

  next() { this.goTo(this.index + 1, 1); }
  prev() { this.goTo(this.index - 1, -1); }

  /* ---------------- helpers ---------------- */

  /**
   * The phone's tilt when the gyroscope is live (x: tilted right +, y: top tilted toward you +, both about
   * -1..1), else null. Chapters map it to something in their own scene.
   */
  get gyro() { return this.tilt.active && !this.reducedMotion ? this.tilt : null; }

  raycast(objects, recursive = true, ndc = this.pointer.ndc) {
    this.raycaster.setFromCamera(ndc, this.current.camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  setHover(on) {
    if (on === this.hovering) return;
    this.hovering = on;
    this.cursor.classList.toggle('hover', on);
    this.canvas.style.cursor = on ? 'pointer' : '';
  }

  /** Shows the radial charge ring at the pointer (call every frame while charging). */
  setCharge(p, x = this.pointer.x, y = this.pointer.y) {
    if (p <= 0) return;
    this._chargeSet = true;
    this.chargeEl.style.transform = `translate(${x}px, ${y}px)`;
    this.chargeEl.classList.add('on');
    this.chargeFg.style.strokeDashoffset = String(163.4 * (1 - Math.min(1, p)));
    this.chargeEl.classList.toggle('full', p >= 1);
  }

  flash(amount = 0.6, color = 0xffffff) {
    this.flashAmt = Math.max(this.flashAmt, amount);
    this.cinePass.uniforms.uFlashColor.value.set(color);
  }

  /** Letterbox bars in, chapter UI out, while a cinematic plays. */
  cinema(on) { document.body.classList.toggle('cinema', !!on); }

  toast(html, ms = 3200) {
    this.toastEl.innerHTML = html;
    this._placeToast();
    this.toastEl.classList.add('show');
    document.body.classList.add('toasting');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { this.toastEl.classList.remove('show'); document.body.classList.remove('toasting'); this._clearUnderToast(); }, ms);
  }

  /** Moves the showing hint only if a panel now covers it. */
  _keepToastClear() {
    const r = this.toastEl.getBoundingClientRect();
    const ui = this.current?.ui;
    if (!ui) return;
    for (const c of ui.children) {
      if (getComputedStyle(c).display === 'none' || c.classList.contains('hidden') || c.classList.contains('hd-el') || c.classList.contains('under-toast')) continue;
      const p = c.getBoundingClientRect();
      if (p.width > innerWidth * 0.95 && p.height > innerHeight * 0.95) continue;
      if (Math.min(r.right, p.right) - Math.max(r.left, p.left) > 2 && Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top) > 2) { this._placeToast(); return; }
    }
  }

  /**
   * The toast goes where it covers nothing: under the top bar, just above the controls, or any clear band
   * between (scanning up from the controls). In a band where the full-width toast doesn't fit, it narrows
   * into the widest free gap between the panels (at least 260 px). Failing all that, where it covers least.
   */
  _placeToast() {
    const t = this.toastEl;
    const panels = [], els = [];
    const ui = this.current?.ui;
    if (ui) {
      for (const c of ui.children) {
        // (not opacity: a chapter's panels are usually still fading in when its first hint shows)
        if (getComputedStyle(c).display === 'none' || c.classList.contains('hidden') || c.classList.contains('hd-el')) continue;
        const r = c.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || (r.width > innerWidth * 0.95 && r.height > innerHeight * 0.95)) continue;
        panels.push(r);
        els.push(c);
      }
    }
    this._clearUnderToast();
    t.style.top = ''; t.style.bottom = ''; t.style.left = ''; t.style.maxWidth = '';
    const natW = Math.min(t.offsetWidth || 400, innerWidth - 32), natH = t.offsetHeight || 48;
    const top0 = this.phoneLayout.matches ? 64 : 84;
    const cssTop = t.getBoundingClientRect().top || innerHeight - natH - 140;
    const tops = [top0, cssTop];
    for (let y = innerHeight - natH - 150; y > top0; y -= 20) tops.push(y);
    const edgeL = 16, edgeR = innerWidth - (this.phoneLayout.matches ? 16 : 90); // (clear of the chapter nav)
    // the free horizontal gaps in a band
    const gaps = (y0, h) => {
      const busy = panels.filter((r) => Math.min(y0 + h, r.bottom) - Math.max(y0, r.top) > 0).map((r) => [r.left, r.right]).sort((p, q) => p[0] - q[0]);
      const out = []; let x = edgeL;
      for (const [l, r] of busy) { if (l - x > 0) out.push([x, l]); x = Math.max(x, r); }
      if (edgeR - x > 0) out.push([x, edgeR]);
      return out;
    };
    const cover = (y0, h, l, r) => panels.reduce((sum, p) => { const ow = Math.min(r, p.right) - Math.max(l, p.left), oh = Math.min(y0 + h, p.bottom) - Math.max(y0, p.top); return sum + (ow > 0 && oh > 0 ? ow * oh : 0); }, 0);
    const cx = innerWidth / 2;
    // 1. full width, centred
    for (const y of tops) {
      if (cover(y, natH, cx - natW / 2, cx + natW / 2) === 0) { t.style.top = `${Math.round(y)}px`; t.style.bottom = 'auto'; return; }
    }
    // 2. narrowed into a gap (taller as its text wraps)
    for (const y of tops) {
      const h = natH * Math.ceil(natW / 260) + 8;
      const g = gaps(y, h).filter(([l, r]) => r - l >= 276).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
      if (!g) continue;
      const w = Math.min(natW, g[1] - g[0] - 16);
      t.style.top = `${Math.round(y)}px`; t.style.bottom = 'auto';
      t.style.maxWidth = `${Math.round(w)}px`;
      t.style.left = `${Math.round((g[0] + g[1]) / 2)}px`;
      return;
    }
    // 3. where it covers least; the panels under it step back while it shows
    let best = top0, least = Infinity;
    for (const y of tops) { const c = cover(y, natH, cx - natW / 2, cx + natW / 2); if (c < least) { least = c; best = y; } }
    t.style.top = `${Math.round(best)}px`; t.style.bottom = 'auto';
    panels.forEach((p, i) => {
      if (Math.min(cx + natW / 2, p.right) - Math.max(cx - natW / 2, p.left) > 0 && Math.min(best + natH, p.bottom) - Math.max(best, p.top) > 0) els[i].classList.add('under-toast');
    });
  }

  _clearUnderToast() { document.querySelectorAll('.under-toast').forEach((e) => e.classList.remove('under-toast')); }

  bleed() {
    const b = document.getElementById('blood');
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout(this._bleedT);
    this._bleedT = setTimeout(() => b.classList.remove('on'), 2600);
  }

  /* ---------------- events ---------------- */

  _setPointer(e) {
    const p = this.pointer;
    p.dx = e.clientX - p.x;
    p.dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.ndc.set((e.clientX / this.width) * 2 - 1, -(e.clientY / this.height) * 2 + 1);
  }

  _bindEvents() {
    const c = this.canvas;
    const p = this.pointer;

    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (p.id !== null && p.id !== e.pointerId) return;
      this.sfx.unlock();
      p.id = e.pointerId;
      p.type = e.pointerType;
      try { c.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      this._setPointer(e);
      p.dx = p.dy = 0;
      p.down = true;
      p.moved = 0;
      p.holdTime = 0;
      p.startTime = performance.now();
      p.startX = e.clientX;
      p.startY = e.clientY;
      p.path = [{ x: e.clientX, y: e.clientY, t: p.startTime }];
      this.cursor.classList.add('down');
      // (a press or a drag, not a quick tap, fades the panels)
      clearTimeout(this._interactT);
      this._interactT = setTimeout(() => document.body.classList.add('interacting'), 260);
      if (e.pointerType === 'touch') { ripple(e.clientX, e.clientY); this._tuck(); }
      if (!this.busy) this.current?.pointerDown(p);
    });

    c.addEventListener('pointermove', (e) => {
      if (p.id !== null && e.pointerId !== p.id) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      this._setPointer(e);
      if (p.down) {
        p.moved += Math.abs(p.dx) + Math.abs(p.dy);
        if (p.moved > 12) document.body.classList.add('interacting');
        const now = performance.now();
        for (const ev of events.length ? events : [e]) {
          p.path.push({ x: ev.clientX, y: ev.clientY, t: now });
          if (this.current?.trail !== false) this.trail.push({ x: ev.clientX, y: ev.clientY, t: now });
        }
        if (p.path.length > 400) p.path.splice(0, p.path.length - 400);
      }
      if (!this.busy) this.current?.pointerMove(p);
    });

    const up = (e) => {
      if (e.pointerId !== p.id) return;
      clearTimeout(this._interactT);
      if (document.body.classList.contains('interacting')) this._interactT = setTimeout(() => document.body.classList.remove('interacting'), 900);
      p.id = null;
      this.cursor.classList.remove('down');
      if (!p.down) return;
      p.down = false;
      this._setPointer(e);
      if (this.busy) return;
      const ch = this.current;
      ch?.pointerUp(p);
      const swipe = this._detectSwipe(p);
      let consumed = false;
      if (swipe) consumed = !!ch?.swipe(swipe);
      if (!consumed && p.moved < 10 && performance.now() - p.startTime < 450) ch?.click(p);
      if (e.pointerType !== 'mouse') this.setHover(false);
      p.holdTime = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    window.addEventListener('mousemove', (e) => {
      this.cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    }, { passive: true });

    document.addEventListener('mouseover', (e) => {
      if (e.target.closest && e.target.closest('button, a, .sign, .option, .trivia-card')) this.cursor.classList.add('hover');
      else if (e.target === c) this.cursor.classList.toggle('hover', this.hovering);
      else this.cursor.classList.remove('hover');
    });

    let wheelAcc = 0;
    let wheelLock = 0;
    window.addEventListener('wheel', (e) => {
      if (e.target.closest && e.target.closest('.card, .quiz, .signs-panel, #nav')) return;
      if (this.busy) { e.preventDefault(); return; }
      if (this.current?.wheel(e)) { e.preventDefault(); return; }
      const now = performance.now();
      if (now < wheelLock) return;
      wheelAcc += e.deltaY;
      clearTimeout(this._wheelReset);
      this._wheelReset = setTimeout(() => (wheelAcc = 0), 200);
      if (Math.abs(wheelAcc) > 120) {
        wheelLock = now + 1300;
        wheelAcc > 0 ? this.next() : this.prev();
        wheelAcc = 0;
      }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      if (e.key === 'm' || e.key === 'M') { this.sfx.unlock(); this.sfx.toggleMute(); return; }
      if (this.current?.key(e)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') this.next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.prev();
    });
    window.addEventListener('keyup', (e) => this.current?.keyUp?.(e));

    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 200));
  }

  _detectSwipe(p) {
    const path = p.path;
    if (path.length < 3) return null;
    const last = path[path.length - 1];
    const now = performance.now();
    let i = path.length - 1;
    while (i > 0 && now - path[i].t < 140) i--;
    const from = path[i];
    const dt = Math.max(16, last.t - from.t || now - from.t);
    const vx = (last.x - from.x) / dt;
    const vy = (last.y - from.y) / dt;
    const speed = Math.hypot(vx, vy);
    const dx = last.x - p.startX;
    const dy = last.y - p.startY;
    const dist = Math.hypot(dx, dy);
    if (dist < 45 || speed < 0.45) return null;
    return { x0: p.startX, y0: p.startY, x1: last.x, y1: last.y, dx, dy, vx, vy, speed, dist, path: path.slice() };
  }

  _bindAudioUI() {
    const soundBtn = document.getElementById('sound-btn');
    const musicBtn = document.getElementById('music-btn');
    const sync = () => {
      soundBtn.setAttribute('aria-pressed', String(!this.sfx.muted));
      soundBtn.setAttribute('aria-label', this.sfx.muted ? 'Unmute all sound (M)' : 'Mute all sound (M)');
      musicBtn.setAttribute('aria-pressed', String(this.sfx.musicOn && !this.sfx.muted));
      musicBtn.setAttribute('aria-label', this.sfx.musicOn ? 'Turn music off' : 'Turn music on');
    };
    soundBtn.addEventListener('click', () => { this.sfx.unlock(); this.sfx.toggleMute(); });
    musicBtn.addEventListener('click', () => {
      this.sfx.unlock();
      if (this.sfx.muted) { this.sfx.setMuted(false); this.sfx.setMusic(true); } else this.sfx.toggleMusic();
    });
    this.sfx.onChange(sync);
    sync();
  }

  /** Keeps the frame rate high: lowers the render resolution when frames get slow, raises it when there is headroom. */
  _adapt(frameTime) {
    const p = this.perf;
    if (document.hidden || this.busy || this.current?.compiling || frameTime > 0.25) return;
    p.acc += frameTime;
    p.frames++;
    if (p.acc < 1) return;
    const avg = p.acc / p.frames;
    p.acc = 0;
    p.frames = 0;
    if (p.cooldown > 0) { p.cooldown--; return; }
    // Every change reallocates the render targets (a hitch of its own), so it only changes on a sustained
    // trend: two slow seconds in a row to step down, four fast ones to step up. After a step down the
    // resolution that was too slow is not tried again for a while, so it never see-saws.
    if (avg > 1 / 50) { p.bad++; p.good = 0; } else if (avg < 1 / 58) { p.good++; p.bad = 0; } else { p.bad = p.good = 0; }
    let next = this.dpr;
    // a chapter with text to read can ask for a higher floor (see Chapter.minDpr)
    const floor = Math.min(this.maxDpr, Math.max(this.minDpr, this.current?.minDpr || 0));
    const now = performance.now();
    // far too slow (under 30 fps) acts after one second; the step is sized from the frame time (the cost
    // goes with the pixel count, the square of the ratio), so it lands near 60 fps in one move, not five
    if ((p.bad >= 2 || (p.bad >= 1 && avg > 1 / 30)) && this.dpr > floor + 0.01) {
      const k = Math.min(0.9, Math.max(0.6, Math.sqrt((1 / 55) / avg)));
      next = Math.max(floor, this.dpr * k);
      p.ceiling = next;
      p.ceilingUntil = now + 30000;
    } else if (p.good >= 4 && this.dpr < this.maxDpr) {
      const cap = now < p.ceilingUntil ? p.ceiling : this.maxDpr;
      next = Math.min(cap, this.dpr + 0.1);
    }
    if (Math.abs(next - this.dpr) > 0.01) {
      p.bad = p.good = 0;
      this.dpr = next;
      this.renderer.setPixelRatio(next);
      this.composer.setPixelRatio(next);
      this._resize();
      p.cooldown = 2;
    }
  }

  _updatePointScale() {
    const dpr = this.renderer.getPixelRatio();
    shared.uPointScale.value = (dpr * this.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(25));
    this.cinePass.uniforms.uRes.value.set(this.width * dpr, this.height * dpr);
  }

  _resizeTrail() {
    const dpr = Math.min(devicePixelRatio, 1.5);
    this.trailCanvas.width = this.width * dpr;
    this.trailCanvas.height = this.height * dpr;
    this.trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _resize() {
    this.width = innerWidth;
    this.height = innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
    this._resizeTrail();
    this._updatePointScale();
    for (const ch of this.chapters) if (ch.built) ch.resize(this.width, this.height);
    if (this.current) this._measureControls(this.current.ui);
  }

  _drawTrail(now) {
    const ctx = this.trailCtx;
    const life = 320;
    while (this.trail.length && now - this.trail[0].t > life) this.trail.shift();
    if (!this.trail.length && !this._trailDirty) return;
    ctx.clearRect(0, 0, this.width, this.height);
    this._trailDirty = this.trail.length > 0;
    if (this.trail.length < 2) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const color = this.current?.trailColor || '120,220,255';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1], b = this.trail[i];
      const k = 1 - (now - b.t) / life;
      if (k <= 0) continue;
      ctx.strokeStyle = `rgba(${color},${k * 0.22})`;
      ctx.lineWidth = 14 * k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = `rgba(255,${190 + 60 * k},${200 + 55 * k},${k * 0.9})`;
      ctx.lineWidth = 3 * k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _tick = (now) => {
    requestAnimationFrame(this._tick);
    const raw = (now - this._last) / 1000;
    const dt = Math.min(Math.max(raw, 0), 0.05); // never backwards, never a huge leap
    this._last = now;
    this._adapt(raw);
    this._t += dt;
    // a panel that opens while a hint is showing: the hint moves out of its way
    if (this.toastEl.classList.contains('show') && (this._toastCheck = (this._toastCheck || 0) + dt) > 0.3) { this._toastCheck = 0; this._keepToastClear(); }
    shared.uTime.value = this._t;
    const ch = this.current;
    if (!ch || ch.compiling) return; // (behind the veil) wait for the shaders rather than stall on them

    const p = this.pointer;
    if (p.down && p.moved < HOLD_SLOP) p.holdTime += dt;
    else if (p.down) p.holdTime = 0;

    // tilt is read by each chapter (app.gyro), which gives it a meaning of its own
    if (this.tilt.active) this.tilt.update(dt);

    this._chargeSet = false;
    ch.update(dt, this._t);
    if (!this._chargeSet) { this.chargeEl.classList.remove('on', 'full'); }

    this.bloomPass.strength = damp(this.bloomPass.strength, ch.bloom.strength, 6, dt);
    this.bloomPass.radius = ch.bloom.radius;
    this.bloomPass.threshold = ch.bloom.threshold;
    this.renderer.toneMappingExposure = damp(this.renderer.toneMappingExposure, ch.exposure, 6, dt);

    // colour grade
    const u = this.cinePass.uniforms;
    const g = ch.grade;
    u.uTime.value = this._t;
    u.uGrain.value = damp(u.uGrain.value, g.grain, 4, dt);
    u.uVig.value = damp(u.uVig.value, g.vig, 4, dt);
    u.uCA.value = damp(u.uCA.value, g.ca, 6, dt);
    u.uSat.value = damp(u.uSat.value, g.sat, 5, dt);
    u.uTintAmt.value = damp(u.uTintAmt.value, g.tintAmt, 5, dt);
    u.uTint.value.lerp(this._tint.set(g.tint), 1 - Math.exp(-5 * dt));
    this.flashAmt = damp(this.flashAmt, 0, 7, dt);
    u.uFlash.value = this.flashAmt;

    this.composer.render(dt);
    this._drawTrail(now);
  };
}
