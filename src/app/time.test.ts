import { describe, expect, it } from 'vitest';
import type { CivilDate } from '../engine/solar';
import { dateToIso, dayTimes, isoToDate, nowBeijing, termOf, upcomingTerm } from './time';

describe('场景时刻', () => {
  it('北京时间与 UTC 互换', () => {
    // 2026-11-07 07:30 UTC = 北京时间 15:30
    const { date, minute } = nowBeijing(Date.UTC(2026, 10, 7, 7, 30));
    expect(date).toEqual({ year: 2026, month: 11, day: 7 });
    expect(minute).toBeCloseTo(15.5 * 60, 6);
  });

  it('日期字符串', () => {
    expect(dateToIso({ year: 2027, month: 1, day: 5 })).toBe('2027-01-05');
    expect(isoToDate('2027-01-05')).toEqual({ year: 2027, month: 1, day: 5 });
    expect(isoToDate('2027-02-30')).toBeNull();
    expect(isoToDate('20270105')).toBeNull();
  });

  it('日出日落、上中天与 NREL SPA 相差不到 1 分钟', () => {
    // 参考值：pvlib.solarposition.sun_rise_set_transit_spa，片区中心 30.616°N 104.12°E，北京时间
    const cases: [CivilDate, string, string, string][] = [
      [{ year: 2026, month: 12, day: 21 }, '07:56:56', '18:06:26', '13:01:26'],
      [{ year: 2027, month: 6, day: 21 }, '06:01:32', '20:09:07', '13:05:13'],
      [{ year: 2027, month: 1, day: 20 }, '08:00:26', '18:28:34', '13:14:22'],
    ];
    const min = (s: string) => {
      const [h, m, sec] = s.split(':').map(Number) as [number, number, number];
      return h * 60 + m + sec / 60;
    };
    for (const [date, rise, set, transit] of cases) {
      const t = dayTimes(date);
      expect(Math.abs(t.sunrise - min(rise))).toBeLessThan(1);
      expect(Math.abs(t.sunset - min(set))).toBeLessThan(1);
      expect(Math.abs(t.noon - min(transit))).toBeLessThan(0.5);
    }
  });

  it('节气：取最近一次到来的', () => {
    const from = { year: 2026, month: 11, day: 7 };
    expect(upcomingTerm('冬至', from)).toEqual({ year: 2026, month: 12, day: 22 });
    expect(upcomingTerm('大寒', from)).toEqual({ year: 2027, month: 1, day: 20 });
    expect(upcomingTerm('秋分', from).year).toBe(2027);
    expect(termOf({ year: 2027, month: 1, day: 20 })).toBe('大寒');
    expect(termOf({ year: 2027, month: 1, day: 21 })).toBeNull();
  });
});
