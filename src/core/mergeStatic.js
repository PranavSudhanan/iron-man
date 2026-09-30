import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Static batching: meshes that never move relative to each other and share a material are merged into
 * one mesh, so the GPU gets one draw call instead of dozens. A street of houses, a stand of timber, a
 * pile of crates: each drawn as a handful of meshes rather than hundreds.
 *
 * Only what is safe to merge is merged: plain meshes (not instanced, skinned or morphing), visible, with
 * a single material and a mirror-free transform. Anything the chapter still animates or looks up must be
 * left out, by marking it `userData.keep = true` (it and everything under it stay as they are).
 */

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

function attrSignature(g) {
  return Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}${g.attributes[k].normalized ? 'n' : ''}`).join(',');
}

/**
 * Merges the static meshes under each of `roots` (default: `target` itself) into new meshes added to
 * `target`, in `target`'s space; the originals are removed. Returns the number of draw calls saved.
 */
export function mergeStatic(target, roots = [target]) {
  target.updateMatrixWorld(true);
  _inv.copy(target.matrixWorld).invert();
  const buckets = new Map();
  const walk = (o) => {
    if (o.userData.keep || !o.visible) return; // hidden things may be shown later: leave them be
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.morphTargetInfluences && !Array.isArray(o.material)
      && !o.geometry.morphAttributes?.position && !o.children.length && o.matrixWorld.determinant() > 0) {
      const g = o.geometry;
      const key = [o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder, o.frustumCulled, attrSignature(g)].join('|');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
      return;
    }
    for (const c of o.children) walk(c);
  };
  for (const r of roots) {
    if (r === target) target.children.slice().forEach(walk);
    else walk(r);
  }
  let saved = 0;
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.clearGroups();
      g.applyMatrix4(_m.multiplyMatrices(_inv, m.matrixWorld));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const first = meshes[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = first.frustumCulled;
    mesh.matrixAutoUpdate = false;
    target.add(mesh);
    for (const m of meshes) m.removeFromParent();
    saved += meshes.length - 1;
  }
  return saved;
}
