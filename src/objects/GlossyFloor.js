import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

/*
 * A real polished floor: any MeshStandardMaterial (e.g. a pbr() concrete) that also shows a blurred
 * mirror image of the scene, the way sealed concrete or wet asphalt does. The reflection is rendered
 * from a mirrored camera at reduced size and read back through its mipmaps, so it is sharp where things
 * touch the floor and blurs with the surface's roughness; the normal map breaks it up, fresnel fades it.
 *
 *   const floor = glossyFloor(new THREE.PlaneGeometry(30, 30), pbr('concrete_floor_worn_001', { repeat: 8 }),
 *                             { renderer, scale: 0.5, strength: 0.6, blur: 4 });
 *   floor.rotation.x = -Math.PI / 2; scene.add(floor);
 *
 * With low: true (weak GPUs) it is the plain material, no mirror pass.
 * Costs one extra scene render per frame (at `scale` of the screen); call floor.resizeMirror(w, h) with
 * the drawing-buffer size from the chapter's resize().
 */
export function glossyFloor(geometry, material, { renderer, scale = 0.5, strength = 0.6, blur = 4, distort = 0.04, low = false } = {}) {
  if (low || !renderer) {
    const m = new THREE.Mesh(geometry, material);
    m.receiveShadow = true;
    return m;
  }
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(256, Math.round(size.x * scale)), h = Math.max(256, Math.round(size.y * scale));
  const mirror = new Reflector(geometry, { textureWidth: w, textureHeight: h, clipBias: 0.002, multisample: 0 });
  const rt = mirror.getRenderTarget();
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const textureMatrix = mirror.material.uniforms.textureMatrix;
  const uniforms = {
    tReflect: { value: rt.texture },
    uTexMatrix: textureMatrix,
    uReflect: { value: strength },
    uBlur: { value: blur },
    uDistort: { value: distort },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uTexMatrix;\nvarying vec4 vReflUv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvReflUv = uTexMatrix * vec4(position, 1.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tReflect; uniform float uReflect; uniform float uBlur; uniform float uDistort;\nvarying vec4 vReflUv;')
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
        {
          vec2 ruv = vReflUv.xy / vReflUv.w + (normal.xy - geometryNormal.xy) * uDistort;
          float rough = clamp(material.roughness, 0.0, 1.0);
          vec3 refl = textureLod(tReflect, ruv, rough * uBlur * 2.0 + 0.5).rgb;
          float nv = clamp(dot(normal, geometryViewDir), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
          float gloss = (1.0 - rough) * (1.0 - rough);
          // the mirror image replaces part of the environment's reflection (it is the nearer, truer one)
          reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, refl * mix(0.35, 1.0, fres), clamp(uReflect * gloss * 1.6, 0.0, 1.0));
        }`);
  };
  material.customProgramCacheKey = () => 'glossyFloor';
  mirror.material.dispose();
  mirror.material = material;
  mirror.receiveShadow = true;
  mirror.userData.glossy = uniforms;
  // keep the mirror the size of the screen share it was made for
  mirror.resizeMirror = (drawW, drawH) => rt.setSize(Math.max(256, Math.round(drawW * scale)), Math.max(256, Math.round(drawH * scale)));
  return mirror;
}
