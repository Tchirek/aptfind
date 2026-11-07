/**
 * 可达范围画在地面上：把到达时刻场作为纹理交给地面材质，在光照算完之后叠色，
 * 这样阴影里、夜里都看得清。
 *
 * - 15 分钟只步行、30 分钟步行 + 地铁各一条等时线；范围内由近到远逐渐变淡，每 5 分钟一道细线；
 * - uReachReveal 从 0 涨到预算值，范围沿着街道一圈圈长出来，波前略亮。
 */

import { DataTexture, HalfFloatType, LinearFilter, type Material, RGFormat, Vector4 } from 'three';
import type { PackedField } from '../app/reach.worker';
import { sceneUniforms } from './lighting';

const empty = () => {
  const t = new DataTexture(new Uint16Array(2), 1, 1, RGFormat, HalfFloatType);
  t.needsUpdate = true;
  return t;
};

export const reachUniforms = {
  uReachOn: { value: 0 },
  uReachReveal: { value: 0 },
  uReachBudget: { value: 30 },
  uReachNear: { value: empty() },
  uReachNearBox: { value: new Vector4(0, 0, 1, 1) },
  uReachFar: { value: empty() },
  uReachFarBox: { value: new Vector4(0, 0, 1, 1) },
};

export function fieldTexture(f: PackedField): DataTexture {
  const t = new DataTexture(f.data, f.grid.nx, f.grid.ny, RGFormat, HalfFloatType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export const boxOf = (f: PackedField) =>
  new Vector4(f.grid.x0, f.grid.y0, f.grid.nx * f.grid.cell, f.grid.ny * f.grid.cell);

const fragmentHead = /* glsl */ `
varying vec2 vEnu;
uniform float uReachOn;
uniform float uReachReveal;
uniform float uReachBudget;
uniform sampler2D uReachNear;
uniform vec4 uReachNearBox;
uniform sampler2D uReachFar;
uniform vec4 uReachFarBox;
uniform float uNight;

vec2 jgReachSample(vec2 p) {
  vec2 un = (p - uReachNearBox.xy) / uReachNearBox.zw;
  if (all(greaterThanEqual(un, vec2(0.0))) && all(lessThanEqual(un, vec2(1.0)))) return texture2D(uReachNear, un).rg;
  vec2 uf = (p - uReachFarBox.xy) / uReachFarBox.zw;
  if (all(greaterThanEqual(uf, vec2(0.0))) && all(lessThanEqual(uf, vec2(1.0)))) return texture2D(uReachFar, uf).rg;
  return vec2(60.0);
}

vec3 jgReach(vec3 base, vec2 p) {
  if (uReachOn < 0.5) return base;
  vec2 t = jgReachSample(p);
  float tw = t.x;
  float tc = t.y;
  float budget = uReachBudget;
  float rev = uReachReveal;
  float fw = max(fwidth(tw), 1e-3);
  float fc = max(fwidth(tc), 1e-3);
  float shownW = 1.0 - smoothstep(rev - fw, rev + fw, tw);
  float shownC = 1.0 - smoothstep(rev - fc, rev + fc, tc);
  float in15 = (1.0 - smoothstep(15.0 - fw, 15.0 + fw, tw)) * shownW;
  float in30 = (1.0 - smoothstep(budget - fc, budget + fc, tc)) * shownC;

  vec3 c15 = mix(vec3(0.05, 0.42, 0.37), vec3(0.42, 0.98, 0.84), uNight);
  vec3 c30 = mix(vec3(0.17, 0.52, 0.56), vec3(0.45, 0.80, 1.00), uNight);

  // 填色只作底：近处略浓、远处渐淡，主要信息交给等时线
  float a = in30 * mix(0.16, 0.05, smoothstep(0.0, budget, tc)) + in15 * 0.05;
  a *= mix(1.0, 1.8, uNight);
  vec3 col = mix(base, mix(c30, c15, in15), clamp(a, 0.0, 1.0));

  // 每 5 分钟一道细线
  float m5 = abs(fract(tc / 5.0 + 0.5) - 0.5) * 5.0 / fc;
  col = mix(col, c30, (1.0 - smoothstep(0.4, 1.2, m5)) * in30 * 0.22);

  // 等时线：15 分钟（只步行）粗，30 分钟（步行 + 地铁）略细
  float l15 = 1.0 - smoothstep(1.0, 2.2, abs(tw - 15.0) / fw);
  float l30 = 1.0 - smoothstep(0.7, 1.8, abs(tc - budget) / fc);
  col = mix(col, c15, l15 * shownW * 0.95);
  col = mix(col, c30, l30 * shownC * 0.9);

  // 生长中的波前
  float growing = 1.0 - step(budget + 0.5, rev);
  float front = exp(-pow((rev - tc) / 0.7, 2.0)) * growing * step(tc, budget);
  col += front * mix(vec3(0.10, 0.30, 0.27), vec3(0.35, 0.95, 0.80), uNight);
  return col;
}
`;

/** 给地面材质加上可达范围叠色；材质的几何体须是 ENU 平面坐标（position.xy 即 x 东 y 北） */
export function withReach<T extends Material>(m: T, key: string): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, reachUniforms, { uNight: sceneUniforms.uNight });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEnu;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEnu = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentHead}`)
      .replace(
        '#include <opaque_fragment>',
        'outgoingLight = jgReach(outgoingLight, vEnu);\n#include <opaque_fragment>',
      );
  };
  m.customProgramCacheKey = () => `jg-reach-${key}`;
  return m;
}
