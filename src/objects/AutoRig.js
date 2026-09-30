import * as THREE from 'three';

/*
 * A skeleton for a model that came without one (a static sculpt standing in its modelling pose), so it
 * can stand naturally, breathe, look around and move its arms, with the skin bending smoothly at the
 * joints instead of tearing:
 *
 *   const rig = new AutoRig(suit, { shoulder: [0.19, 1.39, 0.02], hipsY: 0.98, chestY: 1.3, neckY: 1.46, headY: 1.55 });
 *   rig.aimArm('r', dirWorld, { straight: true, wrist: 0.9 });   // or rig.relax('r')
 *   rig.lookAt(pointWorld); rig.update(dt, t);                     // every frame
 *   rig.wristWorld('r', out)                                       // where a web-shooter would fire from
 *
 * The meshes of a RealSuit (in its root's space, feet at 0, facing +z; its left is +x) are rebuilt as
 * skinned meshes on one skeleton: a fixed root carrying the legs, then hips > spine > chest > neck > head,
 * and on each side shoulder > elbow > wrist > hand. The arms' joints are found on the geometry itself: the
 * centre line of each arm is traced in slices from the shoulder out to the finger tips, and the elbow and
 * wrist are placed along it. Every vertex is weighted to its nearest two bones with a smooth falloff.
 * Poses aim each arm segment along a direction (the model's rest pose is the starting point).
 */
const UP = new THREE.Vector3(0, 1, 0);

export class AutoRig {
  constructor(suit, { shoulder, hipsY, chestY, neckY, headY, armRadius = 0.075, elbowAt = 0.44, wristAt = 0.76 }) {
    this.suit = suit;
    const root = suit.root;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();

    // every vertex in the root's space (once), to measure the arms on
    const parts = suit.meshes.map((m) => {
      const g = m.geometry;
      const toRoot = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const pos = g.attributes.position;
      const P = new Float32Array(pos.count * 3), v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(toRoot); P.set([v.x, v.y, v.z], i * 3); }
      return { m, P, toRoot };
    });

    // the arms: from the shoulder, trace the centre of the arm in slices out to the farthest point
    const arm = (S) => {
      const sh = new THREE.Vector3(S * shoulder[0], shoulder[1], shoulder[2]);
      const pts = [];
      for (const { P } of parts) for (let i = 0; i < P.length; i += 3) {
        if (P[i] * S > shoulder[0] * 1.02 && P[i + 1] > hipsY - 0.12) pts.push(new THREE.Vector3(P[i], P[i + 1], P[i + 2]));
      }
      let tip = sh.clone(), far = 0;
      for (const p of pts) { const d = p.distanceToSquared(sh); if (d > far) { far = d; tip = p; } }
      const L = Math.sqrt(far);
      const N = 12, centres = [];
      for (let k = 0; k < N; k++) {
        const r0 = (k / N) * L, r1 = ((k + 1) / N) * L;
        const c = new THREE.Vector3(); let n = 0;
        for (const p of pts) { const d = p.distanceTo(sh); if (d >= r0 && d < r1) { c.add(p); n++; } }
        centres.push(n ? c.divideScalar(n) : null);
      }
      const along = (f) => {
        const i = Math.min(N - 1, Math.max(0, Math.round(f * N - 0.5)));
        for (let d = 0; d < N; d++) { const c = centres[i + d] || centres[i - d]; if (c) return c.clone(); }
        return sh.clone().lerp(tip, f);
      };
      return { sh, el: along(elbowAt), wr: along(wristAt), tip: tip.clone() };
    };
    this.arms = { l: arm(1), r: arm(-1) };

    // the skeleton, bones placed at the joints (in the root's space; the skeleton lives under the root)
    const bone = (name, p, parent) => { const b = new THREE.Bone(); b.name = name; b.userData.rest = p.clone(); if (parent) { b.position.copy(p).sub(parent.userData.rest); parent.add(b); } else b.position.copy(p); return b; };
    const base = bone('root', new THREE.Vector3(0, 0, 0));
    const hips = bone('hips', new THREE.Vector3(0, hipsY, 0), base);
    const spine = bone('spine', new THREE.Vector3(0, (hipsY + chestY) / 2, 0), hips);
    const chest = bone('chest', new THREE.Vector3(0, chestY, 0), spine);
    const neck = bone('neck', new THREE.Vector3(0, neckY, 0), chest);
    const head = bone('head', new THREE.Vector3(0, headY, 0), neck);
    this.b = { base, hips, spine, chest, neck, head };
    for (const s of ['l', 'r']) {
      const a = this.arms[s];
      const sh = bone(`shoulder.${s}`, a.sh, chest), el = bone(`elbow.${s}`, a.el, sh), wr = bone(`wrist.${s}`, a.wr, el), hand = bone(`hand.${s}`, a.tip, wr);
      this.b[`sh${s}`] = sh; this.b[`el${s}`] = el; this.b[`wr${s}`] = wr; this.b[`hand${s}`] = hand;
      // rest directions of each segment, to aim from
      a.dU = a.el.clone().sub(a.sh).normalize(); a.dF = a.wr.clone().sub(a.el).normalize(); a.dH = a.tip.clone().sub(a.wr).normalize();
      a.t = { sh: new THREE.Quaternion(), el: new THREE.Quaternion(), wr: new THREE.Quaternion() };
    }
    const bones = [];
    base.traverse((o) => { if (o.isBone) bones.push(o); });
    root.add(base);
    base.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    const index = (b) => bones.indexOf(b);

