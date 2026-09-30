import * as THREE from 'three';
import { Chapter } from '../core/Chapter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RealSuit, loadModels, hasModel as hasReal } from '../objects/RealSuit.js';
import { ParticlePool } from '../objects/Particles.js';
import { glowSprite } from '../objects/FX.js';
import { glossyFloor } from '../objects/GlossyFloor.js';
import { loadEnv, envMap, loadTextures, pbr, HDRIS } from '../core/Env.js';
import { rand, damp, clamp, TAU, h, drawTexture } from '../core/utils.js';
import { TIMELINE } from '../data/content.js';
import './Timeline.css';

/*
 * The Chronicle: the Stark archive, a long, dark gallery with a gentle bend. Polished concrete that mirrors
 * the exhibits, walls of dark board-formed concrete, a black ceiling with lighting tracks. Each record is a
 * printed exhibition graphic in a backlit lightbox, slotted into a base; at the milestones the armor of that
 * year stands beside it on a black plinth, as modelled. Scroll, swipe, arrow keys or the buttons carry the
 * camera from record to record; the track spots come up on the record and armor in view. The last record
 * ends quietly: the light warms, the last armor's spot dims and it powers down, and his arc reactor, in a
 * glass case across the aisle, lights up.
 */

const N = TIMELINE.length;
const SPACING = 7;
const PANEL_W = 2.4, PANEL_H = 3.4, PANEL_Y = 0.3 + PANEL_H / 2;
/*
 * The armor beside each milestone: a detailed model (`key`), shown exactly as modelled (if a model is missing,
 * the record simply stands alone). `dx` = how far out from the record it stands.
 */
const HOLO = {
  'MARK I': { key: 'mk1', scheme: 'mk1' },
  'MARK III': { key: 'classic', scheme: 'mk3' },
  'MARK VI': { key: 'classic', scheme: 'mk6' },
  'MARK VII': { key: 'classic', scheme: 'mk7' },
  'MARK XLII': { key: 'classic', scheme: 'classic' },
  'ULTRON': { key: 'heavy', scheme: 'heavy', dx: 2.55 }, // the heavy armor of that battle
  'ACCORDS': { key: 'spider', scheme: null }, // the suit he built for the young hero from Queens
  'MARK L': { key: 'nano', scheme: 'nano' },
  'MARK LXXXV': { key: 'mk85', scheme: 'nano' },
};
const MODEL_KEYS = [...new Set(Object.values(HOLO).map((o) => o.key)), 'reactor'];
const pad = (n) => String(n).padStart(2, '0');
/** the corridor's centre line bends gently from side to side */
const pathX = (z) => Math.sin(z * 0.05) * 2.4;

/* ---------------- the panels' canvas art (drawn once) ---------------- */

