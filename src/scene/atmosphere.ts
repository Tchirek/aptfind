/**
 * 大气散射天空：单次散射、球面大气，瑞利 + 米氏散射，臭氧吸收。
 * 思路与 scatter（BeiyanYunyi/scatter，参照 "On Rendering the Sky, Sunsets, and Planets"）相同，
 * 但为了轻量：
 * - 只在 CPU 上算一张 64×32 的查找表（方位角 × 高度角），太阳挪动了才重算，约 5 ms；
 * - 天空着色器每个像素只查一次表，再叠一个太阳圆盘；
 * - 雾色、天光色取自同一个模型，地平线上天和地的颜色接得上。
 *
 * 坐标：ENU（x 东、y 北、z 天顶），太阳方向为单位向量。
 */

const R_GROUND = 6_360_000;
const R_TOP = 6_420_000;
/** 观察者海拔（成都平原约 500 m） */
const OBSERVER = 500;
const H_RAYLEIGH = 8000;
const H_MIE = 1200;
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6] as const;
const BETA_M = 3.996e-6;
const BETA_M_EXT = BETA_M * 1.11;
const BETA_OZONE = [0.65e-6, 1.881e-6, 0.085e-6] as const;
const MIE_G = 0.8;
const SUN_INTENSITY = 22;
const VIEW_STEPS = 16;
/**
 * 视线最多积分这么远（米）。单次散射在掠地平线方向上路径太长，会把地平线算得发黄发暗；
 * 真实大气里多次散射会把它提亮发白。截短视线是一个便宜的近似。
 */
const MAX_VIEW = 90_000;
const LIGHT_STEPS = 6;

/**
 * 从地心正上方 oz 处出发、单位方向的径向分量为 mu 的射线，与半径 r 的球面的远交点距离；
 * 没有交点返回 −1
 */
function sphereFar(oz: number, mu: number, r: number): number {
  const b = oz * mu;
  const c = oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b + Math.sqrt(disc);
}

function densities(h: number): [number, number, number] {
  const r = Math.exp(-h / H_RAYLEIGH);
  const m = Math.exp(-h / H_MIE);
  const o = Math.max(0, 1 - Math.abs(h - 25_000) / 15_000);
  return [r, m, o];
}

/** 从高度 h（米）的点沿方向（与天顶夹角余弦 mu）到大气顶的光学厚度 [瑞利, 米氏, 臭氧] */
function opticalDepthToTop(h: number, mu: number): [number, number, number] | null {
  const oz = R_GROUND + h;
  const sinT = Math.sqrt(Math.max(0, 1 - mu * mu));
  // 被地面挡住
  const bGround = oz * mu;
  const cGround = oz * oz - R_GROUND * R_GROUND;
  if (mu < 0 && bGround * bGround - cGround >= 0) return null;
  const len = sphereFar(oz, mu, R_TOP);
  if (len <= 0) return [0, 0, 0];
  const ds = len / LIGHT_STEPS;
  let dr = 0;
  let dm = 0;
  let dO = 0;
  for (let i = 0; i < LIGHT_STEPS; i++) {
    const t = (i + 0.5) * ds;
    const x = sinT * t;
    const z = oz + mu * t;
    const hh = Math.sqrt(x * x + z * z) - R_GROUND;
    const [r, m, o] = densities(hh);
    dr += r * ds;
    dm += m * ds;
    dO += o * ds;
  }
  return [dr, dm, dO];
}

const rayleighPhase = (c: number) => (3 / (16 * Math.PI)) * (1 + c * c);
function miePhase(c: number): number {
  const g = MIE_G;
  const g2 = g * g;
  return (
    ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + c * c))) / ((2 + g2) * (1 + g2 - 2 * g * c) ** 1.5)
  );
}

