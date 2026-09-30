#!/usr/bin/env node
/*
 * Turns a rigged (skinned) model into a static one in its modelled pose: the skin, joints and weights are
 * removed (the site never poses limbs; a skinned mesh can't be cloned for several scenes anyway), then
 * duplicate data is merged and unused nodes are pruned.
 *   node tools/bake_static.mjs <in.glb> <out.glb>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) { console.error('usage: bake_static.mjs <in.glb> <out.glb>'); process.exit(1); }
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inFile);
const root = doc.getRoot();
let skinned = 0;
for (const node of root.listNodes()) {
  if (!node.getSkin()) continue;
  node.setSkin(null);
  skinned++;
  for (const prim of node.getMesh()?.listPrimitives() || []) {
    for (const sem of prim.listSemantics()) if (/^(JOINTS|WEIGHTS)_/.test(sem)) prim.setAttribute(sem, null);
  }
}
for (const skin of root.listSkins()) skin.dispose();
for (const anim of root.listAnimations()) anim.dispose();
await doc.transform(dedup(), weld(), prune());
await io.write(outFile, doc);
console.log(`${inFile}: ${skinned} skinned meshes baked static`);
