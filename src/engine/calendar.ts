/**
 * 日历：哪天上班、哪天放假，中小学与川师是否在上课。车流人流的时间模型靠它分出工作日、周末、长假。
 *
 * 出处：
 * - 法定节假日与调休：国务院办公厅《关于 2026 年部分节假日安排的通知》（国办发明电〔2025〕7 号）、
 *   《关于 2027 年部分节假日安排的通知》（国办发明电〔2026〕10 号）；
 * - 中小学：成都市教育局 2025—2026、2026—2027 学年校历（寒暑假、春秋假）；
 * - 川师：《四川师范大学关于 2026 年寒假 / 暑假放假安排的通知》；2027 年寒假尚未公布，
 *   按 2026 年的规律（春节前约三周放、正月十五后约十天开学）推定。
 * 其他年份用通用规则：元旦、劳动节、国庆按固定日期，春节按农历新年表，寒暑假取常见区间。
 */

import type { CivilDate } from './solar';

export type DayKind = 'work' | 'rest' | 'holiday';
/** 长假的性质：春节城里空，国庆五一出游多 */
export type HolidayKind = 'spring' | 'golden' | 'short';

export interface DayInfo {
  kind: DayKind;
  holiday: HolidayKind | null;
  /** 明天开始放 3 天以上的假（今天还要上班）：傍晚出城、回家的车流更重 */
  eveOfLong: boolean;
  /** 中小学在上课 */
  school: boolean;
  /** 川师在上课（学期中的工作日与周末） */
  campus: boolean;
  /** 0 = 周日 … 6 = 周六 */
  weekday: number;
}

const key = (y: number, m: number, d: number) => y * 10000 + m * 100 + d;
const keyOf = (c: CivilDate) => key(c.year, c.month, c.day);

function addDays(c: CivilDate, n: number): CivilDate {
  const t = new Date(Date.UTC(c.year, c.month - 1, c.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function weekdayOf(c: CivilDate): number {
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
}

type Span = [from: number, to: number, kind: HolidayKind];

/** 已公布的放假区间与调休上班日 */
const OFFICIAL: Record<number, { off: Span[]; work: number[] }> = {
  2026: {
    off: [
      [20260101, 20260103, 'short'],
      [20260215, 20260223, 'spring'],
      [20260404, 20260406, 'short'],
      [20260501, 20260505, 'golden'],
      [20260619, 20260621, 'short'],
      [20260925, 20260927, 'short'],
      [20261001, 20261007, 'golden'],
    ],
    work: [20260104, 20260214, 20260228, 20260509, 20260920, 20261010],
  },
  2027: {
    off: [
      [20270101, 20270103, 'short'],
      [20270205, 20270213, 'spring'],
      [20270403, 20270405, 'short'],
      [20270501, 20270505, 'golden'],
      [20270609, 20270609, 'short'],
      [20270915, 20270915, 'short'],
      [20271001, 20271007, 'golden'],
    ],
    work: [20270131, 20270214, 20270508, 20270926, 20271009],
  },
};

/** 农历新年（正月初一）：没有公布安排的年份按除夕到初六放假 */
const LUNAR_NEW_YEAR: Record<number, [number, number]> = {
  2023: [1, 22],
  2024: [2, 10],
  2025: [1, 29],
  2026: [2, 17],
  2027: [2, 6],
  2028: [1, 26],
  2029: [2, 13],
  2030: [2, 3],
};

function genericOff(c: CivilDate): Span | null {
  const k = keyOf(c);
  const y = c.year;
  const fixed: Span[] = [
    [key(y, 1, 1), key(y, 1, 1), 'short'],
    [key(y, 5, 1), key(y, 5, 5), 'golden'],
    [key(y, 10, 1), key(y, 10, 7), 'golden'],
  ];
  const ny = LUNAR_NEW_YEAR[y];
  if (ny) {
    const first = { year: y, month: ny[0], day: ny[1] };
    fixed.push([keyOf(addDays(first, -1)), keyOf(addDays(first, 6)), 'spring']);
  }
  return fixed.find(([a, b]) => k >= a && k <= b) ?? null;
}

const utcOf = (k: number) =>
  Date.UTC(Math.floor(k / 10000), Math.floor((k % 10000) / 100) - 1, k % 100);
const spanDays = (s: Span) => Math.round((utcOf(s[1]) - utcOf(s[0])) / 86_400_000) + 1;

function offSpan(c: CivilDate): Span | null {
  const t = OFFICIAL[c.year];
  const k = keyOf(c);
  if (t) return t.off.find(([a, b]) => k >= a && k <= b) ?? null;
  return genericOff(c);
}

function isMakeupWorkday(c: CivilDate): boolean {
  return OFFICIAL[c.year]?.work.includes(keyOf(c)) ?? false;
}

/** 中小学不上课的区间（寒暑假、春秋假）；未公布的年份取常见区间 */
const SCHOOL_BREAKS: [number, number][] = [
  [20250712, 20250831],
  [20260131, 20260301],
  [20260401, 20260403],
  [20260704, 20260831],
  [20261111, 20261113],
  [20270123, 20270221],
  [20270703, 20270831],
];

function schoolBreak(c: CivilDate): boolean {
  const k = keyOf(c);
  if (c.year >= 2025 && c.year <= 2027) return SCHOOL_BREAKS.some(([a, b]) => k >= a && k <= b);
  const md = c.month * 100 + c.day;
  return (md >= 705 && md <= 831) || (md >= 125 && md <= 225);
}

/** 川师的放假区间（2027 年寒假为推定） */
const CAMPUS_BREAKS: [number, number][] = [
  [20250712, 20250907],
  [20260126, 20260301],
  [20260720, 20260906],
  [20270118, 20270228],
  [20270719, 20270905],
];

function campusBreak(c: CivilDate): boolean {
  const k = keyOf(c);
  if (c.year >= 2025 && c.year <= 2027) return CAMPUS_BREAKS.some(([a, b]) => k >= a && k <= b);
  const md = c.month * 100 + c.day;
  return (md >= 715 && md <= 905) || (md >= 120 && md <= 228);
}

export function dayInfo(c: CivilDate): DayInfo {
  const weekday = weekdayOf(c);
  const span = offSpan(c);
  let kind: DayKind;
  if (span) kind = 'holiday';
  else if (isMakeupWorkday(c)) kind = 'work';
  else kind = weekday === 0 || weekday === 6 ? 'rest' : 'work';

  let eveOfLong = false;
  if (kind === 'work') {
    const next = offSpan(addDays(c, 1));
    if (next) eveOfLong = spanDays(next) >= 3;
  }
  const off = kind !== 'work';
  return {
    kind,
    holiday: span ? span[2] : null,
    eveOfLong,
    school: !off && !schoolBreak(c),
    campus: !campusBreak(c) && kind !== 'holiday',
    weekday,
  };
}