    // skin: each vertex to its nearest two bones, blended
    const seg = (p, a, b) => { const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return { d: p.distanceTo(a.clone().addScaledVector(ab, t)), t }; };
    const smooth = (e0, e1, x) => { const k = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1); return k * k * (3 - 2 * k); };
    this.meshes = [];
    for (const { m, P } of parts) {
      const n = P.length / 3;
      const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
      const p = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        const w = new Map();
        const add = (b, x) => { if (x > 1e-4) w.set(b, (w.get(b) || 0) + x); };
        const S = p.x >= 0 ? 'l' : 'r', A = this.arms[S];
        // how much of it belongs to the arm: beyond the shoulder, close to the arm's line
        const u = seg(p, A.sh, A.el), f = seg(p, A.el, A.wr), hd = seg(p, A.wr, A.tip);
        const dArm = Math.min(u.d, f.d, hd.d);
        const outward = (p.x * (S === 'l' ? 1 : -1) - shoulder[0] * 0.78) / (shoulder[0] * 0.35);
        const armShare = p.y > hipsY - 0.15 ? smooth(0, 1, outward) * (1 - smooth(armRadius, armRadius * 1.9, dArm)) : 0;
        if (armShare > 0) {
          const inv2 = (d) => 1 / Math.pow(d * d + 1e-4, 2);
          const wu = inv2(u.d), wf = inv2(f.d), wh = inv2(hd.d), tot = wu + wf + wh;
          // the upper arm fades into the chest near the shoulder
          const toChest = 1 - smooth(0.0, 0.35, u.t);
          add(this.b[`sh${S}`], armShare * (wu / tot) * (1 - toChest * 0.5));
          add(this.b.chest, armShare * (wu / tot) * toChest * 0.5);
          add(this.b[`el${S}`], armShare * (wf / tot));
          add(this.b[`wr${S}`], armShare * (wh / tot));
        }
        const body = 1 - armShare;
        if (body > 0) {
          // legs stay with the fixed root; up the body the weight moves hips > spine > chest > neck > head
          const y = p.y;
          const legs = 1 - smooth(hipsY - 0.12, hipsY + 0.02, y);
          const hS = smooth(hipsY - 0.12, hipsY + 0.02, y) * (1 - smooth(hipsY, (hipsY + chestY) / 2, y));
          const spS = smooth(hipsY, (hipsY + chestY) / 2, y) * (1 - smooth((hipsY + chestY) / 2, chestY, y));
          const chS = smooth((hipsY + chestY) / 2, chestY, y) * (1 - smooth(neckY - 0.03, neckY + 0.03, y));
          const nkS = smooth(neckY - 0.03, neckY + 0.03, y) * (1 - smooth(headY - 0.04, headY + 0.02, y));
          const hdS = smooth(headY - 0.04, headY + 0.02, y);
          const sum = legs + hS + spS + chS + nkS + hdS || 1;
          add(base, body * legs / sum); add(hips, body * hS / sum); add(spine, body * spS / sum);
          add(chest, body * chS / sum); add(neck, body * nkS / sum); add(head, body * hdS / sum);
        }
        const top = [...w.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
        const tot = top.reduce((s2, e) => s2 + e[1], 0) || 1;
        top.forEach(([b, x], k) => { skinIndex[i * 4 + k] = index(b); skinWeight[i * 4 + k] = x / tot; });
        if (!top.length) { skinIndex[i * 4] = index(base); skinWeight[i * 4] = 1; }
      }
      // the mesh rebuilt in the root's space, skinned, in place of the static one
      const g = m.geometry.clone();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      if (g.attributes.normal) {
        const nm = new THREE.Matrix3().getNormalMatrix(parts.find((x) => x.m === m).toRoot);
        const N = g.attributes.normal, v = new THREE.Vector3();
        for (let i = 0; i < N.count; i++) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); N.setXYZ(i, v.x, v.y, v.z); }
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      const sm = new THREE.SkinnedMesh(g, m.material);
      sm.castShadow = m.castShadow; sm.receiveShadow = m.receiveShadow;
      sm.frustumCulled = false;
      root.add(sm);
      sm.updateMatrixWorld(true);
      sm.bind(this.skeleton, sm.matrixWorld.clone()); // (bones and mesh measured in the same, current frame)
      m.visible = false;
      this.meshes.push(sm);
    }
    this.look = new THREE.Quaternion();
    this.lookT = new THREE.Quaternion();
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this.relax('l', 1); this.relax('r', 1);
  }

  /** Aims a whole arm (root-space directions): upper arm, forearm and hand each along their own. */
  _aim(s, dU, dF, dH, snap) {
    const a = this.arms[s], t = a.t;
    // world (root-space) rotations of each segment from its rest direction, then made local to its parent
    const qU = new THREE.Quaternion().setFromUnitVectors(a.dU, dU.clone().normalize());
    const qFw = new THREE.Quaternion().setFromUnitVectors(a.dF, dF.clone().normalize());
    const qHw = new THREE.Quaternion().setFromUnitVectors(a.dH, dH.clone().normalize());
    const chestInv = this.b.chest.quaternion.clone().invert(); // (the chest's own sway is small; aim against it)
    t.sh.copy(chestInv).multiply(qU);
    t.el.copy(qU).invert().multiply(qFw);
    t.wr.copy(qFw).invert().multiply(qHw);
    if (snap) { this.b[`sh${s}`].quaternion.copy(t.sh); this.b[`el${s}`].quaternion.copy(t.el); this.b[`wr${s}`].quaternion.copy(t.wr); }
  }

  /** Arms relaxed at the sides: hanging, a little out, elbows softly bent, hands turned in. */
  relax(s, snap = 0) {
    const S = s === 'l' ? 1 : -1;
    this._aim(s, new THREE.Vector3(S * 0.16, -1, -0.02), new THREE.Vector3(S * 0.07, -1, 0.2), new THREE.Vector3(S * 0.02, -1, 0.14), snap);
  }

  /** An arm pointing along dirRoot (in the root's space), the wrist cocked back by `wrist` (radians). */
  aim(s, dirRoot, { wrist = 0.9, bend = 0.08 } = {}) {
    const d = dirRoot.clone().normalize();
    const side = new THREE.Vector3().crossVectors(d, UP).normalize();
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    const dU = d.clone().applyAxisAngle(side, -bend);
    const dH = d.clone().applyAxisAngle(side, wrist);
    this._aim(s, dU, d, dH, 0);
  }

  /** Turns the head (and a little of the neck) toward a world point, within a natural range. */
  lookAt(worldPoint) {
    const r = this.suit.root;
    const local = r.worldToLocal(this._v.copy(worldPoint)).sub(this.b.head.userData.rest);
    const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.9, 0.9);
    const pitch = THREE.MathUtils.clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.35, 0.35);
    this.lookT.setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
  }

  lookForward() { this.lookT.identity(); }

  /** Eases toward the targets and adds the living motion (breathing, weight, a little sway). */
  update(dt, t) {
    const k = 1 - Math.exp(-7 * dt), kh = 1 - Math.exp(-4 * dt);
    for (const s of ['l', 'r']) {
      const tt = this.arms[s].t;
      this.b[`sh${s}`].quaternion.slerp(tt.sh, k);
      this.b[`el${s}`].quaternion.slerp(tt.el, k);
      this.b[`wr${s}`].quaternion.slerp(tt.wr, k);
    }
    this.look.slerp(this.lookT, kh);
    const breathe = Math.sin(t * 1.35);
    this.b.chest.quaternion.setFromEuler(new THREE.Euler(-0.018 * breathe, 0, 0));
    this.b.spine.quaternion.setFromEuler(new THREE.Euler(0.01 * Math.sin(t * 0.55), 0.035 * Math.sin(t * 0.31), 0.012 * Math.sin(t * 0.47)));
    this.b.hips.quaternion.setFromEuler(new THREE.Euler(0, 0, 0.01 * Math.sin(t * 0.47 + 1)));
    // the neck takes a third of the turn, the head the rest
    this._q.identity().slerp(this.look, 0.35);
    this.b.neck.quaternion.copy(this._q);
    this._q2.copy(this._q).invert().multiply(this.look);
    this.b.head.quaternion.copy(this._q2);
  }

  /** Where the web-shooter on a wrist is, in world space (just past the wrist joint, under the palm). */
  wristWorld(s, out = new THREE.Vector3()) {
    const wr = this.b[`wr${s}`];
    wr.updateWorldMatrix(true, false);
    const a = this.arms[s];
    // a short way along the hand from the wrist joint
    const along = a.tip.clone().sub(a.wr).multiplyScalar(0.18);
    return out.copy(along).applyMatrix4(wr.matrixWorld);
  }
}
