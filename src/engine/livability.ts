/**
 * 宜居评分：把量测到的事实换成一个 0–100 的数。
 *
 * 方法参照 ghfind 的确定性评分：分维度各有上限，原始量用对数或饱和曲线归一到 0–1，
 * 扣分项另有上限，结果只取决于输入，不经过任何模型。每个维度都给出量化依据。
 *
 * 片区是成熟的城区，几乎每栋楼走几分钟都有超市、地铁，宽松的曲线会让大家都拿满分。
 * 所以曲线的满分与零分都按片区里实际的分布定，并加入片区内确实拉得开的因素：
 * 低层窗位的遮挡、30 分钟地铁可达的车站数、医院与学校、楼间距、周边建筑覆盖率、电梯。
 *
 * 数据全部来自前面几节：逐窗日照、步行与地铁可达、视野、场地与楼宇。
 */

/** 大寒日日照标准（分钟） */
const SUNLIGHT_THRESHOLD = 120;

/** log10(v+1) / log10(fullAt+1)，在 fullAt 处归一为 1 */
export function logRatio(value: number, fullAt: number): number {
  if (value <= 0) return 0;
  return Math.min(Math.log10(value + 1) / Math.log10(fullAt + 1), 1);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** 越小越好的量 → 0–1：good 以内满分，fair 以外为零，中间线性 */
function nearBy(value: number, good: number, fair: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= good) return 1;
  if (value >= fair) return 0;
  return 1 - (value - good) / (fair - good);
}

/** 越大越好的量 → 0–1：low 以下为零，high 以上满分 */
function farBy(value: number, low: number, high: number): number {
  return clamp((value - low) / (high - low), 0, 1);
}

export type Tone = 'good' | 'fair' | 'poor';

/** 一条量化依据：短标签 + 数值，界面上排成整齐的小格 */
export interface Fact {
  label: string;
  value: string;
}

export interface Dimension {
  key: 'light' | 'transit' | 'amenity' | 'education' | 'environment' | 'building';
  label: string;
  score: number;
  max: number;
  facts: Fact[];
  /** 依据连成一句，如"朝南达标 62% · 中位 3.2 小时"（摘要、测试用） */
  detail: string;
}

export interface Penalty {
  label: string;
  /** 扣掉的分数（正数） */
  points: number;
  facts: Fact[];
  detail: string;
}

const joinFacts = (facts: Fact[]) => facts.map((f) => `${f.label} ${f.value}`).join(' · ');

function dimension(
  key: Dimension['key'],
  label: string,
  score: number,
  max: number,
  facts: Fact[],
): Dimension {
  return { key, label, score, max, facts, detail: joinFacts(facts) };
}

