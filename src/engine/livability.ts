/**
 * 宜居评分：把量测到的事实换成一个 0–100 的数。
 *
 * 方法参照 ghfind 的确定性评分：分维度各有上限，原始量用对数或饱和曲线归一到 0–1，
 * 扣分项另有上限，结果只取决于输入，不经过任何模型。每个维度都给出量化依据，
 * 界面上逐项显示贡献与扣分，不写"综合评估"之类的空话。
 *
 * 数据全部来自前面几节：逐窗日照、步行可达、视野、地形与楼龄。
 */

/** 大寒日日照标准（分钟） */
const SUNLIGHT_THRESHOLD = 120;

/** log10(v+1) / log10(fullAt+1)，在 fullAt 处归一为 1 */
export function logRatio(value: number, fullAt: number): number {
  if (value <= 0) return 0;
  return Math.min(Math.log10(value + 1) / Math.log10(fullAt + 1), 1);
}

/** 把分钟数换成 0–1：good 分钟以内满分，fair 以外为零，中间线性 */
function nearByMinutes(minutes: number, good: number, fair: number): number {
  if (!Number.isFinite(minutes)) return 0;
  if (minutes <= good) return 1;
  if (minutes >= fair) return 0;
  return 1 - (minutes - good) / (fair - good);
}

/** 到设施或路的距离（米）→ 0–1 */
function nearByMeters(meters: number, good: number, fair: number): number {
  if (!Number.isFinite(meters)) return 0;
  if (meters <= good) return 1;
  if (meters >= fair) return 0;
  return 1 - (meters - good) / (fair - good);
}

export type Tone = 'good' | 'fair' | 'poor';

export interface Dimension {
  key: 'light' | 'transit' | 'amenity' | 'environment' | 'age';
  label: string;
  score: number;
  max: number;
  /** 量化依据，如"62% 窗位达标 · 中位 3 小时 12 分" */
  detail: string;
}

export interface Penalty {
  label: string;
  /** 扣掉的分数（正数） */
  points: number;
  detail: string;
}

export interface LivabilityFacts {
  /** 这栋楼各窗位的大寒日日照分钟数；不在日照计算范围内时为空 */
  windows: ArrayLike<number>;
  /** 各窗位所在墙面的朝向（正北 0°，顺时针），与 windows 一一对应；缺省时按全部窗位算 */
  windowAzimuths?: ArrayLike<number>;
  /** 步行到最近地铁口的分钟数；Infinity 表示 3 km 内没有 */
  metroMinutes: number;
  busMinutes: number;
  groceryMinutes: number;
  marketMinutes: number;
  medicalMinutes: number;
  parkMinutes: number;
  /** 步行 10 分钟内各类设施的家数 */
  within10: {
    grocery: number;
    market: number;
    food: number;
    medical: number;
    park: number;
  };
  /** 多扇窗外视野开阔度的平均值，0–1 */
  openness: number;
  /** 到最近水面或公园绿地的直线距离（米） */
  greenMeters: number;
  /** 楼基处地面坡度，百分比 */
  slopePercent: number;
  /** 到最近主干道（快速路、主干道、次干道）的直线距离（米）与等级 */
  roadMeters: number | null;
  roadClass: number;
  /** 建成年代；null 表示未知 */
  builtYear: number | null;
}

export interface Livability {
  /** 0–100 */
  total: number;
  tone: Tone;
  label: string;
  dimensions: Dimension[];
  penalties: Penalty[];
  /** 一句话的依据摘要，由规则生成 */
  summary: string;
}

const MAX = {
  light: 30,
  transit: 20,
  amenity: 20,
  environment: 15,
  age: 15,
} as const;

/** 楼龄评分以今年为基准；写死会让"新楼"逐年变旧，取页面年份即可 */
const CURRENT_YEAR = new Date().getFullYear();

const GRADE_LABEL: [number, string, Tone][] = [
  [85, '优秀', 'good'],
  [72, '良好', 'good'],
  [58, '中等', 'fair'],
  [42, '一般', 'fair'],
  [0, '较差', 'poor'],
];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** 朝南（偏东、偏西各 67.5° 以内）算主朝向 */
const SOUTH_SPREAD = 67.5;

