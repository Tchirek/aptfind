import { describe, expect, it } from 'vitest';
import { dayInfo } from './calendar';
import { flowFactors } from './flows';

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe('dayInfo', () => {
  it('法定假日、调休上班日、周末', () => {
    expect(dayInfo(d(2026, 10, 3)).kind).toBe('holiday');
    expect(dayInfo(d(2026, 10, 3)).holiday).toBe('golden');
    expect(dayInfo(d(2026, 2, 18)).holiday).toBe('spring');
    // 2026 年 10 月 10 日是周六，调休上班
    expect(dayInfo(d(2026, 10, 10)).kind).toBe('work');
    expect(dayInfo(d(2026, 11, 7)).kind).toBe('rest');
    expect(dayInfo(d(2026, 11, 9)).kind).toBe('work');
  });

  it('长假前一个工作日', () => {
    expect(dayInfo(d(2026, 9, 30)).eveOfLong).toBe(true);
    expect(dayInfo(d(2026, 9, 29)).eveOfLong).toBe(false);
  });

  it('中小学：学期中的工作日上课，寒暑假、秋假不上', () => {
    expect(dayInfo(d(2026, 11, 10)).school).toBe(true);
    expect(dayInfo(d(2026, 11, 12)).school).toBe(false);
    expect(dayInfo(d(2026, 8, 3)).school).toBe(false);
    expect(dayInfo(d(2027, 2, 1)).school).toBe(false);
  });

  it('川师：2026 年暑假 7 月 20 日起，9 月 7 日开课', () => {
    expect(dayInfo(d(2026, 7, 15)).campus).toBe(true);
    expect(dayInfo(d(2026, 8, 10)).campus).toBe(false);
    expect(dayInfo(d(2026, 9, 8)).campus).toBe(true);
  });

  it('没有公布安排的年份按通用规则', () => {
    expect(dayInfo(d(2030, 10, 2)).kind).toBe('holiday');
    expect(dayInfo(d(2030, 2, 4)).holiday).toBe('spring');
  });
});

describe('flowFactors', () => {
  const tue = d(2026, 11, 10);

  it('工作日：早晚高峰车流远高于半夜，晚高峰最重，平峰约为高峰的六成', () => {
    const peak = flowFactors(tue, 18 * 60).vehicle.commute;
    const am = flowFactors(tue, 8 * 60 + 30).vehicle.commute;
    const mid = flowFactors(tue, 11 * 60).vehicle.commute;
    const night = flowFactors(tue, 3 * 60).vehicle.commute;
    expect(peak).toBeGreaterThan(am);
    expect(am).toBeGreaterThan(mid);
    expect(mid / peak).toBeGreaterThan(0.45);
    expect(mid / peak).toBeLessThan(0.75);
    expect(night).toBeLessThan(0.1);
  });

  it('国庆前一个工作日傍晚比平时重，春节城里车少', () => {
    const eve = flowFactors(d(2026, 9, 30), 18 * 60).vehicle.commute;
    const normal = flowFactors(d(2026, 9, 23), 18 * 60).vehicle.commute;
    expect(eve / normal).toBeGreaterThan(1.3);
    const spring = flowFactors(d(2026, 2, 19), 18 * 60).vehicle.commute;
    expect(spring).toBeLessThan(normal * 0.6);
  });

  it('上学放学只在上课日；暑假没有', () => {
    expect(flowFactors(tue, 7 * 60 + 30).pedestrian.school).toBeGreaterThan(0.6);
    expect(flowFactors(d(2026, 8, 4), 7 * 60 + 30).pedestrian.school).toBe(0);
  });

  it('夏天宵夜到半夜，冬天夜里人少', () => {
    const summer = flowFactors(d(2026, 7, 15), 23 * 60).pedestrian.dining;
    const winter = flowFactors(d(2026, 12, 15), 23 * 60).pedestrian.dining;
    expect(summer).toBeGreaterThan(winter * 1.6);
  });
});
