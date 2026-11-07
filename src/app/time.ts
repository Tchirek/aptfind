/**
 * 场景时刻：北京时间的日期与当日分钟数。界面一律用北京时间，
 * 需要真太阳时（日照标准的有效时间带）时再由 solar.ts 换算。
 */

import {
  BEIJING_OFFSET_MINUTES,
  type CivilDate,
  type SolarTermName,
  solarTermUtc,
  sunPosition,
  trueSolarTimeToUtc,
  utcToBeijingDate,
  utcToBeijingMinutes,
  utcToTrueSolarMinutes,
} from '../engine/solar';
import type { DaySpec } from '../engine/sunlight';

/** 片区中心，场景的太阳位置按这里算 */
export const SITE = { lat: 30.616, lon: 104.12 } as const;

const MS_PER_MINUTE = 60_000;

/** 北京时间某日第 minute 分钟 → UTC 毫秒 */
export function beijingToUtc(date: CivilDate, minute: number): number {
  return (
    Date.UTC(date.year, date.month - 1, date.day) +
    (minute - BEIJING_OFFSET_MINUTES) * MS_PER_MINUTE
  );
}

export function nowBeijing(nowMs = Date.now()): { date: CivilDate; minute: number } {
  return { date: utcToBeijingDate(nowMs), minute: utcToBeijingMinutes(nowMs) };
}

export const sameDate = (a: CivilDate, b: CivilDate) =>
  a.year === b.year && a.month === b.month && a.day === b.day;

/** "2026-11-07"，供 <input type="date"> 使用 */
export function dateToIso(d: CivilDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export function isoToDate(s: string): CivilDate | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  // 拒绝 2 月 30 日这类不存在的日期
  const t = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return t.getUTCMonth() === date.month - 1 && t.getUTCDate() === date.day ? date : null;
}

/** 太阳位置（视高度角计入大气折射） */
export function sunAt(date: CivilDate, minute: number) {
  return sunPosition(beijingToUtc(date, minute), SITE.lat, SITE.lon);
}

export interface DayTimes {
  /** 北京时间，当日分钟数；极昼极夜在成都不会出现 */
  sunrise: number;
  sunset: number;
  /** 太阳上中天（真太阳时 12:00） */
  noon: number;
}

/** 日出日落：太阳中心的几何高度角为 −0.833°（折射 + 视半径），二分到 0.1 分钟 */
export function dayTimes(date: CivilDate): DayTimes {
  const noon = utcToBeijingMinutes(trueSolarTimeToUtc(date, 720, SITE.lon));
  const above = (m: number) => sunAt(date, m).elevation > -0.833;
  // a 在地平线下、b 在地平线上，两者先后不限
  const cross = (below: number, up: number) => {
    let a = below;
    let b = up;
    while (Math.abs(b - a) > 0.1) {
      const mid = (a + b) / 2;
      if (above(mid)) b = mid;
      else a = mid;
    }
    return (a + b) / 2;
  };
  return { sunrise: cross(noon - 720, noon), sunset: cross(noon + 720, noon), noon };
}

/** 某日从日出到日落的整个白天，供逐窗追踪（引擎按真太阳时计） */
export function daylightSpec(date: CivilDate): DaySpec {
  const { sunrise, sunset } = dayTimes(date);
  const tst = (m: number) => utcToTrueSolarMinutes(beijingToUtc(date, m), SITE.lon);
  return { date, startTst: tst(sunrise), endTst: tst(sunset), lat: SITE.lat, lon: SITE.lon };
}

/** "1 月 20 日"，逢节气写成"大寒 · 1 月 20 日" */
export function formatDate(d: CivilDate): string {
  const term = termOf(d);
  const s = `${d.month} 月 ${d.day} 日`;
  return term ? `${term} · ${s}` : s;
}

/** 快捷日期里列出的节气 */
export const TERM_PICKS: readonly SolarTermName[] = ['冬至', '大寒', '春分', '夏至', '秋分'];

/** 从 from 起（含当天）最近一次到来的节气日期 */
export function upcomingTerm(term: SolarTermName, from: CivilDate): CivilDate {
  const start = Date.UTC(from.year, from.month - 1, from.day);
  for (const year of [from.year - 1, from.year, from.year + 1]) {
    const d = utcToBeijingDate(solarTermUtc(year, term));
    if (Date.UTC(d.year, d.month - 1, d.day) >= start) return d;
  }
  return utcToBeijingDate(solarTermUtc(from.year + 1, term));
}

/** 某日是不是某个节气（交节时刻落在北京时间这一天） */
export function termOf(date: CivilDate): SolarTermName | null {
  for (const term of TERM_PICKS) {
    if (sameDate(utcToBeijingDate(solarTermUtc(date.year, term)), date)) return term;
  }
  return null;
}