/**
 * 住宅的起居室、主卧几乎都朝南，大寒日标准也只要求每户有一间居室达标；
 * 把北墙、山墙上的窗位一并平均会把板楼一律算成"采光差"。
 * 有朝向时只取朝南墙面上的窗位；一栋楼没有朝南的墙（极少见）才退回全部窗位。
 */
export function mainFacadeWindows(
  windows: ArrayLike<number>,
  azimuths: ArrayLike<number> | undefined,
): { values: number[]; south: boolean } {
  const all = Array.from(windows);
  if (!azimuths || azimuths.length !== windows.length) return { values: all, south: false };
  const south = all.filter((_, i) => {
    const d = Math.abs((((((azimuths[i] as number) - 180) % 360) + 540) % 360) - 180);
    return d <= SOUTH_SPREAD;
  });
  return south.length > 0 ? { values: south, south: true } : { values: all, south: false };
}

function lightDimension(facts: LivabilityFacts): Dimension | null {
  if (facts.windows.length === 0) return null;
  const { values, south } = mainFacadeWindows(facts.windows, facts.windowAzimuths);
  const n = values.length;
  let lit = 0;
  for (const v of values) if (v >= SUNLIGHT_THRESHOLD) lit++;
  const share = lit / n;
  const med = median(values);
  // 达标比例决定大半，中位数兜底：一栋楼只有少数窗位好不能算采光好
  const score = MAX.light * (0.45 * share ** 0.7 + 0.55 * clamp(med / 240, 0, 1));
  return {
    key: 'light',
    label: '采光',
    score,
    max: MAX.light,
    detail: `${south ? '朝南' : ''}窗位 ${Math.round(share * 100)}% 达标 · 中位 ${hours(med)}`,
  };
}

