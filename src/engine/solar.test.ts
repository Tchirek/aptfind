import { describe, expect, it } from 'vitest';
import reference from './__fixtures__/spa-reference.json';
import {
  type SolarTermName,
  solarTermUtc,
  sunDirectionEnu,
  sunPosition,
  trueSolarTimeToUtc,
  utcToBeijingDate,
  utcToTrueSolarMinutes,
} from './solar';

/** 两个角度之差，考虑 0°/360° 回绕 */
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('sunPosition 对拍 NREL SPA（pvlib）', () => {
  it.each(reference.rows)('$label @ $utcMs', (row) => {
    const p = sunPosition(row.utcMs, row.lat, row.lon);
    expect(Math.abs(p.elevation - row.elevation)).toBeLessThan(0.02);
    // 太阳接近天顶时方位角对误差极敏感，高度角 > 85° 时不比较方位
    if (row.elevation < 85) expect(angleDiff(p.azimuth, row.azimuth)).toBeLessThan(0.03);
    // 折射模型在地平线附近差异较大，只在 3° 以上比较视高度角
    if (row.elevation > 3)
      expect(Math.abs(p.apparentElevation - row.apparentElevation)).toBeLessThan(0.03);
    expect(Math.abs(p.eotMinutes - row.eotMinutes)).toBeLessThan(0.1);
  });
});

describe('solarTermUtc 对拍 SPA 视黄经', () => {
  it.each(reference.terms)('$year $name', (term) => {
    const utc = solarTermUtc(term.year, term.name as SolarTermName);
    // 交节时刻误差在 20 分钟以内，日期就不会错（除非恰好在子夜前后）
    expect(Math.abs(utc - term.utcMs) / 60_000).toBeLessThan(20);
    expect(utcToBeijingDate(utc)).toEqual(utcToBeijingDate(term.utcMs));
  });
});

describe('真太阳时', () => {
  const LON = 104.12;
  const 大寒 = { year: 2027, month: 1, day: 20 };

  it('真太阳时与 UTC 互逆', () => {
    for (const tst of [0, 480, 720, 960, 1439]) {
      const utc = trueSolarTimeToUtc(大寒, tst, LON);
      expect(Math.abs(utcToTrueSolarMinutes(utc, LON) - tst)).toBeLessThan(1e-3);
    }
  });

  it('成都大寒日真太阳时 8:00 约为北京时间 9:14', () => {
    const utc = trueSolarTimeToUtc(大寒, 8 * 60, LON);
    const d = new Date(utc + 8 * 3_600_000);
    expect(d.getUTCHours()).toBe(9);
    expect(d.getUTCMinutes()).toBeGreaterThanOrEqual(13);
    expect(d.getUTCMinutes()).toBeLessThanOrEqual(15);
  });

  it('真太阳时正午太阳在正南', () => {
    const utc = trueSolarTimeToUtc(大寒, 12 * 60, LON);
    const p = sunPosition(utc, 30.616, LON);
    expect(angleDiff(p.azimuth, 180)).toBeLessThan(0.05);
    // 正午高度角 = 90° − 纬度 + 赤纬
    expect(Math.abs(p.elevation - (90 - 30.616 + p.declination))).toBeLessThan(0.05);
  });
});

describe('sunDirectionEnu', () => {
  it('正南、高度 30°', () => {
    const [e, n, u] = sunDirectionEnu(180, 30);
    expect(e).toBeCloseTo(0, 9);
    expect(n).toBeCloseTo(-Math.cos(Math.PI / 6), 9);
    expect(u).toBeCloseTo(0.5, 9);
  });
});
