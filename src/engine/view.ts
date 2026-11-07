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

/** 视域：窗前法线左右各 85°、俯 55° 到仰 45° 的视线，各自打到哪里 */
export interface Viewshed {
  /** 眼睛位置（ENU，米） */
  eye: [number, number, number];
  cols: number;
  rows: number;
  /** 每条视线的单位方向 [x, y, z, …]，按行（仰角）优先、列（方位）次之 */
  dirs: Float32Array;
  /** 每条视线的长度：命中处的距离，没打中为 far */
  dist: Float32Array;
  /** 打中了什么：建筑下标、TERRAIN，或 -1 表示一直看到 far 也没有遮挡 */
  owner: Int32Array;
  far: number;
}

export const VIEWSHED_FAR = 900;

export function viewshedFrom(
  engine: SunlightEngine,
  grid: WindowGrid,
  i: number,
  opts: { halfFan?: number; down?: number; up?: number; step?: number; far?: number } = {},
): Viewshed {
  const halfFan = opts.halfFan ?? 85;
  const down = opts.down ?? 55;
  const up = opts.up ?? 45;
  const step = opts.step ?? 2.5;
  const far = opts.far ?? VIEWSHED_FAR;
  const s: WindowSample = windowSample(grid, i, { px: 0, py: 0, pz: 0, nx: 0, ny: 0 });
  const eye: [number, number, number] = [s.px, s.py, s.pz + EYE_ABOVE_SILL];
  const cols = Math.round((2 * halfFan) / step) + 1;
  const rows = Math.round((down + up) / step) + 1;
  const dirs = new Float32Array(cols * rows * 3);
  const dist = new Float32Array(cols * rows);
  const owner = new Int32Array(cols * rows);
  const base = Math.atan2(s.ny, s.nx);
  for (let r = 0; r < rows; r++) {
    const el = ((-down + r * step) * Math.PI) / 180;
    const ce = Math.cos(el);
    const se = Math.sin(el);
    for (let c = 0; c < cols; c++) {
      const az = base + ((-halfFan + c * step) * Math.PI) / 180;
      const k = r * cols + c;
      const dx = ce * Math.cos(az);
      const dy = ce * Math.sin(az);
      dirs[3 * k] = dx;
      dirs[3 * k + 1] = dy;
      dirs[3 * k + 2] = se;
      const hit = engine.firstHit(eye[0], eye[1], eye[2], dx, dy, se, far);
      dist[k] = hit ? hit.distance : far;
      owner[k] = hit ? hit.owner : -1;
    }
  }
  return { eye, cols, rows, dirs, dist, owner, far };
}
