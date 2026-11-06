/**
 * 太阳位置与真太阳时。
 *
 * 算法取自 NOAA Solar Calculator（Meeus《Astronomical Algorithms》的简化版），
 * 在 1950–2050 年内高度角、方位角误差约 0.01°。日照分析每分钟太阳移动约 0.25°，
 * 这个精度足够；正确性由 solar.test.ts 对拍 NREL SPA 参考值保证。
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/** 北京时间相对 UTC 的偏移 */
export const BEIJING_OFFSET_MINUTES = 8 * 60;

export interface SunPosition {
  /** 方位角：正北为 0°，顺时针（东 90°、南 180°、西 270°） */
  azimuth: number;
  /** 几何高度角，未计大气折射 */
  elevation: number;
  /** 视高度角，计入大气折射；阳光实际从这个角度射来 */
  apparentElevation: number;
  /** 太阳赤纬 */
  declination: number;
  /** 时差（真太阳时 − 平太阳时），分钟 */
  eotMinutes: number;
}

interface SolarEphemeris {
  declination: number;
  eotMinutes: number;
  apparentLongitude: number;
}

const mod = (x: number, m: number) => ((x % m) + m) % m;

function ephemeris(utcMs: number): SolarEphemeris {
  const jd = utcMs / MS_PER_DAY + 2440587.5;
  const t = (jd - 2451545) / 36525;

  const meanLong = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = meanAnomaly * RAD;
  const center =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;

  const omega = (125.04 - 1934.136 * t) * RAD;
  const apparentLongitude = meanLong + center - 0.00569 - 0.00478 * Math.sin(omega);

  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * RAD;

  const lambda = apparentLongitude * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(lambda)) * DEG;

  const y = Math.tan(obliquity / 2) ** 2;
  const l0 = meanLong * RAD;
  const eot =
    y * Math.sin(2 * l0) -
    2 * eccentricity * Math.sin(m) +
    4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
    0.5 * y * y * Math.sin(4 * l0) -
    1.25 * eccentricity * eccentricity * Math.sin(2 * m);

  return {
    declination,
    eotMinutes: 4 * eot * DEG,
    apparentLongitude: mod(apparentLongitude, 360),
  };
}

/** NOAA 的大气折射近似（度） */
function refraction(elevation: number): number {
  if (elevation > 85) return 0;
  const te = Math.tan(elevation * RAD);
  let arcsec: number;
  if (elevation > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevation > -0.575)
    arcsec =
      1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

/** UTC 时刻对应某经度的真太阳时（当日第几分钟，0–1440） */
export function utcToTrueSolarMinutes(utcMs: number, lonDeg: number): number {
  const utcMinutes = mod(utcMs, MS_PER_DAY) / MS_PER_MINUTE;
  return mod(utcMinutes + ephemeris(utcMs).eotMinutes + 4 * lonDeg, 1440);
}

export function sunPosition(utcMs: number, latDeg: number, lonDeg: number): SunPosition {
  const { declination, eotMinutes } = ephemeris(utcMs);
  const tst = mod(mod(utcMs, MS_PER_DAY) / MS_PER_MINUTE + eotMinutes + 4 * lonDeg, 1440);
  const hourAngle = (tst / 4 - 180) * RAD;

  const phi = latDeg * RAD;
  const delta = declination * RAD;
  const sinEl =
    Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) * DEG;
  const azimuth = mod(
    Math.atan2(
      -Math.sin(hourAngle),
      Math.tan(delta) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle),
    ) * DEG,
    360,
  );

  return {
    azimuth,
    elevation,
    apparentElevation: elevation + refraction(elevation),
    declination,
    eotMinutes,
  };
}

/** 公历日期（年、月 1–12、日），按北京时间理解 */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/**
 * 某个北京时间日期里，某经度的真太阳时 `tstMinutes` 对应的 UTC 时刻。
 * 时差随时间缓慢变化，迭代两次即可收敛到毫秒级。
 */
export function trueSolarTimeToUtc(date: CivilDate, tstMinutes: number, lonDeg: number): number {
  // 真太阳时的"当日"以当地子夜为界；先取北京时间正午附近作为初值，保证落在同一天
  const civilNoonUtc =
    Date.UTC(date.year, date.month - 1, date.day, 12) - BEIJING_OFFSET_MINUTES * MS_PER_MINUTE;
  const dayStartUtc = Math.floor(civilNoonUtc / MS_PER_DAY) * MS_PER_DAY;
  let utc = civilNoonUtc;
  for (let i = 0; i < 3; i++) {
    const offset = tstMinutes - 4 * lonDeg - ephemeris(utc).eotMinutes;
    utc = dayStartUtc + offset * MS_PER_MINUTE;
  }
  return utc;
}

/** 把 UTC 时刻转成北京时间当日的分钟数 */
export function utcToBeijingMinutes(utcMs: number): number {
  return mod(utcMs / MS_PER_MINUTE + BEIJING_OFFSET_MINUTES, 1440);
}

export function utcToBeijingDate(utcMs: number): CivilDate {
  const d = new Date(utcMs + BEIJING_OFFSET_MINUTES * MS_PER_MINUTE);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export const SOLAR_TERMS = {
  春分: 0,
  夏至: 90,
  秋分: 180,
  冬至: 270,
  小寒: 285,
  大寒: 300,
} as const;

export type SolarTermName = keyof typeof SOLAR_TERMS;

/**
 * 某年某节气的交节时刻（UTC 毫秒），即太阳视黄经到达对应度数的时刻。
 * 冬至取该年 12 月那一次，其余取该年内那一次。
 */
export function solarTermUtc(year: number, term: SolarTermName): number {
  const target = SOLAR_TERMS[term];
  // 以 3 月 20 日为视黄经 0°，按平均角速度估初值
  let utc = Date.UTC(year, 2, 20) + (target / 360) * 365.2422 * MS_PER_DAY;
  if (utc >= Date.UTC(year + 1, 0, 1)) utc -= 365.2422 * MS_PER_DAY;
  for (let i = 0; i < 8; i++) {
    const diff = mod(ephemeris(utc).apparentLongitude - target + 180, 360) - 180;
    utc -= (diff / 0.98564736) * MS_PER_DAY;
  }
  return utc;
}

/**
 * 太阳方向的单位向量，东-北-天（ENU）坐标：x 指东，y 指北，z 指天顶。
 */
export function sunDirectionEnu(
  azimuthDeg: number,
  elevationDeg: number,
): [number, number, number] {
  const az = azimuthDeg * RAD;
  const el = elevationDeg * RAD;
  const c = Math.cos(el);
  return [c * Math.sin(az), c * Math.cos(az), Math.sin(el)];
}
