/**
 * 逐窗日照：在一天的有效日照时间带内，算出每个窗位被阳光直射的分钟数。
 *
 * 做法：先按粗步长（默认 4 分钟）采样太阳方向并做射线求交；相邻两次的结果不同（照到↔被挡，
 * 或换了挡光的楼），就在这段里二分定位切换时刻，精确到 0.25 分钟。
 * 射线 1 分钟一采的结果与此相比误差在 0.5 分钟内，射线数量却少 70% 以上。
 * 局限：一段粗步长内若出现"照到→被挡→又照到"两次切换，会被漏掉，即短于 4 分钟的缝隙光。
 */

import { DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Solids } from './geometry';
import { TERRAIN_OWNER, type WindowGrid, type WindowSample, windowSample } from './geometry';
import {
  type CivilDate,
  sunDirectionEnu,
  sunPosition,
  trueSolarTimeToUtc,
  utcToBeijingMinutes,
} from './solar';

/** 一天里参与计算的时间带 */
export interface DaySpec {
  date: CivilDate;
  /** 真太阳时，当日第几分钟 */
  startTst: number;
  endTst: number;
  lat: number;
  lon: number;
}

/** 采样结果：照到 */
export const LIT = -1;
/** 采样结果：太阳在地平线下，或在墙的背面 */
export const AWAY = -2;
/** 采样结果：被山体（地形）挡住 */
export const TERRAIN = -3;

export interface TraceOptions {
  coarseStep: number;
  tolerance: number;
}

export const DEFAULT_TRACE: TraceOptions = { coarseStep: 4, tolerance: 0.25 };

/** 一段状态不变的时间：照到、背光，或被某栋楼挡住（建筑下标） */
export interface Span {
  from: number;
  to: number;
  state: number;
}

/** 一天的太阳轨迹：按真太阳时取太阳方向（计入大气折射） */
export class SunPath {
  readonly day: DaySpec;
  private readonly utcStart: number;
  private readonly msPerTstMinute: number;

  constructor(day: DaySpec) {
    this.day = day;
    this.utcStart = trueSolarTimeToUtc(day.date, day.startTst, day.lon);
    const span = day.endTst - day.startTst;
    // 两端精确换算，中间线性插值：一天内时差变化不到 0.5 分钟，插值误差在 1 秒以内
    this.msPerTstMinute =
      span > 0
        ? (trueSolarTimeToUtc(day.date, day.endTst, day.lon) - this.utcStart) / span
        : 60_000;
  }

  utcAt(tst: number): number {
    return this.utcStart + (tst - this.day.startTst) * this.msPerTstMinute;
  }

  /** 真太阳时 → 北京时间（当日第几分钟） */
  beijingAt(tst: number): number {
    return utcToBeijingMinutes(this.utcAt(tst));
  }

  dirAt(tst: number): [number, number, number] {
    const p = sunPosition(this.utcAt(tst), this.day.lat, this.day.lon);
    return sunDirectionEnu(p.azimuth, p.apparentElevation);
  }
}

export class SunlightEngine {
  private readonly bvh: MeshBVH;
  private readonly vertexBuilding: Uint32Array;
  private readonly maxHeight: number;
  private readonly ray = new Ray(new Vector3(), new Vector3());
  private readonly sample: WindowSample = { px: 0, py: 0, pz: 0, nx: 0, ny: 0 };

  constructor(solids: Solids) {
    // indirect 模式不重排几何体的索引，命中三角形的顶点下标与 vertexBuilding 一一对应
    this.bvh = new MeshBVH(solids.geometry, { indirect: true, targetLeafSize: 8 });
    this.vertexBuilding = solids.vertexBuilding;
    solids.geometry.computeBoundingBox();
    this.maxHeight = solids.geometry.boundingBox?.max.z ?? 0;
  }

  /** 太阳方向 dir 下，采样点 s 是否被直射；返回 LIT、AWAY、TERRAIN，或挡光建筑的下标 */
  probe(s: WindowSample, dir: readonly [number, number, number]): number {
    const [de, dn, du] = dir;
    if (du <= 0 || s.nx * de + s.ny * dn <= 0) return AWAY;
    // 射线升到最高楼顶以上就不可能再被挡，借此截断求交距离
    const far = (this.maxHeight - s.pz) / du;
    if (far <= 0) return LIT;
    this.ray.origin.set(s.px, s.py, s.pz);
    this.ray.direction.set(de, dn, du);
    const hit = this.bvh.raycastFirst(this.ray, DoubleSide, 0, far);
    if (!hit?.face) return LIT;
    const owner = this.vertexBuilding[hit.face.a];
    if (owner === undefined) return LIT;
    return owner === TERRAIN_OWNER ? TERRAIN : owner;
  }

  /**
   * 任意方向的射线求交：返回最近命中的距离与归属（建筑下标，或 TERRAIN），没打中返回 null。
   * 视野分析复用同一棵 BVH。
   */
  firstHit(
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
    far: number,
  ): { distance: number; owner: number } | null {
    this.ray.origin.set(px, py, pz);
    this.ray.direction.set(dx, dy, dz).normalize();
    const hit = this.bvh.raycastFirst(this.ray, DoubleSide, 0, far);
    if (!hit?.face) return null;
    const owner = this.vertexBuilding[hit.face.a];
    return { distance: hit.distance, owner: owner === TERRAIN_OWNER ? TERRAIN : (owner ?? -1) };
  }

  /**
   * 追踪一个窗位一天的日照。`spans` 非空时按状态分段写入（区分是哪栋楼挡住），
   * 否则只区分"照到/没照到"，少做二分。返回照到的分钟数。
   */
  trace(
    grid: WindowGrid,
    i: number,
    path: SunPath,
    opts: TraceOptions = DEFAULT_TRACE,
    spans?: Span[],
  ): number {
    const s = windowSample(grid, i, this.sample);
    const { startTst, endTst } = path.day;
    const n = Math.max(1, Math.ceil((endTst - startTst) / opts.coarseStep));
    const step = (endTst - startTst) / n;
    const detailed = spans !== undefined;
    const key = (state: number) => (detailed ? state : state === LIT ? LIT : AWAY);

    let litMinutes = 0;
    let t0 = startTst;
    let st0 = this.probe(s, path.dirAt(t0));
    let spanStart = t0;
    let spanState = st0;

    const close = (to: number, state: number) => {
      if (state === LIT) litMinutes += to - spanStart;
      if (detailed && to > spanStart) spans.push({ from: spanStart, to, state });
    };

    for (let k = 1; k <= n; k++) {
      const t1 = startTst + k * step;
      const st1 = this.probe(s, path.dirAt(t1));
      if (key(st1) !== key(st0)) {
        // 二分定位切换时刻
        let lo = t0;
        let hi = t1;
        while (hi - lo > opts.tolerance) {
          const mid = (lo + hi) / 2;
          if (key(this.probe(s, path.dirAt(mid))) === key(st0)) lo = mid;
          else hi = mid;
        }
        const tSwitch = (lo + hi) / 2;
        close(tSwitch, spanState);
        spanStart = tSwitch;
        spanState = st1;
      }
      t0 = t1;
      st0 = st1;
    }
    close(endTst, spanState);
    return litMinutes;
  }

  /** 批量计算 [from, to) 区间内各窗位的日照分钟数 */
  computeRange(
    grid: WindowGrid,
    path: SunPath,
    from: number,
    to: number,
    out: Float32Array,
    opts: TraceOptions = DEFAULT_TRACE,
  ): void {
    for (let i = from; i < to; i++) out[i - from] = this.trace(grid, i, path, opts);
  }
}
