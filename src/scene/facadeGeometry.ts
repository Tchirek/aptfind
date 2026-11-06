/**
 * 外墙日照着色：每面墙是一张连续的色面，不再画成一格一格的窗框。
 *
 * - 每个窗位仍是一个四边形（拾取时按顶点反查窗位），四边形之间无缝拼接；
 * - 顶点上的日照值取相邻窗位的平均，GPU 在墙面上平滑插值；
 * - 片元着色器按发散色阶上色，并画出 2 小时等时线（粗）与整点等时线（细）、楼层线（极细）。
 * 这与规划日照分析里的"等时线图"同一套读法。
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from 'three';
import type { WindowGrid } from '../engine/geometry';
import { HOUR_BINS, THRESHOLD_MINUTES } from '../ui/palette';

/** 色面离墙面的距离（米），配合 polygonOffset 避免与墙面深度冲突 */
const LIFT = 0.05;

/** 固定的东南向光，只用来区分不同朝向的墙面明暗 */
const LIGHT = (() => {
  const az = (150 * Math.PI) / 180;
  return [Math.sin(az), Math.cos(az)] as const;
})();

export function buildFacadeGeometry(grid: WindowGrid): BufferGeometry {
  const n = grid.count;
  const pos = new Float32Array(n * 12);
  const floorCoord = new Float32Array(n * 4);
  const bayCoord = new Float32Array(n * 4);
  const shade = new Float32Array(n * 4);
  const index = new Uint32Array(n * 6);

  for (let i = 0; i < n; i++) {
    const x0 = grid.x0[i] as number;
    const y0 = grid.y0[i] as number;
    const x1 = grid.x1[i] as number;
    const y1 = grid.y1[i] as number;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = (y1 - y0) / len;
    const ny = -(x1 - x0) / len;
    const ox = nx * LIFT;
    const oy = ny * LIFT;
    const z0 = grid.z0[i] as number;
    const z1 = grid.z1[i] as number;
    pos.set(
      [x0 + ox, y0 + oy, z0, x1 + ox, y1 + oy, z0, x1 + ox, y1 + oy, z1, x0 + ox, y0 + oy, z1],
      i * 12,
    );

    const f = grid.floor[i] as number;
    const w = grid.wall[i] as number;
    const k = Math.floor((i - (grid.wallStart[w] as number)) / (grid.wallFloors[w] as number));
    floorCoord.set([f, f, f + 1, f + 1], i * 4);
    bayCoord.set([k, k + 1, k + 1, k], i * 4);
    const s = 0.86 + 0.14 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1]);
    shade.set([s, s, s, s], i * 4);

    const v = i * 4;
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aMinutes', new BufferAttribute(new Float32Array(n * 4), 1));
  g.setAttribute('aFloor', new BufferAttribute(floorCoord, 1));
  g.setAttribute('aBay', new BufferAttribute(bayCoord, 1));
  g.setAttribute('aShade', new BufferAttribute(shade, 1));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * 写入日照分钟数：顶点取同一面墙上相邻窗位（最多 4 个）的平均值，
 * 于是相邻格子之间颜色连续过渡，墙角处不同朝向的墙互不混合。
 */
export function paintFacades(g: BufferGeometry, grid: WindowGrid, minutes: Float32Array): void {
  const attr = g.getAttribute('aMinutes') as BufferAttribute;
  const out = attr.array as Float32Array;
  const walls = grid.wallStart.length;
  for (let w = 0; w < walls; w++) {
    const start = grid.wallStart[w] as number;
    const B = grid.wallBays[w] as number;
    const F = grid.wallFloors[w] as number;
    const cell = (k: number, f: number) => minutes[start + k * F + f] as number;
    // 角点 (a, b)：a ∈ [0, B]，b ∈ [0, F]
    const corner = (a: number, b: number) => {
      let sum = 0;
      let cnt = 0;
      for (const k of [a - 1, a]) {
        if (k < 0 || k >= B) continue;
        for (const f of [b - 1, b]) {
          if (f < 0 || f >= F) continue;
          sum += cell(k, f);
          cnt++;
        }
      }
      return sum / cnt;
    };
    for (let k = 0; k < B; k++) {
      for (let f = 0; f < F; f++) {
        const o = (start + k * F + f) * 4;
        out[o] = corner(k, f);
        out[o + 1] = corner(k + 1, f);
        out[o + 2] = corner(k + 1, f + 1);
        out[o + 3] = corner(k, f + 1);
      }
    }
  }
  attr.needsUpdate = true;
}

/**
 * 命中三角形的顶点下标 → 窗位下标。每个窗格独占 4 个顶点；BVH 会重排三角形索引，
 * 但不动顶点，所以按顶点反查才可靠。
 */
export const vertexToWindow = (vertex: number) => Math.floor(vertex / 4);

const coolStops = HOUR_BINS.filter((b) => b.to <= THRESHOLD_MINUTES).map((b) => new Color(b.color));
const warmStops = HOUR_BINS.filter((b) => b.from >= THRESHOLD_MINUTES).map(
  (b) => new Color(b.color),
);

const vertexShader = /* glsl */ `
attribute float aMinutes;
attribute float aFloor;
attribute float aBay;
attribute float aShade;
varying float vMinutes;
varying float vFloor;
varying float vBay;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  vMinutes = aMinutes;
  vFloor = aFloor;
  vBay = aBay;
  vShade = aShade;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uCool[4];
uniform vec3 uWarm[4];
uniform float uThreshold;
uniform vec3 uInk;
varying float vMinutes;
varying float vFloor;
varying float vBay;
varying float vShade;
#include <fog_pars_fragment>

// 冷色阶：0 → 2 小时由深到浅；暖色阶：2 → 6 小时以上由浅到深
vec3 ramp(float m) {
  if (m < uThreshold) {
    float t = clamp(m / uThreshold, 0.0, 1.0) * 3.0;
    int i = int(min(floor(t), 2.0));
    return mix(uCool[i], uCool[i + 1], t - float(i));
  }
  float t = clamp((m - uThreshold) / 240.0, 0.0, 1.0) * 3.0;
  int i = int(min(floor(t), 2.0));
  return mix(uWarm[i], uWarm[i + 1], t - float(i));
}

// 宽度为 px 个像素的抗锯齿线
float line(float v, float level, float px) {
  float d = abs(v - level) / max(fwidth(v), 1e-4);
  return 1.0 - smoothstep(px - 0.5, px + 0.5, d);
}

float gridLine(float v, float px) {
  float f = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4);
  return 1.0 - smoothstep(px - 0.5, px + 0.5, f);
}

void main() {
  vec3 c = ramp(vMinutes) * vShade;
  c = mix(c, c * 0.84, gridLine(vFloor, 0.6));
  c = mix(c, c * 0.93, gridLine(vBay, 0.5));
  float hours = line(vMinutes, 60.0, 0.6) + line(vMinutes, 180.0, 0.6) + line(vMinutes, 240.0, 0.6);
  c = mix(c, c * 0.72, clamp(hours, 0.0, 1.0));
  c = mix(c, uInk, 0.88 * line(vMinutes, uThreshold, 1.3));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function facadeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uCool: { value: coolStops },
        uWarm: { value: warmStops },
        uThreshold: { value: THRESHOLD_MINUTES },
        uInk: { value: new Color('#1f1f1c') },
      },
    ]),
    vertexShader,
    fragmentShader,
    fog: true,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
}