function hours(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} 分钟`;
  return r === 0 ? `${h} 小时` : `${h} 小时 ${r} 分`;
}

function transitDimension(facts: LivabilityFacts): Dimension {
  const metro = Number.isFinite(facts.metroMinutes)
    ? clamp(1 - (facts.metroMinutes - 2) / 26, 0, 1) ** 0.9 * 14
    : 0;
  const bus = Number.isFinite(facts.busMinutes)
    ? clamp(1 - (facts.busMinutes - 2) / 18, 0, 1) ** 0.9 * 6
    : 0;
  const metroText = Number.isFinite(facts.metroMinutes)
    ? `步行到地铁 ${Math.max(1, Math.round(facts.metroMinutes))} 分钟`
    : '地铁 3 km 内没有';
  const busText = Number.isFinite(facts.busMinutes)
    ? `公交 ${Math.max(1, Math.round(facts.busMinutes))} 分钟`
    : '公交 3 km 内没有';
  return {
    key: 'transit',
    label: '交通',
    score: metro + bus,
    max: MAX.transit,
    detail: `${metroText} · ${busText}`,
  };
}

function amenityDimension(facts: LivabilityFacts): Dimension {
  const w = facts.within10;
  // 最近一处与 10 分钟内的家数各占一部分：既要有，也要有得选
  const grocery =
    6 * (0.7 * nearByMinutes(facts.groceryMinutes, 5, 13) + 0.3 * logRatio(w.grocery, 8));
  const market =
    4 * (0.75 * nearByMinutes(facts.marketMinutes, 6, 15) + 0.25 * logRatio(w.market, 3));
  const food = 4 * logRatio(w.food, 40);
  const medical =
    3 * (0.75 * nearByMinutes(facts.medicalMinutes, 6, 15) + 0.25 * logRatio(w.medical, 6));
  const park = 3 * (0.75 * nearByMinutes(facts.parkMinutes, 6, 15) + 0.25 * logRatio(w.park, 4));
  const nearest = (m: number) => (Number.isFinite(m) ? `${Math.max(1, Math.round(m))} 分钟` : '无');
  return {
    key: 'amenity',
    label: '生活配套',
    score: grocery + market + food + medical + park,
    max: MAX.amenity,
    detail: `步行到超市 ${nearest(facts.groceryMinutes)} · 菜市场 ${nearest(
      facts.marketMinutes,
    )} · 10 分钟内餐饮 ${w.food} 家`,
  };
}

function environmentDimension(facts: LivabilityFacts): Dimension {
  const openness = clamp(facts.openness, 0, 1) ** 0.6 * 7;
  const green = 4 * nearByMeters(facts.greenMeters, 0, 600);
  const slope =
    facts.slopePercent <= 2
      ? 4
      : facts.slopePercent <= 5
        ? 3
        : facts.slopePercent <= 8
          ? 2
          : facts.slopePercent <= 12
            ? 1
            : 0;
  return {
    key: 'environment',
    label: '环境与视野',
    score: openness + green + slope,
    max: MAX.environment,
    detail: `开阔度 ${Math.round(clamp(facts.openness, 0, 1) * 100)}% · 距水面或公园 ${Math.round(
      facts.greenMeters,
    )} m · 坡度 ${facts.slopePercent.toFixed(1)}%`,
  };
}

function ageDimension(facts: LivabilityFacts): Dimension {
  if (facts.builtYear === null) {
    return { key: 'age', label: '楼龄', score: 8, max: MAX.age, detail: '建成年代未知' };
  }
  const age = Math.max(0, CURRENT_YEAR - facts.builtYear);
  const score = MAX.age * clamp(1 - (age - 5) / 45, 0.2, 1);
  return {
    key: 'age',
    label: '楼龄',
    score,
    max: MAX.age,
    detail:
      facts.builtYear > CURRENT_YEAR
        ? `预计 ${facts.builtYear} 年交付`
        : `${facts.builtYear} 年建成 · ${age} 年`,
  };
}

function noisePenalty(facts: LivabilityFacts): Penalty | null {
  if (facts.roadMeters === null) return null;
  const near = facts.roadClass <= 2;
  const radius = near ? 120 : 60;
  if (facts.roadMeters >= radius) return null;
  const cap = near ? 6 : 2.5;
  const points = cap * (1 - facts.roadMeters / radius);
  const road = facts.roadClass <= 1 ? '快速路或主干道' : facts.roadClass === 2 ? '次干道' : '支路';
  return {
    label: '交通噪声',
    points,
    detail: `距${road} ${Math.round(facts.roadMeters)} m`,
  };
}

/** 各项分数按实际给出的维度归一：不在日照计算范围内的楼没有采光一项 */
export function scoreLivability(facts: LivabilityFacts): Livability {
  const dimensions = [
    lightDimension(facts),
    transitDimension(facts),
    amenityDimension(facts),
    environmentDimension(facts),
    ageDimension(facts),
  ].filter((d): d is Dimension => d !== null);

  const penalty = noisePenalty(facts);
  const penalties = penalty ? [penalty] : [];
  const earned = dimensions.reduce((sum, d) => sum + d.score, 0);
  const possible = dimensions.reduce((sum, d) => sum + d.max, 0);
  const deducted = penalties.reduce((sum, p) => sum + p.points, 0);
  const total = Math.round(clamp((earned / possible) * 100 - deducted, 0, 100));

  const grade = GRADE_LABEL.find(([min]) => total >= min);
  const label = grade ? grade[1] : '较差';
  const tone: Tone = grade ? grade[2] : 'poor';

  return { total, tone, label, dimensions, penalties, summary: summarize(dimensions, penalties) };
}

const STRONG: Record<Dimension['key'], string> = {
  light: '采光好',
  transit: '交通方便',
  amenity: '配套齐全',
  environment: '环境开阔',
  age: '楼龄新',
};

const WEAK: Record<Dimension['key'], string> = {
  light: '采光偏弱',
  transit: '交通偏弱',
  amenity: '配套偏少',
  environment: '环境一般',
  age: '楼龄偏老',
};

function summarize(dimensions: Dimension[], penalties: Penalty[]): string {
  const ranked = [...dimensions].sort((a, b) => b.score / b.max - a.score / a.max);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (!best || !worst) return '';
  const part: string[] = [];
  if (best.score / best.max >= 0.75) part.push(STRONG[best.key]);
  if (worst !== best && worst.score / worst.max < 0.45) part.push(WEAK[worst.key]);
  if (penalties.length) part.push(penalties.map((p) => p.label).join('、'));
  if (!part.length) return '各项均衡';
  return part.join('，');
}
