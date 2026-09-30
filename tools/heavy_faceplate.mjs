#!/usr/bin/env node
/*
 * The Hulkbuster's head is one red mesh (Plane002) made of 38 separate panels; its faceplate should be
 * gold. This moves whole panels (so the colour change follows the real panel seams) to a second primitive
 * with the model's own "gold" material: the panels within `maxAngle` of the way the head faces, below the
 * brow (`maxY`) and on the outer shell (not the inner neck). The rest stays red.
 *   node tools/heavy_faceplate.mjs <original.glb> <out.glb> [maxAngle=68] [maxY=61.2]
 * The head's centre and facing (it is turned ~20° to its right) were measured from the mirrored panel
 * pairs of the original model, in its own units.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [inFile, outFile, angArg, yArg] = process.argv.slice(2);
const MAX_ANGLE = +angArg || 68, MAX_Y = +yArg || 61.2, MIN_R = 2.3;
const CENTRE = [-2.03, -5.09], FACING = [-0.35, 0.94];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inFile);
const root = doc.getRoot();
const node = root.listNodes().find((n) => n.getName() === 'Plane002');
const gold = root.listMaterials().find((m) => m.getName() === 'gold');
if (!node || !gold) { console.error('Plane002 or gold material not found'); process.exit(1); }
const mesh = node.getMesh();
if (mesh.listPrimitives().length > 1) { console.error('already split: run it on the original model'); process.exit(1); }
const prim = mesh.listPrimitives()[0];
const m = node.getWorldMatrix();
const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
const v = [0, 0, 0];
const W = (i) => { pos.getElement(i, v); return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]; };

// panels: triangles joined by shared positions (welded, so UV seams don't split a panel)
const ids = new Map(), parent = [];
const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
const vid = (i) => { pos.getElement(i, v); const k = v.map((x) => Math.round(x * 1e4)).join(','); if (!ids.has(k)) { ids.set(k, parent.length); parent.push(parent.length); } return ids.get(k); };
const T = idx.getCount() / 3, first = [];
for (let t = 0; t < T; t++) {
  const a = vid(idx.getScalar(t * 3)), b = vid(idx.getScalar(t * 3 + 1)), c = vid(idx.getScalar(t * 3 + 2));
  first.push(a);
  for (const [x, y] of [[a, b], [b, c]]) { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; }
}
const panels = new Map();
for (let t = 0; t < T; t++) {
  const r = find(first[t]);
  const [A, B, C] = [0, 1, 2].map((k) => W(idx.getScalar(t * 3 + k)));
  const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  const area = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  const p = panels.get(r) || { a: 0, c: [0, 0, 0], tris: [] };
  p.a += area; for (let k = 0; k < 3; k++) p.c[k] += ((A[k] + B[k] + C[k]) / 3) * area;
  p.tris.push(t);
  panels.set(r, p);
}
const face = [], rest = [];
let n = 0;
for (const p of panels.values()) {
  const x = p.c[0] / p.a, y = p.c[1] / p.a, z = p.c[2] / p.a;
  const dx = x - CENTRE[0], dz = z - CENTRE[1];
  const ang = Math.abs(Math.atan2(dx * FACING[1] - dz * FACING[0], dx * FACING[0] + dz * FACING[1])) * 180 / Math.PI;
  const isFace = ang <= MAX_ANGLE && y < MAX_Y && Math.hypot(dx, dz) > MIN_R;
  if (isFace) n++;
  for (const t of p.tris) (isFace ? face : rest).push(idx.getScalar(t * 3), idx.getScalar(t * 3 + 1), idx.getScalar(t * 3 + 2));
}
const Arr = idx.getArray().constructor;
const faceAcc = doc.createAccessor().setType('SCALAR').setArray(new Arr(face)).setBuffer(idx.getBuffer());
idx.setArray(new Arr(rest));
const facePrim = doc.createPrimitive().setIndices(faceAcc).setMaterial(gold);
for (const sem of prim.listSemantics()) facePrim.setAttribute(sem, prim.getAttribute(sem));
mesh.addPrimitive(facePrim);
await io.write(outFile, doc);
console.log(`faceplate: ${n} of ${panels.size} panels (${face.length / 3} of ${T} triangles) now gold`);