/** A simple line-art icon for each record, drawn with a few batched paths. */
function drawIcon(x, i, cx, cy, s, ink, paper) {
  x.lineWidth = 4; x.lineJoin = 'round'; x.lineCap = 'round';
  x.strokeStyle = ink;
  x.fillStyle = x.strokeStyle;
  x.beginPath();
  switch (i) {
    case 0: { // a gear and a spark: machines were his first language
      const T = 12;
      for (let k = 0; k <= T * 4; k++) {
        const a = (k / (T * 4)) * TAU, r = ((k >> 1) & 1) ? s * 0.5 : s * 0.64;
        const px = cx - s * 0.15 + Math.cos(a) * r, py = cy + s * 0.1 + Math.sin(a) * r;
        k ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.moveTo(cx - s * 0.15 + s * 0.2, cy + s * 0.1); x.arc(cx - s * 0.15, cy + s * 0.1, s * 0.2, 0, TAU);
      const sx = cx + s * 0.78, sy = cy - s * 0.7;
      x.moveTo(sx, sy - s * 0.26); x.lineTo(sx, sy + s * 0.26); x.moveTo(sx - s * 0.26, sy); x.lineTo(sx + s * 0.26, sy);
      x.moveTo(sx - s * 0.12, sy - s * 0.12); x.lineTo(sx + s * 0.12, sy + s * 0.12); x.moveTo(sx + s * 0.12, sy - s * 0.12); x.lineTo(sx - s * 0.12, sy + s * 0.12);
      break;
    }
    case 1: // a graduation cap
      x.moveTo(cx, cy - s * 0.6); x.lineTo(cx + s * 1.05, cy - s * 0.22); x.lineTo(cx, cy + s * 0.16); x.lineTo(cx - s * 1.05, cy - s * 0.22); x.closePath();
      x.moveTo(cx - s * 0.58, cy - 0.02 * s); x.lineTo(cx - s * 0.58, cy + s * 0.42); x.quadraticCurveTo(cx, cy + s * 0.72, cx + s * 0.58, cy + s * 0.42); x.lineTo(cx + s * 0.58, cy - 0.02 * s);
      x.moveTo(cx, cy - s * 0.22); x.lineTo(cx + s * 0.82, cy - s * 0.05); x.lineTo(cx + s * 0.82, cy + s * 0.5);
      x.moveTo(cx + s * 0.74, cy + s * 0.5); x.lineTo(cx + s * 0.9, cy + s * 0.5); x.lineTo(cx + s * 0.94, cy + s * 0.72); x.lineTo(cx + s * 0.7, cy + s * 0.72); x.closePath();
      break;
    case 2: { // the company he inherits: a factory, chimneys, rising smoke
      const g = cy + s * 0.7;
      x.moveTo(cx - s * 1.15, g); x.lineTo(cx + s * 1.15, g);
      x.moveTo(cx - s * 1.0, g); x.lineTo(cx - s * 1.0, cy);
      for (let k = 0; k < 4; k++) { const bx = cx - s * 1.0 + k * s * 0.4; x.lineTo(bx + s * 0.4, cy - s * 0.25); x.lineTo(bx + s * 0.4, cy); }
      x.lineTo(cx + s * 0.6, g);
      x.moveTo(cx + s * 0.62, g); x.lineTo(cx + s * 0.62, cy - s * 0.75); x.lineTo(cx + s * 0.82, cy - s * 0.75); x.lineTo(cx + s * 0.82, g);
      x.moveTo(cx + s * 0.9, g); x.lineTo(cx + s * 0.9, cy - s * 0.45); x.lineTo(cx + s * 1.06, cy - s * 0.45); x.lineTo(cx + s * 1.06, g);
      for (let k = 0; k < 3; k++) { const r = s * (0.1 + k * 0.05), px = cx + s * (0.74 - k * 0.2), py = cy - s * (0.95 + k * 0.2); x.moveTo(px + r, py); x.arc(px, py, r, 0, TAU); }
      for (let k = 0; k < 4; k++) { const wx = cx - s * 0.85 + k * s * 0.4; x.moveTo(wx, cy + s * 0.25); x.lineTo(wx + s * 0.2, cy + s * 0.25); }
      break;
    }
    case 3: // the cave, and the first reactor glowing inside it
      x.moveTo(cx - s * 1.15, cy + s * 0.7); x.bezierCurveTo(cx - s * 1.0, cy - s * 1.0, cx + s * 1.0, cy - s * 1.0, cx + s * 1.15, cy + s * 0.7);
      x.moveTo(cx - s * 0.7, cy + s * 0.7); x.bezierCurveTo(cx - s * 0.6, cy - s * 0.45, cx + s * 0.6, cy - s * 0.45, cx + s * 0.7, cy + s * 0.7);
      x.moveTo(cx - s * 1.3, cy + s * 0.7); x.lineTo(cx + s * 1.3, cy + s * 0.7);
      x.moveTo(cx + s * 0.2, cy + s * 0.2); x.arc(cx, cy + s * 0.2, s * 0.2, 0, TAU);
      x.moveTo(cx + s * 0.34, cy + s * 0.2); x.arc(cx, cy + s * 0.2, s * 0.34, 0, TAU);
      x.moveTo(cx - s * 0.95, cy + s * 0.4); x.lineTo(cx - s * 0.8, cy + s * 0.55); x.moveTo(cx + s * 0.95, cy + s * 0.35); x.lineTo(cx + s * 0.82, cy + s * 0.52);
      break;
    case 4: // a new direction: a podium, a microphone, the spotlight
      x.moveTo(cx - s * 0.5, cy + s * 0.75); x.lineTo(cx - s * 0.38, cy + s * 0.05); x.lineTo(cx + s * 0.38, cy + s * 0.05); x.lineTo(cx + s * 0.5, cy + s * 0.75); x.closePath();
      x.moveTo(cx - s * 0.46, cy + s * 0.05); x.lineTo(cx + s * 0.46, cy + s * 0.05);
      x.moveTo(cx + s * 0.1, cy + s * 0.05); x.lineTo(cx + s * 0.1, cy - s * 0.3); x.lineTo(cx - s * 0.08, cy - s * 0.46);
      x.moveTo(cx - s * 0.02, cy - s * 0.52); x.arc(cx - s * 0.1, cy - s * 0.5, s * 0.08, 0, TAU);
      for (let k = -2; k <= 2; k++) { x.moveTo(cx + k * s * 0.18, cy - s * 1.0); x.lineTo(cx + k * s * 0.42, cy - s * 0.7); }
      break;
    case 5: { // a new element: a triangle core inside an atom
      const r = s * 0.34;
      for (let k = 0; k <= 3; k++) { const a = -Math.PI / 2 + (k / 3) * TAU; k ? x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      for (const rot of [-0.6, 0.6, Math.PI / 2]) { x.moveTo(cx + Math.cos(rot) * s, cy + Math.sin(rot) * s); x.ellipse(cx, cy, s, s * 0.32, rot, 0, TAU); }
      x.stroke();
      x.beginPath();
      for (const [dx, dy] of [[0.78, -0.55], [-0.9, 0.24], [0.1, 0.96]]) { x.moveTo(cx + dx * s + 7, cy + dy * s); x.arc(cx + dx * s, cy + dy * s, 7, 0, TAU); }
      x.fill();
      x.beginPath();
      break;
    }
    case 6: { // the battle for the city: a skyline, one streak climbing into the sky
      const g = cy + s * 0.75;
      const tops = [0.3, 0.55, 0.1, 0.8, 0.45, 0.95, 0.35, 0.6, 0.2];
      x.moveTo(cx - s * 1.2, g);
      tops.forEach((t, k) => { const bx = cx - s * 1.2 + k * s * 0.27; x.lineTo(bx, g - t * s); x.lineTo(bx + s * 0.27, g - t * s); });
      x.lineTo(cx + s * 1.23, g); x.lineTo(cx - s * 1.2, g);
      x.moveTo(cx + s * 0.25, g - s * 0.95); x.quadraticCurveTo(cx + s * 0.35, cy - s * 0.9, cx - s * 0.2, cy - s * 1.15);
      x.stroke();
      x.beginPath(); x.arc(cx - s * 0.2, cy - s * 1.15, 6, 0, TAU); x.fill();
      x.beginPath();
      break;
    }
    case 7: // rebuilding: a house on the cliff, a crane lifting the first beam
      x.moveTo(cx - s * 1.2, cy + s * 0.75); x.lineTo(cx - s * 0.4, cy + s * 0.75); x.lineTo(cx - s * 0.1, cy + s * 0.2); x.lineTo(cx + s * 1.2, cy + s * 0.2);
      x.moveTo(cx + s * 0.1, cy + s * 0.2); x.lineTo(cx + s * 0.1, cy - s * 0.2); x.lineTo(cx + s * 1.0, cy - s * 0.2); x.lineTo(cx + s * 1.0, cy + s * 0.2);
      x.moveTo(cx + s * 0.3, cy - s * 0.2); x.lineTo(cx + s * 0.3, cy - s * 0.45); x.lineTo(cx + s * 0.75, cy - s * 0.45); x.lineTo(cx + s * 0.75, cy - s * 0.2);
      x.moveTo(cx - s * 0.75, cy + s * 0.75); x.lineTo(cx - s * 0.75, cy - s * 0.95); x.lineTo(cx + s * 0.5, cy - s * 0.95);
      x.moveTo(cx - s * 0.95, cy - s * 0.95); x.lineTo(cx - s * 0.75, cy - s * 0.95);
      x.moveTo(cx - s * 0.75, cy - s * 0.7); x.lineTo(cx - s * 0.5, cy - s * 0.95);
      x.moveTo(cx + s * 0.3, cy - s * 0.95); x.lineTo(cx + s * 0.3, cy - s * 0.65); x.moveTo(cx + s * 0.08, cy - s * 0.62); x.lineTo(cx + s * 0.52, cy - s * 0.62);
      break;
    case 8: { // a mistake: a network of nodes, one of them turned red
      const P = [[-0.9, -0.5], [-0.2, -0.85], [0.7, -0.55], [-0.6, 0.35], [0.35, 0.2], [0.95, 0.6], [-0.05, 0.8]];
      const E = [[0, 1], [1, 2], [0, 3], [1, 4], [2, 4], [3, 4], [4, 5], [3, 6], [4, 6], [5, 6], [2, 5]];
      for (const [a, b] of E) { x.moveTo(cx + P[a][0] * s, cy + P[a][1] * s); x.lineTo(cx + P[b][0] * s, cy + P[b][1] * s); }
      x.stroke();
      x.fillStyle = paper;
      x.beginPath();
      P.forEach(([px, py], k) => { if (k !== 4) { x.moveTo(cx + px * s + 12, cy + py * s); x.arc(cx + px * s, cy + py * s, 12, 0, TAU); } });
      x.fill(); x.stroke();
      x.beginPath(); x.arc(cx + P[4][0] * s, cy + P[4][1] * s, 16, 0, TAU);
      x.fillStyle = '#8e1b1b'; x.fill();
      x.beginPath();
      break;
    }
    case 9: { // divided: one circle broken into two halves, drifting apart
      const r = s * 0.78, zig = [[0, -1], [0.12, -0.6], [-0.1, -0.2], [0.1, 0.2], [-0.12, 0.6], [0, 1]];
      for (const side of [-1, 1]) {
        const ox = cx + side * s * 0.14;
        x.moveTo(ox, cy - r);
        x.arc(ox, cy, r, -Math.PI / 2, Math.PI / 2, side < 0);
        for (let k = zig.length - 1; k >= 0; k--) x.lineTo(ox + zig[k][0] * s * 0.6, cy + zig[k][1] * r);
      }
      break;
    }
    case 10: { // Titan: a ringed world in a field of stars
      x.moveTo(cx - s * 0.15 + s * 0.46, cy + s * 0.1); x.arc(cx - s * 0.15, cy + s * 0.1, s * 0.46, 0, TAU);
      x.moveTo(cx - s * 0.15 + s * 0.95, cy + s * 0.1); x.ellipse(cx - s * 0.15, cy + s * 0.1, s * 0.95, s * 0.22, -0.3, 0, TAU);
      for (const [dx, dy, r] of [[0.9, -0.85, 0.2], [-1.0, -0.7, 0.14], [1.0, 0.75, 0.12]]) {
        x.moveTo(cx + dx * s, cy + (dy - r) * s); x.lineTo(cx + dx * s, cy + (dy + r) * s);
        x.moveTo(cx + (dx - r) * s, cy + dy * s); x.lineTo(cx + (dx + r) * s, cy + dy * s);
      }
      x.stroke();
      x.beginPath();
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let k = 0; k < 46; k++) x.rect(cx + (rnd() * 2.6 - 1.3) * s, cy + (rnd() * 2.2 - 1.1) * s, 3, 3);
      x.fill();
      x.beginPath();
      break;
    }
    default: { // the last stand: a reactor above a quiet horizon
      const g = cy + s * 0.62;
      x.moveTo(cx - s * 1.25, g); x.lineTo(cx + s * 1.25, g);
      x.moveTo(cx + s * 0.62, g); x.arc(cx, g, s * 0.62, 0, Math.PI, true);
      for (let k = 1; k < 8; k++) { const a = Math.PI + (k / 8) * Math.PI; x.moveTo(cx + Math.cos(a) * s * 0.78, g + Math.sin(a) * s * 0.78); x.lineTo(cx + Math.cos(a) * s * 1.02, g + Math.sin(a) * s * 1.02); }
      const ry = cy - s * 0.12;
      x.moveTo(cx + s * 0.3, ry); x.arc(cx, ry, s * 0.3, 0, TAU);
      x.moveTo(cx + s * 0.14, ry); x.arc(cx, ry, s * 0.14, 0, TAU);
      for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; x.moveTo(cx + Math.cos(a) * s * 0.17, ry + Math.sin(a) * s * 0.17); x.lineTo(cx + Math.cos(a) * s * 0.27, ry + Math.sin(a) * s * 0.27); }
    }
  }
  x.stroke();
}

