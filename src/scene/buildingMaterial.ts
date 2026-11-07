/**
 * 建筑材质：在 three.js 的 MeshStandardMaterial 上加程序化立面，光照、阴影、雾都沿用引擎自带的。
 *
 * - 窗：按 aFacade 的层坐标、开间坐标逐格画，窗洞大小随立面样式（住宅、学校、商业、工业）不同；
 *   窗格在屏幕上小于约 3 像素时淡出成平均色，远看不闪烁；
 * - 玻璃：深色基底，按菲涅耳项混入天空色，粗糙度低，太阳能在玻璃上打出高光；
 * - 墙脚压暗（近地面的环境光遮蔽）；
 * - 夜里按 uLitShare 的比例随机亮灯，暖色深浅不一；
 * - 选中、悬停与挡光高亮都按建筑下标在着色器里处理，不另建网格。
 */

import { Color, MeshStandardMaterial } from 'three';
import { sceneUniforms } from './lighting';
import { withSkyFog } from './skyLayer';

export const buildingUniforms = {
  uSelected: { value: -1 },
  uHover: { value: -1 },
  uFocus: { value: -1 },
  uGlass: { value: new Color('#4d5b69') },
  uFocusColor: { value: new Color('#4a4740') },
};

const vertexHead = /* glsl */ `
attribute vec4 aFacade;
attribute float aBuilding;
varying vec4 vFacade;
varying float vBuilding;
`;

const fragmentHead = /* glsl */ `
varying vec4 vFacade;
varying float vBuilding;
uniform float uNight;
uniform float uLitShare;
uniform vec3 uSky;
uniform float uSelected;
uniform float uHover;
uniform float uFocus;
uniform vec3 uGlass;
uniform vec3 uFocusColor;

float jgHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// 窗洞在一格里的范围：(左, 右, 下, 上)
vec4 jgWindowRect(float style) {
  if (style < 0.5) return vec4(0.20, 0.80, 0.30, 0.84);
  if (style < 1.5) return vec4(0.10, 0.90, 0.32, 0.86);
  if (style < 2.5) return vec4(0.03, 0.97, 0.08, 0.95);
  return vec4(0.16, 0.84, 0.62, 0.88);
}
`;

const fragmentBody = /* glsl */ `
{
  bool isWall = vFacade.x > -0.5;
  float win = 0.0;
  float lod = 0.0;
  vec2 cellId = vec2(0.0);
  if (isWall && vFacade.y > -0.5) {
    vec2 cell = vFacade.yx;
    cellId = floor(cell);
    vec2 f = fract(cell);
    vec2 w = max(fwidth(cell), vec2(1e-4));
    vec4 r = jgWindowRect(vFacade.w);
    vec2 lo = vec2(r.x, r.z);
    vec2 hi = vec2(r.y, r.w);
    vec2 inside = smoothstep(lo - w * 0.5, lo + w * 0.5, f) * (1.0 - smoothstep(hi - w * 0.5, hi + w * 0.5, f));
    win = inside.x * inside.y;
    // 一格不到约 3 像素时，窗与墙混成平均色
    lod = smoothstep(0.22, 0.5, max(w.x, w.y));
    win = mix(win, (hi.x - lo.x) * (hi.y - lo.y), lod);
  }

  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float fresnel = pow(1.0 - ndv, 3.0);
  // 每扇窗的玻璃深浅不一，约一成拉着浅色窗帘
  float tint = jgHash(vec3(cellId, vBuilding + 3.0));
  vec3 glass = mix(uGlass, uSky, 0.22 + 0.58 * fresnel) * mix(0.8, 1.18, tint);
  glass = mix(glass, vec3(0.80, 0.76, 0.68), step(0.9, tint) * 0.55);
  glass = mix(glass, glass * 0.9 + vec3(0.02), lod);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
  roughnessFactor = mix(roughnessFactor, 0.16, win);

  if (isWall && vFacade.y > -0.5) {
    // 楼层之间一道浅浅的楼板线
    float slab = abs(fract(vFacade.x + 0.5) - 0.5) / max(fwidth(vFacade.x), 1e-4);
    diffuseColor.rgb *= 1.0 - 0.07 * (1.0 - smoothstep(0.5, 1.5, slab)) * (1.0 - lod);
  }

  if (isWall) {
    // 墙脚 0–6 m 渐暗，像接地处的环境光遮蔽
    diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(0.0, 6.0, vFacade.z));
  }

  if (abs(vBuilding - uFocus) < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, uFocusColor, 0.7);
  if (abs(vBuilding - uHover) < 0.5 && abs(vBuilding - uSelected) > 0.5) {
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.45), 0.28);
  }

  // 夜景：一部分窗亮灯
  float pick = jgHash(vec3(cellId, vBuilding));
  float lit = step(pick, uLitShare) * win;
  vec3 warm = mix(vec3(1.0, 0.66, 0.36), vec3(1.0, 0.85, 0.62), jgHash(vec3(cellId.yx, vBuilding + 17.0)));
  totalEmissiveRadiance += warm * lit * uNight * 1.6;
  // 远看时整面墙按亮灯比例微微发光
  totalEmissiveRadiance += warm * lod * win * uLitShare * uNight * 0.6;
}
`;

export function createBuildingMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sceneUniforms, buildingUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexHead}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFacade = aFacade;\nvBuilding = aBuilding;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentHead}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${fragmentBody}`,
      );
  };
  m.customProgramCacheKey = () => 'jg-building-v1';
  return withSkyFog(m);
}
