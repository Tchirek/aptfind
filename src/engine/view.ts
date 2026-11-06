/**
 * 窗前视野：从窗口向外水平看出去，正对面多远是什么，前方扇面里有多少是开阔的。
 */

import { type WindowGrid, type WindowSample, windowSample } from './geometry';
import type { SunlightEngine } from './sunlight';

/** 视线高度：窗台以上 0.6 m，约为坐着时的眼睛高度 */
const EYE_ABOVE_SILL = 0.6;
/** 正对面距离的探测上限（米） */
const FRONT_FAR = 300;
/** 开阔度的判定距离（米）：这个距离内没有遮挡算开阔 */
const OPEN_FAR = 100;
/** 开阔度扇面：法线左右各 60°，每 3° 一条视线 */
const HALF_FAN = 60;
const FAN_STEP = 3;

export interface ViewMetrics {
  /** 正对面第一个遮挡物的水平距离，300 m 内没有则为 null */
  frontDistance: number | null;
  /** 正对面的遮挡物：建筑下标，或 TERRAIN；没有为 null */
  frontOwner: number | null;
  /** 前方 120° 扇面里 100 m 内无遮挡的视线占比，0–1 */
  openness: number;
}

export function viewFrom(engine: SunlightEngine, grid: WindowGrid, i: number): ViewMetrics {
  const s: WindowSample = windowSample(grid, i, { px: 0, py: 0, pz: 0, nx: 0, ny: 0 });
  const z = s.pz + EYE_ABOVE_SILL;
  const front = engine.firstHit(s.px, s.py, z, s.nx, s.ny, 0, FRONT_FAR);
  const base = Math.atan2(s.ny, s.nx);
  let open = 0;
  let total = 0;
  for (let a = -HALF_FAN; a <= HALF_FAN; a += FAN_STEP) {
    const t = base + (a * Math.PI) / 180;
    if (!engine.firstHit(s.px, s.py, z, Math.cos(t), Math.sin(t), 0, OPEN_FAR)) open++;
    total++;
  }
  return {
    frontDistance: front ? front.distance : null,
    frontOwner: front ? front.owner : null,
    openness: open / total,
  };
}