function panelTexture(ev, i) {
  // a printed exhibition graphic (ink on a light diffuser film), made to be seen backlit in a lightbox
  const INK = '#1e1d1c', SOFT = '#6d6964', RED = '#8e1b1b';
  return drawTexture(1024, 1452, (x, w, hh) => {
    const S = w / 512; // drawn at 2x for crisp print
    x.save(); x.scale(S, S);
    const W = 512, HH = hh / S;
    // the film: warm off-white, a faint vignette where the lightbox's tubes fall off toward the frame
    x.fillStyle = '#ece8e0'; x.fillRect(0, 0, W, HH);
    const vg = x.createRadialGradient(W / 2, HH * 0.45, 60, W / 2, HH * 0.5, HH * 0.75);
    vg.addColorStop(0, 'rgba(255,252,246,0)'); vg.addColorStop(1, 'rgba(120,110,98,0.22)');
    x.fillStyle = vg; x.fillRect(0, 0, W, HH);
    // header: record and age, a hairline rule
    x.textBaseline = 'top';
    x.font = '600 15px "Helvetica Neue", Arial, sans-serif';
    x.fillStyle = SOFT;
    x.textAlign = 'left'; x.fillText(`RECORD ${pad(i + 1)} / ${pad(N)}`, 40, 40);
    x.textAlign = 'right'; x.fillText(`AGE ${ev.age}`, W - 40, 40);
    x.fillStyle = INK; x.fillRect(40, 66, W - 80, 1.5);
    // the year, large, in ink
    x.textAlign = 'left';
    x.font = '700 118px "Helvetica Neue", Arial, sans-serif';
    x.fillStyle = INK;
    x.fillText(ev.year, 34, 84, W - 70);
    // the era's code in Stark red
    x.font = '700 20px "Helvetica Neue", Arial, sans-serif';
    x.fillStyle = RED;
    x.fillText(ev.jp, 40, 216);
    x.fillRect(40, 244, 44, 3);
    // the icon, printed in ink
    drawIcon(x, i, W / 2, 440, 104, i === N - 1 ? '#7a5a1c' : INK, '#ece8e0');
    // the title and the accession line at the foot
    x.fillStyle = INK; x.fillRect(40, 596, W - 80, 1.5);
    x.font = '700 40px "Helvetica Neue", Arial, sans-serif';
    x.fillText(ev.title, 40, 612, W - 80);
    x.font = '500 13px "Helvetica Neue", Arial, sans-serif';
    x.fillStyle = SOFT;
    x.fillText(`STARK ARCHIVE  ·  ACC. ${ev.year}.${String(i + 1).padStart(3, '0')}`, 40, 672);
    x.restore();
    // print grain
    const img = x.getImageData(0, 0, w, hh), dd = img.data;
    for (let k = 0; k < dd.length; k += 4) { const n = (Math.random() - 0.5) * 7; dd[k] += n; dd[k + 1] += n; dd[k + 2] += n; }
    x.putImageData(img, 0, 0);
  });
}

