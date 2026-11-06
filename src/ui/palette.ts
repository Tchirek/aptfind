/**
 * 日照时数的发散色阶，以大寒日 2 小时为界。
 *
 * 读法是"问题突出、正常退后"：不足 2 小时用蓝色，越缺越深、越扎眼；
 * 达标一侧用低彩度的沙色到陶土色，避免满屏的南墙压过真正的问题。
 * 冷色阶通过色盲模拟与对比度校验（明度单调、相邻 ΔL ≥ 0.06、浅端对背景 ≥ 2:1）；
 * 暖色阶浅端有意贴近底色（对比度 1.20:1），阈值另由深色等时线标出。
 * 阈值两侧的浅端色差 ΔE 21.3（正常色觉），红色盲模拟下 18.1。
 */

export const THRESHOLD_MINUTES = 120;

/** 0 → 2 小时，由深到浅 */
export const COOL_RAMP = ['#133466', '#24589e', '#3d7fd0', '#7fb0ec'] as const;
/** 2 → 6 小时及以上，由浅到深 */
export const WARM_RAMP = ['#efdcc0', '#e5c49d', '#d9a979', '#c98d5b'] as const;
/** 暖色阶覆盖的时长：2 小时之后再 4 小时到顶 */
export const WARM_SPAN = 240;

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
export function rampColor(minutes: number): string {
  return minutes < THRESHOLD_MINUTES
    ? sample(COOL_RAMP, minutes / THRESHOLD_MINUTES)
    : sample(WARM_RAMP, (minutes - THRESHOLD_MINUTES) / WARM_SPAN);
}

/** 时间轴上的状态色 */
export const SPAN_COLOR = {
  lit: '#d9a979',
  unlit: '#cfcac0',
} as const;