/** 方向 dir 上的天空辐亮度（未经曝光，线性 RGB） */
export function skyRadiance(
  dir: readonly [number, number, number],
  sun: readonly [number, number, number],
): [number, number, number] {
  const [dx, dy, dzRaw] = dir;
  // 地平线以下按略高于地平线处理（下面是地面，看不到）
  const dz = Math.max(dzRaw, 0.002);
  const n = Math.hypot(dx, dy, dz);
  const vx = dx / n;
  const vy = dy / n;
  const vz = dz / n;
  const oz = R_GROUND + OBSERVER;
  const len = Math.min(MAX_VIEW, sphereFar(oz, vz, R_TOP));
  const ds = len / VIEW_STEPS;
  const cosSV = vx * sun[0] + vy * sun[1] + vz * sun[2];
  const pr = rayleighPhase(cosSV);
  const pm = miePhase(cosSV);
  let accR = 0;
  let accM = 0;
  let accO = 0;
  const out: [number, number, number] = [0, 0, 0];
  const sumR = [0, 0, 0];
  const sumM = [0, 0, 0];
  for (let i = 0; i < VIEW_STEPS; i++) {
    const t = (i + 0.5) * ds;
    // 样点相对地心：沿视线水平前进 sinV·t、竖直 vz·t
    const px = vx * t;
    const py = vy * t;
    const pz = oz + vz * t;
    const r = Math.sqrt(px * px + py * py + pz * pz);
    const h = r - R_GROUND;
    const [dR, dM, dO] = densities(h);
    accR += dR * ds;
    accM += dM * ds;
    accO += dO * ds;
    // 样点处的太阳天顶角余弦
    const mu = (px * sun[0] + py * sun[1] + pz * sun[2]) / r;
    const light = opticalDepthToTop(h, mu);
    if (!light) continue;
    for (let c = 0; c < 3; c++) {
      const tau =
        (BETA_R[c] as number) * (accR + light[0]) +
        BETA_M_EXT * (accM + light[1]) +
        (BETA_OZONE[c] as number) * (accO + light[2]);
      const att = Math.exp(-tau);
      sumR[c] = (sumR[c] as number) + dR * att * ds;
      sumM[c] = (sumM[c] as number) + dM * att * ds;
    }
  }
  for (let c = 0; c < 3; c++) {
    out[c] =
      SUN_INTENSITY *
      ((sumR[c] as number) * (BETA_R[c] as number) * pr + (sumM[c] as number) * BETA_M * pm);
  }
  return out;
}

/** 太阳光穿过整层大气后的颜色（透射率），用于太阳圆盘与直射光色 */
export function sunTransmittance(sun: readonly [number, number, number]): [number, number, number] {
  const depth = opticalDepthToTop(OBSERVER, Math.max(sun[2], -0.05));
  if (!depth) return [0, 0, 0];
  return [0, 1, 2].map((c) =>
    Math.exp(
      -(
        (BETA_R[c] as number) * depth[0] +
        BETA_M_EXT * depth[1] +
        (BETA_OZONE[c] as number) * depth[2]
      ),
    ),
  ) as [number, number, number];
}

/** 曝光：把辐亮度压到显示范围，天空与雾用同一条曲线 */
export const EXPOSURE = 1.6;
export const expose = (v: number) => 1 - Math.exp(-v * EXPOSURE);

export const LUT_W = 64;
export const LUT_H = 32;

/**
 * 查找表：u 为方位角（0 = 正北，顺时针），v 为高度角（按 √ 分布，地平线附近更密）。
 * 输出已曝光的线性 RGB，RGBA 浮点。
 */
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 暮光的多次散射近似：太阳刚落到地平线下时，高层大气仍被照亮，天顶是深蓝而不是黑。
 * 单次散射给不出这一点，按太阳高度加一层很淡的蓝。
 */
function twilight(sunZ: number, viewZ: number): [number, number, number] {
  const el = (Math.asin(Math.max(-1, Math.min(1, sunZ))) * 180) / Math.PI;
  const k = smooth(-11, -1, el) * (1 - smooth(4, 16, el));
  const h = Math.max(0, viewZ);
  return [k * (0.05 + 0.04 * (1 - h)), k * (0.07 + 0.03 * (1 - h)), k * (0.16 + 0.02 * h)];
}

export function buildSkyLut(
  sun: readonly [number, number, number],
  out?: Float32Array,
): Float32Array {
  const data = out ?? new Float32Array(LUT_W * LUT_H * 4);
  for (let j = 0; j < LUT_H; j++) {
    const v = (j + 0.5) / LUT_H;
    const el = v * v * (Math.PI / 2);
    for (let i = 0; i < LUT_W; i++) {
      const az = ((i + 0.5) / LUT_W) * Math.PI * 2;
      const c = Math.cos(el);
      const dir: [number, number, number] = [c * Math.sin(az), c * Math.cos(az), Math.sin(el)];
      const L = skyRadiance(dir, sun);
      const t = twilight(sun[2], dir[2]);
      const o = (j * LUT_W + i) * 4;
      data[o] = expose(L[0] + t[0]);
      data[o + 1] = expose(L[1] + t[1]);
      data[o + 2] = expose(L[2] + t[2]);
      data[o + 3] = 1;
    }
  }
  return data;
}

/** 查找表里某个高度角一整圈的平均色（雾、天光用） */
export function lutRingAverage(data: Float32Array, row: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < LUT_W; i++) {
    const o = (row * LUT_W + i) * 4;
    out[0] += (data[o] as number) / LUT_W;
    out[1] += (data[o + 1] as number) / LUT_W;
    out[2] += (data[o + 2] as number) / LUT_W;
  }
  return out;
}