/* ---------------- the chapter ---------------- */

export class Timeline extends Chapter {
  constructor(app) {
    super(app, { id: 'timeline', title: 'Chronicle', jp: 'ARCHIVE' });
    this.bloom = { strength: 0.7, radius: 0.55, threshold: 2.8 }; // only the spot lenses and the reactor bloom
    this.grade = { ...this.grade, grain: 0.025, vig: 0.45, ca: 0.002, sat: 1, tint: 0xffc070, tintAmt: 0 };
    this.mood = 'calm';
    this.shiftView = 0;
    this.trailColor = '120,220,255';
    this.pos = 0; this.target = 0;
    this.endT = 0; this.goldK = 0; this.relicK = 0; this.fadeK = 0;
    this._wheelAcc = 0; this._wheelLast = 0; this._wheelLock = 0; this._edgeSince = 0; this._releaseUntil = 0;
    this._arrived = true; this._shown = -1; this._hinted = false;
  }

  /** The detailed models and the gallery's light and surfaces, fetched behind the veil. */
  load() { return Promise.all([loadModels(MODEL_KEYS), loadEnv(HDRIS.studio), loadTextures(['concrete_floor_worn_001'])]); }

  /** An exhibit: the detailed model as authored (null if it did not load). */
  _exhibit(H) {
    if (!hasReal(H.key)) return null;
    const r = new RealSuit(H.key, { castShadow: !this.app.low });
    if (!r.ok) return null;
    return { suit: r, width: Math.max(0.7, r.size.x), height: r.height };
  }

