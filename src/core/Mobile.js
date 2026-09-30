/*
 * Phone extras: tilt the device to look around (gyro parallax), a chakra ripple under every touch,
 * and haptic feedback on the moments that matter.
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Device tilt as a smoothed x (left/right) and y (toward/away) in -1..1, re-centred on how it is held. */
export class Tilt {
  constructor() {
    this.x = 0; this.y = 0;
    this.tx = 0; this.ty = 0;
    this.base = null;
    this.enabled = false;
    this.active = false;
  }

  /** Call from inside a tap: iOS only grants motion access to a user gesture. */
  request() {
    const D = window.DeviceOrientationEvent;
    if (!D || this.enabled) return;
    this.enabled = true;
    // listen regardless: where access is not granted, events simply never arrive
    addEventListener('deviceorientation', this._on, true);
    if (typeof D.requestPermission === 'function') D.requestPermission().catch(() => { /* declined */ });
  }

  _on = (e) => {
    if (e.beta == null || e.gamma == null) return;
    let b = e.beta, g = e.gamma;
    // keep "tilt right" and "tilt away" meaning the same in landscape
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    if (ang === 90) [b, g] = [-g, b];
    else if (ang === -90 || ang === 270) [b, g] = [g, -b];
    else if (ang === 180) { b = -b; g = -g; }
    if (!this.base) this.base = { b, g };
    // drift slowly back to however the phone is being held
    this.base.b += (b - this.base.b) * 0.002;
    this.base.g += (g - this.base.g) * 0.002;
    this.tx = clamp((g - this.base.g) / 22, -1, 1);
    this.ty = clamp((b - this.base.b) / 22, -1, 1);
    this.active = true;
  };

  update(dt) {
    const k = 1 - Math.exp(-7 * dt);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
  }
}

/** A ring of chakra spreading from a touch point. */
export function ripple(x, y) {
  const el = document.createElement('div');
  el.className = 'touch-ripple';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.append(el);
  setTimeout(() => el.remove(), 700);
}

/** Vibration patterns for the sound effects that mark something happening (phones that support it). */
const PATTERNS = {
  beep: 6, lock: [8, 30, 8], clank: 12, thud: 18, hammer: 14, zap: 8,
  chime: [10, 40, 12], wrong: [35, 30, 35], alarm: [30, 60, 30],
  repulsor: [18, 20, 30], unibeam: [30, 30, 90], missile: 16, boom: [30, 20, 60], powerUp: [10, 40, 30], visor: [12, 30, 20],
};

export function enableHaptics(sfx) {
  if (!('vibrate' in navigator)) return;
  let last = 0;
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    const fn = sfx[name];
    if (typeof fn !== 'function') continue;
    sfx[name] = function (...args) {
      const now = performance.now();
      // never buzz continuously: short effects are rate-limited
      if (now - last > 60) {
        last = now;
        try { navigator.vibrate(pattern); } catch (_) { /* not allowed yet */ }
      }
      return fn.apply(this, args);
    };
  }
}
