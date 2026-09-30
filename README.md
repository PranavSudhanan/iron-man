# Iron Man — The Armored Avenger

An interactive 3D fan tribute to Iron Man, built with three.js and Vite. Twelve chapters, each a hands-on
scene: power up the armor, build the Mark I in a cave, take the suit apart in the workshop, suit up, fly over
a city, look through the helmet's HUD, fire repulsors, walk the Hall of Armor, synthesize a new element, defend
the city, walk through his life, and test yourself in a quiz.

> Unofficial, non-commercial fan tribute. Not affiliated with or endorsed by Marvel. The detailed 3D models are
> by the artists credited below; sound effects and music are original and generated in the browser; the text
> is written for this site.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the production build
```

## Chapters

| # | Chapter | What you do |
|---|---------|-------------|
| 1 | **Iron Man** | Hold to bring the armor online; turn it; fire a repulsor; open the faceplate |
| 2 | **The Cave** | Forge the reactor, hammer the plates, assemble the Mark I and break out |
| 3 | **The Workshop** | A hologram of the suit: rotate, explode it, inspect each system, scan it |
| 4 | **Suit Up** | Choose an armor and watch the gantry fit it piece by piece |
| 5 | **First Flight** | Fly a ring course over a night city; boost; don't climb too high (icing) |
| 6 | **Heads-Up Display** | Inside the helmet: analyse drones, lock targets, fire micro-missiles |
| 7 | **Repulsor Range** | A timed shooting range with charged shots and the chest beam |
| 8 | **Hall of Armor** | Eleven armors on display, with stats, inspection and power-on |
| 9 | **New Element** | Map the lattice, align the prisms, fire the accelerator |
| 10 | **Battle** | Defend the city from drone waves and bring down the carrier |
| 11 | **Chronicle** | His life, as a holographic archive |
| 12 | **Trials** | A quiz; the suit reacts to every answer |

## How it's built

- `src/core/` — the engine: `App` (render loop, post-processing, chapter transitions, adaptive resolution,
  shader pre-compilation so nothing stutters), `Chapter` (base class), `Audio` (the synthesized sound kit and
  an original electronic score, one theme per chapter), `CineCam`, `mergeStatic`, `utils`.
- `src/objects/RealSuit.js` — the detailed armor models in `public/models/` (converted and optimized with the
  tools in `tools/`), scaled and aimed alike, with glowing reactors and eyes, boot thrusters, a hologram look,
  an exploded view, plate-by-plate assembly, and — on the model made of separate plates — arms that pivot at
  the shoulder, elbow and wrist for repulsor, hover and flight poses.
- `src/objects/Suit.js` — a procedural armor built entirely from code: a jointed body with pose presets, glowing
  reactor, eyes and repulsors, boot and palm thrusters, an opening faceplate, a hologram mode, an exploded view,
  piece-by-piece assembly and colour schemes for the different Marks.
- `src/objects/FX.js` — beams, shockwaves, explosions, a hologram floor, a night sky, a procedural city, drones.
- `src/chapters/` — one file per chapter. `src/data/content.js` — all the written content.

## Your own music (optional)

Add audio files you have the rights to in `public/music/` and list them in `public/music/tracks.json`, e.g.
`{ "prologue": "theme.mp3", "battle": "fight.mp3" }`; they play in those chapters instead of the score.

## 3D model credits

| Model | Artist | Licence |
|---|---|---|
| Iron Man | [Grant Riley](https://sketchfab.com/3d-models/iron-man-69dde1ad49e94852984e3d83928efd65) | CC BY-NC 4.0 |
| Iron Man – Mark 1 | [Nathang30](https://sketchfab.com/3d-models/iron-man-mark-1-57b18282c1a84c5899fcc7f67762a386) | CC BY-NC-SA 4.0 (our optimized copy is under the same licence) |
| Iron Man Mark 85 | [LLIypuk](https://sketchfab.com/3d-models/iron-man-mark-85-8da781aa74024366844b36444c650d69) | CC BY 4.0 (simplified from 2.2M to 180k triangles, textures resized) |
| Iron Man - Mark V Rig (Low Poly) | [wonderstark](https://sketchfab.com/3d-models/iron-man-mark-v-rig-low-poly-ea6f480ebb0f42d58b34ea1913c457e0) | CC BY 4.0 (rig removed and pose baked with `tools/bake_static.mjs`; an unpainted, bare-steel variant is used for the first flight) |
| iron man for blender (Mark XLII) | [colts43752](https://sketchfab.com/3d-models/iron-man-for-blender-5e7796081e1c41e1b7f39dbff1172381) | CC BY 4.0 |
| Iron Man nano tech | [#3D $Resource$](https://sketchfab.com/3d-models/500-likes-special-iron-man-nano-tech-5160141d6eaf41cd83ee692b65df20f6) | CC BY 4.0 |
| Iron Man helmet | [Sergei](https://sketchfab.com/3d-models/iron-man-helmet-3fb9b4f22925487692d9bc24f4c50211) | CC BY 4.0 (helmet extracted from its display scene) |
| Iron Man Helmet | [Ashwani-Tyagi](https://sketchfab.com/3d-models/iron-man-helmet-4cb973027cfb430d8d815531dfad65fd) | CC BY-NC 4.0 (materials converted to metal/rough) |
| Homecoming Suit | purchased by the site owner | purchased licence |
| Iron Man (rigid-plate, T-pose), Mark 44 heavy armor, Arc Reactor | supplied by the site owner | used with the owner's permission |

Changes made for the web: textures resized and re-encoded, geometry re-indexed, display props removed,
materials assigned where the source had none. Tools: `tools/simplify_glb.mjs` (meshoptimizer), `tools/compress_glb.py`, `tools/sg_to_mr.py`,
`tools/convert.html` (+ `tools/assetsrv.cjs`).

## Skies, light and surfaces

Photographed HDRI skies (image-based lighting, and the visible sky on the outdoor pages) and PBR texture
sets (concrete, rock, sand, steel plate) are from [Poly Haven](https://polyhaven.com), CC0 (public domain).
`tools/fetch_polyhaven.py` downloads and prepares them into `public/env/` and `public/tex/`;
`tools/hdr_backdrop.py` bakes a night-exposure backdrop from an HDR. `src/core/Env.js` loads them;
`src/objects/GlossyFloor.js` is the polished (mirror) floor.

The Mark 44 heavy armor's faceplate was recoloured gold in `public/models/mark-heavy.glb` by
`tools/heavy_faceplate.mjs` (it moves the face panels of the head mesh to the model's own gold material;
run it on the original file).