  build() {
    const s = this.scene, low = this.app.low;
    const air = 0x0c0b0a;
    s.background = new THREE.Color(air);
    s.fog = new THREE.Fog(air, 11, 42);
    // a photographed studio for the armor's reflections, turned well down: the gallery's own lights do the rest
    s.environment = envMap(HDRIS.studio);
    s.environmentIntensity = 0.4;
    this.camera.fov = 45;
    this.camera.near = 0.1; this.camera.far = 160;
    this.camera.updateProjectionMatrix();
    const d = new THREE.Object3D();
    const zStart = 10, zEnd = -(N - 1) * SPACING - 12;

    // light: the room's faint bounce; a track spot on the record in view; a track spot on its armor (the one
    // shadow caster); a soft rim behind the armor; a warm wash that walks the corridor with the camera; the
    // reactor's own light at the end. A fixed set: nothing is added or removed as you move.
    s.add(new THREE.HemisphereLight(0x5a544c, 0x0d0b09, 0.5));
    this.panelSpot = new THREE.SpotLight(0xffe0bc, 0, 14, 0.36, 0.55, 1.4);
    this.suitKey = new THREE.SpotLight(0xffe7cf, 0, 14, 0.3, 0.5, 1.4);
    this.suitKey.castShadow = !low;
    this.suitKey.shadow.mapSize.set(1024, 1024);
    this.suitKey.shadow.camera.near = 1; this.suitKey.shadow.camera.far = 12;
    this.suitKey.shadow.bias = -0.0003; this.suitKey.shadow.normalBias = 0.03; this.suitKey.shadow.radius = 4;
    this.suitRim = new THREE.PointLight(0xdfe6f0, 0, 6, 2);
    this.wash = new THREE.PointLight(0xffd6a8, 14, 18, 2);
    this.relicLight = new THREE.PointLight(0xbfe6ff, 0, 3.5, 2);
    s.add(this.panelSpot, this.panelSpot.target, this.suitKey, this.suitKey.target, this.suitRim, this.wash, this.relicLight);
    this._keyS = null;

    // the room: a polished concrete floor (a real blurred mirror), walls of dark board-formed concrete that follow
    // the corridor's bend, a black ceiling with the lighting tracks
    const floorMat = pbr('concrete_floor_worn_001', { repeat: [9, 27], color: 0x6c6964, roughness: 0.5, metalness: 0, normalScale: 0.55, fallback: 0x1c1b1a });
    this.floor = glossyFloor(new THREE.PlaneGeometry(40, 120), floorMat, { renderer: this.app.renderer, low, scale: 0.5, strength: 0.65, blur: 4.5 });
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, 0, -(N - 1) * SPACING / 2);
    s.add(this.floor);
    const WALL_H = 5.6;
    const wallMat = pbr('concrete_floor_worn_001', { repeat: 1, color: 0x4a4642, roughness: 1, metalness: 0, fallback: 0x1a1918, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const pos = [], uv = [], idx = [];
      let k = 0;
      for (let z = zStart + 4; z >= zEnd - 4; z -= 1, k++) {
        const x = pathX(z) + side * 5.4;
        pos.push(x, 0, z, x, WALL_H, z);
        uv.push(z / 3.2, 0, z / 3.2, WALL_H / 3.2);
        if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const wall = new THREE.Mesh(g, wallMat);
      wall.receiveShadow = true;
      s.add(wall);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(40, 120), new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.95 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, WALL_H, -(N - 1) * SPACING / 2);
    s.add(ceil);
    const ends = new THREE.Mesh(new THREE.PlaneGeometry(14, WALL_H), wallMat);
    ends.position.set(pathX(zEnd - 4), WALL_H / 2, zEnd - 4);
    s.add(ends);

    // the lighting tracks (two black rails that follow the bend) and a track spot aimed at every exhibit
    const steelBlack = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0.6 });
    const railN = Math.ceil(zStart - zEnd + 8) * 2;
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.04, 1.02), steelBlack, railN);
    let ri = 0;
    for (let z = zStart + 4; z > zEnd - 4 && ri < railN - 1; z -= 1) {
      const zc = z - 0.5, a = Math.atan2(pathX(z) - pathX(z - 1), 1);
      for (const off of [-1.6, 1.6]) { d.position.set(pathX(zc) + off, WALL_H - 0.03, zc); d.rotation.set(0, a, 0); d.scale.set(1, 1, 1); d.updateMatrix(); rails.setMatrixAt(ri++, d.matrix); }
    }
    rails.count = ri;
    s.add(rails);

    // the panels: a printed graphic in a backlit lightbox with a black aluminium frame, slotted into a base
    const panelGeo = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    const fw = 0.04, fd = 0.09, bars = [];
    for (const [w, hh, px, py] of [[PANEL_W + fw * 2, fw, 0, PANEL_H / 2 + fw / 2], [PANEL_W + fw * 2, fw, 0, -PANEL_H / 2 - fw / 2], [fw, PANEL_H, -PANEL_W / 2 - fw / 2, 0], [fw, PANEL_H, PANEL_W / 2 + fw / 2, 0]]) {
      const b = new THREE.BoxGeometry(w, hh, fd); b.translate(px, py, -fd / 2 + 0.012); bars.push(b);
    }
    bars.push(new THREE.BoxGeometry(PANEL_W, PANEL_H, 0.02).translate(0, 0, -fd + 0.02)); // the lightbox's back
    const frameGeo = mergeGeometries(bars);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.38, metalness: 0.75 });
    const bases = new THREE.InstancedMesh(new THREE.BoxGeometry(PANEL_W + 0.36, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.55, metalness: 0.1 }), N);
    bases.castShadow = !low; bases.receiveShadow = true;
    // the round plinths the armor stands on (black lacquer), and soft contact shadows under everything
    const plinthGeo = new THREE.CylinderGeometry(0.62, 0.66, 0.12, 64);
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.32, metalness: 0.05 });
    const blobTex = drawTexture(128, 128, (x) => {
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    }, false);
    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const blobs = [];
    const fixtures = [];

    this.panels = [];
    this.suits = [];
    this._c = { white: new THREE.Color(0xffffff), warm: new THREE.Color(0xffd9a6), key: new THREE.Color(0xffe7cf), keyWarm: new THREE.Color(0xffc98e), tmp: new THREE.Color() };
    TIMELINE.forEach((ev, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -i * SPACING;
      const g = new THREE.Group();
      g.position.set(pathX(z) + side * 1.7, 0, z);
      g.rotation.y = -side * 0.18;
      s.add(g);
      const map = panelTexture(ev, i);
      const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.62, metalness: 0 });
      const panel = new THREE.Mesh(panelGeo, mat);
      panel.position.y = PANEL_Y;
      panel.userData.index = i;
      panel.receiveShadow = true;
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.y = PANEL_Y;
      frame.castShadow = !low;
      g.add(panel, frame);
      g.updateMatrixWorld(true);
      d.position.set(0, 0.15, -0.05); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix();
      bases.setMatrixAt(i, d.matrix.premultiply(g.matrixWorld));
      blobs.push(g.localToWorld(new THREE.Vector3(0, 0, -0.05)).toArray().concat([PANEL_W + 1.1, 1.3, g.rotation.y]));
      // its track spot on the ceiling, aimed at the record
      fixtures.push([g.localToWorld(new THREE.Vector3(0, WALL_H - 0.35, 2.4)), g.localToWorld(new THREE.Vector3(0, PANEL_Y, 0))]);
      const P = { i, ev, side, g, panel, mat, b: 0.3, hasSuit: !!HOLO[ev.jp] };
      this.panels.push(P);

      // the armor of that year on its plinth beside the record, as modelled
      const H = HOLO[ev.jp];
      const made = H && this._exhibit(H);
      if (made) {
        const suit = made.suit;
        const dx = side * (H.dx || 2.05);
        const big = H.key === 'heavy' ? 1.7 : 1;
        const plinth = new THREE.Mesh(plinthGeo, plinthMat);
        plinth.scale.set(big, 1, big);
        plinth.position.set(dx, 0.06, 0.35);
        plinth.castShadow = !low; plinth.receiveShadow = true;
        g.add(plinth);
        suit.root.position.set(dx, 0.12, 0.35);
        suit.root.rotation.y = -side * 0.3;
        suit.root.visible = false;
        g.add(suit.root);
        blobs.push(g.localToWorld(new THREE.Vector3(dx, 0, 0.35)).toArray().concat([1.9 * big, 1.9 * big, 0]));
        fixtures.push([g.localToWorld(new THREE.Vector3(dx, WALL_H - 0.35, 2.2)), g.localToWorld(new THREE.Vector3(dx, made.height * 0.6, 0.35))]);
        this.suits.push({ i, suit, width: made.width, height: made.height, yaw: -side * 0.3, glow: H.key !== 'spider', dx, big, lit: 0 });
      } else P.hasSuit = false;
    });
    bases.instanceMatrix.needsUpdate = true;
    s.add(bases);
    const blobGeos = blobs.map(([x, y, z, w, dd, ry]) => new THREE.PlaneGeometry(w, dd).rotateX(-Math.PI / 2).rotateY(ry).translate(x, 0.008, z));
    const blobMesh = new THREE.Mesh(mergeGeometries(blobGeos), blobMat);
    blobMesh.renderOrder = 1;
    s.add(blobMesh);

    // the track spots themselves: a black can with a warm lens (HDR: the lens is the one thing that blooms)
    const can = new THREE.CylinderGeometry(0.075, 0.09, 0.26, 20).rotateX(Math.PI / 2);
    const lens = new THREE.CircleGeometry(0.062, 20);
    const cans = new THREE.InstancedMesh(can, steelBlack, fixtures.length);
    this.lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2b8).multiplyScalar(3.2), toneMapped: false });
    const lenses = new THREE.InstancedMesh(lens, this.lensMat, fixtures.length);
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), steelBlack, fixtures.length);
    fixtures.forEach(([p, aim], k) => {
      d.position.copy(p); d.scale.set(1, 1, 1); d.lookAt(aim); d.updateMatrix(); cans.setMatrixAt(k, d.matrix);
      d.translateZ(0.132); d.updateMatrix(); lenses.setMatrixAt(k, d.matrix);
      d.position.set(p.x, p.y + 0.18, p.z); d.rotation.set(0, 0, 0); d.updateMatrix(); stems.setMatrixAt(k, d.matrix);
    });
    s.add(cans, lenses, stems);

    // the last record's quiet moment: his arc reactor in a glass case on a pedestal across from the last suit,
    // dark until the end, when its light comes up
    const lastP = this.panels[N - 1];
    this.relic = new THREE.Group();
    this.relic.position.set(-lastP.side * 1.95, 0, 0.7);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.05, 0.46), new THREE.MeshStandardMaterial({ color: 0x1a1918, roughness: 0.5, metalness: 0.05 }));
    pedestal.position.y = 0.525; pedestal.castShadow = !low; pedestal.receiveShadow = true;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, envMapIntensity: 2.5 }));
    glass.position.y = 1.05 + 0.21; glass.renderOrder = 3;
    this.relic.add(pedestal, glass);
    this.relicReal = hasReal('reactor') ? new RealSuit('reactor', { castShadow: false }) : null;
    this.relicSpin = new THREE.Group();
    this.relicSpin.position.y = 1.1;
    this.relic.add(this.relicSpin);
    if (this.relicReal?.ok) {
      // the detailed reactor as modelled, standing upright on a small stand
      this.relicReal.root.position.y = 0.02;
      this.relicSpin.add(this.relicReal.root);
    } else this.relicReal = null;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.03, 24), steelBlack);
    stand.position.y = 0.015;
    this.relicSpin.add(stand);
    this.relicGlow = glowSprite(new THREE.Color(0xcff0ff).multiplyScalar(3), 0.5, 0);
    this.relicGlow.material.toneMapped = false;
    this.relicGlow.position.set(0, 0.17, 0);
    this.relicSpin.add(this.relicGlow);
    this.relic.rotation.y = lastP.side * 0.35;
    lastP.g.add(this.relic);
    lastP.g.updateMatrixWorld(true);
    this.relicPos = this.relicSpin.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.18, 0));
    this.relicLight.position.copy(this.relicPos).add(new THREE.Vector3(0, 0.1, 0.2));
    blobMesh.geometry.dispose();
    blobGeos.push(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.008, 0).premultiply(this.relic.matrixWorld)));
    blobMesh.geometry = mergeGeometries(blobGeos);

    // dust hanging in the spot beams
    this.motes = new ParticlePool({ count: 260, drag: 0.2, turbulence: 0.12, softness: 2 });
    s.add(this.motes.points);
    this.moteColor = new THREE.Color(0xd9c7ae);

    this._cp = new THREE.Vector3(); this._lp = new THREE.Vector3(); this._v = new THREE.Vector3();
    this.hitList = this.panels.map((p) => p.panel);
    this._layout();
    this._buildUI();
  }

  /** The camera stops (one per panel) for the current screen shape, joined into smooth curves. */
  _layout() {
    const aspect = this.app.width / this.app.height;
    const phone = this.app.width <= 760 || aspect < 0.9;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const needH = phone ? PANEL_H / 0.4 : 5.2, needW = phone ? 3.3 : 5.8;
    const dist = clamp(Math.max(needH / (2 * t), needW / (2 * t * aspect)), 5.6, 13);
    const cams = [], looks = [];
    for (const p of this.panels) {
      // frame the record and its suit together (records without a suit sit nearer the centre)
      const ox = p.side * (p.hasSuit ? (phone ? 0.45 : 0.95) : (phone ? 0.1 : 0.3));
      cams.push(p.g.localToWorld(new THREE.Vector3(ox, PANEL_Y + (phone ? 0.25 : 0.05), dist)));
      looks.push(p.g.localToWorld(new THREE.Vector3(ox, PANEL_Y - 0.1, 0)));
    }
    this.camCurve = new THREE.CatmullRomCurve3(cams, false, 'centripetal');
    this.lookCurve = new THREE.CatmullRomCurve3(looks, false, 'centripetal');
  }

  _buildUI() {
    this.intro({
      kicker: 'Archive · 1970 — 2023',
      title: 'The <em>Chronicle</em>',
      jp: 'ARCHIVE',
      desc: 'A life kept as light: twelve records, from a boy who spoke in machines to the man who built a better self. Walk the archive year by year — the suits of each era stand beside their records.',
      extra: [this.gestures([['swipe', '<b>Scroll</b> or <b>swipe</b> to travel'], ['key', '<b>← →</b> step through the years'], ['tap', '<b>Tap</b> a record or a tick to jump']])],
    });

    this.elYear = h('span.tl-age');
    this.elCode = h('span.card-jp');
    this.elTitle = h('h3');
    this.elText = h('p');
    this.elMeta = h('span.tl-meta');
    this.btnReplay = this.button('Replay from start', () => this.replay(), 'btn-gold btn-sm tl-replay');
    this.card = h('div.card.timeline-card.pe', { 'aria-live': 'polite' },
      h('div.tl-head', {}, this.elYear, h('div.tl-code', {}, this.elCode, this.elMeta)),
      this.elTitle, this.elText, this.btnReplay);
    this.ui.append(this.card);

    this.progFill = h('i');
    this.ticks = TIMELINE.map((ev, i) => {
      const b = h('button', { type: 'button', 'aria-label': `${ev.year}: ${ev.title}`, 'data-year': ev.year, style: `left:${(i / (N - 1)) * 100}%` });
      b.addEventListener('click', (e) => { e.stopPropagation(); this.app.sfx.click(); this.goTo(i); });
      return b;
    });
    this.ui.append(h('div.tl-progress.pe', {}, this.progFill, h('div.tl-ticks', {}, this.ticks)));

    this.btnPrev = this.button('<span aria-hidden="true">‹</span><span class="lbl">Earlier</span>', () => this.step(-1));
    this.btnNext = this.button('<span class="lbl">Later</span><span aria-hidden="true">›</span>', () => this.step(1), 'btn-primary');
    this.btnPrev.setAttribute('aria-label', 'Earlier record');
    this.btnNext.setAttribute('aria-label', 'Later record');
    this.counter = h('span.label.tl-count', { text: `01 / ${pad(N)}` });
    this.ui.append(h('div.controls', {}, h('div.group', {}, this.btnPrev, this.counter, this.btnNext)));
    this._syncUI(true);
  }

  _hint() {
    if (this._hinted) return;
    this._hinted = true;
    this.app.toast('<b>Scroll</b>, <b>swipe</b> or use <b>← →</b> to walk through the archive.', 3600);
  }

  onEnter() { this._hint(); }

  enter() {
    this._edgeSince = performance.now();
    this._wheelAcc = 0;
    if (document.getElementById('loader')?.classList.contains('done')) this._hint();
  }

  exit() {
    this.app.sfx.charge(0);
    this.app.sfx.thrust(0);
    this.app.setHover(false);
  }

  /* ---------------- moving through the archive ---------------- */

  goTo(i) {
    i = clamp(i, 0, N - 1);
    if (i === this.target) return;
    const far = Math.abs(i - this.target) > 1;
    this.target = i;
    this._arrived = false;
    if (i === 0 || i === N - 1) this._edgeSince = performance.now();
    far ? this.app.sfx.whoosh() : this.app.sfx.swoosh();
    this.app.flash(0.025, 0xfff0e0);
    this._syncUI();
  }

  step(dir) { this.goTo(this.target + dir); }

  replay() {
    this.goTo(0);
    this.app.toast('Back to the beginning.', 1800);
  }

  _syncUI(force = false) {
    const i = this.target;
    if (i === this._shown && !force) return;
    this._shown = i;
    const ev = TIMELINE[i];
    const fill = () => {
      this.elYear.textContent = ev.year;
      this.elCode.textContent = ev.jp;
      this.elMeta.textContent = `Age ${ev.age} · ${pad(i + 1)}/${pad(N)}`;
      this.elTitle.textContent = ev.title;
      this.elText.textContent = ev.text;
      this.btnReplay.classList.toggle('on', i === N - 1);
      this.card.classList.remove('hidden');
    };
    clearTimeout(this._cardT);
    if (force) fill();
    else { this.card.classList.add('hidden'); this._cardT = setTimeout(fill, 220); }
    this.counter.textContent = `${pad(i + 1)} / ${pad(N)}`;
    this.progFill.style.width = `${(i / (N - 1)) * 100}%`;
    this.ticks.forEach((b, k) => { b.classList.toggle('on', k <= i); b.classList.toggle('cur', k === i); if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    this.btnPrev.disabled = i === 0;
    this.btnNext.disabled = i === N - 1;
  }

  /* ---------------- input ---------------- */

  wheel(e) {
    const now = performance.now();
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const dir = Math.sign(delta);
    if (!dir) return true;
    // at either end, a fresh scroll (after a pause) is handed on to the app: it moves to the next chapter
    if ((dir > 0 && this.target === N - 1) || (dir < 0 && this.target === 0)) {
      if (now < this._releaseUntil) return false;
      const fresh = now - this._wheelLast > 300;
      this._wheelLast = now;
      if (fresh && now - this._edgeSince > 1000 && Math.abs(this.pos - this.target) < 0.05) { this._releaseUntil = now + 700; return false; }
      return true;
    }
    if (now - this._wheelLast > 250 || Math.sign(this._wheelAcc) !== dir) this._wheelAcc = 0;
    this._wheelLast = now;
    this._wheelAcc += delta;
    if (now > this._wheelLock && Math.abs(this._wheelAcc) > 50) {
      this.step(dir);
      this._wheelAcc = 0;
      this._wheelLock = now + 450;
    }
    return true;
  }

  swipe(s) {
    const dir = Math.abs(s.dx) > Math.abs(s.dy) ? (s.dx < 0 ? 1 : -1) : (s.dy < 0 ? 1 : -1);
    this.step(dir);
    return true;
  }

  key(e) {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') { if (this.target === N - 1) return false; this.step(1); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowUp') { if (this.target === 0) return false; this.step(-1); return true; }
    if (k === 'Home') { this.goTo(0); return true; }
    if (k === 'End') { this.goTo(N - 1); return true; }
    if ((k === 'r' || k === 'R') && this.target === N - 1) { this.replay(); return true; }
    return false;
  }

  _pick(p) {
    const hit = this.app.raycast(this.hitList, false, p.ndc)[0];
    return hit ? hit.object.userData.index : -1;
  }

  pointerMove(p) {
    if (p.down || p.type !== 'mouse') return;
    const i = this._pick(p);
    this.app.setHover(i >= 0 && i !== this.target);
  }

  click(p) {
    const i = this._pick(p);
    if (i >= 0 && i !== this.target) { this.app.sfx.click(); this.goTo(i); }
  }

  resize(w, hh) {
    this.camera.aspect = w / hh;
    // phones: the record card covers the lower part, so lift the scene into the space above it
    if (w <= 760 || w / hh < 0.9) this.camera.setViewOffset(w, hh, 0, hh * 0.13, w, hh);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.built) this._layout();
    if (this.floor?.resizeMirror) { const v = this.app.renderer.getDrawingBufferSize(new THREE.Vector2()); this.floor.resizeMirror(v.x, v.y); }
  }

  /* ---------------- every frame ---------------- */

  update(dt, t) {
    const app = this.app, c = this._c;
    this.pos = damp(this.pos, this.target, 2.4, dt);
    if (Math.abs(this.pos - this.target) < 0.0015) this.pos = this.target;
    if (!this._arrived && Math.abs(this.pos - this.target) < 0.04) {
      this._arrived = true;
      app.sfx.hologram();
    }

    // the quiet ending: the gallery light warms, the last armor's spot dims and it powers down, and the reactor
    // in its case across the aisle lights up, then settles to a low glow
    const atEnd = this.target === N - 1 && Math.abs(this.pos - (N - 1)) < 0.06;
    this.endT = atEnd ? this.endT + dt : 0;
    this.goldK = damp(this.goldK, atEnd && this.endT > 0.6 ? 1 : 0, atEnd ? 0.7 : 3, dt);
    this.fadeK = damp(this.fadeK, atEnd && this.endT > 3.2 ? 1 : 0, atEnd ? 0.45 : 4, dt);
    const relicGoal = !atEnd || this.endT < 2.2 ? 0 : this.endT < 7.5 ? 1 : 0.45;
    this.relicK = damp(this.relicK, relicGoal, atEnd ? (this.endT < 7.5 ? 0.9 : 0.35) : 4, dt);
    const rk = this.relicK * (0.94 + Math.sin(t * 2.1) * 0.06);
    this.relicGlow.material.opacity = rk * 0.75;
    this.relicGlow.scale.setScalar(0.1 + rk * 0.12);
    this.relicLight.intensity = rk * 2.2;
    this.relicSpin.rotation.y = t * 0.25; // a slow turntable
    if (this.relicK > 0.05 && Math.random() < dt * 3) {
      const v = this.relicPos;
      this.motes.emit({ x: v.x + rand(-0.6, 0.6), y: v.y + rand(0, 1.5), z: v.z + rand(-0.6, 0.6), vx: 0, vy: rand(-0.02, 0.04), vz: 0, life: rand(3, 5), size: rand(0.008, 0.016), color: this.moteColor, alpha: 0.35 * this.relicK });
    }
    this.grade.tintAmt = this.goldK * 0.06;

    // the records: backlit, the one in view brighter (its own spot is on it too), the rest glowing softly
    for (const P of this.panels) {
      const dd = Math.abs(this.pos - P.i);
      const near = Math.max(0, 1 - dd);
      P.b = 0.1 + near * near * 0.13;
      const gold = P.i === N - 1 ? this.goldK : 0;
      P.mat.emissive.copy(c.white).lerp(c.warm, gold);
      P.mat.emissiveIntensity = P.b * (1 - gold * 0.25);
    }

    // the armor near the record in view (never more than three shown), as modelled; the current one lit and
    // powered, its neighbours standing dark
    const cur = Math.round(this.pos);
    let keyOn = null;
    for (const S of this.suits) {
      const vis = Math.abs(S.i - this.pos) < 1.5;
      if (S.suit.root.visible !== vis) S.suit.root.visible = vis;
      if (!vis) continue;
      const isCur = S.i === cur && Math.abs(this.pos - cur) < 0.35;
      if (isCur) keyOn = S;
      const off = S.i === N - 1 ? this.fadeK : 0;
      S.lit = damp(S.lit, isCur ? 1 - off : 0, isCur ? 1.8 : 4, dt);
      S.suit.root.rotation.y = S.yaw + Math.sin(t * 0.25 + S.i) * 0.3;
      S.suit.reactor = S.glow ? S.lit : 0;
      S.suit.eyes = S.glow ? S.lit : 0;
      S.suit.update(dt);
    }
    // a track spot on the current armor from the ceiling in front, a soft rim behind; they come up when it arrives
    if (keyOn !== this._keyS) {
      this._keyS = keyOn;
      if (keyOn) {
        keyOn.suit.root.getWorldPosition(this._v);
        const P = this.panels[keyOn.i];
        this.suitKey.target.position.set(this._v.x, this._v.y + keyOn.height * 0.55, this._v.z);
        const f = P.g.localToWorld(new THREE.Vector3(keyOn.dx, 5.25, 2.2));
        this.suitKey.position.copy(f);
        this.suitKey.target.updateMatrixWorld();
        this.suitRim.position.set(this._v.x - P.side * 0.6, this._v.y + keyOn.height * 1.05, this._v.z - 1.3);
        this.suitKey.intensity = 0; this.suitRim.intensity = 0;
      }
    }
    const endDim = keyOn && keyOn.i === N - 1 ? 1 - this.fadeK * 0.95 : 1;
    this.suitKey.intensity = damp(this.suitKey.intensity, keyOn ? 60 * (keyOn.big > 1 ? 1.6 : 1) * endDim : 0, 2.2, dt);
    this.suitRim.intensity = damp(this.suitRim.intensity, keyOn ? 5 * endDim : 0, 2.2, dt);
    this.suitKey.color.copy(c.key).lerp(c.keyWarm, this.goldK);

    // the record's spot follows the record in view
    const P = this.panels[cur];
    this._v.set(0, 5.25, 2.4); P.g.localToWorld(this._v);
    this.panelSpot.position.lerp(this._v, 1 - Math.exp(-5 * dt));
    this._v.set(0, PANEL_Y - 0.2, 0); P.g.localToWorld(this._v);
    this.panelSpot.target.position.lerp(this._v, 1 - Math.exp(-5 * dt));
    this.panelSpot.target.updateMatrixWorld();
    this.panelSpot.intensity = damp(this.panelSpot.intensity, 14 * (1 - Math.min(1, Math.abs(this.pos - cur) * 2)) * (1 - this.goldK * 0.3), 4, dt);
    this.panelSpot.color.copy(c.key).lerp(c.keyWarm, this.goldK);
    // a warm wash that walks the corridor a little ahead of the camera
    this.wash.position.set(pathX(this.camera.position.z - 4), 4.2, this.camera.position.z - 4);
    this.wash.intensity = 14 * (1 - this.goldK * 0.4 - this.fadeK * 0.35);
    this.scene.environmentIntensity = 0.4 * (1 - this.fadeK * 0.6);

    // dust hanging in the air around the camera's stretch of the gallery
    if (Math.random() < dt * 16) {
      const z = this.camera.position.z - rand(1.5, 9);
      this.motes.emit({ x: pathX(z) + rand(-3.5, 3.5), y: rand(0.4, 4.2), z, vx: rand(-0.03, 0.03), vy: rand(-0.02, 0.03), vz: rand(-0.03, 0.03), life: rand(4, 8), size: rand(0.008, 0.018), color: this.moteColor, alpha: 0.3 });
    }
    this.motes.update(dt, t);

    // camera: along the curve, a slight parallax with the pointer (or the phone's tilt), a slow breath
    const k = this.pos / (N - 1);
    this.camCurve.getPoint(k, this._cp);
    this.lookCurve.getPoint(k, this._lp);
    const gy = app.gyro;
    const px = gy ? gy.x : app.pointer.ndc.x, py = gy ? gy.y : app.pointer.ndc.y;
    this._px = damp(this._px || 0, px, 2, dt);
    this._py = damp(this._py || 0, py, 2, dt);
    const cam = this.camera;
    cam.position.set(this._cp.x + this._px * 0.35, this._cp.y + this._py * 0.2 + Math.sin(t * 0.5) * 0.04, this._cp.z);
    cam.lookAt(this._lp);
  }
}
