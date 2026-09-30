import * as THREE from 'three';
import { h } from './utils.js';
import { DEFAULT_GRADE } from './CinematicPass.js';

const ICONS = {
  tap: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".5"/></svg>',
  hold: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".35"/><path d="M12 4a8 8 0 0 1 8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>',
  swipe: '<svg viewBox="0 0 24 24"><path d="M3 15c5-6 11-8 18-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 5l4 3-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  draw: '<svg viewBox="0 0 24 24"><path d="M3 17c3-8 6 4 9-4s6 2 9-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  drag: '<svg viewBox="0 0 24 24"><path d="M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M5 3l12 7-5 1.5L9.5 17z" fill="currentColor"/></svg>',
  key: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 11h1M11 11h1M15 11h1M8 14h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

/**
 * Base class for every 3D chapter. Each chapter owns a scene, a camera and a HUD layer.
 */
export class Chapter {
  constructor(app, { id, title, jp }) {
    this.app = app;
    this.id = id;
    this.title = title;
    this.jp = jp;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, app.width / app.height, 0.1, 400);
    this.built = false;
    this.active = false;
    this.bloom = { strength: 0.9, radius: 0.5, threshold: 0.75 };
    this.grade = { ...DEFAULT_GRADE };
    this.mood = 'calm';
    this.trail = true;
    this.exposure = 1;
    this._holdFired = false;
    this._charging = false;
    this.ui = h(`section.chapter-ui`, { 'data-id': id, 'aria-label': title });
  }

  /** Assets the chapter needs before it can build (e.g. a model); awaited behind the chapter veil. */
  load() { return null; }
  /** Called once (lazily) before first enter. */
  build() {}
  enter() {}
  exit() {}
  update(/* dt, t */) {}
  resize(w, hgt) {
    this.camera.aspect = w / hgt;
    // on wide screens shift the 3D focus right so it doesn't sit under the intro text
    if (this.shiftView && w / hgt > 1.1) this.camera.setViewOffset(w, hgt, -w * this.shiftView, 0, w, hgt);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }
  pointerDown(/* p */) {}
  pointerMove(/* p */) {}
  pointerUp(/* p */) {}
  click(/* p */) {}
  /** return true when the swipe was used (suppresses click) */
  swipe(/* s */) { return false; }
  /** return true to consume the wheel event */
  wheel(/* e */) { return false; }
  key(/* e */) { return false; }

  /**
   * Press-and-hold helper. Call every frame. Shows the charge ring and hum.
   * Returns { progress, fired } — fired is true once per hold when progress reaches 1.
   */
  trackHold(duration, enabled = true, delay = 0.12) {
    const p = this.app.pointer;
    if (!p.down) this._holdFired = false;
    if (enabled && p.down && !this._holdFired && p.holdTime > delay) {
      const progress = Math.min(1, (p.holdTime - delay) / duration);
      this.app.setCharge(progress);
      this.app.sfx.charge(progress);
      this._charging = true;
      if (progress >= 1) {
        this._holdFired = true;
        this._charging = false;
        this.app.sfx.charge(0);
        return { progress: 1, fired: true };
      }
      return { progress, fired: false };
    }
    if (this._charging) { this._charging = false; this.app.sfx.charge(0); }
    return { progress: 0, fired: false };
  }

  /** Legend of gestures shown under the intro: [['hold', 'Hold the eye to awaken'], ...] */
  gestures(list) {
    return h('ul.gestures', { 'aria-label': 'How to interact' }, list.map(([icon, label]) =>
      h('li', {}, h('i', { html: ICONS[icon] || ICONS.tap }), h('span', { html: label }))));
  }

  /** Standard intro block. */
  intro({ kicker, title, jp, desc, quote, extra = [] }) {
    const el = h('div.intro',
      {},
      h('div.jp-bg', { text: jp || '' }),
      h('span.kicker', { text: kicker }),
      h('button.guide-btn.pe', { type: 'button', 'aria-label': 'Show the guide', text: 'Guide', onclick: () => { const t = el.classList.toggle('tucked'); el.classList.toggle('show-guide', !t); } }),
      h('h2', { html: title }),
      h('p.desc.pe', { html: desc, onclick: () => el.classList.toggle('expanded') }),
      quote ? h('blockquote.quote', { html: quote }) : null,
      ...extra,
    );
    this.ui.append(el);
    return el;
  }

  button(label, onClick, cls = '') {
    const b = h(`button.btn.pe${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button', html: label });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.sfx.click();
      onClick(e, b);
    });
    return b;
  }
}
