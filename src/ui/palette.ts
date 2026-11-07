/**
 * 日照时数的发散色阶，以 2 小时为界（大寒日标准的门槛）。
 *
 * 只给选中的那栋楼着色，周围是米色的程序化立面，所以两侧都要跳出来：
 * 不足 2 小时用蓝色，越缺越深；2 小时以上用阳光的金色到琥珀色，越久越深。
 * 两侧各自明度单调（冷色 0.33→0.74，暖色 0.89→0.60），阈值处一浅蓝一浅金，色相相反；
 * 阈值另由深色等时线标出。
 */

export const THRESHOLD_MINUTES = 120;

/** 0 → 2 小时，由深到浅 */
export const COOL_RAMP = ['#133466', '#24589e', '#3d7fd0', '#7fb0ec'] as const;
/** 2 → 6 小时及以上，由浅到深 */
export const WARM_RAMP = ['#f6d98a', '#efbb55', '#de9330', '#c46f1c'] as const;
/** 暖色阶覆盖的时长：至少 4 小时；白天更长时一直铺到"从日出照到日落" */
export const WARM_SPAN = 240;

/** 某天的暖色阶跨度：昼长减去阈值，不短于 WARM_SPAN */
export const warmSpanFor = (dayMinutes: number) =>
  Math.max(WARM_SPAN, Math.round(dayMinutes - THRESHOLD_MINUTES));

function mixHex(a: string, b: string, t: number): string {
  const ca = [1, 3, 5].map((k) => Number.parseInt(a.slice(k, k + 2), 16));
  const cb = [1, 3, 5].map((k) => Number.parseInt(b.slice(k, k + 2), 16));
  return `#${ca
    .map((v, i) => Math.round(v + ((cb[i] as number) - v) * t))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function sample(ramp: readonly string[], t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (ramp.length - 1);
  const i = Math.min(Math.floor(x), ramp.length - 2);
  return mixHex(ramp[i] as string, ramp[i + 1] as string, x - i);
}

/** 与外墙着色器一致的取色，供界面上的色块使用 */
export function rampColor(minutes: number, warmSpan = WARM_SPAN): string {
  return minutes < THRESHOLD_MINUTES
    ? sample(COOL_RAMP, minutes / THRESHOLD_MINUTES)
    : sample(WARM_RAMP, (minutes - THRESHOLD_MINUTES) / warmSpan);
}

/** 时间轴上的状态色 */
export const SPAN_COLOR = {
  lit: '#efbb55',
  unlit: '#c9d3e0',
} as const;
