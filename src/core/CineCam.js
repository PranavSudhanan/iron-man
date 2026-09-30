import * as THREE from 'three';

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const val = (v) => (typeof v === 'function' ? v() : v);

/**
 * A small cinematic camera director for a chapter: keyframed shots (position, look target, field of view),
 * eased between keys, with cuts (a key flagged `cut` snaps instead of blending), shake and timed events.
 * While it runs, the chapter skips its own camera logic.
 *
 *   cine.play([{ t: 0, pos, look, fov }, { t: 1.2, pos, look, cut: true }, …], { events: [[0.5, fn]], onEnd })
 */
export class CineCam {
  constructor(camera) {
    this.camera = camera;
    this.active = false;
    this.shake = 0;
    this._look = new THREE.Vector3();
  }

  play(keys, { events = [], onEnd = null } = {}) {
    const cam = this.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.baseFov = this.baseFov || cam.fov;
    // the first key starts from wherever the camera is now
    this.keys = [{ t: 0, pos: cam.position.clone(), look: cam.position.clone().add(dir.multiplyScalar(10)), fov: cam.fov }, ...keys];
    this.events = events.map(([t, fn]) => ({ t, fn })).sort((a, b) => a.t - b.t);
    this.onEnd = onEnd;
    this.t = 0;
    this.active = true;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.camera.fov = this.baseFov || this.camera.fov;
    this.camera.updateProjectionMatrix();
    const cb = this.onEnd;
    this.onEnd = null;
    if (cb) cb();
  }

  /** Advances the shot; returns true while it controls the camera. */
  update(dt) {
    if (!this.active) return false;
    this.t += dt;
    while (this.events.length && this.events[0].t <= this.t) this.events.shift().fn();
    const K = this.keys, last = K[K.length - 1];
    if (this.t >= last.t) {
      this._apply(val(last.pos), val(last.look), last.fov ?? this.baseFov);
      this.stop();
      return false;
    }
    let i = 0;
    while (i < K.length - 2 && K[i + 1].t <= this.t) i++;
    const a = K[i], b = K[i + 1];
    let k = Math.min(1, Math.max(0, (this.t - a.t) / Math.max(1e-4, b.t - a.t)));
    if (b.cut) k = 0; // hold this shot, then hard-cut to b when its time arrives
    else k = b.linear ? k : ease(k);
    const pa = val(a.pos), pb = val(b.pos), la = val(a.look), lb = val(b.look);
    const fa = a.fov ?? this.baseFov, fb = b.fov ?? this.baseFov;
    this._apply(pa.clone().lerp(pb, k), la.clone().lerp(lb, k), fa + (fb - fa) * k);
    return true;
  }

  _apply(pos, look, fov) {
    const cam = this.camera;
    this.shake *= 0.9;
    const s = this.shake;
    cam.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    this._look.copy(look);
    cam.lookAt(this._look);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}
