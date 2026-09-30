#!/usr/bin/env node
/*
 * Reduces a GLB's triangle count with meshoptimizer's simplifier, keeping materials, UVs and textures:
 *   node tools/simplify_glb.mjs <in.glb> <out.glb> [targetTriangles=180000] [maxError=0.004]
 * Vertices are welded first (so the simplifier can collapse across shared edges), then every mesh is
 * simplified by the same ratio. Run tools/compress_glb.py afterwards to shrink the textures.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, simplify, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [inFile, outFile, targetArg, errArg] = process.argv.slice(2);
if (!inFile || !outFile) { console.error('usage: simplify_glb.mjs <in.glb> <out.glb> [targetTriangles] [maxError]'); process.exit(1); }
const TARGET = +targetArg || 180000;
const ERROR = +errArg || 0.004;

const countTris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(n);
};

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inFile);
const before = countTris(doc);
await doc.transform(dedup(), weld());
const ratio = Math.min(1, TARGET / before);
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: ERROR }), prune());
const after = countTris(doc);
await io.write(outFile, doc);
console.log(`${inFile}: ${before} -> ${after} triangles (ratio ${ratio.toFixed(3)}, max error ${ERROR})`);
