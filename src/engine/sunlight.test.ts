import { describe, expect, it } from 'vitest';
import type { Building } from './district';
import {
  buildSolids,
  buildWindowGrid,
  type WindowGrid,
  wallAzimuth,
  windowSample,
} from './geometry';
import { solarTermUtc, utcToBeijingDate } from './solar';
import { RULE_DAHAN } from './standard';
import { AWAY, LIT, type Span, SunlightEngine, SunPath } from './sunlight';

const LAT = 30.616;
const LON = 104.12;

/** 轴对齐的长方体建筑，轮廓逆时针 */
function box(
  index: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  height: number,
  core = true,
): Building {
  return {
    index,
    id: `b${index}`,
    rings: [Float64Array.of(x0, y0, x1, y0, x1, y1, x0, y1)],
    height,
    floors: Math.round(height / 3),
    cls: 'R',
    source: 'cbmf',
    compound: -1,
    core,
  };
}

const dahan = utcToBeijingDate(solarTermUtc(2027, '大寒'));
const path = new SunPath({
  date: dahan,
  startTst: RULE_DAHAN.startTst,
  endTst: RULE_DAHAN.endTst,
  lat: LAT,
  lon: LON,
});

/** 找某栋楼、某朝向、某层的第一个窗位 */
function findWindow(g: WindowGrid, building: number, azimuth: number, floor = 0): number {
  for (let i = 0; i < g.count; i++) {
    if (g.building[i] !== building || g.floor[i] !== floor) continue;
    if (Math.abs(((wallAzimuth(g, i) - azimuth + 540) % 360) - 180) < 1) return i;
  }
  throw new Error('没有这个窗位');
}

describe('单栋楼，无遮挡', () => {
  const buildings = [box(0, -10, -5, 10, 5, 30)];
  const engine = new SunlightEngine(buildSolids(buildings));
  const grid = buildWindowGrid(buildings);

  it('南墙大寒日 8–16 时全程直射，480 分钟', () => {
    expect(engine.trace(grid, findWindow(grid, 0, 180), path)).toBeCloseTo(480, 3);
  });

  it('东墙只在上午照到，正午（真太阳时 12:00）太阳转到正南后背光', () => {
    expect(engine.trace(grid, findWindow(grid, 0, 90), path)).toBeCloseTo(240, 0);
  });

  it('西墙只在下午照到', () => {
    expect(engine.trace(grid, findWindow(grid, 0, 270), path)).toBeCloseTo(240, 0);
  });

  it('北墙大寒日照不到', () => {
    expect(engine.trace(grid, findWindow(grid, 0, 0), path)).toBe(0);
  });

  it('窗位数量：开间约 3.3 m、层高 3 m', () => {
    // 南北墙各 20 m → 6 开间，东西墙各 10 m → 3 开间，共 18 开间 × 10 层
    expect(grid.count).toBe(180);
  });
});

describe('南面一道长墙遮挡，对拍解析解', () => {
  // 目标楼南墙在 y = 0，三层；遮挡墙北立面在 y = −30，高 22 m，东西各延伸 500 m。
  // 底层窗台看墙顶仰角约 35°，大寒正午太阳高度约 39°：只有正午前后能照到
  const WALL_Y = -30;
  const WALL_H = 22;
  const buildings = [box(0, -10, 0, 10, 10, 9), box(1, -500, -40, 500, WALL_Y, WALL_H, false)];
  const engine = new SunlightEngine(buildSolids(buildings));
  const grid = buildWindowGrid(buildings);

  /** 解析判断：射线到达遮挡墙北立面时的高度是否已超过墙顶 */
  function analyticMinutes(win: number): number {
    const s = windowSample(grid, win, { px: 0, py: 0, pz: 0, nx: 0, ny: 0 });
    const dt = 0.01;
    let lit = 0;
    for (let t = RULE_DAHAN.startTst + dt / 2; t < RULE_DAHAN.endTst; t += dt) {
      const [de, dn, du] = path.dirAt(t);
      if (du <= 0 || s.nx * de + s.ny * dn <= 0) continue;
      const k = (WALL_Y - s.py) / dn;
      if (Math.abs(s.px + k * de) > 500 || s.pz + k * du >= WALL_H) lit += dt;
    }
    return lit;
  }

  it.each([0, 1, 2])('第 %i 层与解析解相差不到 0.5 分钟', (floor) => {
    const win = findWindow(grid, 0, 180, floor);
    const expected = analyticMinutes(win);
    expect(expected).toBeGreaterThan(10);
    expect(expected).toBeLessThan(470);
    expect(Math.abs(engine.trace(grid, win, path) - expected)).toBeLessThan(0.5);
  });

  it('楼层越高照得越久', () => {
    const m = [0, 1, 2].map((f) => engine.trace(grid, findWindow(grid, 0, 180, f), path));
    expect(m[0]).toBeLessThan(m[1] as number);
    expect(m[1]).toBeLessThan(m[2] as number);
  });

  it('分段结果：被挡的时段都记在遮挡墙名下，各段首尾相接', () => {
    const win = findWindow(grid, 0, 180, 0);
    const spans: Span[] = [];
    const minutes = engine.trace(grid, win, path, undefined, spans);
    expect(spans[0]?.from).toBe(RULE_DAHAN.startTst);
    expect(spans.at(-1)?.to).toBe(RULE_DAHAN.endTst);
    for (let k = 1; k < spans.length; k++) expect(spans[k]?.from).toBe(spans[k - 1]?.to);
    for (const sp of spans) expect([LIT, 1]).toContain(sp.state);
    expect(spans.some((sp) => sp.state === 1)).toBe(true);
    const lit = spans.filter((sp) => sp.state === LIT).reduce((a, sp) => a + sp.to - sp.from, 0);
    expect(lit).toBeCloseTo(minutes, 6);
  });
});

describe('probe', () => {
  it('太阳在墙背面返回 AWAY', () => {
    const buildings = [box(0, -10, -5, 10, 5, 30)];
    const engine = new SunlightEngine(buildSolids(buildings));
    const grid = buildWindowGrid(buildings);
    const s = windowSample(grid, findWindow(grid, 0, 0), { px: 0, py: 0, pz: 0, nx: 0, ny: 0 });
    expect(engine.probe(s, path.dirAt(12 * 60))).toBe(AWAY);
  });
});