export interface LivabilityFacts {
  /** 这栋楼各窗位的大寒日日照分钟数；不在日照计算范围内时为空 */
  windows: ArrayLike<number>;
  /** 各窗位所在墙面的朝向（正北 0°，顺时针），与 windows 一一对应；缺省时按全部窗位算 */
  windowAzimuths?: ArrayLike<number>;
  /** 步行到最近地铁口的分钟数；Infinity 表示 3 km 内没有 */
  metroMinutes: number;
  /** 步行 + 地铁 30 分钟内能出站的车站数 */
  reachStations: number;
  busMinutes: number;
  groceryMinutes: number;
  marketMinutes: number;
  /** 步行到最近医院（不算诊所、门诊部）的分钟数 */
  hospitalMinutes: number;
  kindergartenMinutes: number;
  primaryMinutes: number;
  middleMinutes: number;
  /** 步行 10 分钟内各类设施的家数 */
  within10: {
    grocery: number;
    food: number;
    sport: number;
  };
  /** 多扇窗外视野开阔度的平均值，0–1 */
  openness: number;
  /** 窗前正对面遮挡物距离的中位数（米），300 m 内无遮挡记 300 */
  spacing: number;
  /** 到最近水面或公园绿地的直线距离（米） */
  greenMeters: number;
  /** 楼周 150 m 内的建筑覆盖率（基底面积 ÷ 圆面积），0–1 */
  coverage: number;
  /** 到最近的快速路、主干道、次干道的直线距离（米），没有为 Infinity */
  roads: readonly [number, number, number];
  /** 地上层数 */
  floors: number;
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
  light: 24,
  transit: 18,
  amenity: 16,
  education: 10,
  environment: 17,
  building: 15,
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

function quantile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return sorted[Math.min(n - 1, Math.floor(p * n))] as number;
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

/** 时长写短：一小时内"37 分钟"，以上"3.2 小时" */
function hours(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} 分钟`;
  return `${(m / 60).toFixed(1).replace(/\.0$/, '')} 小时`;
}

const walk = (m: number) => (Number.isFinite(m) ? `${Math.max(1, Math.round(m))} 分钟` : '3 km 外');

/**
 * 采光：朝南窗位的达标比例、中位时长，再加上最差两成窗位的时长——
 * 低层被前排楼挡住是这一片最常见的问题，只看中位数会把它抹平。
 */
function lightDimension(facts: LivabilityFacts): Dimension | null {
  if (facts.windows.length === 0) return null;
  const { values, south } = mainFacadeWindows(facts.windows, facts.windowAzimuths);
  const sorted = [...values].sort((a, b) => a - b);
  let lit = 0;
  for (const v of sorted) if (v >= SUNLIGHT_THRESHOLD) lit++;
  const share = lit / sorted.length;
  const med = quantile(sorted, 0.5);
  const low = quantile(sorted, 0.2);
  const score = MAX.light * (0.3 * share + 0.35 * farBy(med, 60, 360) + 0.35 * farBy(low, 0, 240));
  return dimension('light', '采光', score, MAX.light, [
    { label: south ? '朝南达标' : '达标', value: `${Math.round(share * 100)}%` },
    { label: '中位', value: hours(med) },
    { label: '较差两成', value: hours(low) },
  ]);
}

/** 交通：走到地铁口、30 分钟内坐地铁能到多少站、公交 */
function transitDimension(facts: LivabilityFacts): Dimension {
  const metro = 8 * nearBy(facts.metroMinutes, 3, 18);
  const reach = 6 * farBy(facts.reachStations, 8, 34);
  const bus = 4 * nearBy(facts.busMinutes, 1, 8);
  return dimension('transit', '交通', metro + reach + bus, MAX.transit, [
    { label: '地铁', value: walk(facts.metroMinutes) },
    { label: '30 分钟可达', value: `${facts.reachStations} 站` },
    { label: '公交', value: walk(facts.busMinutes) },
  ]);
}

/** 生活配套：超市、菜市场、医院要近，餐饮与运动场所要多 */
function amenityDimension(facts: LivabilityFacts): Dimension {
  const w = facts.within10;
  const grocery = 4 * (0.6 * nearBy(facts.groceryMinutes, 1, 8) + 0.4 * farBy(w.grocery, 2, 20));
  const market = 4 * nearBy(facts.marketMinutes, 3, 12);
  const hospital = 3 * nearBy(facts.hospitalMinutes, 5, 25);
  const food = 3 * farBy(w.food, 20, 220);
  const sport = 2 * farBy(w.sport, 1, 15);
  return dimension('amenity', '生活配套', grocery + market + hospital + food + sport, MAX.amenity, [
    { label: '超市', value: walk(facts.groceryMinutes) },
    { label: '菜市场', value: walk(facts.marketMinutes) },
    { label: '医院', value: walk(facts.hospitalMinutes) },
    { label: '附近餐饮', value: `${w.food} 家` },
  ]);
}

/** 教育：步行到幼儿园、小学、中学 */
function educationDimension(facts: LivabilityFacts): Dimension {
  const k = 3 * nearBy(facts.kindergartenMinutes, 3, 15);
  const p = 4 * nearBy(facts.primaryMinutes, 5, 20);
  const m = 3 * nearBy(facts.middleMinutes, 8, 30);
  return dimension('education', '教育', k + p + m, MAX.education, [
    { label: '幼儿园', value: walk(facts.kindergartenMinutes) },
    { label: '小学', value: walk(facts.primaryMinutes) },
    { label: '中学', value: walk(facts.middleMinutes) },
  ]);
}

/** 环境与视野：楼间距、开阔度、周边建筑密不密、离水面和公园多远 */
function environmentDimension(facts: LivabilityFacts): Dimension {
  const spacing = 5 * farBy(facts.spacing, 15, 70);
  const openness = 5 * clamp(facts.openness, 0, 1) ** 0.7;
  const coverage = 3 * nearBy(facts.coverage, 0.18, 0.42);
  const green = 4 * nearBy(facts.greenMeters, 150, 900);
  return dimension(
    'environment',
    '环境与视野',
    spacing + openness + coverage + green,
    MAX.environment,
    [
      { label: '楼间距', value: `${Math.round(facts.spacing)} m` },
      { label: '开阔度', value: `${Math.round(clamp(facts.openness, 0, 1) * 100)}%` },
      { label: '周边覆盖', value: `${Math.round(facts.coverage * 100)}%` },
      { label: '水面公园', value: `${Math.round(facts.greenMeters)} m` },
    ],
  );
}

/**
 * 楼龄与电梯：新楼得分高。电梯按层数与年代判断：9 层以上都有；
 * 7–8 层的老楼常是"6+1"的多层，2010 年以后建的才普遍装了；4–6 层的多层大多没有。
 * 爬楼是老小区最直接的不便。
 */
function hasLift(floors: number, builtYear: number | null): boolean | null {
  if (floors >= 9) return true;
  if (floors >= 7) return builtYear === null ? null : builtYear >= 2010;
  return false;
}

function buildingDimension(facts: LivabilityFacts): Dimension {
  let age = 5;
  const out: Fact[] = [];
  if (facts.builtYear === null) {
    out.push({ label: '建成', value: '未知' });
  } else {
    const years = CURRENT_YEAR - facts.builtYear;
    age = 10 * clamp(1 - (years - 3) / 37, 0.1, 1);
    if (years < 0) {
      out.push({ label: '预计交付', value: `${facts.builtYear} 年` });
    } else {
      out.push({ label: '建成', value: `${facts.builtYear} 年` });
      out.push({ label: '楼龄', value: `${years} 年` });
    }
  }
  const has = hasLift(facts.floors, facts.builtYear);
  const lift = has ? 5 : facts.floors <= 3 ? 3.5 : has === null ? 3 : 1;
  out.push({ label: '层数', value: `${facts.floors} 层` });
  out.push({
    label: '电梯',
    value: has ? '有' : facts.floors <= 3 ? '低层不需' : has === null ? '—' : '无',
  });
  return dimension('building', '楼龄与电梯', age + lift, MAX.building, out);
}

/** 交通噪声：快速路影响最远、扣得最多，主干道次之，次干道只管贴边的楼；取最重的一条 */
const NOISE: { radius: number; cap: number; name: string }[] = [
  { radius: 220, cap: 8, name: '快速路' },
  { radius: 130, cap: 5, name: '主干道' },
  { radius: 70, cap: 2.5, name: '次干道' },
];

function noisePenalty(facts: LivabilityFacts): Penalty | null {
  let best: Penalty | null = null;
  NOISE.forEach((n, cls) => {
    const d = facts.roads[cls] as number;
    if (!(d < n.radius)) return;
    const points = n.cap * (1 - d / n.radius);
    if (!best || points > best.points) {
      const facts = [{ label: `距${n.name}`, value: `${Math.round(d)} m` }];
      best = { label: '交通噪声', points, facts, detail: joinFacts(facts) };
    }
  });
  return best;
}

/** 各项分数按实际给出的维度归一：不在日照计算范围内的楼没有采光一项 */
export function scoreLivability(facts: LivabilityFacts): Livability {
  const dimensions = [
    lightDimension(facts),
    transitDimension(facts),
    amenityDimension(facts),
    educationDimension(facts),
    environmentDimension(facts),
    buildingDimension(facts),
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
  education: '上学近',
  environment: '环境开阔',
  building: '楼新有电梯',
};

const WEAK: Record<Dimension['key'], string> = {
  light: '采光偏弱',
  transit: '交通偏弱',
  amenity: '配套偏少',
  education: '上学偏远',
  environment: '楼距偏密',
  building: '楼老或无电梯',
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
